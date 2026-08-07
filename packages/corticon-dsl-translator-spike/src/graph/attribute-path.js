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

/**
 * True if an action modifies or constructs an entity/association itself, not a plain
 * scalar attribute of one. Two confirmed real shapes, both in DC Medicaid/CHIP's
 * `Create Household for Unique PrimaryInsuredId.ers` / `Group Members into
 * Households.ers`: (1) `Household.newUnique[...]` puts a bare top-level ENTITY term
 * ("Household") in modifiedTermList, alongside a NEW-type term ("Household.new") in
 * referencedTermList; (2) `members.add(...)`-style association mutation puts a bare
 * top-level ENTITY term ("members") in modifiedTermList with no NEW term at all --
 * so NEW alone isn't a sufficient signal.
 *
 * Checking referencedTermList for a bare ENTITY term (as an earlier version of this
 * function did) is NOT a valid signal on its own: confirmed real ordinary attribute
 * assignments -- `Person.age = Person.dob.yearsBetween(today)` and
 * `Household.HouseholdSize = members->size`, neither an entity-creation action --
 * both carry a bare top-level ENTITY term in referencedTermList too, just naming the
 * entity the read is scoped to. Only a bare ENTITY term in modifiedTermList itself
 * (the entity/association actually being written), or a NEW term anywhere, counts.
 */
/**
 * Scans all rule terms in a project and builds a map from every alias used in
 * rules (term.parent.text, e.g. "ppEligRslt") to its canonical entity type
 * (term.parent.datatype, e.g. "ParticipatingProgramEligRslt"). This is the
 * Corticon alias concept: rulesheets declare entity aliases locally, but the
 * datatype field always carries the real type name regardless of alias.
 *
 * Returns a Map<alias, canonicalType>. Entries where alias === canonicalType
 * are included so callers can use the map unconditionally.
 */
export function buildEntityAliasMap(project) {
  const aliasMap = new Map();
  for (const rulesheet of Object.values(project.rulesheets ?? {})) {
    for (const rule of rulesheet.rules ?? []) {
      for (const cell of [...(rule.conditions ?? []), ...(rule.actions ?? [])].filter(Boolean)) {
        for (const term of [...(cell.referencedTerms ?? []), ...(cell.modifiedTerms ?? [])]) {
          let current = term;
          while (current && (current.termtype === 'METHOD' || current.termtype === 'COLLECTION')) {
            current = current.parent;
          }
          if (!current?.parent?.text || !current.parent.datatype) continue;
          aliasMap.set(current.parent.text, current.parent.datatype);
        }
      }
    }
  }
  return aliasMap;
}

export function touchesEntityCreation(modifiedTerms, referencedTerms) {
  const entityItselfModified = (modifiedTerms ?? []).some((t) => t.termtype === 'ENTITY');
  const newConstruction = [...(modifiedTerms ?? []), ...(referencedTerms ?? [])].some((t) => t.termtype === 'NEW');
  return entityItselfModified || newConstruction;
}
