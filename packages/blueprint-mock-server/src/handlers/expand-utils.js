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
 * A resource with kinds is a `oneOf` of them, each an `allOf` of refs —
 * a suggestion is an operation suggestion or an informing one — so the
 * members of `oneOf` and `anyOf` are read too, as deep as they go.
 *
 * `follow` is `api.resolve.schema`, which resolves one hop against the
 * document the schema was declared in. Identity when omitted, which is right
 * for a schema that carries no refs.
 *
 * @param {object} schema
 * @param {(schema: *) => *} follow
 * @returns {object[]} Property maps, outermost first
 */
export function propertiesOf(schema, follow = (x) => x, seen = new Set()) {
  const resolved = follow(schema);
  if (!resolved || typeof resolved !== 'object' || seen.has(resolved)) return [];
  seen.add(resolved);
  // A ref to a ref — a component that names a schema in another file — is
  // followed on to the schema.
  if (resolved !== schema && typeof resolved.$ref === 'string') return propertiesOf(resolved, follow, seen);

  const sources = [];
  if (resolved.properties) sources.push(resolved.properties);
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    for (const entry of Array.isArray(resolved[key]) ? resolved[key] : []) {
      sources.push(...propertiesOf(entry, follow, seen));
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
 * @param {(schema: object) => object} [follow]
 * @param {object} [resources] - Where each resource is kept (spec-loader.js `resourceIndex`)
 * @returns {Array<{ fieldName: string, fkField: string, resource: string, collection: string }>}
 */
export function extractExpandFields(schema, follow = (x) => x, resources = null) {
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
          collection: resourceToCollection(rel.resource, resources),
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
 * The collection a resource's records are kept in. One the model names is
 * found there; otherwise the name is converted by convention — ApplicationMember
 * → application-members — which is how it was found before the model said.
 *
 * @param {string} resource
 * @param {{ collections: Map<string, string> }} [resources] - The mock's
 *   resource index (spec-loader.js `resourceIndex`)
 */
export function resourceToCollection(resource, resources) {
  return resources?.collections.get(resource) ?? (resource
    .replace(/([A-Z])/g, (_, c, i) => (i === 0 ? c.toLowerCase() : `-${c.toLowerCase()}`))
    + 's');
}

/**
 * Walk a response schema and return all fields annotated with
 * x-relationship.style: links-only.
 *
 * Handles flat schemas, allOf and oneOf. A polymorphic reference has no one
 * resource: its type field names one for each record, through the
 * discriminator's mapping or by name (transcript_entry → TranscriptEntry).
 * A record held inside this one — each evidence entry of a suggestion —
 * comes back as `{ within, fields }`, its own fields to link.
 *
 * @param {object} schema - OpenAPI schema object (resolved, post-overlay)
 * @param {(schema: object) => object} [follow]
 * @param {object} resources - Where each resource is kept (spec-loader.js `resourceIndex`)
 * @returns {Array<{ fkField: string, linkName: string, resource: string, collection: string, typeField?: string, mapping?: object } | { within: string, fields: Array }>}
 */
export function extractLinksFields(schema, follow = (x) => x, resources, seen = new Set()) {
  if (!resources) throw new TypeError('extractLinksFields needs the mock\'s resource index, to find where each resource is kept');
  if (!schema) return [];

  const fields = [];
  for (const props of propertiesOf(schema, follow)) {
    for (const [fieldName, propDef] of Object.entries(props)) {
      const rel = propDef?.['x-relationship'];
      if (rel?.style === 'links-only' && rel.resource) {
        // Derive the link name by stripping trailing Id (only when > 2 chars remain)
        const linkName = fieldName.length > 2 ? fieldName.replace(/Id$/, '') : fieldName;
        fields.push(rel.resource === 'Polymorphic'
          ? { fkField: fieldName, linkName, typeField: rel.discriminator?.propertyName, mapping: rel.discriminator?.mapping ?? {} }
          : { fkField: fieldName, linkName, resource: rel.resource, collection: resourceToCollection(rel.resource, resources) });
        continue;
      }
      const held = follow(propDef)?.items ?? propDef;
      const resolved = follow(held);
      // Only the schemas above this one are skipped, so a schema that holds
      // itself ends, and two fields holding the same schema both link.
      if (!resolved || typeof resolved !== 'object' || seen.has(resolved)) continue;
      const inner = extractLinksFields(held, follow, resources, new Set([...seen, resolved]));
      if (inner.length > 0) fields.push({ within: fieldName, fields: inner });
    }
  }

  return fields;
}

/** The resource a polymorphic reference's type value names, or null for one outside the contracts. */
function resourceOfType(type, mapping) {
  if (typeof type !== 'string' || type === '') return null;
  const resource = mapping[type] ?? type.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return resource === 'External' ? null : resource;
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
 * @param {object} resources - Where each resource is read
 * @returns {string|null}
 */
function linkTo(resource, id, collection, lookup, resources) {
  const item = resources?.itemPaths.get(resource);
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
 * (unlike expand). A record held inside this one gets its own `links`.
 *
 * @param {object} record - Raw DB record (or already-expanded record)
 * @param {Array} linksFields - From extractLinksFields
 * @param {(collection: string, id: string) => object|null} [lookup] - Finds a related record, for its parent ids
 * @param {object} resources - Where each resource is read (spec-loader.js `resourceIndex`)
 * @returns {object}
 */
export function applyLinks(record, linksFields, lookup, resources) {
  if (!resources) throw new TypeError('applyLinks needs the mock\'s resource index, to find where each resource is read');
  if (!linksFields || linksFields.length === 0 || !record || typeof record !== 'object') return record;

  const links = record.links ? { ...record.links } : {};
  let hasLinks = false;
  let out = record;

  for (const field of linksFields) {
    if (field.within) {
      const held = record[field.within];
      const linked = Array.isArray(held)
        ? held.map((item) => applyLinks(item, field.fields, lookup, resources))
        : applyLinks(held, field.fields, lookup, resources);
      if (linked !== held) out = { ...out, [field.within]: linked };
      continue;
    }
    const fkValue = record[field.fkField];
    if (!fkValue) continue;
    const resource = field.typeField ? resourceOfType(record[field.typeField], field.mapping) : field.resource;
    if (!resource) continue;
    const href = linkTo(resource, fkValue, field.typeField ? resourceToCollection(resource, resources) : field.collection, lookup, resources);
    if (!href) continue;
    links[field.linkName] = href;
    hasLinks = true;
  }

  return hasLinks ? { ...out, links } : out;
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

/**
 * The readOnly fields a client's request would change. readOnly means the
 * server sets the field (OpenAPI) — a state machine's status, a timestamp, a
 * record's parent from its path — so a client may send one only with the
 * value the server has or sets anyway, as when it sends a record back
 * unchanged. A create may also take one its schema declares writable, as a
 * value set once: an id the caller chooses, when a conversation started.
 *
 * @param {object} body - The request body
 * @param {object} schema - The record's read schema
 * @param {(s: object) => object} [follow]
 * @param {object} [known] - The values the server has or sets: the stored record for an update, the path's for a create
 * @param {string[]} [allowed] - Fields the operation takes anyway: a create schema's writable fields
 * @returns {string[]}
 */
export function changedReadOnlyFields(body, schema, follow = (x) => x, known = {}, allowed = []) {
  if (!body || typeof body !== 'object' || !schema) return [];
  const readOnly = new Set(propertiesOf(schema, follow).flatMap((props) => Object.entries(props)
    .filter(([, prop]) => prop?.readOnly === true || follow(prop)?.readOnly === true)
    .map(([name]) => name)));
  return Object.keys(body).filter((name) => readOnly.has(name) && !allowed.includes(name)
    && JSON.stringify(known?.[name]) !== JSON.stringify(body[name]));
}

/**
 * The fields a request schema takes from a client: declared, and not marked
 * readOnly there.
 *
 * @param {object|null} schema - An operation's request schema
 * @param {(s: object) => object} [follow]
 * @returns {string[]}
 */
export function writableFieldsOf(schema, follow = (x) => x) {
  if (!schema) return [];
  return propertiesOf(schema, follow).flatMap((props) => Object.entries(props)
    .filter(([, prop]) => prop?.readOnly !== true && follow(prop)?.readOnly !== true)
    .map(([name]) => name));
}
