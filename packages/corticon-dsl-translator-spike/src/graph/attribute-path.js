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
  if (!term || term.termtype !== 'ATTRIBUTE') return undefined;
  const entityType = term.parent?.datatype ?? term.parent?.text;
  if (!entityType) return undefined;
  return `${entityType}.${term.text}`;
}

/** True if a modifiedTermList/referencedTermList contains a bare ENTITY-type term -- the confirmed real shape of an entity-creation action (`.new`), distinct from a plain attribute assignment. */
export function touchesEntityCreation(terms) {
  return (terms ?? []).some((t) => t.termtype === 'ENTITY' || t.termtype === 'NEW');
}
