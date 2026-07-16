/**
 * Utilities for x-relationship runtime behavior at GET time.
 *
 * expand:     The resolver renames the FK field (e.g. memberId → member) and
 *             preserves x-relationship on the renamed field. At GET time these
 *             utilities find the DB FK value and inline the related object.
 *
 * links-only: The resolver keeps the FK field and adds a `links` property to
 *             the schema. At GET time these utilities populate links.{name}
 *             with a URI pointing to the related resource.
 */

/**
 * Walk a response schema and return all fields annotated with
 * x-relationship.style: expand.
 *
 * Handles flat schemas and allOf.
 *
 * @param {object} schema - OpenAPI schema object (resolved, post-overlay)
 * @returns {Array<{ fieldName: string, fkField: string, resource: string, collection: string }>}
 */
export function extractExpandFields(schema) {
  if (!schema) return [];

  const fields = [];
  const propertySources = [];

  if (schema.properties) propertySources.push(schema.properties);
  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) {
      if (entry.properties) propertySources.push(entry.properties);
    }
  }

  for (const props of propertySources) {
    for (const [fieldName, propDef] of Object.entries(props)) {
      const rel = propDef?.['x-relationship'];
      if (rel?.style === 'expand' && rel.resource) {
        // The resolver renames fooId → foo via deriveLinkName (strips trailing Id).
        // Reverse that convention to find the DB column: foo → fooId.
        const fkField = fieldName + 'Id';
        fields.push({
          fieldName,
          fkField,
          resource: rel.resource,
          collection: resourceToCollection(rel.resource),
        });
      }
    }
  }

  return fields;
}

/**
 * Apply expand substitutions to a single DB record.
 * Returns a new object — does not mutate the original.
 *
 * For each expand field:
 *   - reads the FK value from record[fkField]
 *   - calls lookup(collection, fkValue) to fetch the related object
 *   - if found: removes fkField, sets fieldName to the related object
 *   - if not found: leaves the record unchanged for that field
 *
 * @param {object} record - Raw DB record
 * @param {Array<{ fieldName, fkField, collection }>} expandFields
 * @param {function(collection: string, id: string): object|null} lookup
 * @returns {object}
 */
export function applyExpand(record, expandFields, lookup) {
  if (!expandFields || expandFields.length === 0) return record;

  const result = { ...record };

  for (const { fieldName, fkField, collection } of expandFields) {
    const fkValue = result[fkField];
    if (!fkValue) continue;

    const related = lookup(collection, fkValue);
    if (related) {
      result[fieldName] = related;
    }
  }

  return result;
}

/**
 * Resolve the item schema from a list response schema.
 *
 * List schemas wrap the actual resource schema:
 *   IncomeList.allOf[].properties.items.items.$ref → Income
 *
 * Returns the item schema object, or the list schema itself if no items ref found.
 *
 * @param {object} listSchema - The list response schema
 * @param {object} schemas - All schemas from apiMetadata.schemas
 * @returns {object|null}
 */
export function getItemSchema(listSchema, schemas) {
  if (!listSchema) return null;

  const sources = [];
  if (listSchema.properties) sources.push(listSchema);
  if (Array.isArray(listSchema.allOf)) sources.push(...listSchema.allOf);

  for (const entry of sources) {
    const itemsItems = entry.properties?.items?.items;
    if (itemsItems) {
      // If the item schema is a $ref, resolve it using the schemas map.
      if (itemsItems.$ref && schemas) {
        const refName = itemsItems.$ref.split('/').pop();
        return schemas[refName] ?? itemsItems;
      }
      return itemsItems;
    }
  }

  return listSchema;
}

/**
 * Convert a PascalCase resource name to a kebab-case plural collection name.
 * e.g. ApplicationMember → application-members
 *
 * This mirrors the convention used by deriveCollectionName for sub-resources.
 */
function resourceToCollection(resource) {
  return resource
    .replace(/([A-Z])/g, (_, c, i) => (i === 0 ? c.toLowerCase() : `-${c.toLowerCase()}`))
    + 's';
}

/**
 * Walk a response schema and return all fields annotated with
 * x-relationship.style: links-only.
 *
 * Handles flat schemas and allOf.
 *
 * @param {object} schema - OpenAPI schema object (resolved, post-overlay)
 * @returns {Array<{ fkField: string, linkName: string, resource: string, collection: string }>}
 */
export function extractLinksFields(schema) {
  if (!schema) return [];

  const fields = [];
  const propertySources = [];

  if (schema.properties) propertySources.push(schema.properties);
  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) {
      if (entry.properties) propertySources.push(entry.properties);
    }
  }

  for (const props of propertySources) {
    for (const [fieldName, propDef] of Object.entries(props)) {
      const rel = propDef?.['x-relationship'];
      if (rel?.style === 'links-only' && rel.resource) {
        // Derive the link name by stripping trailing Id (only when > 2 chars remain)
        const linkName = fieldName.length > 2 ? fieldName.replace(/Id$/, '') : fieldName;
        fields.push({
          fkField: fieldName,
          linkName,
          resource: rel.resource,
          collection: resourceToCollection(rel.resource),
        });
      }
    }
  }

  return fields;
}

/**
 * Apply links-only substitutions to a single DB record.
 * Returns a new object — does not mutate the original.
 *
 * For each linksField, if the FK value exists on the record:
 *   - Adds a `links` entry: links[linkName] = serverBasePath/collection/fkValue
 *   - Does NOT remove the FK field (unlike expand)
 *
 * @param {object} record - Raw DB record (or already-expanded record)
 * @param {Array<{ fkField, linkName, collection }>} linksFields
 * @param {string} [serverBasePath=''] - e.g. '/x-relationship'
 * @returns {object}
 */
export function applyLinks(record, linksFields, serverBasePath = '') {
  if (!linksFields || linksFields.length === 0) return record;

  const links = record.links ? { ...record.links } : {};
  let hasLinks = false;

  for (const { fkField, linkName, collection } of linksFields) {
    const fkValue = record[fkField];
    if (!fkValue) continue;
    links[linkName] = `${serverBasePath}/${collection}/${fkValue}`;
    hasLinks = true;
  }

  if (!hasLinks) return record;
  return { ...record, links };
}
