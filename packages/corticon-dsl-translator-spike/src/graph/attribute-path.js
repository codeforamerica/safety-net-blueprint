/**
 * Resolve a parsed expression term into a canonical "EntityType.attributeName" path.
 *
 * Corticon expressions reference entities by a rulesheet-local alias (e.g. "loanapp"
 * for LoanApplication), not the entity's real type name -- confirmed real in
 * Mortgage's Select_Credit.ers (`<parentTerm text="loanapp" datatype="LoanApplication" .../>`).
 * Using `.text` directly would produce alias-based paths that don't match up across
 * different rulesheets using different aliases for the same entity. Corticon's own
 * `datatype` field already carries the real entity type regardless of alias, so
 * canonical paths use `datatype`, not `text`, for the owning entity.
 */
export function canonicalAttributePath(term) {
  // A METHOD (`.contains(...)`, `.yearsBetween(...)`, `.round(...)`) or COLLECTION
  // (`->sum`, `->sortedBy(...)`) term is itself just an operation, not the
  // attribute being read -- confirmed real: DC Medicaid's
  // `outputCoverage1.contains('ineligible')` and `dob.yearsBetween(today)` both
  // put the ATTRIBUTE as the METHOD term's direct parent, and ComputeIncome.ers's
  // `applicant.income->sum` puts it as the COLLECTION term's direct parent.
  // Without resolving through it, the dependency graph silently drops any read
  // that goes through a method call or collection aggregator -- confirmed to
  // zero out edges into `Household.totalIncome`/`Household.incomeRounded`
  // entirely. Walks through any number of consecutive METHOD/COLLECTION wrapper
  // terms (not just one level), so a method chained on a collection result
  // (`->sum.round(2)`) would resolve correctly too, even though we haven't seen
  // that specific shape confirmed real yet -- there's no reason to assume it
  // can't occur, and handling it costs nothing extra. Stops at the first
  // non-METHOD/COLLECTION term reached: if that's an ATTRIBUTE, resolve it; if
  // it's an ENTITY instead (e.g. `adult->size`, `candidate->exists(...)`,
  // `program->sortedBy(...)`, all confirmed real), there genuinely is no scalar
  // attribute being read, so this correctly stops there rather than walking
  // past the entity to misattribute the read to some unrelated ancestor field.
  let current = term;
  while (current && (current.termtype === 'METHOD' || current.termtype === 'COLLECTION')) {
    current = current.parent;
  }
  if (!current || current.termtype !== 'ATTRIBUTE') return undefined;
  const entityType = current.parent?.datatype ?? current.parent?.text;
  if (!entityType) return undefined;
  return `${entityType}.${current.text}`;
}

/** True if a modifiedTermList/referencedTermList contains a bare ENTITY-type term -- the confirmed real shape of an entity-creation action (`.new`), distinct from a plain attribute assignment. */
export function touchesEntityCreation(terms) {
  return (terms ?? []).some((t) => t.termtype === 'ENTITY' || t.termtype === 'NEW');
}
