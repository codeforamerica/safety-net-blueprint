/**
 * Detectors for the remaining rule-level classification patterns: date/age
 * arithmetic, currency rounding, and sorting/ranking. Each operates on a single
 * parsed term (from a condition/action's referencedTerms or modifiedTerms).
 */

import { entriesOf } from '../../../map-utils.js';

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

/**
 * True if this cell uses compound arithmetic where operator precedence matters --
 * confirmed real: this fixture's own operator-precedence.ers uses
 * `incomeRounded - incomeRounded * 0.2`, where * binds before -.
 * Detected via mixed additive (+/-) and multiplicative (*,/) binary operators in
 * the raw expression text; space on both sides distinguishes binary from unary,
 * and avoids matching the -> collection-navigation operator.
 */
export function cellUsesCompoundArithmetic(cell) {
  const text = cell?.text ?? cell?.expression ?? '';
  return /\s[-+]\s/.test(text) && /\s[*\/]\s/.test(text);
}

/**
 * True if this cell uses Corticon logical keywords (and/or/not) -- confirmed real:
 * this fixture's own logical-operators.ers uses `and`, `or`, and `not` as compound
 * condition connectives. Whole-word boundaries prevent false-positives on attribute
 * names that happen to contain these substrings (e.g. "standard", "annotation").
 */
export function cellUsesLogicalKeywords(cell) {
  return /\b(and|or|not)\b/.test(cell?.text ?? cell?.expression ?? '');
}

/**
 * True if this cell uses Corticon range-membership syntax (X in [lo..hi]) --
 * the `range` variant of the `membership-test` pattern. Confirmed real: this
 * fixture's own range-membership.ers uses `age in [0..17]`, `age in [18..64]`,
 * and `age in [65..150)`. Detected via the `in` keyword followed by a bracket
 * and the `..` range separator.
 */
export function cellUsesRangeMembership(cell) {
  const text = cell?.text ?? cell?.expression ?? '';
  return /\bin\s*[\[(]/.test(text) && /\.\./.test(text);
}

/**
 * True if this cell uses a string-list membership test via Corticon's `.contains()`
 * method -- the `string-list` variant of the `membership-test` pattern. Confirmed
 * real in CBMS Disaster FS: `cntyCdList.contains(homeCntyCd)`,
 * `zipList.contains(homeZip)`, `actvIndvList.contains(clientID.toInteger.toString)`.
 * Detected via the `.contains(` text pattern; semantics (substring vs.
 * delimiter-separated token match) are ambiguous and cannot be resolved from
 * static file inspection.
 */
export function cellUsesStringListMembership(cell) {
  return /\.contains\s*\(/.test(cell?.text ?? cell?.expression ?? '');
}

/**
 * True if this action uses a scalar accumulator pattern -- `attribute += number` --
 * to accumulate a count across multiple entity-scoped rule firings. Confirmed real
 * in CBMS Disaster FS: `program.t_totalNoOfClients += 1`. The dependency graph has
 * no equivalent; the correct translation is almost always a collection aggregate
 * but requires manual confirmation. Detected via the `+=` operator followed by a
 * numeric literal in the raw expression text.
 */
export function cellUsesScalarAccumulator(cell) {
  return /\+=\s*\d/.test(cell?.text ?? cell?.expression ?? '');
}

/**
 * True if this cell calls a Java extension method -- a static class method invoked
 * as `ClassName.methodName(...)` where the class name starts with an uppercase
 * letter and is not a chained attribute path before the call (e.g. this matches
 * `EligUtility.getLastMonth(...)` but not `Person.dob.yearsBetween(today)` because
 * the latter has an intermediate attribute segment before the method). Confirmed
 * real in CBMS Disaster FS: `EligUtility.getLastMonth(...)`,
 * `Allotment.getMaximumAllotmentAmount(...)`, `TimelyNOA.getTimelyNOACutoff(...)`,
 * `ReferenceTableData.getDecimalValue(...)`.
 */
export function cellUsesExtensionCall(cell) {
  return /\b[A-Z][A-Za-z]+\.[a-z][A-Za-z_]+\s*\(/.test(cell?.text ?? cell?.expression ?? '');
}

/**
 * True if this cell uses a Corticon type-conversion method (.toString(),
 * .toDecimal(), .toDate(), etc.) -- confirmed real: this fixture's own
 * type-conversion.ers uses `age.toString()` in an action. Detected via the raw
 * expression text since Corticon does not emit a METHOD term for the conversion
 * call -- the parsed term tree only shows the attribute being converted, not the
 * method applied to it.
 */
export function cellUsesTypeConversion(cell) {
  return /\.(toString|toDecimal|toDate|toInteger|toBoolean|toNumber)\s*\(/i.test(cell?.text ?? cell?.expression ?? '');
}

/**
 * Scans every rule's conditions/actions, plus every rulesheet's own filters, across a
 * whole project and surfaces each expression-level pattern match found -- the
 * project-wide entry point classify-project.js uses, built on the same per-term/per-cell
 * detectors above (including their raw-text fallbacks, so a project-level scan doesn't
 * lose the compound-expression/filter-level cases those fallbacks exist for).
 */
export function classifyExpressionPatterns(project) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      for (const cell of [...rule.conditions, ...rule.actions].filter(Boolean)) {
        if ((cell.referencedTerms ?? []).some(isDateArithmetic)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'date-arithmetic', expression: cell.text });
        }
        if (actionUsesCurrencyRounding(cell)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'currency-rounding', expression: cell.text });
        }
        if (usesSortingOperation(cell)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'sorting', expression: cell.text });
        }
        if (cellUsesCompoundArithmetic(cell)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'operator-precedence', expression: cell.text });
        }
        if (cellUsesLogicalKeywords(cell)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'logical-keywords', expression: cell.text });
        }
        if (cellUsesRangeMembership(cell)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'membership-test/range', expression: cell.text });
        }
        if (cellUsesStringListMembership(cell)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'membership-test/string-list', expression: cell.text });
        }
        if (cellUsesScalarAccumulator(cell)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'scalar-accumulator', expression: cell.text });
        }
        if (cellUsesExtensionCall(cell)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'extension-call', expression: cell.text });
        }
        if (cellUsesTypeConversion(cell)) {
          result.push({ rulesheet: rulesheetFile, ruleIndex, kind: 'type-conversion', expression: cell.text });
        }
      }
    });
    for (const filter of rulesheet.filters ?? []) {
      if (usesSortingOperation(filter)) {
        result.push({ rulesheet: rulesheetFile, ruleIndex: null, kind: 'sorting', expression: filter.expression });
      }
    }
  }
  return result;
}
