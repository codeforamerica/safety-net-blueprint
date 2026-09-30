/**
 * Filter a contract set down to one environment.
 *
 * A node carrying `x-environments` is kept only when the target environment is
 * listed, and the marker is stripped from whatever survives — a resolved
 * contract describes one environment and should not still be asking which.
 *
 * With no target environment this is a no-op: every node is kept, markers
 * included, because nothing has been decided yet.
 */

const MARKER = 'x-environments';

/**
 * @param {import('../../types.js').Doc[]} docs
 * @param {string|null} envTarget
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
export function filterEnvironment(docs, envTarget) {
  if (!envTarget) return { docs, warnings: [], applied: [] };

  const applied = [];

  const filtered = docs.map((doc) => {
    let count = 0;
    const content = filterNode(doc.content, envTarget, () => { count += 1; });

    // The transform rebuilds every node, so identity cannot tell us whether
    // anything changed — only the count of nodes touched can.
    if (count === 0) return doc;

    applied.push(
      `Filtered to environment "${envTarget}", ${count} node(s) affected -> ${doc.relativePath ?? doc.path}`
    );
    return { ...doc, content };
  });

  return { docs: filtered, warnings: [], applied };
}

/**
 * Filter one node, returning null when the node itself is excluded.
 *
 * @param {*} node
 * @param {string} envTarget
 * @param {() => void} onTouched - Called once per node removed or stripped
 * @returns {*} The filtered node, or null if it should be removed
 */
function filterNode(node, envTarget, onTouched) {
  if (node === null || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    const kept = node.filter((item) => {
      const include = includedInEnvironment(item, envTarget);
      if (!include) onTouched();
      return include;
    });
    return kept.map((item) => filterNode(item, envTarget, onTouched));
  }

  if (!includedInEnvironment(node, envTarget)) return null;
  if (MARKER in node) onTouched();

  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === MARKER) continue;

    const filtered = filterNode(value, envTarget, onTouched);
    // A removed child is dropped; a removed array element was already filtered
    // out above, so only object-valued children can come back null here.
    if (filtered !== null) result[key] = filtered;
    else onTouched();
  }

  return result;
}

/**
 * @param {*} node
 * @param {string} envTarget
 * @returns {boolean} True when the node carries no marker, or lists this environment
 */
function includedInEnvironment(node, envTarget) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return true;
  const environments = node[MARKER];
  return !Array.isArray(environments) || environments.includes(envTarget);
}
