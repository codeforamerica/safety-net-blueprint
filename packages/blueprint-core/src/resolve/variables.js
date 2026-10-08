/**
 * Substitute ${VAR} placeholders throughout a contract set.
 *
 * A placeholder with no value is left exactly as written and reported, rather
 * than blanked. An empty string in a URL or an identifier fails somewhere far
 * from the cause; the literal `${VAR}` fails where the problem is.
 *
 * The caller supplies the values — reading an environment file is its job, not
 * this pass's.
 */

const PLACEHOLDER = /\$\{([^}]+)\}/g;

/**
 * @param {import('../../types.js').Doc[]} docs
 * @param {Record<string, string>} variables
 * @returns {{ docs: object[], warnings: string[], applied: string[], unresolved: string[] }}
 */
export function substituteVariables(docs, variables) {
  const unresolved = new Map();
  const applied = [];

  const substituted = docs.map((doc) => {
    const where = doc.relativePath ?? doc.path;
    let count = 0;

    const content = substituteNode(doc.content, variables, {
      onSubstituted: () => { count += 1; },
      onUnresolved: (name) => {
        if (!unresolved.has(name)) unresolved.set(name, new Set());
        unresolved.get(name).add(where);
      },
    });

    // The transform rebuilds every node, so identity cannot tell us whether
    // anything changed — only the substitution count can.
    if (count === 0) return doc;

    applied.push(`Substituted ${count} variable reference(s) -> ${where}`);
    return { ...doc, content };
  });

  const warnings = [...unresolved].map(
    ([name, files]) =>
      `Unresolved placeholder \${${name}} left as-is in ${[...files].sort().join(', ')}.`
  );

  return { docs: substituted, warnings, applied, unresolved: [...unresolved.keys()].sort() };
}

/**
 * Substitute placeholders in overlay configuration.
 *
 * Config is read once, before the pipeline runs, and several passes are driven
 * by it — so a value that varies by environment has to be substituted here
 * rather than in the document pass, which runs last and would be too late to
 * change what a pass did.
 *
 * It also has to be here rather than there for a structural reason: the
 * document pass substitutes values and not object keys, and an event type
 * prefix reaches AsyncAPI channel *keys*. Prefixing with an unsubstituted
 * placeholder would leave the key and its sibling `address:` disagreeing.
 * Resolving the prefix before it is applied avoids the problem rather than
 * teaching the walker to rewrite keys, which can collide.
 *
 * @param {object|null} config - From `overlayConfig`
 * @param {Record<string, string>} variables
 * @returns {{ config: object|null, warnings: string[], unresolved: string[] }}
 */
export function substituteConfig(config, variables = {}) {
  if (!config) return { config, warnings: [], unresolved: [] };

  const unresolved = new Set();
  const substituted = substituteNode(config, variables, {
    onSubstituted: () => {},
    onUnresolved: (name) => unresolved.add(name),
  });

  const warnings = [...unresolved].sort().map(
    (name) => `Unresolved placeholder \${${name}} left as-is in overlay config.`
  );

  return { config: substituted, warnings, unresolved: [...unresolved].sort() };
}

/**
 * @param {*} node
 * @param {Record<string, string>} variables
 * @param {{ onSubstituted: () => void, onUnresolved: (name: string) => void }} handlers
 * @returns {*} The node with placeholders replaced
 */
function substituteNode(node, variables, handlers) {
  if (typeof node === 'string') {
    return node.replace(PLACEHOLDER, (literal, name) => {
      if (name in variables) {
        handlers.onSubstituted();
        return variables[name];
      }
      handlers.onUnresolved(name);
      return literal;
    });
  }

  if (node === null || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    return node.map((item) => substituteNode(item, variables, handlers));
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, substituteNode(value, variables, handlers)])
  );
}
