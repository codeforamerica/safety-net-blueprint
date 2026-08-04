import { canonicalAttributePath } from '../graph/attribute-path.js';
import { isBlankTemplateRule } from '../corticon/rulesheet.js';
import { entriesOf } from '../map-utils.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

/**
 * Finds attribute paths written by more than one rule *within the same rulesheet* --
 * Corticon's decision-table combinatorial semantics (issue #388's "Decision-table
 * combinatorial semantics" row): multiple condition columns, multiple rule rows,
 * each row an independent AND-of-conditions alternative converging on one write.
 * Confirmed real in Mortgage's Select_Credit.ers (3 rules -- liability count/credit
 * limit combinations -- all writing `loanapp.creditReqtMet`) and DC Medicaid/CHIP's
 * `MAGI Eligibility Groups.ers` (17 real rule rows).
 *
 * Distinct from cross-rulesheet Fact assembly (see classify-all.js's own
 * findCrossRulesheetAssembly), which is the same convergence across *separate*
 * rulesheets, not rows within one. Also distinct from a self-loop (`classifySelfLoops`):
 * these rows don't read the path they write at all -- they're independent alternatives,
 * not a value depending on its own prior value.
 */
export function classifyDecisionTableCombinatorics(project) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    // Map: writePath -> Set of ruleIndices within this rulesheet that write it.
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
        result.push({ path, rulesheet: rulesheetFile, ruleIndices: [...ruleIndices].sort((a, b) => a - b) });
      }
    }
  }
  return result;
}
