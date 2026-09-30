/**
 * Shared internal utilities for blueprint-core.
 * Not exported from the package public API.
 */

import pluralize from 'pluralize';

/**
 * Extract the schema name from any $ref string.
 *
 * Returns the last path segment of the fragment, which is the schema name
 * across all common $ref forms:
 *   "#/components/schemas/Foo"   → "Foo"
 *   "#/$defs/Foo"                → "Foo"
 *   "file.yaml#/$defs/Foo"       → "Foo"
 *   "file.yaml#/Foo"             → "Foo"
 *
 * Returns null for refs with no fragment or an empty fragment.
 *
 * @param {string} ref
 * @returns {string|null}
 */
export function extractRefName(ref) {
  if (typeof ref !== 'string') return null;
  const hash = ref.indexOf('#');
  if (hash === -1) return null;
  const segments = ref.slice(hash + 1).split('/').filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

/**
 * Extract path parameter names from an endpoint path.
 *
 * "/applications/{applicationId}/review" → ["applicationId"]
 *
 * @param {string} path
 * @returns {string[]}
 */
export function extractPathParams(path) {
  return (path.match(/\{([^}]+)\}/g) || []).map(m => m.slice(1, -1));
}

/**
 * Build a parameter reference index from all loaded OpenAPI files.
 * Maps parameter name → `$ref` string, e.g.:
 *   "applicationId" → "#/components/parameters/ApplicationIdParam"
 *
 * @param {Array<{ relativePath: string, spec: Object }>} yamlFiles
 * @returns {Map<string, string>}
 */
export function buildParameterIndex(yamlFiles) {
  const index = new Map();

  for (const { spec } of yamlFiles) {
    if (!spec?.components?.parameters) continue;

    for (const [key, paramDef] of Object.entries(spec.components.parameters)) {
      if (paramDef?.name && !index.has(paramDef.name)) {
        index.set(paramDef.name, `#/components/parameters/${key}`);
      }
    }
  }

  return index;
}

const ENDPOINT_INDEX_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Infer an OpenAPI tag from an endpoint path.
 * Uses the first static (non-parameter) path segment, title-cased.
 *
 * "/applications/{applicationId}/summary" → "Applications"
 * "/case-workers/{id}/tasks"              → "Case Workers"
 *
 * @param {string} path
 * @returns {string}
 */
export function inferTagFromPath(path) {
  const seg = path.split('/').find(s => s && !s.startsWith('{')) ?? 'Other';
  return seg.replace(/-./g, m => ' ' + m[1].toUpperCase())
            .replace(/^./, m => m.toUpperCase());
}

/**
 * Build an OpenAPI path entry object for a generated endpoint.
 * Resolves path parameters against the provided index, infers a tag from
 * the path, and injects it into the operation.
 *
 * @param {string} path           - endpoint path, e.g. "/applications/{applicationId}/summary"
 * @param {string} method         - HTTP method, lowercase, e.g. "get" or "post"
 * @param {Object} operation      - OpenAPI operation object (summary, operationId, responses, …)
 * @param {Map<string, string>} paramIndex - from buildParameterIndex
 * @param {Object|null} xRelationship - optional x-relationship annotation to inject on the operation
 * @returns {{ parameters?: Object[], [method]: Object }}
 */
export function buildPathEntry(path, method, operation, paramIndex = new Map(), xRelationship = null) {
  const paramNames = extractPathParams(path);
  const parameters = paramNames.map(name => {
    const ref = paramIndex.get(name);
    return ref
      ? { $ref: ref }
      : { name, in: 'path', required: true, schema: { type: 'string' } };
  });

  const tag = inferTagFromPath(path);
  const op  = { ...operation, tags: [tag] };
  if (xRelationship) op['x-relationship'] = xRelationship;

  const entry = {};
  if (parameters.length > 0) entry.parameters = parameters;
  entry[method] = op;
  return entry;
}

/**
 * Capitalize the first character.
 *
 * The rules and compositions generators both build schema and operation names
 * from contract identifiers, and each carried its own copy of this.
 *
 * @param {string} name
 * @returns {string}
 */
export function toPascalCase(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Convert a kebab-case collection name to its PascalCase singular schema prefix.
 * Used to match example keys to collections (e.g., "queues" → "Queue",
 * "task-audit-events" → "TaskAuditEvent").
 * @param {string} collectionName - Database collection name
 * @returns {string} PascalCase schema prefix
 */
export function collectionToSchemaPrefix(collectionName) {
  const segments = collectionName.split('-');
  return segments.map((seg, i) => {
    // only the trailing segment is the plural noun, the earlier ones qualify it
    const s = i === segments.length - 1 ? pluralize.singular(seg) : seg;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }).join('');
}

/**
 * Extract individual resources from an examples object.
 * Filters out list examples, payload examples, and non-object entries.
 * Returns resources sorted by key name for consistent ordering.
 * @param {Object} examples - Examples object from YAML (key → value)
 * @returns {Array<{key: string, name: string, data: Object}>} Sorted array of resources
 */
export function extractIndividualResources(examples) {
  const resources = [];

  for (const [key, value] of Object.entries(examples)) {
    if (!value || typeof value !== 'object') continue;
    if (value.items && Array.isArray(value.items)) continue;

    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('payload') || lowerKey.includes('create') || lowerKey.includes('update')) continue;

    if (value.id) {
      resources.push({ key, name: key, data: value });
    }
  }

  resources.sort((a, b) => a.key.localeCompare(b.key));
  return resources;
}
