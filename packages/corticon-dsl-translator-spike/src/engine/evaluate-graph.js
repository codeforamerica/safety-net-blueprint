/**
 * Portable graph evaluator. Pure ESM, no Node.js or DOM APIs.
 * Works in both the browser and on the server (Node.js / mock server).
 *
 * Expressions use a CEL-compatible subset (arithmetic, comparison, logical,
 * ternary) that is also valid JavaScript, so evaluation is done via
 * new Function(). Variable names in expressions are the last path segment
 * of each node:
 *   $.Household.monthlyGrossIncome  →  monthlyGrossIncome
 *   Expedited.grossIncomeLimit      →  grossIncomeLimit
 *
 * Limitation: if two nodes share the same last segment (e.g. both
 * Foo.size and Bar.size), whichever is computed later will shadow the
 * earlier one in the scope. Avoid duplicate attribute names across
 * namespaces when authoring graphs.
 */

/** Last path segment of a node path (used as the JS variable name in expressions). */
export function localName(path) {
  return path.split('.').pop();
}

/**
 * Topological sort of derived node paths (Kahn's algorithm).
 * Input-only edges (from $.* nodes) are treated as roots.
 *
 * @param {string[]} derivedPaths - all non-input node paths
 * @param {Object}   revDeps      - { to: [from, ...] } reverse dependency map
 * @returns {string[]} derived paths in evaluation order
 */
function topoSort(derivedPaths, revDeps) {
  const derivedSet = new Set(derivedPaths);
  const inDegree = Object.fromEntries(derivedPaths.map(n => [n, 0]));
  const outEdges = Object.fromEntries(derivedPaths.map(n => [n, []]));

  for (const [to, fromList] of Object.entries(revDeps)) {
    if (!derivedSet.has(to)) continue;
    for (const from of fromList) {
      if (derivedSet.has(from)) {
        inDegree[to] = (inDegree[to] || 0) + 1;
        outEdges[from].push(to);
      }
    }
  }

  const queue = derivedPaths.filter(n => inDegree[n] === 0);
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

/**
 * Evaluate a graph with a (possibly partial) set of inputs.
 *
 * Nodes whose dependencies are not yet provided remain unresolved.
 * Their `missing` entry traces back to which original input paths
 * ($.* nodes) are the root cause, so the caller can tell the user
 * exactly which fields to fill in.
 *
 * @param {object} graph  - { nodes, edges } graph object
 * @param {object} inputs - { "$.Household.size": 3, ... } — partial OK
 * @returns {{ values, missing, errors, ordered }}
 *   values:  fullPath → computed value  (inputs + all resolved derived nodes)
 *   missing: fullPath → Set of missing input paths  (unresolved derived nodes)
 *   errors:  fullPath → error message  (nodes that threw during eval)
 *   ordered: string[] — derived nodes in evaluation order
 */
export function evaluateGraph(graph, inputs) {
  const allPairs = Object.values(graph.edges ?? {}).flat();

  // revDeps: to → [from, ...]
  const revDeps = {};
  for (const { from, to } of allPairs) {
    if (!revDeps[to]) revDeps[to] = [];
    if (!revDeps[to].includes(from)) revDeps[to].push(from);
  }

  const derivedPaths = Object.keys(graph.nodes ?? {}).filter(p => !p.startsWith('$.'));
  const ordered = topoSort(derivedPaths, revDeps);

  const values = {};   // fullPath → value
  const missing = {};  // fullPath → Set<inputPath>
  const errors = {};   // fullPath → string

  // Seed from provided inputs (skip empty strings / undefined)
  for (const path of Object.keys(graph.nodes ?? {})) {
    if (path.startsWith('$.')) {
      const v = inputs[path];
      if (v !== undefined && v !== null && v !== '') values[path] = v;
    }
  }

  // Evaluate derived nodes in topological order
  for (const nodePath of ordered) {
    const deps = revDeps[nodePath] ?? [];
    const missingSet = new Set();

    for (const dep of deps) {
      if (values[dep] === undefined) {
        if (dep.startsWith('$.')) {
          missingSet.add(dep);
        } else {
          // Trace through to root missing inputs
          const m = missing[dep];
          if (m && m.size > 0) {
            for (const mm of m) missingSet.add(mm);
          } else {
            missingSet.add(dep); // dep errored or has no expression
          }
        }
      }
    }

    if (missingSet.size > 0) {
      missing[nodePath] = missingSet;
      continue;
    }

    const expr = graph.nodes[nodePath]?.expression;
    if (!expr) continue;

    // Build scope: localName → value for all currently resolved nodes
    const scopeKeys = Object.keys(values).map(localName);
    const scopeVals = Object.values(values);

    try {
      // eslint-disable-next-line no-new-func
      values[nodePath] = new Function(...scopeKeys, 'return (' + expr + ')').apply(null, scopeVals);
    } catch (e) {
      errors[nodePath] = e.message;
    }
  }

  return { values, missing, errors, ordered };
}

/**
 * Return input node specs from a graph, sorted by path.
 * @param {object} graph
 * @returns {{ path: string, type?: string, description?: string }[]}
 */
export function getInputNodes(graph) {
  return Object.entries(graph.nodes ?? {})
    .filter(([p]) => p.startsWith('$.'))
    .map(([path, info]) => ({ path, ...info }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Return derived node paths in topological evaluation order.
 * @param {object} graph
 * @returns {string[]}
 */
export function getDerivedNodesInOrder(graph) {
  const allPairs = Object.values(graph.edges ?? {}).flat();
  const revDeps = {};
  for (const { from, to } of allPairs) {
    if (!revDeps[to]) revDeps[to] = [];
    if (!revDeps[to].includes(from)) revDeps[to].push(from);
  }
  const derivedPaths = Object.keys(graph.nodes ?? {}).filter(p => !p.startsWith('$.'));
  return topoSort(derivedPaths, revDeps);
}
