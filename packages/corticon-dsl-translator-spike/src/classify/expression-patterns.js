/**
 * Detectors for the remaining rule-level classification patterns: date/age
 * arithmetic, currency rounding, and sorting/ranking. Each operates on a single
 * parsed term (from a condition/action's referencedTerms or modifiedTerms).
 */

/**
 * True if this term is date/calendar arithmetic -- confirmed real: DC Medicaid's
 * `Person.dob.yearsBetween(today)` (Create Household for Unique
 * PrimaryInsuredId.ers) and this fixture's own `Applicant.dob.yearsBetween(today)`
 * (AgeCalculation.ers), both a METHOD term whose immediate parent is a
 * DateTime-typed ATTRIBUTE. Matching on the parent's real `datatype` rather than
 * hardcoding specific method names (`yearsBetween`, `addYears`, ...) means this
 * doesn't need updating every time a new calendar method turns up.
 */
export function isDateArithmetic(term) {
  return term?.termtype === 'METHOD' && term.parent?.datatype === 'DateTime';
}

/**
 * True if this term is currency/decimal rounding -- confirmed real in this
 * fixture's own `Household.totalIncome.round(2)` (ComputeIncome.ers): a METHOD
 * term named `round`, applied to a Decimal-typed value.
 */
export function isCurrencyRounding(term) {
  return term?.termtype === 'METHOD' && /^round\b/.test(term.text ?? '') && term.datatype === 'Decimal';
}

/**
 * True if this action uses currency/decimal rounding, checking both real
 * confirmed shapes -- not just `isCurrencyRounding` on its own terms. Confirmed
 * real: when `.round(...)` is applied to a bare attribute (this fixture's
 * `Household.totalIncome.round(2)`), Corticon emits a real METHOD term
 * `isCurrencyRounding` can detect. But when `.round(...)` is applied to a
 * *compound* expression instead (DC Medicaid's own
 * `((Household.magi/Household.fpl)*100).round(2)`), Corticon emits **no term
 * at all** for the round() call -- there is nothing in the parsed term tree to
 * find. The only way to catch that real case is scanning the action's own raw
 * expression text as a fallback.
 */
export function actionUsesCurrencyRounding(action) {
  if ((action?.referencedTerms ?? []).some(isCurrencyRounding)) return true;
  return /\.round\s*\(/.test(action?.text ?? action?.expression ?? '');
}

/**
 * True if this term is a sorting/ranking operation -- confirmed real:
 * `->sortedBy(...)->first`, in DC Medicaid's `Parse Cohorts.ers`
 * (`cohorts->sortedBy(cohorts.type)->first.type`) and this fixture's own
 * `ProgramRanking.ers`: a COLLECTION term containing "sortedBy" in its own
 * text, or in a nested COLLECTION ancestor's text.
 */
export function isSortingOperation(term) {
  let current = term;
  while (current && current.termtype === 'COLLECTION') {
    if (/sortedBy/.test(current.text ?? '') || /sortedBy/.test(current.fulltext ?? '')) return true;
    current = current.parent;
  }
  return false;
}

/**
 * True if this condition/action/filter cell uses a sorting/ranking operation,
 * checking both real confirmed shapes -- not just `isSortingOperation` on its
 * own terms. Confirmed real: DC Medicaid's (and this fixture's) action-level
 * `->sortedBy(...)->first` puts "sortedBy" directly in a COLLECTION term's own
 * text, which `isSortingOperation` can detect. But IRR's `initial values.ers`
 * filter-level equivalent (`flows->sortedBy(installment)->first`) doesn't --
 * its COLLECTION term's text/fulltext read only `flows`/`flows->asSequence->first`,
 * with no "sortedBy" anywhere in the parsed term tree at all, the same real gap
 * `actionUsesCurrencyRounding` works around for `.round(...)`. The only way to
 * catch that real case is scanning the cell's own raw expression text.
 */
export function usesSortingOperation(cell) {
  if ((cell?.referencedTerms ?? []).some(isSortingOperation)) return true;
  return /sortedBy\s*\(/.test(cell?.text ?? cell?.expression ?? '');
}
