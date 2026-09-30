/**
 * Check `var:` field references in SLA types and metrics against real schemas.
 *
 * Both express conditions as JSON Logic, where `{ var: "status" }` names a
 * field on the resource being filtered. Nothing stops that naming a field that
 * does not exist — the document is structurally valid and the condition simply
 * never matches at runtime, which is the worst way to find out.
 *
 * Only the first path segment is checked. `slaInfo.deadline.at` is verified as
 * far as `slaInfo` existing on the resource; the nested shape is the schema's
 * business, and resolving it through composed and referenced schemas would
 * report confident nonsense more often than it would catch a real mistake.
 */

/**
 * SLA types do not name the collection they apply to — they are a workflow
 * concept and always describe Task lifecycle.
 */
const SLA_COLLECTION = 'tasks';

/**
 * Collections are looked up within the document's own domain. A bare name is
 * ambiguous across domains, and resolving it to the wrong one checks fields
 * against an unrelated schema and reports confident nonsense.
 *
 * @param {import('../../types.js').Doc} doc
 * @param {string} collection
 * @returns {string}
 */
function qualify(doc, collection) {
  return `${doc.content?.domain}/${collection}`;
}

/**
 * @param {import('../../types.js').Doc} doc - An sla-types document
 * @param {Map<string, Set<string>>} propertiesByCollection
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateSlaTypeFields(doc, propertiesByCollection) {
  const properties = propertiesByCollection.get(qualify(doc, SLA_COLLECTION));
  if (!properties) return [];

  const errors = [];

  for (const slaType of doc.content?.slaTypes ?? []) {
    if (!slaType?.pauseWhen) continue;

    for (const reference of varReferences(slaType.pauseWhen)) {
      const field = reference.split('.')[0];
      if (properties.has(field)) continue;

      errors.push({
        rule: 'unknown-field-reference',
        message: `var: "${reference}" — field "${field}" does not exist on the ${SLA_COLLECTION} resource.`,
        path: `slaTypes[${slaType.id}].pauseWhen`,
      });
    }
  }

  return errors;
}

/**
 * @param {import('../../types.js').Doc} doc - A metrics document
 * @param {Map<string, Set<string>>} propertiesByCollection
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateMetricFields(doc, propertiesByCollection) {
  const errors = [];

  for (const metric of doc.content?.metrics ?? []) {
    // A metric can draw from up to three collections, each with its own filter.
    for (const key of ['source', 'from', 'to']) {
      const clause = metric[key];
      if (!clause?.filter) continue;

      // A collection the domain does not expose as an OpenAPI resource has no
      // schema to check against — a metric over the runtime event stream, say.
      const properties = propertiesByCollection.get(qualify(doc, clause.collection));
      if (!properties) continue;

      for (const reference of varReferences(clause.filter)) {
        const field = reference.split('.')[0];
        if (properties.has(field)) continue;

        errors.push({
          rule: 'unknown-field-reference',
          message:
            `var: "${reference}" — field "${field}" does not exist on the ` +
            `${clause.collection} resource.`,
          path: `metrics[${metric.id}].${key}.filter`,
        });
      }
    }
  }

  return errors;
}

/**
 * Every `var` operand in a JSON Logic expression.
 *
 * @param {*} node
 * @returns {Generator<string>}
 */
function* varReferences(node) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) yield* varReferences(item);
    return;
  }

  if (typeof node.var === 'string') {
    yield node.var;
    return;
  }

  for (const value of Object.values(node)) yield* varReferences(value);
}
