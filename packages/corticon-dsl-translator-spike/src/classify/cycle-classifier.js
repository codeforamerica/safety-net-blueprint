import { canonicalAttributePath } from '../graph/attribute-path.js';
import { findCycles } from '../graph/build-graph.js';
import { entriesOf } from '../map-utils.js';

// Corticon's decision-table model represents each condition as a separate column
// (a distinct simple check), never a compound boolean expression in one cell --
// confirmed real in every multi-condition rulesheet we have (Flatten.ers's 5
// separate null-check columns, IncomeTier.ers's 2 separate comparison columns).
// So checking a single condition's own text for a trailing "= null" is reliable;
// there's no risk of missing a null-check buried inside a larger AND/OR expression.
function isNullCheckOn(path, condition) {
  if (!condition) return false;
  const touchesPath = (condition.referencedTerms ?? []).some((t) => canonicalAttributePath(t) === path);
  return touchesPath && /=\s*null\s*$/.test(condition.text ?? '');
}

// NOTE: this deliberately does NOT check cross-rulesheet Fact assembly
// (findCrossRulesheetAssembly). Assembly ("written by >1 rulesheet") and a
// self-loop ("read AND written within one specific rulesheet") are independent
// facts about a path, not competing classifications of the same thing -- an
// earlier version of this function treated assembly as a priority-1 override,
// which broke on real data: IRR's confirmed genuine cycle (Investment.irr) is
// ALSO written by `initial values.ers` as an unconditional seed value, and DC
// Medicaid's confirmed decision-table row (Person.outputCoverage1) is ALSO
// written by four different rulesheets as a shared status-message field --
// neither is the "two rulesheets jointly decide one Fact via mutually exclusive
// conditions" pattern assembly actually means, yet both got miscategorized once
// "written by >1 rulesheet" was used to short-circuit this classifier. Assembly
// stays a wholly separate, independently-reported finding; this function only
// ever answers the self-loop's own three-way ambiguity.
function classifySelfLoop(path, rule, edge, ruleflowContext) {
  // Priority 1: null-check masking -- the specific rule causing this self-loop
  // explicitly checks the same attribute against a literal null.
  if ((rule?.conditions ?? []).some((c) => isNullCheckOn(path, c))) return 'null-check-masking';
  // Priority 2: genuine cycle -- the rulesheet is ever reached via an
  // `iterative="true"` node (see ruleflow-context.js).
  if (ruleflowContext.perRulesheet.get(edge.rulesheet)?.iterative) return 'genuine-cycle';
  // Priority 3: none of the above -- an ordinary decision-table alternative row
  // (confirmed real: DC Medicaid's Flatten.ers `.contains('ineligible')` check).
  return 'decision-table-alternative-row';
}

/**
 * Classifies every structural self-loop in the dependency graph (edges where
 * `from === to`) into one of three categories -- see `classifySelfLoop()` for the
 * real evidence behind each one. This is the disambiguation `findCycles()`'s own
 * comment in build-graph.js defers to Phase 3: a raw self-loop alone can't tell
 * a genuine cycle apart from an ordinary decision-table row or null-check
 * masking; this function is what actually tells them apart, using the rule's
 * own condition text plus the containing Ruleflow node's `iterative` flag (via
 * ruleflow-context.js). Cross-rulesheet Fact assembly is a separate, independent
 * finding (see findCrossRulesheetAssembly) -- not merged into this classification.
 */
export function classifySelfLoops(project, graph, ruleflowContext) {
  const rulesheetsByKey = new Map(entriesOf(project.rulesheets));

  return graph.edges
    .filter((edge) => edge.from === edge.to)
    .map((edge) => {
      const path = edge.from;
      const rule = rulesheetsByKey.get(edge.rulesheet)?.rules?.[edge.ruleIndex];
      return {
        path,
        rulesheet: edge.rulesheet,
        ruleIndex: edge.ruleIndex,
        classification: classifySelfLoop(path, rule, edge, ruleflowContext),
      };
    });
}

// The specific edges that make up one hop-to-hop step of a multi-node cycle path
// (e.g. for [A, B, C, A]: the A->B, B->C, and C->A edges) -- there can be more
// than one real edge per hop (different rules independently producing the same
// dependency), so this collects all of them, not just the first found.
function edgesForCycle(cyclePath, graph) {
  const edges = [];
  for (let i = 0; i < cyclePath.length - 1; i++) {
    const from = cyclePath[i];
    const to = cyclePath[i + 1];
    edges.push(...graph.edges.filter((e) => e.from === from && e.to === to));
  }
  return edges;
}

/**
 * Classifies every multi-node cycle (length > 2 -- i.e. not a direct self-loop,
 * which classifySelfLoops already handles) found by findCycles(). Unlike a direct
 * self-loop, the null-check-masking and decision-table-alternative-row patterns
 * don't apply here -- both are about one rule's own self-consistency check
 * against a single attribute, not a chain spanning multiple attributes and
 * rulesheets. Confirmed real: IRR's `Investment.npv -> Investment.irr ->
 * Cashflow.portion -> Investment.npv` chain, spanning `evaluate npv.ers` and
 * `solve each cashflow.ers`, both reached from the same iterative loop -- so the
 * only classification this function currently makes is "genuine cycle" (any
 * edge in the chain comes from a rulesheet ever reached iteratively) or
 * "unclassified" (no confirmed real example of a non-iterative multi-node cycle
 * exists yet, so this is flagged for manual review rather than guessed at).
 */
export function classifyMultiHopCycles(graph, ruleflowContext) {
  const multiHopCycles = findCycles(graph).filter((cycle) => cycle.length > 2);

  return multiHopCycles.map((cyclePath) => {
    const edges = edgesForCycle(cyclePath, graph);
    const isIterative = edges.some((e) => ruleflowContext.perRulesheet.get(e.rulesheet)?.iterative);
    return {
      path: cyclePath.slice(0, -1),
      rulesheets: [...new Set(edges.map((e) => e.rulesheet))],
      classification: isIterative ? 'genuine-cycle' : 'unclassified-multi-hop-cycle',
    };
  });
}
