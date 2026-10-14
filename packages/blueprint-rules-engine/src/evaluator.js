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
 *   missing     — list of unresolved input paths (state: 'missing' only)
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

import { timestampFromDate } from '@bufbuild/protobuf/wkt';

import { parse } from '@bufbuild/cel';
import { evaluateCELNode } from './cel.js';

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
    return Number.isNaN(date.getTime()) ? undefined : timestampFromDate(date);
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
 * Collection sub-fields ($.household.members[].age) are skipped: there is no
 * item to default into until the collection itself is supplied.
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

  const inputTypeErrors = buildInputTypeErrors(graph.inputs, inputs);
  const resolved = {};
  const nodes = {};

  for (const factName of ordered) {
    const deps = graph.dependencies[factName] ?? [];
    const missingPaths = new Set();
    const erroredDeps = new Set();
    const defaultedDeps = new Set();

    for (const dep of deps) {
      if (dep.startsWith('$.')) {
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
      if (defaultedDeps.has(dep)) return { state: 'placeholder' };
      if (!dep.startsWith('$.')) {
        if (resolved[dep] !== undefined) return { state: 'complete' };
        return { state: 'missing', missing: nodes[dep]?.state === 'missing' ? nodes[dep].missing : [dep] };
      }
      return missingPaths.has(dep) ? { state: 'missing', missing: [dep] } : { state: 'complete' };
    };

    let outcome;
    try {
      outcome = evaluateWithStates(expr, deps, depState, scope);
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
function evaluateWithStates(expr, deps, depState, scope) {
  const parsed = parse(expr);
  return statesOf(parsed.expr, deps, depState, scope);
}

function statesOf(node, deps, depState, scope) {
  const call = node.exprKind.case === 'callExpr' ? node.exprKind.value : null;
  const fn = call?.function;

  if (fn === '_&&_' || fn === '_||_') {
    const settles = fn === '_&&_' ? false : true;
    const sides = call.args.map((a) => statesOf(a, deps, depState, scope));
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
    const inner = statesOf(call.args[0], deps, depState, scope);
    return inner.state === 'missing' ? inner : { state: inner.state, value: !inner.value };
  }

  if (fn === '_?_:_') {
    const cond = statesOf(call.args[0], deps, depState, scope);
    if (cond.state === 'missing') return cond;
    const branch = statesOf(cond.value ? call.args[1] : call.args[2], deps, depState, scope);
    if (branch.state === 'missing') return branch;
    return { state: lessSettled(cond.state, branch.state), value: branch.value };
  }

  return leafStates(node, deps, depState, scope);
}

/**
 * A part of an expression with no and/or/conditional at its top: evaluated
 * whole, from the dependencies it mentions.
 *
 * Which dependencies a part mentions is read from the names it uses: a fact by
 * its identifier, an input by the dotted path it starts with — `screener.isWorking`
 * mentions `$.screener.isWorking`, and `household.members` mentions every
 * `$.household.members[]` path. Over-matching only ever makes a part less
 * settled than it could be, never gives it a wrong value.
 */
function leafStates(node, deps, depState, scope) {
  const chains = new Set();
  (function walk(n) {
    const k = n.exprKind;
    if (k.case === 'identExpr') { chains.add(k.value.name); return; }
    if (k.case === 'selectExpr') {
      const parts = [];
      let cur = n;
      while (cur.exprKind.case === 'selectExpr') { parts.unshift(cur.exprKind.value.field); cur = cur.exprKind.value.operand; }
      if (cur.exprKind.case === 'identExpr') { chains.add([cur.exprKind.value.name, ...parts].join('.')); return; }
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
  if (missing.length) return { state: 'missing', missing };
  return { state, value: evaluateCELNode(node, scope) };
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
