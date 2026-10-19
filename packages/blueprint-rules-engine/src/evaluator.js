/**
 * Blueprint rules evaluator.
 *
 * Walks a compiled graph in topological order (Kahn's algorithm) and evaluates
 * each fact's CEL expression against a (possibly partial) set of inputs.
 *
 * Facts are returned as typed nodes, each carrying:
 *   type        — 'intermediate' or 'output'
 *   state       — 'complete' | 'placeholder' | 'missing' | 'error'
 *   value       — resolved value (null when state is missing or error)
 *   message     — error description (state: 'error' only)
 *   missing     — list of unresolved input paths (state: 'missing' only). A
 *                 field of one item of a list is named at its position:
 *                 `$.household.members[1].age`.
 *
 * A per-item fact (`reviewMonths[].qualifies`) is computed once for each item
 * of its list fact. Its node has the same shape: `value` has one entry per
 * item, null where that item is unresolved, and `missing` names what those
 * items need.
 *
 * States mirror FactGraph's Complete/Placeholder/Incomplete, and are pinned to
 * it fact for fact by the parity tests in tests/fact-graph.test.js:
 *   complete    — fact resolved; every input it read was explicitly provided
 *   placeholder — fact resolved, but from a stand-in somewhere: an input that
 *                 fell back to its declared default, a null collection read as
 *                 [], or another fact that is itself a placeholder. Placeholder
 *                 is contagious in FactGraph and is contagious here.
 *   missing     — fact could not compute; missing required input paths (tracked)
 *   error       — fact threw during evaluation
 *
 * Input scope: top-level named inputs (household, policy) are placed directly in
 * scope so expressions like "household.monthlyIncome < policy.limit" resolve via
 * JavaScript property access.
 *
 * @module evaluator
 */

import { timestampFromDate, TimestampSchema } from '@bufbuild/protobuf/wkt';
import { reflect } from '@bufbuild/protobuf/reflect';

import { parse } from '@bufbuild/cel';
import { evaluateCEL, inputOf } from '@codeforamerica/blueprint-core/cel';

// ── Type checking ─────────────────────────────────────────────────────────────

/**
 * Check whether a runtime value matches its declared schema type.
 * null is treated as a type error (explicitly provided as wrong type),
 * undefined is absence (handled separately as missing).
 */
export function matchesType(val, declaredType) {
  const actual = Array.isArray(val) ? 'array' : val === null ? 'null' : typeof val;
  switch (declaredType) {
    case 'integer':
    case 'number':  return actual === 'number';
    case 'boolean': return actual === 'boolean';
    case 'string':  return actual === 'string';
    case 'array':   return actual === 'array';
    case 'object':  return actual === 'object';
    default:        return true;
  }
}

/**
 * Find declared array-typed input paths whose runtime value is null.
 * FactGraph's seedGraph skips null collections (treating them as absent),
 * and the Scala engine evaluates filters over an unset collection as Placeholder([]).
 * We replicate this: null collection → patch scope with [] → result is placeholder.
 */
function buildNullCollectionPaths(graphInputs, inputs) {
  const nullPaths = new Set();
  for (const [path, spec] of Object.entries(graphInputs ?? {})) {
    if (spec.type !== 'array') continue;
    const val = resolveInputPath(path, inputs);
    if (val === null) nullPaths.add(path);
  }
  return nullPaths;
}

/**
 * Write a value into the scope at a dotted path, cloning every object along
 * the way so the caller's input objects are never mutated.
 *
 * Missing intermediate objects are created, so a value can be written into a
 * namespace the caller did not supply at all.
 */
function setScopePath(scope, inputs, parts, value) {
  const namespace = parts[0];
  // A top-level input is the value itself, not an object holding it — a date
  // declared as an input of its own, say. Cloning it as an object spread a
  // string into a map and left the converted value inside it.
  if (parts.length === 1) {
    scope[namespace] = value;
    return;
  }
  // Shallow-clone the namespace so we don't mutate the user's object
  if (scope[namespace] === inputs[namespace]) {
    scope[namespace] = { ...inputs[namespace] };
  }
  let obj = scope[namespace];
  for (let i = 1; i < parts.length - 1; i++) {
    obj[parts[i]] = obj[parts[i]] != null ? { ...obj[parts[i]] } : {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
}

/**
 * Patch a scope object so that null array values become [].
 */
function patchNullCollections(scope, inputs, nullCollectionPaths) {
  for (const path of nullCollectionPaths) {
    // '$.household.members[]' → ['household', 'members']
    setScopePath(scope, inputs, path.slice(2).replace(/\[\]$/, '').split('.'), []);
  }
}

/**
 * Build a map of type errors for all declared input paths.
 * Only flags values that are present but have the wrong type.
 *
 * For scalar paths ($.household.monthlyIncome), the path itself is the map key.
 * For sub-field paths ($.household.members[].age), the *parent collection path*
 * ($.household.members[]) is the key — this aligns with the dependency graph,
 * where facts declare a dep on the collection, not individual sub-fields.
 * If any item in the collection has a wrong-type field, the whole collection
 * is flagged so all dependent facts are moved to errors.
 */
function buildInputTypeErrors(graphInputs, inputs) {
  const typeErrors = new Map();
  for (const [path, spec] of Object.entries(graphInputs ?? {})) {
    const inner = path.slice(2); // strip '$.'
    const subFieldIdx = inner.indexOf('[].');
    if (subFieldIdx !== -1) {
      // Sub-field path: e.g. $.household.members[].age
      const collRef = inner.slice(0, subFieldIdx);          // household.members
      const fieldName = inner.slice(subFieldIdx + 3);       // age
      const collPath = `$.${collRef}[]`;                    // $.household.members[]
      if (typeErrors.has(collPath)) continue;               // already flagged
      // Resolve the parent array
      const collParts = collRef.split('.');
      let arr = inputs;
      for (const p of collParts) {
        if (arr == null) break;
        arr = arr[p];
      }
      if (!Array.isArray(arr)) continue;
      // Check each item's field — null treated as absent, not a type error
      for (const item of arr) {
        const val = item[fieldName];
        if (val != null && !matchesType(val, spec.type)) {
          const actual = Array.isArray(val) ? 'array' : typeof val;
          typeErrors.set(collPath, `expected ${spec.type} for .${fieldName}, got ${actual}`);
          break;
        }
      }
    } else {
      // Scalar or top-level array path
      const val = resolveInputPath(path, inputs);
      // null is treated as absent (missing), not a type error — matches FactGraph's seedGraph
      // behavior of skipping null/undefined inputs rather than rejecting them.
      if (val != null && !matchesType(val, spec.type)) {
        const actual = Array.isArray(val) ? 'array' : typeof val;
        typeErrors.set(path, `expected ${spec.type}, got ${actual}`);
      }
    }
  }
  return typeErrors;
}

// ── Topological sort (Kahn's algorithm) ──────────────────────────────────────

function topoSort(factNames, dependencies) {
  const factSet = new Set(factNames);
  const inDegree = Object.fromEntries(factNames.map(f => [f, 0]));
  const outEdges = Object.fromEntries(factNames.map(f => [f, []]));

  for (const [fact, deps] of Object.entries(dependencies)) {
    if (!factSet.has(fact)) continue;
    for (const dep of deps) {
      if (factSet.has(dep)) {
        inDegree[fact]++;
        outEdges[dep].push(fact);
      }
    }
  }

  const queue = factNames.filter(f => inDegree[f] === 0);
  const ordered = [];
  while (queue.length) {
    const n = queue.shift();
    ordered.push(n);
    for (const m of outEdges[n]) {
      inDegree[m]--;
      if (inDegree[m] === 0) queue.push(m);
    }
  }
  return ordered;
}

// ── Input path resolution ─────────────────────────────────────────────────────

/**
 * Resolve a JSONPath input key ($.household.monthlyExpenses, $.household.members[])
 * to its value from the caller's named input objects.
 */
function resolveInputPath(path, inputs) {
  const clean = path.slice(2).replace(/\[\]$/, '');
  const parts = clean.split('.');
  let node = inputs;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

// ── Core evaluator ─────────────────────────────────────────────────────────────

/**
 * Convert values the graph declares as `integer` into BigInt, which is how a
 * CEL `int` is expressed in JavaScript.
 *
 * CEL keeps `int` and `double` apart and defines no arithmetic between them,
 * so `household.size * 3` fails when `size` arrives as a JS number: the value
 * is a double and the literal is an int. A JS number carries no int/double
 * distinction for the runtime to read, and the graph declares the type — so
 * the type it declares is the one CEL should see.
 *
 * This also makes `integer / integer` truncate, which is CEL's semantics for
 * two ints and what the declaration asks for. A fact wanting real division
 * should say `double(x)`, exactly as it would in any other CEL host.
 *
 * Non-integral values are left alone even where the declaration says
 * `integer`; `buildInputTypeErrors` is what reports those.
 */
/**
 * Convert a declared input to the CEL type its declaration names.
 *
 * Returns the converted value, or undefined to leave the value as it is.
 *
 * `integer` becomes a BigInt, which is how a CEL `int` is written in
 * JavaScript. CEL keeps `int` and `double` apart and defines no arithmetic
 * between them, so `household.size * 3` fails when the value arrives as a JS
 * number: the value is a double and the literal is an int. A JS number says
 * nothing about which it is, and the graph declares the type.
 *
 * `date` and `date-time` become CEL timestamps. Without this, an input
 * declared `format: date` arrives as `1989-03-13`, and CEL's only temporal
 * constructor rejects it — `timestamp('1989-03-13')` is not RFC 3339, so a
 * rule computing an age from a birthday written exactly as the schema
 * recommends fails to evaluate. Binding it here means an expression never
 * calls `timestamp()` on an input at all: `m.dateOfBirth.getFullYear()`
 * works, and the same declaration behaves the same way in any engine that
 * honours it. A bare date is read at UTC midnight.
 */
function coerceDeclared(spec, value) {
  if (spec.type === 'integer') {
    return Number.isInteger(value) ? BigInt(value) : undefined;
  }

  if (spec.type === 'string' && (spec.format === 'date' || spec.format === 'date-time')) {
    if (typeof value !== 'string') return undefined;
    // A date carries no time or zone; RFC 3339 needs both.
    const text = spec.format === 'date' && !value.includes('T') ? `${value}T00:00:00Z` : value;
    const date = new Date(text);
    // An unparseable value is left alone so it is reported as a bad input
    // rather than silently becoming an epoch date.
    // Bound already reflected. A bare Timestamp message is reflected by CEL each
    // time it's read, which looks its type up in a registry only an evaluation
    // has — so a date read afterwards failed: a fact returning the members
    // whose date of birth passes a test could not be converted back.
    return Number.isNaN(date.getTime()) ? undefined : reflect(TimestampSchema, timestampFromDate(date));
  }

  return undefined;
}

/**
 * Apply `coerceDeclared` to every declared input, including collection
 * sub-fields. The caller's objects are never mutated — `setScopePath` clones
 * on the way down and arrays are rebuilt.
 */
function coerceDeclaredInputs(scope, inputs, graphInputs) {
  for (const [path, spec] of Object.entries(graphInputs ?? {})) {
    const inner = path.slice(2);
    const subFieldIdx = inner.indexOf('[].');

    if (subFieldIdx === -1) {
      const converted = coerceDeclared(spec, resolveInputPath(path, scope));
      if (converted !== undefined) setScopePath(scope, inputs, inner.split('.'), converted);
      continue;
    }

    const collRef = inner.slice(0, subFieldIdx);
    const field = inner.slice(subFieldIdx + 3);
    const arr = resolveInputPath(`$.${collRef}`, scope);
    if (!Array.isArray(arr)) continue;

    let changed = false;
    const next = arr.map((item) => {
      if (!item) return item;
      const converted = coerceDeclared(spec, item[field]);
      if (converted === undefined) return item;
      changed = true;
      return { ...item, [field]: converted };
    });

    if (changed) setScopePath(scope, inputs, collRef.split('.'), next);
  }
}

/**
 * Declared input paths that carry a `default` and whose value the caller did
 * not supply, mapped to that default.
 *
 * The defaults are read from the compiled graph, keyed by field path, so a
 * caller who supplies part of a namespace still gets defaults for the rest of
 * it. They used to be read from the ruleset's authored `inputs:` block, passed
 * in alongside the graph — that applied defaults only when a whole namespace
 * was absent, and required the caller to hold the rules contract this engine
 * deliberately does not depend on.
 *
 * Collection sub-fields ($.household.members[].age) are skipped here: there
 * is no item to default into until the collection is supplied. Each item's
 * defaults are filled when its list's items are registered, by registerItems.
 */
function buildDefaultedPaths(graphInputs, inputs) {
  const defaults = new Map();
  for (const [path, spec] of Object.entries(graphInputs ?? {})) {
    if (spec.default === undefined || path.includes('[]')) continue;
    // null counts as absent here, matching how missing inputs are treated
    if (resolveInputPath(path, inputs) == null) defaults.set(path, spec.default);
  }
  return defaults;
}

/**
 * Evaluate a compiled graph against a (possibly partial) set of inputs.
 *
 * @param {Object} graph          - compiled graph document (facts, outputs, inputs, dependencies)
 * @param {Object} inputs         - named input objects, e.g. { household: { ... } }
 * @returns {Object}              - plain map of fact names to typed nodes
 */
export function evaluate(graph, inputs) {
  checkFormatVersion(graph);
  const outputSet = new Set(graph.outputs);
  const factNames = Object.keys(graph.facts);
  const ordered = topoSort(factNames, graph.dependencies);

  const scope = { ...inputs };

  const defaultedPaths = buildDefaultedPaths(graph.inputs, inputs);
  for (const [path, value] of defaultedPaths) {
    setScopePath(scope, inputs, path.slice(2).split('.'), value);
  }

  const nullCollectionPaths = buildNullCollectionPaths(graph.inputs, inputs);
  patchNullCollections(scope, inputs, nullCollectionPaths);

  // Last, so it also covers values written in by the two passes above.
  coerceDeclaredInputs(scope, inputs, graph.inputs);

  // Every item of every list the caller sent, with where it sits, so a field
  // one item lacks is named at its position.
  const ctx = { items: new Map(), results: new Map(), info: new WeakMap(), graph };
  registerItems(scope, inputs, graph.inputs, ctx.info);

  // The ruleset's constants, from the graph — given values, not inputs, so
  // nothing a caller sends replaces them and nothing resting on them is a
  // placeholder.
  if (graph.constants) {
    scope.constants = Object.fromEntries(Object.entries(graph.constants).map(([name, { value, type }]) => [
      name,
      coerceDeclared({ type }, value) ?? value,
    ]));
  }

  const inputTypeErrors = buildInputTypeErrors(graph.inputs, inputs);
  const resolved = {};
  const nodes = {};

  for (const factName of ordered) {
    const deps = graph.dependencies[factName] ?? [];
    const missingPaths = new Set();
    const erroredDeps = new Set();
    const defaultedDeps = new Set();

    for (const dep of deps) {
      if (isPerItem(dep)) {
        // A per-item fact has a state for each item, read where an item is.
        if (nodes[dep]?.state === 'error') erroredDeps.add(dep);
      } else if (dep.startsWith('$.')) {
        if (inputTypeErrors.has(dep)) {
          erroredDeps.add(dep);
        } else if (nullCollectionPaths.has(dep) || defaultedPaths.has(dep)) {
          defaultedDeps.add(dep);
        } else {
          const val = resolveInputPath(dep, inputs);
          if (val == null) missingPaths.add(dep);
        }
      } else {
        // Fact dependency — propagate error, missing and placeholder upward.
        // Facts are visited in topological order, so nodes[dep] is settled.
        if (nodes[dep]?.state === 'error') {
          erroredDeps.add(dep);
        } else if (resolved[dep] === undefined) {
          if (nodes[dep]?.state === 'missing') {
            for (const p of nodes[dep].missing) missingPaths.add(p);
          } else {
            missingPaths.add(dep);
          }
        } else if (nodes[dep]?.state === 'placeholder') {
          // A fact computed from a placeholder is itself a placeholder —
          // FactGraph's Placeholder is contagious the same way.
          defaultedDeps.add(dep);
        }
      }
    }

    const type = outputSet.has(factName) ? 'output' : 'intermediate';

    if (erroredDeps.size > 0) {
      const details = [...erroredDeps].map(d =>
        inputTypeErrors.has(d) ? `'${d}' — ${inputTypeErrors.get(d)}` : `'${d}' — ${nodes[d]?.message}`
      ).join('; ');
      nodes[factName] = { type, state: 'error', value: null, message: `Dependency error: ${details}` };
      continue;
    }

    const factDecl = graph.facts[factName];
    const expr = factDecl?.expression;
    if (!expr) {
      if (missingPaths.size > 0) {
        nodes[factName] = { type, state: 'missing', value: null, missing: [...missingPaths] };
      }
      continue;
    }

    // What each dependency contributes, read by the evaluation below for
    // whichever part of the expression mentions it.
    const depState = (dep) => {
      if (isPerItem(dep)) {
        const node = nodes[dep];
        return node?.state === 'missing' ? { state: 'missing', missing: node.missing } : { state: node?.state ?? 'complete' };
      }
      if (defaultedDeps.has(dep)) return { state: 'placeholder' };
      if (!dep.startsWith('$.')) {
        if (resolved[dep] !== undefined) return { state: 'complete' };
        return { state: 'missing', missing: nodes[dep]?.state === 'missing' ? nodes[dep].missing : [dep] };
      }
      return missingPaths.has(dep) ? { state: 'missing', missing: [dep] } : { state: 'complete' };
    };

    const list = listFactOf(factName);
    if (list) {
      try {
        nodes[factName] = { type, ...evaluatePerItem(factName, list, factDecl, deps, depState, scope, ctx, nodes) };
      } catch (err) {
        nodes[factName] = { type, state: 'error', value: null, message: `Expression failed to evaluate: ${expr} — ${err.message}` };
      }
      continue;
    }

    let outcome;
    try {
      outcome = evaluateWithStates(expr, deps, depState, scope, ctx);
    } catch (err) {
      nodes[factName] = {
        type,
        state: 'error',
        value: null,
        message: `Expression failed to evaluate: ${expr} — ${err.message}`,
      };
      continue;
    }

    if (outcome.state === 'missing') {
      nodes[factName] = { type, state: 'missing', value: null, missing: [...new Set(outcome.missing)] };
      continue;
    }

    const result = outcome.value;
    resolved[factName] = result;
    // A fact declares its type just as an input does, and a fact reading it
    // has to see the same CEL type either way — otherwise `a * 2` fails on a
    // derived integer while succeeding on a declared one. The node keeps the
    // plain JS number; only the value CEL reads back is widened.
    scope[factName] =
      factDecl?.type === 'integer' && Number.isInteger(result) ? BigInt(result) : result;
    // A list fact's items carry the facts computed on them, so the scope holds
    // its own copies of them; the node keeps the items as they came.
    if (factDecl.as && Array.isArray(result)) {
      scope[factName] = listItems(factName, parse(expr).expr, result, scope, ctx, { at: '', standing: outcome.state });
    }

    nodes[factName] = { type, state: outcome.state, value: result };
  }

  return nodes;
}

// ── States through and, or and the conditional ───────────────────────────────

const STANDING = { complete: 0, placeholder: 1, missing: 2 };
const lessSettled = (a, b) => (STANDING[a] >= STANDING[b] ? a : b);

/**
 * Evaluate a fact's expression, giving its result the standing the result
 * actually rests on.
 *
 * A fact's state used to be read off its dependency list before anything was
 * evaluated: any defaulted input made it a placeholder, any missing one made it
 * missing. That is right for most expressions and wrong for the three that do
 * not always need every operand. `false && x` is false whatever x is, so it is
 * complete even when x is unanswered or rests on a default; likewise
 * `true || x`. FactGraph combines states this way, through All, Any and
 * Switch, and so does any interview that wants an answer as soon as one is
 * settled — an exempt person should not be held up by the hours question.
 *
 * So `&&`, `||`, `!` and `? :` are evaluated operand by operand, each carrying
 * a state; anything else is a leaf, evaluated whole from the dependencies it
 * mentions, exactly as a fact used to be. A complete operand settles an and/or
 * outright. One that settles it on a default does so for `or` always, and for
 * `and` only when nothing else is unanswered — FactGraph's Any and All, matched
 * as they are. A conditional whose condition is unknown is missing — it is not
 * known which branch applies — where FactGraph takes the first branch whose
 * condition is known; that one is not matched, because it names a result that
 * can turn out wrong.
 *
 * Errors are not part of this: a wrong-type input still errors every fact that
 * reads it, before any evaluation, as the conformance corpus requires.
 *
 * @returns {{ state: 'complete'|'placeholder'|'missing', value?: *, missing?: string[] }}
 */
function evaluateWithStates(expr, deps, depState, scope, ctx) {
  const parsed = parse(expr);
  return statesOf(parsed.expr, deps, depState, scope, ctx);
}

/**
 * What a part of an expression is evaluated inside: the items bound by name
 * around it — a list macro's loop variable, or a list fact's `as` — each with
 * what is known about it, and the state of each macro's running result. With
 * them, the graph and every registered item's ItemInfo.
 *
 * @typedef {{ items: Map<string, ItemInfo|null>, results: Map<string, object>, info: WeakMap<object, ItemInfo>, graph: object }} LoopContext
 */

function statesOf(node, deps, depState, scope, loop) {
  if (node.exprKind.case === 'comprehensionExpr') return comprehensionStates(node, deps, depState, scope, loop);

  const call = node.exprKind.case === 'callExpr' ? node.exprKind.value : null;
  const fn = call?.function;

  if (fn === '_&&_' || fn === '_||_') {
    const settles = fn === '_&&_' ? false : true;
    const sides = call.args.map((a) => statesOf(a, deps, depState, scope, loop));
    // A complete operand that settles the result decides it outright.
    if (sides.some((s) => s.state === 'complete' && s.value === settles)) {
      return { state: 'complete', value: settles };
    }
    // An operand that settles it only on a default: here `and` and `or` differ,
    // deliberately, because FactGraph's All and Any do. A defaulted `true`
    // settles an `or` — a provisional true, labelled as such — even while
    // another operand is unanswered. A defaulted `false` does not settle an
    // `and` while one is: the result is unanswered. Asymmetric, and kept so: the
    // point is to answer as FactGraph answers, and both outcomes are flagged
    // (placeholder, missing), so neither claims more than is known.
    const placeholderSettles = sides.some((s) => s.state === 'placeholder' && s.value === settles);
    if (placeholderSettles && fn === '_||_') return { state: 'placeholder', value: settles };
    const missing = sides.filter((s) => s.state === 'missing');
    if (missing.length) return { state: 'missing', missing: missing.flatMap((s) => s.missing) };
    if (placeholderSettles) return { state: 'placeholder', value: settles };
    return { state: sides.map((s) => s.state).reduce(lessSettled), value: !settles };
  }

  if (fn === '!_') {
    const inner = statesOf(call.args[0], deps, depState, scope, loop);
    return inner.state === 'missing' ? inner : { state: inner.state, value: !inner.value };
  }

  if (fn === '_?_:_') {
    const cond = statesOf(call.args[0], deps, depState, scope, loop);
    if (cond.state === 'missing') return cond;
    const branch = statesOf(cond.value ? call.args[1] : call.args[2], deps, depState, scope, loop);
    if (branch.state === 'missing') return branch;
    return { state: lessSettled(cond.state, branch.state), value: branch.value };
  }

  return leafStates(node, deps, depState, scope, loop);
}

// ── States through the list macros ───────────────────────────────────────────

/**
 * A list macro — `exists`, `all`, `exists_one`, `filter`, `map` — given the
 * standing its result rests on, item by item.
 *
 * An absent input is missing, never an error and never a guess, and that
 * holds for a field one item of a list doesn't have as much as for an input
 * at the top: a household member added before their birth date is known
 * leaves the question "is anyone 60 or older" unanswered, not failed and not
 * "no". So an item's field that isn't there is unknown for that item, and the
 * macro's answer is missing only when that item could change it: `exists`
 * with another item already true is true, `all` with one already false is
 * false, and a predicate that is settled without the field — a guard on
 * `has()`, or `isDisabled || age >= 60` for a disabled member — settles that
 * item. Which items come first doesn't matter.
 *
 * The parser expands every macro into one loop: a starting result, a step
 * combining the running result with each item, a condition to stop early, and
 * a final result. `exists` steps with `@result || p`, `all` with `@result && p`,
 * `filter` with `p ? @result + [m] : @result`. Walking that loop with states,
 * through the `&&`, `||` and `? :` rules above, gives each macro the right
 * answer without naming any of them.
 *
 * When every item has every field the step reads, the macro is evaluated
 * whole, as before, so a complete list gives exactly the answer it always did.
 * What remains unknown past a macro — an unknown list's size, say — is #493.
 */
function comprehensionStates(node, deps, depState, scope, loop) {
  const c = node.exprKind.value;
  const chain = chainOf(c.iterRange);
  // Walking a list fact needs the list, not the facts on its items: those are
  // read item by item below, so one unresolved item settles nothing early.
  const range = chain && loop.graph?.facts[chain]?.as
    ? { ...depState(chain), value: lookupChain(chain, scope) }
    : statesOf(c.iterRange, deps, depState, scope, loop);
  if (range.state === 'missing') return range;

  // The items as the scope holds them, so a declared date is still a date.
  // A range that is computed — another macro's result — has only its value.
  const items = (chain && lookupChain(chain, scope)) ?? range.value;
  if (!Array.isArray(items)) return leafStates(node, deps, depState, scope, loop);

  if (!hasUnknownItem(c, items, scope, loop)) return leafStates(node, deps, depState, scope, loop);

  let result = statesOf(c.accuInit, deps, depState, scope, loop);
  for (const item of items) {
    const inside = withResult(withItem(loop, c.iterVar, loop.info?.get(item) ?? null), c.accuVar, result);
    const bound = { ...scope, [c.iterVar]: item, [c.accuVar]: result.value };
    const proceed = statesOf(c.loopCondition, deps, depState, bound, inside);
    if (proceed.state !== 'missing' && proceed.value === false) break;
    result = statesOf(c.loopStep, deps, depState, bound, inside);
  }
  return statesOf(c.result, deps, depState, { ...scope, [c.accuVar]: result.value }, withResult(loop, c.accuVar, result));
}

/**
 * Whether any item a macro walks — at its own level, or in a macro nested in
 * its step, such as each wage record against the member's incomes — lacks a
 * field the step reads. Decided before evaluating, from the data, so a macro
 * with nothing unknown is evaluated whole and one with an unknown item is
 * walked item by item.
 *
 * A nested macro over a list another expression computes can't be checked
 * this way, since its items exist only once evaluated, so it is walked item
 * by item: that is correct for any list, only slower.
 *
 * @param {object} c - The comprehension
 * @param {unknown[]} items - The items it walks
 * @param {object} scope
 * @returns {boolean}
 */
function hasUnknownItem(c, items, scope, loop) {
  const read = readFields(c.loopStep, c.iterVar);
  const nested = nestedComprehensions(c.loopStep);
  return items.some((item) => {
    const info = loop.info?.get(item);
    if (read.some((path) => fieldStanding(info, path)?.state !== 'complete' || valueAt(item, path) == null)) return true;
    const bound = { ...scope, [c.iterVar]: item };
    return nested.some((n) => {
      const inner = n.exprKind.value;
      const chain = chainOf(inner.iterRange);
      if (!chain) return true;
      const innerItems = lookupChain(chain, bound);
      return Array.isArray(innerItems) && hasUnknownItem(inner, innerItems, bound, loop);
    });
  });
}

/** The macros directly in an expression: not those inside another macro, which their own check covers. */
function nestedComprehensions(node) {
  const found = [];
  (function walk(n) {
    const k = n.exprKind;
    if (k.case === 'comprehensionExpr') { found.push(n); return; }
    if (k.case === 'selectExpr') { walk(k.value.operand); return; }
    if (k.case === 'callExpr') { if (k.value.target) walk(k.value.target); k.value.args.forEach(walk); return; }
    if (k.case === 'listExpr') { k.value.elements.forEach(walk); return; }
    if (k.case === 'structExpr') { k.value.entries.forEach((e) => e.value && walk(e.value)); }
  })(node);
  return found;
}

function withItem(loop, name, info) {
  return { ...loop, items: new Map(loop.items).set(name, info) };
}

function withResult(loop, name, state) {
  return { ...loop, results: new Map(loop.results).set(name, state) };
}

/** `household.members` for an expression that is just a dotted name, else null. */
function chainOf(node) {
  const parts = [];
  let cur = node;
  while (cur.exprKind.case === 'selectExpr' && !cur.exprKind.value.testOnly) {
    parts.unshift(cur.exprKind.value.field);
    cur = cur.exprKind.value.operand;
  }
  return cur.exprKind.case === 'identExpr' ? [cur.exprKind.value.name, ...parts].join('.') : null;
}

function lookupChain(chain, scope) {
  return valueAt(scope, chain.split('.'));
}

function valueAt(value, path) {
  let node = value;
  for (const part of path) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

/**
 * The fields of a loop's item a step reads, as paths below the item: `m.a.b`
 * reads ['a', 'b']. A field read only to ask whether it is there — `has(m.a)` —
 * isn't one: absence is what it asks about.
 */
function readFields(node, itemVar) {
  const found = [];
  (function walk(n) {
    const k = n.exprKind;
    if (k.case === 'selectExpr') {
      if (k.value.testOnly) return;
      const chain = chainOf(n);
      if (chain) {
        const [head, ...path] = chain.split('.');
        if (head === itemVar && path.length) found.push(path);
        return;
      }
      walk(k.value.operand);
      return;
    }
    if (k.case === 'callExpr') { if (k.value.target) walk(k.value.target); k.value.args.forEach(walk); return; }
    if (k.case === 'listExpr') { k.value.elements.forEach(walk); return; }
    if (k.case === 'structExpr') { k.value.entries.forEach((e) => e.value && walk(e.value)); return; }
    if (k.case === 'comprehensionExpr') {
      const c = k.value;
      [c.iterRange, c.accuInit, c.loopCondition, c.loopStep, c.result].forEach((x) => x && walk(x));
    }
  })(node);
  return found;
}

/**
 * A part of an expression with no and/or/conditional at its top: evaluated
 * whole, from the dependencies it mentions.
 *
 * Which dependencies a part mentions is read from the names it uses: a fact by
 * its identifier, an input by the dotted path it starts with — `screener.isWorking`
 * mentions `$.screener.isWorking`, and `household.members` mentions every
 * `$.household.members[]` path. Over-matching only ever makes a part less
 * settled than it could be, never gives it a wrong value. A per-item fact is
 * read on an item, so its state is that item's, not the list's.
 */
function leafStates(node, deps, depState, scope, loop) {
  const chains = new Set();
  // Names read for their value, not only asked about with has(): what an
  // item of a list macro must have for this part to be evaluated.
  const needed = new Set();
  (function walk(n) {
    const k = n.exprKind;
    if (k.case === 'identExpr') { chains.add(k.value.name); needed.add(k.value.name); return; }
    if (k.case === 'selectExpr') {
      const parts = [];
      let cur = n;
      while (cur.exprKind.case === 'selectExpr') { parts.unshift(cur.exprKind.value.field); cur = cur.exprKind.value.operand; }
      if (cur.exprKind.case === 'identExpr') {
        const chain = [cur.exprKind.value.name, ...parts].join('.');
        chains.add(chain);
        if (!k.value.testOnly) needed.add(chain);
        return;
      }
      walk(cur);
      return;
    }
    if (k.case === 'callExpr') { if (k.value.target) walk(k.value.target); k.value.args.forEach(walk); return; }
    if (k.case === 'listExpr') { k.value.elements.forEach(walk); return; }
    if (k.case === 'structExpr') { k.value.entries.forEach((e) => e.value && walk(e.value)); return; }
    if (k.case === 'comprehensionExpr') {
      const c = k.value;
      [c.iterRange, c.accuInit, c.loopCondition, c.loopStep, c.result].forEach((x) => x && walk(x));
    }
  })(node);

  const mentions = (dep) => {
    // A per-item fact is read on an item, and its state is that item's.
    if (isPerItem(dep)) return false;
    if (!dep.startsWith('$.')) return chains.has(dep);
    const base = dep.slice(2).split('[]')[0];
    for (const c of chains) {
      if (c === base || base.startsWith(c + '.') || c.startsWith(base + '.')) return true;
    }
    return false;
  };

  let state = 'complete';
  const missing = [];
  for (const dep of deps.filter(mentions)) {
    const s = depState(dep);
    if (s.state === 'missing') missing.push(...s.missing);
    else state = lessSettled(state, s.state);
  }

  // Inside a list macro or a per-item fact: a running result carries its own
  // state, a fact on an item carries that item's, a field filled by its
  // default is a placeholder, and a field this item doesn't have is missing,
  // named where the item sits.
  for (const chain of needed) {
    const [head, ...path] = chain.split('.');
    if (loop.results.has(head)) {
      const s = loop.results.get(head);
      if (s.state === 'missing') missing.push(...s.missing);
      else state = lessSettled(state, s.state);
    } else if (loop.items.has(head) && path.length) {
      const info = loop.items.get(head);
      const standing = fieldStanding(info, path);
      if (standing?.state === 'missing') missing.push(...standing.missing);
      else if (standing) state = lessSettled(state, standing.state);
      else if (valueAt(scope[head], path) == null) missing.push(info?.path ? `${info.path}.${path.join('.')}` : chain);
    }
  }

  // A macro inside this part is evaluated whole, so what each item it walks
  // carries is checked here: a fact on an item with that item's state, a
  // defaulted field as a placeholder.
  for (const n of nestedComprehensions(node)) {
    const s = itemStandings(n.exprKind.value, scope, loop);
    missing.push(...s.missing);
    state = lessSettled(state, s.state);
  }

  if (missing.length) return { state: 'missing', missing: [...new Set(missing)] };
  return { state, value: evaluateCEL(node, scope) };
}

/**
 * The standing of what a macro reads from the items it walks, item by item:
 * the per-item facts and defaulted fields among them, and so on into the
 * macros inside it. A macro over a list another expression computes is
 * checked through the macros that compute it.
 *
 * @returns {{ state: 'complete'|'placeholder', missing: string[] }}
 */
function itemStandings(c, scope, loop) {
  let state = 'complete';
  const missing = [];
  const merge = (s) => {
    if (s.state === 'missing') missing.push(...s.missing);
    else state = lessSettled(state, s.state);
  };
  for (const n of nestedComprehensions(c.iterRange)) merge(itemStandings(n.exprKind.value, scope, loop));

  const chain = chainOf(c.iterRange);
  const items = chain && lookupChain(chain, scope);
  if (Array.isArray(items)) {
    const read = readFields(c.loopStep, c.iterVar);
    const inner = nestedComprehensions(c.loopStep);
    for (const item of items) {
      const info = loop.info?.get(item);
      for (const path of read) {
        const s = fieldStanding(info, path);
        if (s) merge(s);
      }
      const bound = { ...scope, [c.iterVar]: item };
      for (const n of inner) merge(itemStandings(n.exprKind.value, bound, withItem(loop, c.iterVar, info ?? null)));
    }
  }
  return { state, missing };
}

// ── Items and per-item facts ─────────────────────────────────────────────────

/**
 * What is known about one item of a list: where it sits, for naming what it
 * lacks, and the standing of what it carries.
 *
 * @typedef {object} ItemInfo
 * @property {string|null} path - Where a missing field is named: the item's
 *   position in the input (`$.months[1]`), or, for an item a list fact built,
 *   its position in that list (`reviewMonths[0]`)
 * @property {Set<string>} defaulted - Fields filled by their declared default
 * @property {string} [list] - The list fact the item belongs to
 * @property {string} [at] - Its position in that list fact, e.g. `reviewMonths[0].reviewWeeks[1]`
 * @property {string} [standing] - The list fact's state for the list holding it
 * @property {Object<string, object>} [facts] - Each per-item fact's state for it, by name
 */

/** The graph format editions this engine runs: any 1.x up to this one. */
const FORMAT_VERSION = '1.1';

/**
 * Refuse a graph written in an edition this engine doesn't know, rather than
 * evaluate what it doesn't understand. A minor edition only adds, so every
 * earlier one runs; a later one may use what this engine lacks, and another
 * major means something else. No edition is 1.0.
 */
function checkFormatVersion(graph) {
  const version = graph.formatVersion ?? '1.0';
  const [major, minor] = String(version).split('.').map(Number);
  const [knownMajor, knownMinor] = FORMAT_VERSION.split('.').map(Number);
  if (major !== knownMajor || !(minor <= knownMinor)) {
    throw new Error(`This graph is written in format ${version}; this engine runs format ${knownMajor}.0 through ${FORMAT_VERSION}. Use an engine that supports ${version}.`);
  }
}

/** Whether a dependency is a per-item fact: a fact, not an input, with `[].` in its path. */
function isPerItem(dep) {
  return !dep.startsWith('$.') && dep.includes('[].');
}

/** The list fact a per-item fact is on: `a[].b[].c` is on `a[].b`. */
function listFactOf(factPath) {
  const at = factPath.lastIndexOf('[].');
  return at < 0 ? null : factPath.slice(0, at);
}

/**
 * Copy every item of every list the graph declares into the scope, fill each
 * item's declared defaults, and record where each sits. Lists inside items
 * are reached through their items, outermost first: `$.months[].weeks[]`
 * after `$.months[]`.
 *
 * The scope's items are its own copies, so nothing written into them — a
 * default, a fact computed on them — reaches the caller's objects.
 */
function registerItems(scope, inputs, graphInputs, info) {
  const lists = Object.keys(graphInputs ?? {})
    .filter((path) => path.endsWith('[]'))
    .sort((a, b) => a.split('[]').length - b.split('[]').length);
  const registered = new Map();

  for (const list of lists) {
    const owner = listFactOf(list.slice(0, -2));
    const field = list.slice(owner ? owner.length + 3 : 2, -2);
    const holders = owner ? registered.get(`${owner}[]`) ?? [] : [{ value: scope, path: '$' }];
    const fieldDefaults = Object.entries(graphInputs)
      .filter(([path, spec]) => spec.default !== undefined && path.startsWith(`${list}.`) && !path.slice(list.length + 1).includes('[]'))
      .map(([path, spec]) => [path.slice(list.length + 1).split('.'), coerceDeclared(spec, spec.default) ?? spec.default]);

    const items = [];
    for (const holder of holders) {
      const parts = field.split('.');
      const arr = valueAt(holder.value, parts);
      if (!Array.isArray(arr)) continue;
      const copies = arr.map((item, i) => {
        if (item === null || typeof item !== 'object') return item;
        const copy = { ...item };
        const defaulted = new Set();
        for (const [fieldPath, value] of fieldDefaults) {
          if (valueAt(copy, fieldPath) == null) { writeAt(copy, fieldPath, value); defaulted.add(fieldPath.join('.')); }
        }
        const path = `${holder.path}.${field}[${i}]`;
        info.set(copy, { path, defaulted });
        items.push({ value: copy, path });
        return copy;
      });
      if (holder.value === scope) setScopePath(scope, inputs, parts, copies);
      else writeAt(holder.value, parts, copies);
    }
    registered.set(list, items);
  }
}

/** Write a value at a path inside an object the evaluator owns, copying objects on the way down. */
function writeAt(obj, path, value) {
  let node = obj;
  for (const part of path.slice(0, -1)) {
    node[part] = node[part] != null && typeof node[part] === 'object' ? { ...node[part] } : {};
    node = node[part];
  }
  node[path[path.length - 1]] = value;
}

/**
 * The standing of a field an item carries, when the item knows it: a fact
 * computed on the item has that item's state, and a field filled by its
 * default is a placeholder. Undefined for a field the item simply has or
 * lacks — the caller checks its value.
 */
function fieldStanding(info, path) {
  if (!info) return undefined;
  if (info.facts && path[0] in info.facts) return info.facts[path[0]];
  if (info.defaulted?.has(path.join('.'))) return { state: 'placeholder' };
  return undefined;
}

/**
 * The scope's copies of a list fact's items, each registered with what is
 * known about it, so the facts computed on them can be written in and read
 * back by name.
 *
 * When the items are an input's items (inputOf), they are found among the
 * scope's own items, so each keeps its position in the input and the defaults
 * it was given. Otherwise they are new, and named by their position in the
 * list fact.
 *
 * @param {string} list - The list fact
 * @param {object} expr - Its parsed expression
 * @param {unknown[]} value - Its value, as evaluated
 * @param {object} scope - The scope it was evaluated in, items bound
 * @param {LoopContext} ctx
 * @param {{ at: string, standing: string }} parent - Where the list sits, and the state it rests on
 */
function listItems(list, expr, value, scope, ctx, parent) {
  const name = list.includes('[].') ? list.slice(list.lastIndexOf('[].') + 3) : list;
  const sources = inputOf(ctx.graph, list) ? itemsOfInput(expr, scope) : value;
  return sources.map((source, i) => {
    const from = ctx.info.get(source);
    const at = `${parent.at ? `${parent.at}.` : ''}${name}[${i}]`;
    const copy = source !== null && typeof source === 'object' ? { ...source } : source;
    if (copy !== source) {
      ctx.info.set(copy, {
        path: from?.path ?? at,
        defaulted: from?.defaulted ?? new Set(),
        list,
        at,
        standing: parent.standing,
        facts: {},
      });
    }
    return copy;
  });
}

/**
 * The scope's own items a list fact keeps, for an expression inputOf has
 * found to keep an input's items: the input, a field of an item, `filter` of
 * one, or `? :` between them. Each is evaluated as CEL evaluates it, so the
 * items found are the items the list fact's value holds.
 *
 * `filter` expands to a loop whose step is `p ? @result + [m] : @result`, as
 * the CEL specification defines the macro; `p` is read from that step.
 */
function itemsOfInput(expr, scope) {
  const { case: kind, value } = expr.exprKind;
  if (kind === 'comprehensionExpr') {
    const keeps = value.loopStep.exprKind.value.args[0];
    return itemsOfInput(value.iterRange, scope).filter((item) => evaluateCEL(keeps, { ...scope, [value.iterVar]: item }) === true);
  }
  if (kind === 'callExpr' && value.function === '_?_:_') {
    return itemsOfInput(evaluateCEL(value.args[0], scope) ? value.args[1] : value.args[2], scope);
  }
  return lookupChain(chainOf(expr), scope);
}

/**
 * A per-item fact, computed once for each item of its list.
 *
 * Each item is bound by its list's `as` name, and each enclosing list's item
 * by that list's, and the expression is evaluated with the same rules as any
 * fact. What it gives each item is written onto that item, so a later
 * expression reads it as a field.
 *
 * The node's `value` has one entry per item, in the list's order, null where
 * that item is unresolved; on an inner list, one list per outer item. Its
 * state is the least settled of its items', and `missing` names what the
 * unresolved ones need.
 */
function evaluatePerItem(factName, list, factDecl, deps, depState, scope, ctx, nodes) {
  const root = factName.slice(0, factName.indexOf('[].'));
  if (!Array.isArray(scope[root])) {
    return nodes[root]?.state === 'missing'
      ? { state: 'missing', value: null, missing: nodes[root].missing }
      : { state: 'missing', value: null, missing: [root] };
  }

  const name = factName.slice(list.length + 3);
  const expr = parse(factDecl.expression).expr;
  const missing = [];
  let state = 'complete';

  // Every item of `list`, with the items enclosing it bound by name. An outer
  // item whose inner list is unresolved has no items; its entry is null and
  // the list's own state for it stands.
  const each = (listPath, fn) => {
    const outer = listFactOf(listPath);
    if (!outer) return fn(scope[listPath], { ...scope }, ctx);
    const inner = listPath.slice(outer.length + 3);
    const as = ctx.graph.facts[outer].as;
    return each(outer, (items, bound, loop) => items.map((item) => {
      const info = ctx.info.get(item);
      const itemBound = { ...bound, [as]: item };
      const itemLoop = withItem(loop, as, info ?? null);
      const standing = info?.facts?.[inner];
      if (!Array.isArray(item?.[inner])) {
        if (standing?.state === 'missing') missing.push(...standing.missing);
        state = 'missing';
        return null;
      }
      return fn(item[inner], itemBound, itemLoop);
    }));
  };

  const as = ctx.graph.facts[list].as;
  const value = each(list, (items, bound, loop) => items.map((item) => {
    const info = ctx.info.get(item);
    const outcome = statesOf(expr, deps, depState, { ...bound, [as]: item }, withItem(loop, as, info ?? null));
    const settled = outcome.state === 'missing' ? outcome : { ...outcome, state: lessSettled(outcome.state, info?.standing ?? 'complete') };
    if (info) info.facts[name] = settled;
    if (settled.state === 'missing') {
      missing.push(...settled.missing);
      state = 'missing';
      return null;
    }
    if (state !== 'missing') state = lessSettled(state, settled.state);
    item[name] = factDecl.type === 'integer' && Number.isInteger(settled.value) ? BigInt(settled.value) : settled.value;
    if (factDecl.as && Array.isArray(settled.value)) {
      item[name] = listItems(factName, expr, settled.value, { ...bound, [as]: item }, ctx, { at: info?.at ?? '', standing: settled.state });
    }
    return settled.value;
  }));

  return state === 'missing'
    ? { state, value, missing: [...new Set(missing)] }
    : { state, value };
}

// ── Internal fluent API (intra-package use only; not exported from index.js) ──

export class EvalResult {
  constructor(nodes) { this._nodes = nodes; }
  get(name) { return this._nodes[name]; }
  filter(typeOrNames) {
    if (Array.isArray(typeOrNames)) {
      const names = new Set(typeOrNames);
      return new EvalResult(Object.fromEntries(Object.entries(this._nodes).filter(([k]) => names.has(k))));
    }
    return new EvalResult(Object.fromEntries(Object.entries(this._nodes).filter(([, n]) => n.type === typeOrNames)));
  }
  collect(state) {
    return Object.fromEntries(
      Object.entries(this._nodes).filter(([, n]) => n.state === state).map(([k, n]) => {
        if (state === 'error')   return [k, n.message];
        if (state === 'missing') return [k, n.missing];
        return [k, n.value];
      })
    );
  }
  toJSON() { return this._nodes; }
}

export class Graph {
  constructor(compiled) {
    this._compiled = compiled;
  }
  evaluate(inputs) {
    return new EvalResult(evaluate(this._compiled, inputs));
  }
}

/**
 * Wrap a compiled decision graph for evaluation.
 *
 * Takes a graph, not a rules contract. Compiling a contract into a graph is
 * blueprint-core's `generate`, which is a build-time step — this engine is
 * the runtime, and keeping the two apart is what lets it run without the
 * contract tooling installed.
 *
 * @param {object} graph - A compiled graph: facts, outputs, dependencies
 * @returns {Graph}
 */
export function toGraph(graph) {
  if (!graph?.facts || !graph?.outputs) {
    throw new TypeError(
      'toGraph expects a compiled graph (facts, outputs). To compile a rules ' +
      'contract, use generate(docs, \'graph\') from @codeforamerica/blueprint-core ' +
      'and pass the graph it produces.'
    );
  }
  return new Graph(graph);
}
