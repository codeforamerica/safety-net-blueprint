import { canonicalAttributePath, touchesEntityCreation } from './attribute-path.js';
import { entriesOf } from '../map-utils.js';
// TODO: isBlankTemplateRule is Corticon-specific — should be filtered upstream before reaching the graph builder
import { isBlankTemplateRule } from '../sources/corticon/rulesheet.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

/**
 * Build the attribute dependency graph for a whole project: for every rule in every
 * rulesheet, an edge from each attribute its condition/action *reads* to the
 * attribute it *writes*. This is purely structural -- it records what depends on
 * what, without judging whether a given dependency is ordinary, a cycle, an
 * entity-creation action, etc. (that's Phase 3's job, using this graph as input).
 */
export function buildDependencyGraph(project) {
  const nodes = new Set();
  const edges = [];
  // Keyed by written attribute path -> the rulesheets that write it, each with
  // the rule index and entity-creation flag -- Phase 3 needs this directly for
  // cross-rulesheet Fact assembly and entity-creation detection.
  const writes = new Map();

  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      // Corticon Studio's own reserved blank/template row (see rulesheet.js's own
      // comment) -- always rule index 0 in every real fixture checked, kept in the
      // model now for faithfulness but genuinely has no logic to contribute an edge.
      if (isBlankTemplateRule(rule)) return;

      // Shared across every action in the rule -- all of them only run if the
      // rule's conditions are met, so each one's write genuinely does depend on
      // whatever the conditions read. Individual columns can still be null even on
      // a real (non-blank-template) rule -- that column just doesn't apply to this
      // particular row -- so those are filtered here, not upstream in ingestion.
      const conditionReads = rule.conditions.filter(Boolean).flatMap((c) => attributePathsIn(c.referencedTerms));

      for (const action of rule.actions.filter(Boolean)) {
        const isEntityCreation = touchesEntityCreation(action.modifiedTerms, action.referencedTerms);
        const writePaths = attributePathsIn(action.modifiedTerms);
        // Scoped to THIS action alone, not pooled across every action in the rule --
        // confirmed real in DC Medicaid's Calculate_premium.ers: one action computes
        // `monthly_premium`, and a *separate* action later reads it (via `.toString`)
        // to build an unrelated message string. Pooling all actions' reads together
        // made that read look like monthly_premium depended on itself -- a spurious
        // self-loop with nothing to do with monthly_premium's own computation.
        const reads = new Set([...conditionReads, ...attributePathsIn(action.referencedTerms)]);

        for (const writePath of writePaths) {
          nodes.add(writePath);
          for (const readPath of reads) {
            // A self-referencing edge is kept, not skipped as degenerate -- but it's
            // genuinely ambiguous on its own. Confirmed real examples of all three:
            // (1) IRR's `Investment.irr = Investment.irr + 0.01` inside an
            //     `iterative="true"` node -- a genuine cycle, needs flagging;
            // (2) DC Medicaid's Flatten.ers checking `outputCoverage1.contains(...)`
            //     then setting `outputCoverage1` -- an ordinary decision-table
            //     alternative row (mutually-exclusive conditions), not a cycle at all;
            // (3) Mortgage's `late30DaysSum = null` -> `= 0` -- null-check masking,
            //     needs mapping onto this DSL's Placeholder mechanism, not a cycle.
            // Telling these apart needs the rule's own condition text and the
            // containing Ruleflow node's `iterative` flag -- Phase 3's job, not this
            // raw graph's. Recording the edge faithfully here is what makes that
            // later disambiguation possible at all.
            nodes.add(readPath);
            edges.push({ from: readPath, to: writePath, rulesheet: rulesheetFile, ruleIndex });
          }
          if (!writes.has(writePath)) writes.set(writePath, []);
          writes.get(writePath).push({ rulesheet: rulesheetFile, ruleIndex, isEntityCreation });
        }

        // For entity-creation actions, also add the association path (e.g.
        // ApplicationMember.exemptions) as a written node. canonicalAttributePath
        // only resolves scalar ATTRIBUTE terms -- the ENTITY term for the association
        // itself returns null there, so it never enters writePaths above and would
        // be invisible to the sink-candidate and translation layers entirely.
        // Recording it here lets the translation layer generate a collection output
        // fact for it (variant: 'output') rather than having no panel at all.
        // Only qualified paths (containing '.') are included -- bare association
        // names like 'members' (DC Medicaid's Person.members += ...) lack a stable
        // parent-entity context and can't reliably be represented as a canonical path.
        if (isEntityCreation) {
          for (const term of (action.modifiedTerms ?? [])) {
            if (term.termtype !== 'ENTITY' || !term.fulltext?.includes('.')) continue;
            const assocPath = term.fulltext;
            nodes.add(assocPath);
            for (const readPath of reads) {
              nodes.add(readPath);
              edges.push({ from: readPath, to: assocPath, rulesheet: rulesheetFile, ruleIndex });
            }
            if (!writes.has(assocPath)) writes.set(assocPath, []);
            writes.get(assocPath).push({ rulesheet: rulesheetFile, ruleIndex, isEntityCreation: true });
          }
        }
      }
    });
  }

  return { nodes, edges, writes };
}

/**
 * Traces backward from a sink candidate through the dependency graph to build
 * its subgraph. Returns { nodes, edges, nodeCount, depth, orderedLayers } where:
 * - depth is the longest path from any source node to the candidate
 * - orderedLayers is an array of node arrays grouped by BFS depth (layer 0 =
 *   sink, layer 1 = direct predecessors, etc.), each layer's nodes ordered
 *   left-to-right using barycenter heuristic to minimize edge crossings —
 *   the same ordering used to lay out the diagram, stored here so the
 *   visualizer reads it rather than recomputing it.
 */
export function buildCandidateSubgraph(candidatePath, graph) {
  // Build adjacency in reverse (to -> from) for backward traversal.
  const reverseAdj = new Map();
  // Forward adjacency needed for barycenter ordering within each layer.
  const fwdAdj = new Map();
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue; // skip self-loops — corrupt layer assignment without adding structural info
    if (!reverseAdj.has(edge.to)) reverseAdj.set(edge.to, []);
    if (!reverseAdj.get(edge.to).includes(edge.from)) reverseAdj.get(edge.to).push(edge.from);
    if (!fwdAdj.has(edge.from)) fwdAdj.set(edge.from, []);
    if (!fwdAdj.get(edge.from).includes(edge.to)) fwdAdj.get(edge.from).push(edge.to);
  }

  const visitedNodes = new Set();
  const visitedEdges = [];
  const depthByNode = new Map();
  const visiting = new Set();

  function visit(path, depth) {
    if (visiting.has(path)) return; // cycle — don't follow
    if (depthByNode.has(path) && depth <= depthByNode.get(path)) return;
    depthByNode.set(path, depth);
    visitedNodes.add(path);
    visiting.add(path);
    for (const pred of reverseAdj.get(path) ?? []) {
      // Collect the original edge objects (with rulesheet/ruleIndex) for consumers.
      const edgesForPair = graph.edges.filter((e) => e.from === pred && e.to === path);
      for (const e of edgesForPair) visitedEdges.push(e);
      visit(pred, depth + 1);
    }
    visiting.delete(path);
  }

  visit(candidatePath, 0);

  // Group nodes by layer depth.
  const byLayer = new Map();
  for (const [node, depth] of depthByNode) {
    if (!byLayer.has(depth)) byLayer.set(depth, []);
    byLayer.get(depth).push(node);
  }
  const maxDepth = visitedNodes.size ? Math.max(...depthByNode.values()) : 0;

  // Barycenter ordering: for each layer (deepest first), sort by avg position
  // of the nodes it connects to in the layer below — reduces edge crossings.
  // This is the canonical left-to-right ordering for the diagram and nav.
  const orderedLayers = [];
  for (let l = maxDepth; l >= 0; l--) {
    const lNodes = [...(byLayer.get(l) ?? [])];
    const below = orderedLayers[maxDepth - l - 1] ?? []; // already-ordered layer l+1 (one closer to sink)
    const posOf = (n) => { const i = below.indexOf(n); return i < 0 ? below.length / 2 : i; };
    lNodes.sort((a, b) => {
      const avg = (targets) => targets.length ? targets.reduce((s, t) => s + posOf(t), 0) / targets.length : below.length / 2;
      const aTgts = (fwdAdj.get(a) ?? []).filter((t) => depthByNode.get(t) === l - 1);
      const bTgts = (fwdAdj.get(b) ?? []).filter((t) => depthByNode.get(t) === l - 1);
      return avg(aTgts) - avg(bTgts);
    });
    orderedLayers.push(lNodes);
  }
  // orderedLayers is built deepest-first; reverse so index 0 = sink layer.
  orderedLayers.reverse();

  return {
    nodes: [...visitedNodes],
    edges: visitedEdges,
    nodeCount: visitedNodes.size,
    depth: maxDepth,
    orderedLayers,
  };
}


/** Attribute paths written by more than one distinct rulesheet -- the cross-rulesheet Fact assembly pattern (e.g. Person.MedicaidEligible in Parse Cohorts.ers + Flatten.ers). */
export function findCrossRulesheetAssembly(graph) {
  const result = [];
  for (const [path, writers] of entriesOf(graph.writes)) {
    const distinctRulesheets = new Set(writers.map((w) => w.rulesheet));
    if (distinctRulesheets.size > 1) {
      result.push({ path, rulesheets: [...distinctRulesheets] });
    }
  }
  return result;
}

/**
 * Detect structural cycles in the raw dependency graph -- A reads B (directly or
 * transitively) and B reads A. This is *not* the same thing as "a genuine cycle
 * requiring manual redesign" in the Decision 9 sense: confirmed real self-loops
 * include an ordinary decision-table alternative row and null-check masking,
 * neither of which need flagging (see the comment in buildDependencyGraph). Use
 * this to find candidates, then classify each one using the rule's own condition
 * and the containing Ruleflow node's `iterative` flag.
 */
export function findCycles(graph) {
  const adjacency = new Map();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    adjacency.get(edge.from).add(edge.to);
  }

  const cycles = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(node, path) {
    if (visiting.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart).concat(node));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) {
      visit(next, [...path, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.nodes) {
    if (!visited.has(node)) visit(node, []);
  }
  return cycles;
}
