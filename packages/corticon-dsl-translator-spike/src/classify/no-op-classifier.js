import { entriesOf } from '../map-utils.js';
import { isBlankTemplateRule } from '../corticon/rulesheet.js';

/**
 * Finds rules that have no actions -- they evaluate conditions but produce no
 * writes and therefore no Fact derivations. Confirmed real in DC Medicaid/CHIP's
 * MAGI Eligibility Groups.ers (rule[12]: conditions present, all actions absent).
 * Sometimes used as label/documentation columns in Corticon Studio's decision table
 * grid; regardless of intent, they are no-ops from a translation standpoint.
 */
export function classifyNoOps(project) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      if (!rule.actions.some(Boolean)) {
        result.push({ rulesheet: rulesheetFile, ruleIndex });
      }
    });
  }
  return result;
}
