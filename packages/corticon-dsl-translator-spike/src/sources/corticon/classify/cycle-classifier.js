import { basename } from 'node:path';
import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { isBlankTemplateRule } from '../rulesheet.js';
import { entriesOf } from '../../../map-utils.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

/**
 * Finds genuine dependency cycles — self-loop rules in iterative rulesheets that are
 * not explained by the null-guard or scalar-accumulator patterns, and are not already
 * explained by an expression-level pattern (e.g. a transform-in-place rounding rule).
 *
 * classifiedRuleKeys: Set of "rulesheetFile#ruleIndex" strings for rules already
 * classified by null-guard-classifier or scalar-accumulator-classifier — those are
 * skipped here to avoid double-classification.
 *
 * expressionPatternRuleKeys: Set of "rulesheetFile#ruleIndex" strings for rules already
 * explained by an expression-level pattern — those are also skipped.
 */
export function classifyCycles(project, ruleflowContext, classifiedRuleIds = new Set()) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    if (!ruleflowContext.perRulesheet.get(rulesheetFile)?.iterative) continue;
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      const ruleId = `${basename(rulesheetFile)}:${ruleIndex}`;
      if (classifiedRuleIds.has(ruleId)) return;
      const conditionReads = new Set(
        (rule.conditions ?? []).filter(Boolean).flatMap((c) => attributePathsIn(c.referencedTerms)),
      );
      for (const action of (rule.actions ?? []).filter(Boolean)) {
        const writePaths = attributePathsIn(action.modifiedTerms);
        const reads = new Set([...conditionReads, ...attributePathsIn(action.referencedTerms)]);
        for (const path of writePaths) {
          if (reads.has(path)) {
            result.push({ pattern: 'cycle', node: path, ruleId });
          }
        }
      }
    });
  }
  return result;
}

/**
 * Classifies every multi-node cycle (length > 2 — i.e. not a direct self-loop,
 * which classifyCycles already handles) found by building a dependency adjacency
 * directly from the project's own rules. Confirmed real:
 * IRR's `Investment.npv -> Investment.irr -> Cashflow.portion -> Investment.npv`
 * chain, spanning `evaluate npv.ers` and `solve each cashflow.ers`, both reached
 * from the same iterative loop.
 *
 * Returns PatternFinding objects with pattern "cycle" (iterative) or "cycle" with
 * variant "unclassified" (non-iterative — requires manual investigation).
 * Multi-hop findings use `nodes` (array) instead of `node` (string).
 */
export function classifyMultiHopCycles(project, ruleflowContext) {
  const adjacency = new Map();
  const nodes = new Set();
  const allEdges = [];

  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      const conditionReads = (rule.conditions ?? []).filter(Boolean).flatMap((c) => attributePathsIn(c.referencedTerms));
      for (const action of (rule.actions ?? []).filter(Boolean)) {
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

  return cycles
    .filter((cycle) => cycle.length > 2)
    .map((cyclePath) => {
      const edges = [];
      for (let i = 0; i < cyclePath.length - 1; i++) {
        const from = cyclePath[i];
        const to = cyclePath[i + 1];
        edges.push(...allEdges.filter((e) => e.from === from && e.to === to));
      }
      const isIterative = edges.some((e) => ruleflowContext.perRulesheet.get(e.rulesheet)?.iterative);
      const finding = { pattern: 'cycle', nodes: cyclePath.slice(0, -1) };
      if (!isIterative) finding.variant = 'unclassified';
      return finding;
    });
}
