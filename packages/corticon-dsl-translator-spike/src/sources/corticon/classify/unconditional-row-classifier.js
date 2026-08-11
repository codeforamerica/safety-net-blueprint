import { basename } from 'node:path';
import { isBlankTemplateRule } from '../rulesheet.js';
import { entriesOf } from '../../../map-utils.js';

/**
 * Finds unconditional rules (no conditions) that are not the last rule in their
 * rulesheet — the unconditional-row-out-of-order pattern. In Corticon's decision-table
 * model the unconditional row is conventionally the fallback/default and should appear
 * last; an earlier position is unusual and may indicate a logic error.
 *
 * Blank template rows (all-null) are excluded — those are Corticon Studio's reserved
 * placeholder row and are not real rules.
 */
export function classifyUnconditionalRows(project) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    const rules = rulesheet.rules ?? [];
    const lastRealIndex = rules.reduce((last, rule, i) => (!isBlankTemplateRule(rule) ? i : last), -1);
    rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      if (ruleIndex === lastRealIndex) return;
      const hasConditions = (rule.conditions ?? []).some(Boolean);
      if (!hasConditions && rule.actions.some(Boolean)) {
        result.push({ pattern: 'unconditional-row-out-of-order', ruleId: `${basename(rulesheetFile)}:${ruleIndex}` });
      }
    });
  }
  return result;
}
