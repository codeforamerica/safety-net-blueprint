import { entriesOf } from '../map-utils.js';

/**
 * Finds attribute paths written by more than one rule *within the same rulesheet* --
 * Corticon's decision-table combinatorial semantics (issue #388's "Decision-table
 * combinatorial semantics" row): multiple condition columns, multiple rule rows,
 * each row an independent AND-of-conditions alternative converging on one write.
 * Confirmed real in Mortgage's Select_Credit.ers (3 rules -- liability count/credit
 * limit combinations -- all writing `loanapp.creditReqtMet`) and DC Medicaid/CHIP's
 * `MAGI Eligibility Groups.ers` (17 real rule rows).
 *
 * Distinct from cross-rulesheet Fact assembly (`findCrossRulesheetAssembly` in
 * build-graph.js), which is the same convergence across *separate* rulesheets, not
 * rows within one. Also distinct from a self-loop (`classifySelfLoops`): these rows
 * don't read the path they write at all -- they're independent alternatives, not a
 * value depending on its own prior value.
 */
export function classifyDecisionTableCombinatorics(graph) {
  const result = [];
  for (const [path, writers] of entriesOf(graph.writes)) {
    const ruleIndicesByRulesheet = new Map();
    for (const writer of writers) {
      if (!ruleIndicesByRulesheet.has(writer.rulesheet)) ruleIndicesByRulesheet.set(writer.rulesheet, new Set());
      ruleIndicesByRulesheet.get(writer.rulesheet).add(writer.ruleIndex);
    }
    for (const [rulesheet, ruleIndices] of ruleIndicesByRulesheet) {
      if (ruleIndices.size > 1) {
        result.push({ path, rulesheet, ruleIndices: [...ruleIndices].sort((a, b) => a - b) });
      }
    }
  }
  return result;
}
