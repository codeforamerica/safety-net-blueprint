import { basename } from 'node:path';
import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { isBlankTemplateRule } from '../rulesheet.js';
import { entriesOf } from '../../../map-utils.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

/**
 * Finds attribute paths written by more than one rule *within the same rulesheet* —
 * Corticon's decision-table combinatorial semantics (issue #388's "Decision-table
 * combinatorial semantics" row): multiple condition columns, multiple rule rows,
 * each row an independent AND-of-conditions alternative converging on one write.
 * Confirmed real in Mortgage's Select_Credit.ers (3 rules — liability count/credit
 * limit combinations — all writing `loanapp.creditReqtMet`) and DC Medicaid/CHIP's
 * `MAGI Eligibility Groups.ers` (17 real rule rows).
 *
 * Returns PatternFinding objects with pattern "hit-policy-unverified".
 */
export function classifyHitPolicyUnverified(project) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    const ruleIndicesByPath = new Map();
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      for (const action of rule.actions.filter(Boolean)) {
        for (const writePath of attributePathsIn(action.modifiedTerms)) {
          if (!ruleIndicesByPath.has(writePath)) ruleIndicesByPath.set(writePath, new Set());
          ruleIndicesByPath.get(writePath).add(ruleIndex);
        }
      }
    });
    for (const [path, ruleIndices] of ruleIndicesByPath) {
      if (ruleIndices.size > 1) {
        result.push({ pattern: 'hit-policy-unverified', node: path, ruleId: `${basename(rulesheetFile)}:*` });
      }
    }
  }
  return result;
}

/**
 * Finds self-referential rules that are part of a decision table — a rule that reads
 * and writes the same attribute where the read is a guard condition selecting one
 * branch, not a genuine data cycle. Only emitted for non-iterative rulesheets (iterative
 * self-loops are classified as cycle or scalar-accumulator by their own classifiers).
 * Confirmed real: DC Medicaid/CHIP's Flatten.ers `.contains('ineligible')` check.
 *
 * expressionPatternRuleKeys: Set of "rulesheetFile#ruleIndex" strings for rules already
 * explained by an expression-level pattern — those are skipped here since the expression
 * pattern is the accurate classification.
 */
export function classifyDecisionTableAlternativeRows(project, ruleflowContext, expressionPatternRuleKeys = new Set()) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    const isIterative = ruleflowContext.perRulesheet.get(rulesheetFile)?.iterative;
    if (isIterative) continue;
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      if (expressionPatternRuleKeys.has(`${basename(rulesheetFile)}:${ruleIndex}`)) return;
      const conditionReads = new Set(
        (rule.conditions ?? []).filter(Boolean).flatMap((c) => attributePathsIn(c.referencedTerms)),
      );
      const ruleId = `${basename(rulesheetFile)}:${ruleIndex}`;
      for (const action of rule.actions.filter(Boolean)) {
        const writePaths = attributePathsIn(action.modifiedTerms);
        const reads = new Set([...conditionReads, ...attributePathsIn(action.referencedTerms)]);
        for (const path of writePaths) {
          if (reads.has(path)) {
            result.push({ pattern: 'decision-table-alternative-row', node: path, ruleId });
          }
        }
      }
    });
  }
  return result;
}
