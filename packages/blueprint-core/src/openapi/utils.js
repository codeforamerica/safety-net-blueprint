/**
 * Shared internal utilities for blueprint-core.
 * Not exported from the package public API.
 */

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
 * Build an index of generated endpoints from their x-relationship annotations.
 * Maps "${type}:${domain}:${id}" → { path, method } for all non-FK operation
 * relationships injected by the resolve pipeline.
 *
 * Used by explorer tools to build bidirectional links between API endpoints
 * and the contract artifacts that generated them.
 *
 * @param {Array<{ spec: Object }>} yamlFiles
 * @returns {Map<string, { path: string, method: string }>}
 */
export function buildEndpointIndex(yamlFiles) {
  const index = new Map();
  for (const { spec } of yamlFiles) {
    for (const [path, pathItem] of Object.entries(spec?.paths ?? {})) {
      for (const method of ENDPOINT_INDEX_METHODS) {
        const op = pathItem?.[method];
        const rel = op?.['x-relationship'];
        if (!rel?.type || rel.type === 'fk') continue;
        if (!rel.domain || !rel.id) continue;
        const key = `${rel.type}:${rel.domain}:${rel.id}`;
        if (!index.has(key)) index.set(key, { path, method });
      }
    }
  }
  return index;
}

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
