import { entriesOf } from '../../../map-utils.js';

// A bare top-level ENTITY term in modifiedTermList means the entity/association itself
// is being written, not a scalar attribute of it -- see touchesEntityCreation's own
// comment (attribute-path.js) for the confirmed real evidence distinguishing this from
// an ordinary assignment's bare ENTITY term in referencedTermList.
function entityCreationKind(modifiedTerms, referencedTerms) {
  const modifiedEntityTerm = (modifiedTerms ?? []).find((t) => t.termtype === 'ENTITY');
  if (!modifiedEntityTerm) return null;
  const hasNew = [...(modifiedTerms ?? []), ...(referencedTerms ?? [])].some((t) => t.termtype === 'NEW');
  // Confirmed real: DC Medicaid/CHIP's `Person.cohort += Cohort.newUnique[...]` is
  // both at once (a brand-new Cohort, added into Person.cohort) -- "new" wins since
  // it's the more specific/informative fact about what happened.
  return {
    entityType: modifiedEntityTerm.datatype ?? modifiedEntityTerm.text,
    associationPath: modifiedEntityTerm.fulltext,
  };
}

// Determines whether any condition or action in the project references the given
// association path or entity type -- i.e. reads from `path` or from an attribute
// of an entity reached through `path` (e.g. `ApplicationMember.exemptions.exemptionType`).
// Used to distinguish the two entity-creation variants: an association that is
// read elsewhere is an input the caller must supply; one that is only written
// is an output the response body should contain.
//
// Checking fulltext alone is insufficient: Corticon commonly aliases associations
// under different names in filters/conditions (e.g. `cohorts` as a local alias for
// the entities in `Person.cohort`), so `Person.cohort` would not appear in any
// referencedTerm fulltext even though the entities it contains are definitely read.
// Checking by entity type catches these alias-based reads: if any term's datatype
// (or its parent ENTITY term's datatype) matches the created entity type, the
// association is being read somewhere.
function isReadAnywhere(project, associationPath, entityType) {
  for (const [, rulesheet] of entriesOf(project.rulesheets)) {
    for (const rule of rulesheet.rules ?? []) {
      for (const part of [...(rule.conditions ?? []), ...(rule.actions ?? [])].filter(Boolean)) {
        for (const term of part.referencedTerms ?? []) {
          // Skip NEW terms — they are part of the creation expression itself
          // (e.g. `ApplicationMember.exemptions.new`), not downstream reads.
          if (term.termtype === 'NEW') continue;
          if (term.fulltext === associationPath || term.fulltext?.startsWith(associationPath + '.')) return true;
          // Alias-based read: the created entity type is accessed under a different
          // local name (e.g. `cohorts` for Cohort entities in `Person.cohort`).
          if (entityType && (term.datatype === entityType || term.parent?.datatype === entityType)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Finds real entity-creation / association-mutation actions: an action that
 * constructs a new entity (`.new`/`.newUnique`) or mutates an existing
 * association/collection (`.add`) directly, rather than assigning a plain scalar
 * attribute. Confirmed real in DC Medicaid/CHIP's `Create Household for Unique
 * PrimaryInsuredId.ers` (`Household.newUnique[...]`, kind "new"), `Group Members into
 * Households.ers` (`members += Person`-style association mutation with no NEW term at
 * all, kind "add"), and `MAGI Eligibility Groups.ers`/`Non-MAGI Eligibility
 * Groups.ers` (`Person.cohort += Cohort.newUnique[...]`/`Cohort.new[...]`, both kinds
 * at once).
 *
 * Each result includes a `variant` field distinguishing two cases (see
 * translation-patterns.yaml `entity-creation` variants for the full rationale):
 * - `output`: the association is only written, never read downstream — the response
 *   body should contain it, derived from the creation logic.
 * - `input`: the association is both written and read by other rules — it must be
 *   caller-supplied before invoking the graph (same caller-contract as before).
 *
 * Scans rulesheets directly rather than the attribute dependency graph: a pure
 * entity/association write has no scalar ATTRIBUTE term at all (confirmed real in the
 * Group Members "add" case), so buildDependencyGraph's attribute-path write tracking
 * never records it -- this pattern would be invisible if detection only looked there.
 */
export function classifyEntityCreation(project) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      for (const action of rule.actions.filter(Boolean)) {
        const creation = entityCreationKind(action.modifiedTerms, action.referencedTerms);
        if (creation) result.push({ rulesheet: rulesheetFile, ruleIndex, ...creation });
      }
    });
  }
  // Second pass: tag each entry with its variant based on whether the association
  // path is ever read elsewhere in the project.
  for (const entry of result) {
    entry.variant = isReadAnywhere(project, entry.associationPath, entry.entityType) ? 'input' : 'output';
  }
  return result;
}
