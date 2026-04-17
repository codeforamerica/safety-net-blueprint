/**
 * Shared utility for deriving database collection names from paths.
 * Extracted to avoid circular dependencies between route-generator and rule-evaluation.
 */

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
 * Singleton sub-resources (singular last segment) are pluralized.
 *   e.g., /applications/{id}/interview → 'interviews'
 *   e.g., intake/applications/interview → 'interviews'
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

  // Sub-collection paths (2+ non-param segments, last is plural) are prefixed with the parent
  // resource singular to avoid cross-domain DB collection name collisions.
  if (segments.length >= 2 && lastSegment.endsWith('s')) {
    const parentSegment = segments[segments.length - 2];
    const parentSingular = parentSegment.endsWith('s') ? parentSegment.slice(0, -1) : parentSegment;
    return `${parentSingular}-${lastSegment}`;
  }

  // Pluralize singleton segment names so they match the DB collection convention
  return lastSegment && !lastSegment.endsWith('s') ? `${lastSegment}s` : lastSegment;
}
