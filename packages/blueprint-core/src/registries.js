/**
 * Named registries of reusable, citable items.
 *
 * Core knows the registry *format* — a `type`, and `entries` keyed by stable
 * kebab-case IDs — and deliberately not which types exist. `policies`,
 * `patterns` and anything else are declared by the contracts that need them,
 * so adding a type requires no change here.
 *
 * Annotations reference entries by bare ID, so IDs share one namespace per
 * type across files. Later files override earlier ones at the per-ID level,
 * which is how a state replaces a baseline entry.
 */

/**
 * Merge every registry of a given type into one map of ID to entry.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {string} type - Registry type, e.g. 'policies'
 * @returns {Record<string, object>} Entry IDs to entry definitions
 */
export function registryEntries(docs, type) {
  const merged = {};

  for (const doc of registriesOfType(docs, type)) {
    Object.assign(merged, doc.content.entries);
  }

  return merged;
}

/**
 * Every registry type declared across the document set.
 *
 * Used to know which annotation fields hold entry IDs rather than free text.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {Set<string>}
 */
export function registryTypes(docs) {
  return new Set(
    docs
      .filter((doc) => doc.type === 'registry' && typeof doc.content?.type === 'string')
      .map((doc) => doc.content.type)
  );
}

/**
 * Registries of one type, in the order documents were supplied.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {string} type
 * @returns {import('../types.js').Doc[]}
 */
function registriesOfType(docs, type) {
  return docs.filter(
    (doc) =>
      doc.type === 'registry' &&
      doc.content?.type === type &&
      doc.content.entries &&
      typeof doc.content.entries === 'object'
  );
}
