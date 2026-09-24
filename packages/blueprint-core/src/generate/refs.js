/**
 * Align a generated overlay's external $refs with its target spec.
 *
 * Specs reference shared components by relative path, and the prefix depends
 * on where the spec sits — `./components/…` from one location, `../../…` from
 * another. A generated overlay is built without knowing that, so its refs are
 * rewritten to match whatever convention the spec it patches already uses.
 */

/**
 * The prefix a spec uses for external component references.
 *
 * Taken from the first external `$ref` naming a `components/` directory.
 * Internal refs (`#/components/…`) are not external references and are
 * skipped. Defaults to `./` when a spec has none.
 *
 * @param {object} spec
 * @returns {string}
 */
export function detectComponentPrefix(spec) {
  return findPrefix(spec) ?? './';
}

/**
 * @param {*} node
 * @returns {string|null}
 */
function findPrefix(node) {
  if (node === null || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findPrefix(item);
      if (found !== null) return found;
    }
    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      const match = value.match(/^(?!#)(.*?)components\//);
      if (match) return match[1];
    }
    if (value !== null && typeof value === 'object') {
      const found = findPrefix(value);
      if (found !== null) return found;
    }
  }

  return null;
}

/**
 * Replace one external-component ref prefix with another throughout a tree.
 *
 * @param {object} overlay
 * @param {string} fromPrefix
 * @param {string} toPrefix
 * @returns {object} The overlay, unchanged when the prefixes already match
 */
export function rewriteComponentRefs(overlay, fromPrefix, toPrefix) {
  if (fromPrefix === toPrefix) return overlay;

  const walk = (node) => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);

    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => {
        if (key === '$ref' && typeof value === 'string' && value.startsWith(`${fromPrefix}components/`)) {
          return [key, toPrefix + value.slice(fromPrefix.length)];
        }
        return [key, walk(value)];
      })
    );
  };

  return walk(overlay);
}
