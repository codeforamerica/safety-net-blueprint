/**
 * Check that annotation keys point at things that exist.
 *
 * An annotation file attaches documentation and metadata to contract elements
 * by key — a schema field path, an operation, an event, a fact. None of those
 * keys are checked by the annotation schema itself, so a typo or a renamed
 * field leaves an annotation attached to nothing: it silently stops appearing
 * in the explorer and in generated documentation, with no error anywhere.
 *
 * Every key kind is checked against the artifact that defines it.
 */

import { resolveSchemaRefs, resolveRef, collectTopLevelProperties, getPropertyAtPath } from '../json-schema/index.js';

/**
 * @param {import('../../types.js').Doc} doc - An annotations document
 * @param {object} context
 * @param {Map<string, { spec: object, filePath: string }>} context.specsByDomain
 * @param {Set<string>} context.actions - "<object>.<action>" keys from state machines
 * @param {Set<string>} context.channels - Every AsyncAPI channel
 * @param {Map<string, { domain: string, facts: Set<string> }>} context.graphs - Facts per ruleset
 * @param {Map<string, Set<string>>} context.registryEntryIds - Entry IDs per registry type
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateAnnotations(doc, context) {
  const domain = doc.content?.domain ?? null;

  return [
    ...checkKeys(doc.content?.schema, (key) => schemaPathError(key, context.specsByDomain, domain), 'schema'),
    ...checkKeys(doc.content?.operations, (key) =>
      context.actions.has(key) ? null : `Operation "${key}" matches no state machine action.`, 'operations'),
    ...checkKeys(doc.content?.events, (key) =>
      context.channels.has(key) ? null : `Event "${key}" is not a channel in any AsyncAPI document.`, 'events'),
    ...checkKeys(doc.content?.facts, (key) => factError(key, context.graphs, domain), 'facts'),
    ...citationErrors(doc, context.registryEntryIds),
  ];
}

/**
 * @param {object} section - One annotation section, keyed by target
 * @param {(key: string) => string|null} check
 * @param {string} sectionName
 * @returns {{ rule: string, message: string, path: string }[]}
 */
function checkKeys(section, check, sectionName) {
  const errors = [];

  for (const key of Object.keys(section ?? {})) {
    const message = check(key);
    if (message) {
      errors.push({ rule: `unknown-annotation-${sectionName}-key`, message, path: `${sectionName}.${key}` });
    }
  }

  return errors;
}

/**
 * Why a `schema:` key does not resolve, or null when it does.
 *
 * The key is `resource.field.subfield`, with `[]` marking array traversal.
 * The resource is matched case-insensitively against schema names, trying the
 * generated Request and Response suffixes as well, and preferring the
 * annotation's own domain before falling back to any.
 *
 * @param {string} key
 * @param {Map<string, { spec: object, filePath: string }>} specsByDomain
 * @param {string|null} domain
 * @returns {string|null}
 */
function schemaPathError(key, specsByDomain, domain) {
  if (!key) return 'Empty annotation key.';
  if (specsByDomain.size === 0) return null;

  const dot = key.indexOf('.');
  const resource = dot === -1 ? key : key.slice(0, dot);
  const fieldPath = dot === -1 ? null : key.slice(dot + 1);

  const base = resource.charAt(0).toUpperCase() + resource.slice(1);
  const candidates = [base, `${base}Response`, `${base}Request`];

  const found = findSchema(specsByDomain, candidates, domain);
  if (!found) return `Schema "${base}" is not declared in any OpenAPI document.`;
  if (!fieldPath) return null; // annotating the resource itself

  const { spec, filePath, setRoot, schemaName } = found;
  const schema = resolveSchemaRefs(spec.components.schemas[schemaName], { spec, specFilePath: filePath, setRoot });

  if (getPropertyAtPath(spec, schema, fieldPath)) return null;

  return walkPath(spec, filePath, setRoot, schema, fieldPath)
    ? null
    : `Path "${key}" does not exist on schema "${base}".`;
}

/**
 * @param {Map<string, { spec: object, filePath: string }>} specsByDomain
 * @param {string[]} candidates
 * @param {string|null} domain
 * @returns {{ spec: object, filePath: string, schemaName: string }|null}
 */
function findSchema(specsByDomain, candidates, domain) {
  const search = (entry) => {
    const name = candidates.find((c) => entry.spec?.components?.schemas?.[c]);
    return name ? { ...entry, schemaName: name } : null;
  };

  const own = domain ? specsByDomain.get(domain) : null;
  if (own) {
    const hit = search(own);
    if (hit) return hit;
  }

  for (const entry of specsByDomain.values()) {
    const hit = search(entry);
    if (hit) return hit;
  }

  return null;
}

/**
 * Walk a dotted path segment by segment, following sub-resources.
 *
 * Direct navigation misses keys like `application.householdInfo.paysRent`,
 * where `householdInfo` is a sub-resource at its own endpoint rather than a
 * property of Application. Each segment is tried as a property, then inside
 * array items, then as a sub-resource.
 *
 * @param {object} spec
 * @param {string} filePath
 * @param {string|null} setRoot - Contract-set root bounding $ref following
 * @param {object} schema
 * @param {string} fieldPath
 * @returns {boolean}
 */
function walkPath(spec, filePath, setRoot, schema, fieldPath) {
  const subResources = buildSubResourceMap(spec, filePath, setRoot);
  let current = schema;

  for (const segment of fieldPath.replace(/\[\]/g, '').split('.').filter(Boolean)) {
    const properties = collectTopLevelProperties(spec, current);
    if (properties.has(segment)) {
      current = properties.get(segment);
      continue;
    }

    if (current.items) {
      const items = current.items.$ref ? resolveRef(spec, current.items.$ref) ?? current.items : current.items;
      const itemProperties = collectTopLevelProperties(spec, items);
      if (itemProperties.has(segment)) {
        current = itemProperties.get(segment);
        continue;
      }
    }

    if (subResources.has(segment)) {
      current = subResources.get(segment);
      continue;
    }

    return false;
  }

  return true;
}

/**
 * Sub-resource schemas by the camelCase name an annotation would use.
 *
 * A nested endpoint such as `/applications/{id}/tax-filers/{taxFilerId}`
 * registers under both `taxFilers` and `taxFiler`; the item schema wins over
 * a collection's list schema.
 *
 * @param {object} spec
 * @param {string} filePath
 * @param {string|null} setRoot - Contract-set root bounding $ref following
 * @returns {Map<string, object>}
 */
function buildSubResourceMap(spec, filePath, setRoot) {
  const map = new Map();
  const schemas = spec?.components?.schemas ?? {};

  const schemaFor = (ref) => {
    const name = typeof ref === 'string' ? ref.match(/^#\/components\/schemas\/(.+)$/)?.[1] : null;
    const raw = name ? schemas[name] : null;
    return raw ? resolveSchemaRefs(raw, { spec, specFilePath: filePath, setRoot }) : null;
  };

  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  for (const [path, pathItem] of Object.entries(spec?.paths ?? {})) {
    const segments = path.split('/').filter(Boolean);
    if (!segments.slice(0, -1).some((s) => s.startsWith('{'))) continue; // not nested

    const last = segments.at(-1);
    const schema = schemaFor(pathItem.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref);
    if (!schema) continue;

    if (!last.startsWith('{')) {
      // Singleton or collection without a detail endpoint; an item schema
      // registered earlier is more specific, so it is not overwritten.
      const key = camel(last);
      if (!map.has(key)) map.set(key, schema);
      continue;
    }

    const collection = segments.at(-2);
    if (!collection || collection.startsWith('{')) continue;

    const plural = camel(collection);
    const singular = plural.replace(/s$/, '');
    map.set(plural, schema);
    if (singular !== plural && !map.has(singular)) map.set(singular, schema);
  }

  return map;
}

/**
 * Why a `facts:` key does not resolve, or null when it does.
 *
 * Keys are `{ruleset}.{factName}`. The ruleset must exist in a compiled graph,
 * belong to the annotating domain, and declare the fact.
 *
 * @param {string} key
 * @param {Map<string, { domain: string, facts: Set<string> }>} graphs
 * @param {string|null} domain
 * @returns {string|null}
 */
function factError(key, graphs, domain) {
  if (graphs.size === 0) return null; // no compiled graphs to check against

  const dot = key.indexOf('.');
  if (dot === -1) return `Fact key "${key}" must be {ruleset}.{factName}.`;

  const ruleset = key.slice(0, dot);
  const factName = key.slice(dot + 1);

  const graph = graphs.get(ruleset);
  if (!graph) return `Ruleset "${ruleset}" is not in any compiled graph.`;

  if (domain && graph.domain !== domain) {
    return `Ruleset "${ruleset}" belongs to domain "${graph.domain}" but is annotated in "${domain}".`;
  }

  return graph.facts.has(factName) ? null : `Fact "${factName}" is not declared by ruleset "${ruleset}".`;
}

/**
 * Registry references that name no entry.
 *
 * An annotation cites entries by ID using the registry type as the field name,
 * so `policies: [snap-processing-clock]` must resolve in the policies registry.
 *
 * @param {import('../../types.js').Doc} doc
 * @param {Map<string, Set<string>>} registryEntryIds
 * @returns {{ rule: string, message: string, path: string }[]}
 */
function citationErrors(doc, registryEntryIds) {
  const errors = [];

  for (const section of ['schema', 'operations', 'events', 'facts']) {
    for (const [key, annotation] of Object.entries(doc.content?.[section] ?? {})) {
      for (const [field, value] of Object.entries(annotation ?? {})) {
        const ids = registryEntryIds.get(field);
        if (!ids || !Array.isArray(value)) continue;

        for (const id of value) {
          if (ids.has(id)) continue;
          errors.push({
            rule: 'unknown-registry-citation',
            message: `${field}: "${id}" is not an entry in the ${field} registry.`,
            path: `${section}.${key}.${field}`,
          });
        }
      }
    }
  }

  return errors;
}
