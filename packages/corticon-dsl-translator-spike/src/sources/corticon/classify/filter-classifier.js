import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { entriesOf } from '../../../map-utils.js';

/**
 * Surfaces every rulesheet's real filters (see rulesheet.js's `extractFilters`) as a
 * classification finding, alongside the canonical attribute path(s) each one reads --
 * confirmed real in Mortgage's Select_Credit.ers, where
 * `liability.accountType = 'CreditLine'` filters the `liability` collection before
 * `liability->size >= 3` ever evaluates it (issue #388's "Scope/Alias/Filter" row).
 * Only the filter expression itself is surfaced here -- Corticon Studio's own
 * full-vs-limiting cascade distinction (whether a filter that empties a collection
 * excludes the whole parent entity from the rulesheet, not just the filtered alias)
 * isn't visible in this static structure and is flagged in the issue as something to
 * resolve against live execution behavior, not guessed at here.
 */
export function classifyFilters(project) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    for (const filter of rulesheet.filters ?? []) {
      result.push({
        rulesheet: rulesheetFile,
        expression: filter.expression,
        paths: (filter.referencedTerms ?? []).map(canonicalAttributePath).filter(Boolean),
      });
    }
  }
  return result;
}
