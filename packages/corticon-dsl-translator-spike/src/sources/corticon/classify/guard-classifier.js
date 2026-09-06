import { basename } from 'node:path';
import { entriesOf } from '../../../map-utils.js';

/**
 * Surfaces every rulesheet's filters as PatternFinding objects with pattern "guard" —
 * confirmed real in Mortgage's Select_Credit.ers, where
 * `liability.accountType = 'CreditLine'` filters the `liability` collection before
 * `liability->size >= 3` ever evaluates it (issue #388's "Scope/Alias/Filter" row).
 * Only the filter expression itself is surfaced here — Corticon Studio's own
 * full-vs-limiting cascade distinction (whether a filter that empties a collection
 * excludes the whole parent entity from the rulesheet, not just the filtered alias)
 * isn't visible in this static structure and is flagged in the issue as something to
 * resolve against live execution behavior, not guessed at here.
 *
 * Guards are rulesheet-level (apply to all rules in the sheet), so ruleId uses :*
 * and no node is emitted — the filter scopes a collection, not a single fact node.
 */
export function classifyGuards(project) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    for (const filter of rulesheet.filters ?? []) {
      result.push({
        pattern: 'guard',
        ruleId: `${basename(rulesheetFile)}:*`,
        expression: filter.expression,
      });
    }
  }
  return result;
}
