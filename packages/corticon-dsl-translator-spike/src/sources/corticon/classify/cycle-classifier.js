import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { isBlankTemplateRule } from '../corticon/rulesheet.js';
import { entriesOf } from '../../../map-utils.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

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
// A collection-accumulation rule has the shape:
//   condition: collection.counted = null (or similar per-item guard)
//   action:    Parent.total = Parent.total + collection.field
// In Corticon forward-chaining, this iterates over a collection summing a field.
// In reverse-chaining it translates directly to sum(collection, 'field').
// Detected by: the accumulating action reads an attribute on a DIFFERENT entity
// than the one it writes (the collection item entity vs. the parent entity).
function isCollectionAccumulation(path, rule) {
  const writtenEntity = path.split('.')[0];
  for (const action of (rule?.actions ?? []).filter(Boolean)) {
    const writePaths = attributePathsIn(action.modifiedTerms);
    if (!writePaths.includes(path)) continue;
    // The action must also READ path (accumulate: total = total + x)
    const actionReads = attributePathsIn(action.referencedTerms);
    if (!actionReads.includes(path)) continue;
    // At least one OTHER read must be on a different entity (the collection item)
    const otherEntityRead = actionReads.some((r) => r.split('.')[0] !== writtenEntity);
    if (otherEntityRead) return true;
  }
  return false;
}

function classifySelfLoop(path, rule, rulesheetFile, ruleflowContext) {
  // Priority 1: null-check masking -- the specific rule causing this self-loop
  // explicitly checks the same attribute against a literal null.
  if ((rule?.conditions ?? []).some((c) => isNullCheckOn(path, c))) return 'null-check-masking';
  // Priority 2: collection accumulation inside an iterative ruleflow -- translates
  // to sum(collection, 'field'), not a genuine cycle needing manual redesign.
  if (ruleflowContext.perRulesheet.get(rulesheetFile)?.iterative && isCollectionAccumulation(path, rule)) return 'collection-accumulation';
  // Priority 3: genuine cycle -- the rulesheet is ever reached via an
  // `iterative="true"` node (see ruleflow-context.js).
  if (ruleflowContext.perRulesheet.get(rulesheetFile)?.iterative) return 'genuine-cycle';
  // Priority 4: none of the above -- an ordinary decision-table alternative row
  // (confirmed real: DC Medicaid's Flatten.ers `.contains('ineligible')` check).
  return 'decision-table-alternative-row';
}

/**
 * Classifies every structural self-loop in the project (rules where a condition
 * references the same attribute an action writes) into one of three categories --
 * see `classifySelfLoop()` for the real evidence behind each one. Detected directly
 * from the project's own rule conditions and actions, without a pre-built dependency
 * graph -- a self-loop exists when a rule's action writes attribute X and the same
 * rule's conditions (or that specific action's own reads) reference attribute X.
 *
 * expressionPatterns is passed in so that self-loops already explained by an
 * expression-level pattern (e.g. decimal-rounding's `adjustedHours = adjustedHours.round(1)`)
 * are not also classified as decision-table-alternative-row. The expression pattern
 * is the accurate classification for those rules; emitting a self-loop entry on top
 * of it produces a false-positive in the visualizer and translation log.
 */
export function classifySelfLoops(project, ruleflowContext, expressionPatterns = []) {
  const expressionPatternRuleKeys = new Set(expressionPatterns.map((p) => `${p.rulesheet}#${p.ruleIndex}`));
  const result = [];

  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;

      // Condition reads are shared across every action in the rule -- all actions
      // only run if the rule's conditions are met, same scoping logic as
      // buildDependencyGraph's own conditionReads.
      const conditionReads = new Set(
        rule.conditions.filter(Boolean).flatMap((c) => attributePathsIn(c.referencedTerms)),
      );

      for (const action of rule.actions.filter(Boolean)) {
        const writePaths = attributePathsIn(action.modifiedTerms);
        // Action-scoped reads: condition reads plus this specific action's own
        // referenced terms -- same per-action scoping confirmed real in DC Medicaid's
        // Calculate_premium.ers (see buildDependencyGraph's own comment).
        const reads = new Set([...conditionReads, ...attributePathsIn(action.referencedTerms)]);

        for (const writePath of writePaths) {
          if (reads.has(writePath)) {
            // If this rule already carries an expression-pattern classification
            // (e.g. decimal-rounding, operator-precedence), the self-loop is an
            // artifact of a transform-in-place operation, not a decision-table
            // alternative row. Skip it -- the expression pattern entry is sufficient.
            // Exception: genuine-cycle (iterative ruleflow) and null-check-masking
            // both take priority; those must still be reported regardless of
            // whether an expression pattern is also present.
            const hasExpressionPattern = expressionPatternRuleKeys.has(`${rulesheetFile}#${ruleIndex}`);
            const isIterative = ruleflowContext.perRulesheet.get(rulesheetFile)?.iterative;
            const isNullCheck = (rule.conditions ?? []).some((c) => isNullCheckOn(writePath, c));
            if (hasExpressionPattern && !isIterative && !isNullCheck) continue;
            result.push({
              path: writePath,
              rulesheet: rulesheetFile,
              ruleIndex,
              classification: classifySelfLoop(writePath, rule, rulesheetFile, ruleflowContext),
            });
          }
        }
      }
    });
  }

  return result;
}

/**
 * Classifies every multi-node cycle (length > 2 -- i.e. not a direct self-loop,
 * which classifySelfLoops already handles) found by building a dependency adjacency
 * directly from the project's own rules. Unlike a direct self-loop, the
 * null-check-masking and decision-table-alternative-row patterns don't apply here --
 * both are about one rule's own self-consistency check against a single attribute,
 * not a chain spanning multiple attributes and rulesheets. Confirmed real:
 * IRR's `Investment.npv -> Investment.irr -> Cashflow.portion -> Investment.npv`
 * chain, spanning `evaluate npv.ers` and `solve each cashflow.ers`, both reached
 * from the same iterative loop.
 */
export function classifyMultiHopCycles(project, ruleflowContext) {
  // Build adjacency and edge list directly from project rules -- same logic as
  // buildDependencyGraph but kept internal to classification so the classifier
  // doesn't depend on a pre-built graph artifact.
  const adjacency = new Map();
  const nodes = new Set();
  const allEdges = [];

  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      const conditionReads = rule.conditions.filter(Boolean).flatMap((c) => attributePathsIn(c.referencedTerms));
      for (const action of rule.actions.filter(Boolean)) {
        const writePaths = attributePathsIn(action.modifiedTerms);
        const reads = [...conditionReads, ...attributePathsIn(action.referencedTerms)];
        for (const writePath of writePaths) {
          nodes.add(writePath);
          for (const readPath of reads) {
            nodes.add(readPath);
            if (!adjacency.has(readPath)) adjacency.set(readPath, new Set());
            adjacency.get(readPath).add(writePath);
            allEdges.push({ from: readPath, to: writePath, rulesheet: rulesheetFile, ruleIndex });
          }
        }
      }
    });
  }

  // DFS cycle detection -- same algorithm as findCycles in build-graph.js.
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

  for (const node of nodes) {
    if (!visited.has(node)) visit(node, []);
  }

  const multiHopCycles = cycles.filter((cycle) => cycle.length > 2);

  return multiHopCycles.map((cyclePath) => {
    const edges = [];
    for (let i = 0; i < cyclePath.length - 1; i++) {
      const from = cyclePath[i];
      const to = cyclePath[i + 1];
      edges.push(...allEdges.filter((e) => e.from === from && e.to === to));
    }
    const isIterative = edges.some((e) => ruleflowContext.perRulesheet.get(e.rulesheet)?.iterative);
    return {
      path: cyclePath.slice(0, -1),
      rulesheets: [...new Set(edges.map((e) => e.rulesheet))],
      classification: isIterative ? 'genuine-cycle' : 'unclassified-multi-hop-cycle',
    };
  });
}
