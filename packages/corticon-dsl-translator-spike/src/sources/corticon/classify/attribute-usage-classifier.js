import { isBlankTemplateRule } from '../rulesheet.js';
import { entriesOf } from '../../../map-utils.js';
import { buildEntityAliasMap } from '../../../graph/attribute-path.js';

/**
 * Scans every rule's conditions and actions and collects all ATTRIBUTE terms that
 * are read (referencedTerms of conditions and actions) or written (modifiedTerms of
 * actions). Returns { reads, writes } where each is a Set of "Entity.attribute" strings.
 * An attribute in both sets is an intermediate: computed by one rule, consumed by another.
 */
export function classifyAttributeUsage(project) {
  const reads = new Set();
  const writes = new Set();
  const aliasMap = buildEntityAliasMap(project);

  function add(set, term) {
    // Capture both scalar ATTRIBUTE terms and named association references --
    // associations have termtype ENTITY but carry a parent (e.g. applicant on
    // Application from "applicant += ApplicationMember"), distinguishing them
    // from bare entity references (no parent) which are not property accesses.
    const isAttribute = term?.termtype === 'ATTRIBUTE';
    const isAssociation = term?.termtype === 'ENTITY' && !!term.parent?.text;
    if (!isAttribute && !isAssociation) return;
    const alias = term.parent?.text ?? '';
    if (!alias) return;
    // Resolve alias to canonical entity type so keys match the dependency graph.
    const entity = aliasMap.get(alias) ?? alias;
    set.add(`${entity}.${term.text}`);
  }

  for (const [, rulesheet] of entriesOf(project.rulesheets)) {
    for (const rule of rulesheet.rules) {
      if (isBlankTemplateRule(rule)) continue;
      for (const cell of [...rule.conditions, ...rule.actions].filter(Boolean)) {
        for (const term of cell.referencedTerms ?? []) add(reads, term);
      }
      for (const action of rule.actions.filter(Boolean)) {
        for (const term of action.modifiedTerms ?? []) add(writes, term);
      }
    }
  }

  // Ruleflow branch conditions (e.g. "ApplicationMember.programType") are not
  // rulesheet cells -- scan them separately so enum switch attributes appear.
  for (const [, ruleflow] of entriesOf(project.ruleflows)) {
    for (const node of ruleflow.nodes ?? []) {
      for (const term of node.condition?.referencedTerms ?? []) add(reads, term);
    }
  }

  return { reads, writes };
}
