/**
 * Shared utilities for collection names, state machine merging, and object path resolution.
 */

/**
 * Resolve a dot-notation path against an object.
 * Supports bracket notation for array indexing (e.g., "data.candidates[0].personId").
 * Returns null if any segment along the path is missing.
 *
 * @param {*} obj - The object to traverse
 * @param {string} path - Dot-notation path, optionally with [n] array indexes
 * @returns {*} Resolved value, or null if any segment is missing
 */
export function resolveDotPath(obj, path) {
  if (obj == null || !path) return null;
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  return normalized.split('.').reduce((cur, key) => (cur == null ? null : cur[key]), obj) ?? null;
}

/**
 * Where a collection's records are kept: the domain it belongs to, then its
 * path with the parameters left out. `/applications/{applicationId}/members`
 * in intake is `intake/applications/members`.
 *
 * Keyed by domain, so `/settings` in two domains is two collections, and by
 * the whole path, so a nested collection is named for where it sits, with
 * nothing guessed from how its words are spelled. It is the form a state
 * machine names a collection in — `from: intake/applications/members` — and
 * the one core's validator indexes collections by.
 *
 * @param {string|null} domain - As the API declares it (eventDomainOf)
 * @param {string} path - Relative to the server, as OpenAPI writes paths
 * @returns {string}
 */
export function storageName(domain, path) {
  const segments = String(path ?? '').split('/').filter((s) => s && !s.startsWith('{'));
  return [domain, ...segments].filter(Boolean).join('/');
}

/**
 * The collection a step names, `from: intake/applications/members` or a
 * call's `POST: intake/applications/verifications`: the domain and path as
 * written, or the shorthand core's validator also accepts for a nested
 * collection (`intake/application-members`), through the mock's resource index.
 *
 * @param {string} reference - `{domain}/{path}`, with no record ids in it
 * @param {{ aliases?: Map<string, string> }} [resources] - The mock's resource index (spec-loader.js `resourceIndex`)
 * @returns {string}
 */
export function collectionNamed(reference, resources) {
  const name = storageName(null, reference);
  return resources?.aliases?.get(name) ?? name;
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
 * Capitalize the first letter of a string.
 *
 * @param {string} str
 * @returns {string}
 */
export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a camelCase or PascalCase string to kebab-case.
 * e.g., "ApplicationDocument" → "application-document"
 *
 * @param {string} str
 * @returns {string}
 */
export function toKebabCase(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Convert a snake_case string to camelCase.
 * e.g., "application_document" → "applicationDocument"
 *
 * @param {string} str
 * @returns {string}
 */
export function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
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

/**
 * The domain an API's events are named for: the one it declares, as written
 * — `case-management`, not `case_management`. A document declaring none falls
 * back to its server's base path, which is how the domain was read before
 * documents had to declare one. Its collections are kept under the same
 * name (storageName).
 *
 * @param {{ domain?: string|null, serverBasePath?: string }} apiMetadata
 * @returns {string}
 */
export function eventDomainOf(apiMetadata) {
  return apiMetadata.domain ?? (apiMetadata.serverBasePath ?? '').replace(/^\//, '');
}
