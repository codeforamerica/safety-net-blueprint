import { entriesOf } from '../map-utils.js';

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
  return { kind: hasNew ? 'new' : 'add', entityType: modifiedEntityTerm.datatype ?? modifiedEntityTerm.text };
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
 * at once). Per issue #388, this is an orchestration-layer concern to flag for
 * relocation, not a Fact to translate -- grouping flat Person records into Household
 * objects (or a cohort match into a Person's cohort collection) is data assembly, not
 * rule evaluation.
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
      for (const action of rule.actions) {
        const creation = entityCreationKind(action.modifiedTerms, action.referencedTerms);
        if (creation) result.push({ rulesheet: rulesheetFile, ruleIndex, ...creation });
      }
    });
  }
  return result;
}
