/**
 * Browser-compatible evaluator bundle.
 *
 * Derived from blueprint-rules-engine/src/cel.js and evaluator.js.
 * Contains only evaluateGraph (which takes a pre-compiled graph) — the
 * compile step happens at build time, not in the browser.
 *
 * Exposed as window.RulesEngine = { evaluateGraph }.
 */
(function () {

// ── CEL evaluator (from cel.js) ───────────────────────────────────────────────

function evaluateCEL(expr, context) {
  if (context === undefined) context = {};
  if (!expr || typeof expr !== 'string') return undefined;
  try {
    let js = expr
      // has(field) → field != null && field !== ''
      .replace(/\bhas\(([^)]+)\)/g, '($1 != null && $1 !== "")')
      // .size() → .length
      .replace(/\.size\(\)/g, '.length')
      // .contains(x) → .includes(x)
      .replace(/\.contains\(/g, '.includes(')
      // "x" in arr → arr.includes("x")
      .replace(/"([^"]+)"\s+in\s+(\w+)/g, '$2.includes("$1")')
      // $var in arr → arr.includes($var)
      .replace(/(\w+)\s+in\s+(\w+)/g, (m, v, arr) => /^(true|false|null|undefined)$/.test(v) ? m : `${arr}.includes(${v})`)
      // .filter(v, pred) → .filter(v => pred)
      .replace(/\.filter\((\w+),\s*/g, '.filter($1 => ')
      // .map(v, expr) → .map(v => expr)
      .replace(/\.map\((\w+),\s*/g, '.map($1 => ')
      // .all(v, pred) → .every(v => pred)
      .replace(/\.all\((\w+),\s*/g, '.every($1 => ')
      // .exists(v, pred) → .some(v => pred)
      .replace(/\.exists\((\w+),\s*/g, '.some($1 => ');

    const names = Object.keys(context);
    const vals  = Object.values(context);
    // eslint-disable-next-line no-new-func
    return new Function(...names, `"use strict"; return (${js});`)(...vals);
  } catch {
    return undefined;
  }
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

// ── evaluateGraph ─────────────────────────────────────────────────────────────

function evaluateGraph(graph, inputs) {
  const factNames = Object.keys(graph.facts);
  const ordered = topoSort(factNames, graph.dependencies);

  const scope = Object.assign({}, inputs);

  const complete = {};
  const placeholder = {};
  const missing = {};
  const errors = {};
  const resolved = {};

  for (const factName of ordered) {
    const deps = graph.dependencies[factName] || [];
    const missingPaths = new Set();

    for (const dep of deps) {
      if (dep.startsWith('$.')) {
        if (resolveInputPath(dep, inputs) === undefined) missingPaths.add(dep);
      } else {
        if (resolved[dep] === undefined && !errors[dep]) {
          if (missing[dep]) {
            for (const p of missing[dep]) missingPaths.add(p);
          } else {
            missingPaths.add(dep);
          }
        }
      }
    }

    if (missingPaths.size > 0) {
      missing[factName] = Array.from(missingPaths);
      continue;
    }

    const expr = (graph.facts[factName] || {}).expression;
    if (!expr) continue;

    const result = evaluateCEL(expr, scope);
    if (result === undefined) {
      errors[factName] = 'Expression failed to evaluate: ' + expr;
    } else {
      resolved[factName] = result;
      scope[factName] = result;
      complete[factName] = result;
    }
  }

  const outputSet = new Set(graph.outputs);
  return {
    complete:    Object.fromEntries(Object.entries(complete).filter(function(e) { return outputSet.has(e[0]); })),
    placeholder: Object.fromEntries(Object.entries(placeholder).filter(function(e) { return outputSet.has(e[0]); })),
    missing:     Object.fromEntries(Object.entries(missing).filter(function(e) { return outputSet.has(e[0]); })),
    errors:      Object.fromEntries(Object.entries(errors).filter(function(e) { return outputSet.has(e[0]); })),
  };
}

window.RulesEngine = { evaluateGraph: evaluateGraph };

})();
