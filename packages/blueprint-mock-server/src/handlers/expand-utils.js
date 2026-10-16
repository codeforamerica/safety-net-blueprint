/**
 * Utilities for x-relationship and x-derived runtime behavior at GET time.
 *
 * expand:     The resolver renames the FK field (e.g. memberId → member) and
 *             preserves x-relationship on the renamed field. At GET time these
 *             utilities find the DB FK value and inline the related object.
 *
 * links-only: The resolver keeps the FK field and adds a `links` property to
 *             the schema. At GET time these utilities populate links.{name}
 *             with a URI pointing to the related resource.
 *
 * x-derived:  Fields annotated with x-derived carry a CEL expression evaluated
 *             at read time with $this bound to the record.
 */

import { evaluateCEL } from '@codeforamerica/blueprint-core/cel';

/**
 * Every property map a schema contributes, following refs on the way.
 *
 * A composed schema declares its fields across `allOf` members, and those
 * members are refs — so without following them there are no properties to
 * read and an annotated field is invisible. That failed quietly: list items
 * came back without their `links`, because `x-relationship` lives on a
 * property the walker could not see (#448).
 *
 * `follow` is `api.resolve.schema`, which resolves one hop against the
 * document the schema was declared in. Identity when omitted, which is right
 * for a schema that carries no refs.
 *
 * @param {object} schema
 * @param {(schema: *) => *} follow
 * @returns {object[]} Property maps, outermost first
 */
export function propertiesOf(schema, follow = (x) => x) {
  const resolved = follow(schema);
  if (!resolved || typeof resolved !== 'object') return [];

  const sources = [];
  if (resolved.properties) sources.push(resolved.properties);

  if (Array.isArray(resolved.allOf)) {
    for (const entry of resolved.allOf) {
      const member = follow(entry);
      if (member?.properties) sources.push(member.properties);
    }
  }

  return sources;
}

/**
 * Walk a response schema and return all fields annotated with
 * x-relationship.style: expand.
 *
 * Handles flat schemas and allOf.
 *
 * @param {object} schema - OpenAPI schema object (resolved, post-overlay)
 * @returns {Array<{ fieldName: string, fkField: string, resource: string, collection: string }>}
 */
export function extractExpandFields(schema, follow = (x) => x) {
  if (!schema) return [];

  const fields = [];
  const propertySources = propertiesOf(schema, follow);
  const declared = new Set(propertySources.flatMap((props) => Object.keys(props)));

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
          // The schema keeps the key too when it is writable (the Writable
          // pattern); otherwise the expanded record replaces it.
          keepFk: declared.has(fkField),
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
 *   - if found: sets fieldName to the related object, and removes fkField
 *     unless the schema declares it too (keepFk)
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

  for (const { fieldName, fkField, collection, keepFk } of expandFields) {
    const fkValue = result[fkField];
    if (!fkValue) continue;

    const related = lookup(collection, fkValue);
    if (related) {
      result[fieldName] = related;
      if (!keepFk && fkField !== fieldName) delete result[fkField];
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
export function getItemSchema(listSchema, schemas, follow = (x) => x) {
  if (!listSchema) return null;

  const root = follow(listSchema);
  const sources = [];
  if (root.properties) sources.push(root);
  if (Array.isArray(root.allOf)) sources.push(...root.allOf.map(follow));

  for (const entry of sources) {
    const itemsItems = entry?.properties?.items?.items;
    if (!itemsItems) continue;

    if (typeof itemsItems.$ref === 'string') {
      // Prefer the resolver, which follows a ref into another document.
      // The name lookup below only works for a same-document ref, and was
      // the only option while specs arrived dereferenced (#448).
      const resolved = follow(itemsItems);
      if (resolved !== itemsItems) return resolved;

      if (schemas) {
        const refName = itemsItems.$ref.split('/').pop();
        return schemas[refName] ?? itemsItems;
      }
    }
    return itemsItems;
  }

  return root;
}

/**
 * Where each resource's records are kept, by resource name, read from core's
 * model of the API documents when they are loaded (spec-loader.js) — so a
 * TranscriptionProfile served at /profiles is found in `profiles`.
 *
 * @type {Map<string, string>}
 */
const collectionsByResource = new Map();

/**
 * Where each resource is read, by resource name: its item path with the server
 * base in front, and the parameter naming the record itself — so a link to a
 * member is `/intake/applications/{applicationId}/members/{memberId}`, in the
 * API that serves members, not a path under whichever API holds the link.
 *
 * @type {Map<string, { path: string, parameter: string }>}
 */
const itemPathsByResource = new Map();

/**
 * @param {Map<string, string>} collections - Resource name → collection
 * @param {Map<string, { path: string, parameter: string }>} [itemPaths] - Resource name → where it is read
 */
export function registerResourceCollections(collections, itemPaths = new Map()) {
  // A server starting replaces what the last one registered: a resource only it
  // served would otherwise still look served here.
  collectionsByResource.clear();
  itemPathsByResource.clear();
  for (const [name, collection] of collections) collectionsByResource.set(name, collection);
  for (const [name, item] of itemPaths) itemPathsByResource.set(name, item);
}

/**
 * The collection a resource's records are kept in. One the model names is
 * found there; otherwise the name is converted by convention — ApplicationMember
 * → application-members — which is how it was found before the model said.
 */
export function resourceToCollection(resource) {
  return collectionsByResource.get(resource) ?? (resource
    .replace(/([A-Z])/g, (_, c, i) => (i === 0 ? c.toLowerCase() : `-${c.toLowerCase()}`))
    + 's');
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
export function extractLinksFields(schema, follow = (x) => x) {
  if (!schema) return [];

  const fields = [];
  const propertySources = propertiesOf(schema, follow);
  const declared = new Set(propertySources.flatMap((props) => Object.keys(props)));

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
 * Where a related record is read: its resource's item path, with the record's
 * own id and any parent ids filled in. Parent ids come from the related record
 * itself — a member carries its `applicationId`.
 *
 * Null when there's no route to point at: a resource no loaded API serves, as
 * when only one domain's contracts are deployed, or a nested record that isn't
 * here to say who its parent is. A link that can't be right is left out.
 *
 * @param {string} resource
 * @param {string} id
 * @param {string} collection
 * @param {(collection: string, id: string) => object|null} lookup
 * @returns {string|null}
 */
function linkTo(resource, id, collection, lookup) {
  const item = itemPathsByResource.get(resource);
  if (!item) return null;
  let related;
  let unresolved = false;
  const path = item.path.replace(/\{([^}]+)\}/g, (_, name) => {
    if (name === item.parameter) return encodeURIComponent(id);
    related ??= lookup?.(collection, id) ?? null;
    const value = related?.[name];
    if (value === undefined || value === null) unresolved = true;
    return encodeURIComponent(value ?? '');
  });
  return unresolved ? null : path;
}

/**
 * Apply links-only substitutions to a single DB record.
 * Returns a new object — does not mutate the original.
 *
 * For each linksField with an id on the record, adds `links[linkName]`: where
 * the related record is read, in the API that serves it. The id field stays
 * (unlike expand).
 *
 * @param {object} record - Raw DB record (or already-expanded record)
 * @param {Array<{ fkField, linkName, resource, collection }>} linksFields
 * @param {(collection: string, id: string) => object|null} [lookup] - Finds a related record, for its parent ids
 * @returns {object}
 */
export function applyLinks(record, linksFields, lookup) {
  if (!linksFields || linksFields.length === 0) return record;

  const links = record.links ? { ...record.links } : {};
  let hasLinks = false;

  for (const { fkField, linkName, resource, collection } of linksFields) {
    const fkValue = record[fkField];
    if (!fkValue) continue;
    const href = linkTo(resource, fkValue, collection, lookup);
    if (!href) continue;
    links[linkName] = href;
    hasLinks = true;
  }

  if (!hasLinks) return record;
  return { ...record, links };
}

/**
 * Walk a response schema and return all fields annotated with x-derived.
 *
 * Handles flat schemas and allOf.
 *
 * @param {object} schema - OpenAPI schema object (resolved, post-overlay)
 * @returns {Array<{ fieldName: string, expr: string }>}
 */
export function extractDerivedFields(schema, follow = (x) => x) {
  if (!schema) return [];

  const fields = [];
  const propertySources = propertiesOf(schema, follow);
  const declared = new Set(propertySources.flatMap((props) => Object.keys(props)));

  for (const props of propertySources) {
    for (const [fieldName, propDef] of Object.entries(props)) {
      if (propDef?.['x-derived']) {
        fields.push({ fieldName, expr: propDef['x-derived'] });
      }
    }
  }

  return fields;
}

/**
 * Apply x-derived field computations to a record.
 * Returns a new object — does not mutate the original.
 *
 * Each x-derived expression is CEL, evaluated with `this` bound to the record.
 * One that does not evaluate leaves the field out, and says why.
 *
 * @param {object} record - DB record (after expand/links have been applied)
 * @param {Array<{ fieldName: string, expr: string }>} derivedFields
 * @returns {object}
 */
export function applyDerivedFields(record, derivedFields) {
  if (!derivedFields || derivedFields.length === 0) return record;

  const result = { ...record };
  for (const { fieldName, expr } of derivedFields) {
    try {
      result[fieldName] = evaluateCEL(expr, { this: record });
    } catch (e) {
      console.warn(`x-derived ${fieldName} "${expr}" did not evaluate: ${e.message}`);
    }
  }
  return result;
}
