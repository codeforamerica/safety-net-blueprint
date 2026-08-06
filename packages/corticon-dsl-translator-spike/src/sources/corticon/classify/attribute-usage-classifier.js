import { isBlankTemplateRule } from '../corticon/rulesheet.js';
import { entriesOf } from '../../../map-utils.js';

/**
 * Scans every rule's conditions and actions and collects all ATTRIBUTE terms that
 * are read (referencedTerms of conditions and actions) or written (modifiedTerms of
 * actions). Cross-references the vocabulary for authoritative type info -- term.datatype
 * is the primitive underlying type (e.g. String) and loses custom-type/enum information,
 * so the vocabulary is the authoritative source. An attribute in both maps is an
 * intermediate: computed by one rule, consumed by another.
 *
 * Returns { reads, writes } where each is an object mapping "Entity.attribute" ->
 * { entity, attribute, datatype, vocabFile }.
 */
export function classifyAttributeUsage(project) {
  const reads = {};
  const writes = {};

  // Build a lookup from "Entity.attribute" -> { datatype, vocabFile } using the
  // vocabulary directly so enum types show their values ("'snap' | 'tanf'") rather
  // than just the underlying primitive type name.
  const vocabLookup = new Map();
  for (const [vocabFile, vocab] of entriesOf(project.vocabularies)) {
    const customTypes = new Map(entriesOf(vocab.customTypes));
    for (const [entityName, entity] of entriesOf(vocab.entities)) {
      for (const [attrName, attr] of entriesOf(entity.attributes)) {
        let datatype;
        if (attr.kind === 'association') {
          const typeName = attr.type?.name ?? '?';
          datatype = attr.isCollection ? `List(${typeName})` : typeName;
        } else if (attr.type?.kind === 'customType') {
          const ct = customTypes.get(attr.type.name);
          datatype = (ct?.isEnum && ct.values?.length) ? ct.values.join(' | ') : attr.type.name;
        } else {
          datatype = attr.type?.name ?? '?';
        }
        // Keyed by lowercase entity name so rule aliases (e.g. "program") match
        // vocab entries (e.g. "Program") regardless of capitalisation.
        vocabLookup.set(`${entityName.toLowerCase()}.${attrName}`, { datatype, vocabFile });
      }
    }
  }

  function add(map, term) {
    // Capture both scalar ATTRIBUTE terms and named association references --
    // associations have termtype ENTITY but carry a parent (e.g. applicant on
    // Application from "applicant += ApplicationMember"), distinguishing them
    // from bare entity references (no parent) which are not property accesses.
    const isAttribute = term?.termtype === 'ATTRIBUTE';
    const isAssociation = term?.termtype === 'ENTITY' && !!term.parent?.text;
    if (!isAttribute && !isAssociation) return;
    const entity = term.parent?.text ?? '';
    if (!entity) return;
    const key = `${entity}.${term.text}`;
    if (!map[key]) {
      const resolved = vocabLookup.get(`${entity.toLowerCase()}.${term.text}`);
      map[key] = {
        entity,
        attribute: term.text,
        datatype: resolved?.datatype ?? term.datatype ?? '?',
        vocabFile: resolved?.vocabFile ?? null,
      };
    }
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
