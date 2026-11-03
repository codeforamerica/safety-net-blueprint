/**
 * Polymorphic references: an id whose resource depends on a type field beside
 * it, such as a document link's subjectId with subjectType.
 *
 * The reference names its type field with x-relationship's discriminator
 * (OpenAPI's propertyName and mapping). The type field is an enum, and each
 * value names a resource in the set — by name in snake_case
 * (application_member → ApplicationMember), the way OpenAPI's discriminator
 * takes a value as a schema name — unless the mapping names one for it, or
 * External for something outside the contracts. Then the reference can be
 * checked when a record is written, and take part in onDelete, like any other.
 *
 * Checked over the whole set, after overlays: a framework type field gets its
 * enum from the set that includes it. Event data isn't checked: an event is
 * not a record a delete can reach.
 */

const pascalOf = (value) => String(value).split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');

/** Follow a ref within the same document. */
function local(content, schema) {
  if (typeof schema?.$ref !== 'string' || !schema.$ref.startsWith('#/')) return schema;
  return schema.$ref.slice(2).split('/').reduce((node, key) => node?.[key], content) ?? schema;
}

/** Every properties map in a document, with where it is. */
function* propertyMaps(node, trail = []) {
  if (!node || typeof node !== 'object') return;
  if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
    yield { properties: node.properties, trail };
  }
  for (const [key, value] of Object.entries(node)) yield* propertyMaps(value, [...trail, key]);
}

/**
 * @param {import('../../types.js').Doc[]} docs
 * @returns {Map<string, Array<{ rule: string, message: string, path: string }>>} By document path
 */
export function polymorphicReferenceErrors(docs) {
  const resources = new Set();
  for (const doc of docs) {
    if (doc.type !== 'openapi') continue;
    for (const top of doc.model?.()?.resources ?? []) {
      for (const resource of [top, ...top.singletons]) if (resource.name) resources.add(resource.name);
    }
  }

  const byDoc = new Map();
  const report = (doc, rule, message, path) => {
    if (!byDoc.has(doc.path)) byDoc.set(doc.path, []);
    byDoc.get(doc.path).push({ rule, message, path: `${doc.path}#/${path}` });
  };

  for (const doc of docs) {
    if (doc.type === 'asyncapi' || !doc.content || typeof doc.content !== 'object') continue;
    for (const { properties, trail } of propertyMaps(doc.content)) {
      for (const [field, definition] of Object.entries(properties)) {
        const relationship = definition?.['x-relationship'];
        if (relationship?.resource !== 'Polymorphic') continue;
        const at = [...trail, 'properties', field].join('/');
        const typeField = relationship.discriminator?.propertyName;
        if (!typeField || !properties[typeField]) {
          report(doc, 'polymorphic-type-field', `${field} is Polymorphic, so it names the field beside it that says its type: x-relationship.discriminator.propertyName${typeField ? ` (${typeField} isn't one)` : ''}.`, at);
          continue;
        }
        const values = local(doc.content, properties[typeField])?.enum;
        if (!Array.isArray(values)) {
          report(doc, 'polymorphic-type-not-enum', `${typeField}, the type of ${field}, must be an enum, so each value can be checked against a resource. A framework field gets its values from the contract set, through an overlay.`, at);
          continue;
        }
        const mapping = relationship.discriminator.mapping ?? {};
        for (const value of values.filter((v) => v !== null)) {
          const resource = mapping[value] ?? pascalOf(value);
          if (resource !== 'External' && !resources.has(resource)) {
            report(doc, 'polymorphic-type-names-nothing', `${typeField} value "${value}" names no resource (${resource}). Map it in discriminator.mapping to a resource, or to External for something outside the contracts.`, at);
          }
        }
      }
    }
  }
  return byDoc;
}
