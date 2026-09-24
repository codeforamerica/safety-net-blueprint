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

import { evaluateCEL } from './cel.js';

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
function coerceDeclaredIntegers(scope, inputs, graphInputs) {
  for (const [path, spec] of Object.entries(graphInputs ?? {})) {
    if (spec.type !== 'integer') continue;

    const inner = path.slice(2);
    const subFieldIdx = inner.indexOf('[].');

    if (subFieldIdx === -1) {
      const val = resolveInputPath(path, scope);
      if (Number.isInteger(val)) setScopePath(scope, inputs, inner.split('.'), BigInt(val));
      continue;
    }

    // Collection sub-field ($.household.members[].age) — convert the field on
    // every item, replacing the array so the caller's items stay untouched.
    const collRef = inner.slice(0, subFieldIdx);
    const field = inner.slice(subFieldIdx + 3);
    const arr = resolveInputPath(`$.${collRef}`, scope);
    if (!Array.isArray(arr)) continue;

    setScopePath(
      scope,
      inputs,
      collRef.split('.'),
      arr.map((item) =>
        item && Number.isInteger(item[field]) ? { ...item, [field]: BigInt(item[field]) } : item
      )
    );
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
  coerceDeclaredIntegers(scope, inputs, graph.inputs);

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

    if (missingPaths.size > 0) {
      nodes[factName] = { type, state: 'missing', value: null, missing: [...missingPaths] };
      continue;
    }

    const factDecl = graph.facts[factName];
    const expr = factDecl?.expression;
    if (!expr) continue;

    let result;
    try {
      result = evaluateCEL(expr, scope);
    } catch (err) {
      nodes[factName] = {
        type,
        state: 'error',
        value: null,
        message: `Expression failed to evaluate: ${expr} — ${err.message}`,
      };
      continue;
    }

    resolved[factName] = result;
    // A fact declares its type just as an input does, and a fact reading it
    // has to see the same CEL type either way — otherwise `a * 2` fails on a
    // derived integer while succeeding on a declared one. The node keeps the
    // plain JS number; only the value CEL reads back is widened.
    scope[factName] =
      factDecl?.type === 'integer' && Number.isInteger(result) ? BigInt(result) : result;

    const state = defaultedDeps.size > 0 ? 'placeholder' : 'complete';
    nodes[factName] = { type, state, value: result };
  }

  return nodes;
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
