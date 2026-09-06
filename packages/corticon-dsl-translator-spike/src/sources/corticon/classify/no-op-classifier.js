import { basename } from 'node:path';
import { entriesOf } from '../../../map-utils.js';

/**
 * Finds rules that have no actions — they produce no writes and therefore no
 * Fact derivations. Includes blank template rows (Corticon Studio's built-in
 * reserved row at index 0, all-null conditions and actions) and any rule with
 * conditions but no actions (confirmed real in DC Medicaid/CHIP's MAGI Eligibility
 * Groups.ers, rule[12]). Sometimes used as label/documentation columns in Corticon
 * Studio's decision table grid. Regardless of intent, all are no-ops from a
 * translation standpoint and are excluded from Fact compilation.
 */
export function classifyNoOps(project) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (!rule.actions.some(Boolean)) {
        result.push({ pattern: 'no-op', ruleId: `${basename(rulesheetFile)}:${ruleIndex}` });
      }
    });
  }
  return result;
}
