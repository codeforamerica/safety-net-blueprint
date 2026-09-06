import { parse } from '../formula-parser.js';

/**
 * Collects all callable names referenced in a formula string.
 * Returns a Set of names (data_relation or derived rule names called).
 */
function referencedCallables(formulaStr) {
  const refs = new Set();
  try {
    collectCalls(parse(String(formulaStr)), refs);
  } catch { /* malformed formula — skip */ }
  return refs;
}

function collectCalls(node, refs) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Call') {
    refs.add(node.name);
    for (const arg of node.args ?? []) collectCalls(arg, refs);
    return;
  }
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) val.forEach(v => collectCalls(v, refs));
    else if (val && typeof val === 'object') collectCalls(val, refs);
  }
}

/**
 * Builds the dependency graph and identifies sink candidates from a rulespec model.
 *
 * Sink candidates are derived rules not referenced by any other derived rule —
 * i.e. the "outputs" of the computation graph.
 *
 * @param {object} rulespec - The loaded rulespec model.
 * Returns:
 *   graph        — { nodes: string[], edges: {from, to, ruleId}[] }
 *   sinkCandidates — { [factName]: { definitionCount, totalDefinitions, latestPosition, totalPositions } }
 */
export function classifySinkCandidates(rulespec) {
  const { parameters, dataRelations, derivedRules } = rulespec;

  // Build name → path(s) map for all nodes (local names, no domain/graph prefix)
  const nameToPath = new Map();
  for (const p of parameters) nameToPath.set(p.name, [p.name]);
  for (const dr of dataRelations) {
    // Use base name (without discriminator suffix) for dependency resolution
    nameToPath.set(dr.name, [dr.name]);
  }
  for (const dr of derivedRules) {
    nameToPath.set(dr.name, [dr.name]);
  }

  // Build edges: for each derived rule, parse its formula and find referenced callables
  const nodes = new Set();
  const edges = [];

  for (const [name, paths] of nameToPath) paths.forEach(p => nodes.add(p));

  // Track which derived rule names are referenced by other derived rules
  const referencedByOther = new Set();

  for (const dr of derivedRules) {
    const toPath = nameToPath.get(dr.name)?.[0];
    if (!toPath) continue;
    const versions = dr.versions ?? [];
    const formula = versions[versions.length - 1]?.formula;
    if (formula == null) continue;

    for (const calledName of referencedCallables(String(formula))) {
      const fromPaths = nameToPath.get(calledName);
      if (!fromPaths) continue;
      referencedByOther.add(calledName);
      for (const fromPath of fromPaths) {
        nodes.add(fromPath);
        edges.push({ from: fromPath, to: toPath, ruleId: dr.name });
      }
    }
  }

  // Sink candidates: derived rules not referenced by any other derived rule
  const sinkCandidates = {};
  const totalRules = derivedRules.length;
  for (let i = 0; i < derivedRules.length; i++) {
    const dr = derivedRules[i];
    if (referencedByOther.has(dr.name)) continue;
    const path = nameToPath.get(dr.name)?.[0];
    if (!path) continue;
    sinkCandidates[path] = {
      definitionCount: 1,
      totalDefinitions: totalRules,
      latestPosition: i,
      totalPositions: totalRules - 1,
    };
  }

  return { graph: { nodes: [...nodes], edges }, sinkCandidates };
}
