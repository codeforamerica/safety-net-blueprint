/**
 * Shared utilities for collection name derivation and state machine merging.
 */

/**
 * Determine whether a path represents a singleton sub-resource.
 * Convention: sub-resource collections use plural names; singletons use singular (no trailing 's').
 *   e.g., /applications/{applicationId}/interview → singleton (singular)
 *         /applications/{applicationId}/documents → collection (plural)
 *
 * @param {string} path - OpenAPI-style path (may include {param} segments)
 * @returns {boolean}
 */
export function isSingletonSubResource(path) {
  const segments = path.split('/').filter(s => s && !s.startsWith('{'));
  const lastSegment = segments[segments.length - 1];
  return Boolean(lastSegment && !lastSegment.endsWith('s'));
}

/**
 * Derive the database collection name from a path.
 * Works for both OpenAPI endpoint paths (with {param} segments) and entity paths
 * from rules (e.g., "intake/applications/documents").
 *
 * Sub-collection paths (2+ non-param segments, last is plural) are prefixed with
 * the parent resource singular to avoid cross-domain DB collection name collisions.
 *   e.g., /applications/{id}/documents → 'application-documents'
 *   e.g., intake/applications/documents → 'application-documents'
 *
 * Singleton sub-resources (2+ non-param segments, last is singular) are kept as-is.
 * The caller's path structure signals it is a singleton; pluralizing would create a
 * mismatch with the composition assembler and seeder which use the resource name directly.
 *   e.g., /applications/{id}/household-info → 'household-info'
 *   e.g., /applications/{id}/interview → 'interview'
 *
 * Top-level singleton paths (1 non-param segment, singular) are pluralized to match
 * the DB collection convention used by the seeder.
 *   e.g., /application → 'applications'
 *
 * @param {string} path - Path or entity reference to derive collection name from
 * @param {string} [basePath] - Prefix to strip before processing (e.g., "/intake" or "intake")
 * @returns {string} Collection name for database operations
 */
export function deriveCollectionName(path, basePath) {
  const resourcePath = basePath && path.startsWith(basePath)
    ? path.slice(basePath.length)
    : path;
  const segments = resourcePath.split('/').filter(s => s && !s.startsWith('{'));
  const lastSegment = segments[segments.length - 1] || '';

  if (segments.length >= 2) {
    // Singleton sub-resource (singular last segment): keep as-is.
    // The path structure signals it is a singleton; the composition assembler and seeder
    // both use the resource name directly, so pluralizing would create a mismatch.
    if (isSingletonSubResource(path)) return lastSegment;

    // Sub-collection (plural last segment): prefix with parent singular to avoid
    // cross-domain DB collection name collisions.
    //   e.g., /applications/{id}/documents → 'application-documents'
    const parentSegment = segments[segments.length - 2];
    const parentSingular = parentSegment.endsWith('s') ? parentSegment.slice(0, -1) : parentSegment;
    return `${parentSingular}-${lastSegment}`;
  }

  // Top-level singleton: pluralize to match the DB collection convention used by the seeder.
  //   e.g., /application → 'applications'
  return lastSegment && !lastSegment.endsWith('s') ? `${lastSegment}s` : lastSegment;
}

/**
 * Extract the last `{param}` name from an OpenAPI-style path.
 * Used both to find a sub-resource's parent parameter and a composition's primary bind parameter.
 *   e.g., /applications/{applicationId}/review → 'applicationId'
 *   e.g., /applications/{applicationId}/members/{memberId}/incomes → 'memberId'
 *
 * @param {string} path - OpenAPI-style path
 * @returns {string|null}
 */
export function extractPrimaryParam(path) {
  const matches = [...path.matchAll(/\{([^}]+)\}/g)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

/**
 * Merge two arrays of id-keyed items (guards or rules), with overrides taking precedence.
 * Domain-level items come first; machine-level items override by id.
 *
 * @param {Array} base - Domain-level items (e.g., stateMachine.guards)
 * @param {Array} overrides - Machine-level items (e.g., machine.guards)
 * @returns {Array} Merged array, machine-level items winning on id conflict
 */
export function mergeByPrecedence(base = [], overrides = []) {
  const map = new Map((base || []).map(item => [item.id, item]));
  for (const item of (overrides || [])) map.set(item.id, item);
  return [...map.values()];
}

/**
 * Build the combined inline lookup array for executeProcedures.
 * Merges procedures (platform → domain → machine) into one id-keyed array.
 * Procedures are looked up by executeProcedure when call: steps reference a named procedure id.
 *
 * @param {Object} stateMachine - Top-level state machine doc (may have _platformProcedures)
 * @param {Object|null} machine - Machine-level entry (may have procedures and rules)
 * @returns {Array} Flat array of procedures and rules, higher-precedence items winning on id
 */
export function buildInlineRules(stateMachine, machine) {
  // Precedence: platform < domain < machine (higher overrides lower on same id)
  const procedures = mergeByPrecedence(
    mergeByPrecedence(stateMachine?._platformProcedures || [], stateMachine?.procedures || []),
    machine?.procedures || []
  );
  const rules = mergeByPrecedence(stateMachine?.rules || [], machine?.rules || []);
  // Rules take precedence over procedures for same id (unlikely, but consistent)
  return mergeByPrecedence(procedures, rules);
}
