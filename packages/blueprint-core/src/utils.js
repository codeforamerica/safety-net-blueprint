/**
 * Shared internal utilities for blueprint-core.
 * Not exported from the package public API.
 */

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
