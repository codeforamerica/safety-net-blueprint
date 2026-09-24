/**
 * Work out which documents an overlay action applies to.
 *
 * An action names a JSONPath target but not, usually, a file. Resolution finds
 * every document where that path exists and then narrows:
 *
 *   files: / file:   explicit — a relative path, or a canonical https:// URI
 *                    matched against the document's $id, so a JSON Schema can
 *                    be addressed without knowing path conventions
 *   target-api:      matches info.x-api-id
 *   target-version:  matches the -vN filename suffix (no suffix means 1)
 *
 * An action that resolves to no document, or to several without a
 * disambiguator, applies to nothing and says why. Silently patching an
 * arbitrary one of several matches would be worse than not patching at all.
 */

import { checkPathExists, parsePath } from '../overlay/overlay-resolver.js';

/**
 * @param {object} action
 * @param {import('../../types.js').Doc[]} docs
 * @returns {{ targets: import('../../types.js').Doc[], warnings: string[] }}
 */
export function resolveActionTargets(action, docs) {
  if (!action?.target) return { targets: [], warnings: [] };

  const description = action.description || action.target;
  const candidates = docsContaining(docs, checkTargetFor(action));

  const explicit = action.files ?? action.file;
  if (explicit !== undefined) {
    return matchExplicit(explicit, candidates, action.target, description);
  }

  return matchByFilters(action, candidates, description);
}

/**
 * The path that must already exist for an action to apply.
 *
 * An `add` creates its final segment, so the parent is what has to be there.
 *
 * @param {object} action
 * @returns {string}
 */
function checkTargetFor(action) {
  if (action.add === undefined) return action.target;

  const tokens = parsePath(action.target);
  if (tokens.length <= 1) return action.target;

  return '$.' + tokens
    .slice(0, -1)
    .map((t) => (t.type === 'filter' ? `[?(@.${t.field} == '${t.value}')]` : t.value))
    .join('.');
}

/**
 * @param {import('../../types.js').Doc[]} docs
 * @param {string} checkTarget
 * @returns {import('../../types.js').Doc[]}
 */
function docsContaining(docs, checkTarget) {
  return docs.filter((doc) => checkPathExists(doc.content, checkTarget).fullPathExists);
}

/**
 * Narrow to the documents an action names outright.
 *
 * @param {string|string[]} explicit - files: value, or the legacy file: alias
 * @param {import('../../types.js').Doc[]} candidates
 * @param {string} target
 * @param {string} description
 * @returns {{ targets: import('../../types.js').Doc[], warnings: string[] }}
 */
function matchExplicit(explicit, candidates, target, description) {
  const requested = Array.isArray(explicit) ? explicit : [explicit];

  const matched = new Map();
  const unmatched = [];

  for (const wanted of requested) {
    const doc = wanted.startsWith('https://')
      ? candidates.find((c) => c.content?.$id === wanted)
      : candidates.find((c) => c.relativePath === wanted);

    if (doc) matched.set(doc, true);
    else unmatched.push(wanted);
  }

  const warnings = unmatched.length
    ? [`Target ${target} does not exist in specified file(s): ${unmatched.join(', ')} (action: "${description}")`]
    : [];

  return { targets: [...matched.keys()], warnings };
}

/**
 * Narrow by target-api and target-version, requiring an unambiguous result.
 *
 * @param {object} action
 * @param {import('../../types.js').Doc[]} candidates
 * @param {string} description
 * @returns {{ targets: import('../../types.js').Doc[], warnings: string[] }}
 */
function matchByFilters(action, candidates, description) {
  const targetApi = action['target-api'];
  const targetVersion = action['target-version'];

  let filtered = candidates;
  if (targetApi) {
    filtered = filtered.filter((doc) => doc.content?.info?.['x-api-id'] === targetApi);
  }
  if (targetVersion !== undefined && targetVersion !== null) {
    const wanted = parseInt(targetVersion, 10);
    filtered = filtered.filter((doc) => versionOf(doc) === wanted);
  }

  if (filtered.length === 1) return { targets: filtered, warnings: [] };

  if (filtered.length === 0) {
    return {
      targets: [],
      warnings: [
        candidates.length === 0
          ? `Target ${action.target} does not exist in any file (action: "${description}")`
          : `Target ${action.target} matched ${candidates.length} file(s) but none passed ` +
            `target-api/target-version filters (action: "${description}")`,
      ],
    };
  }

  const names = filtered.map((doc) => doc.relativePath ?? doc.path).join(', ');
  return {
    targets: [],
    warnings: [
      `Target ${action.target} exists in multiple files (${names}). ` +
      `Use file, target-api, or target-version to disambiguate (action: "${description}")`,
    ],
  };
}

/**
 * Version from a `-vN` filename suffix; no suffix means version 1.
 *
 * @param {import('../../types.js').Doc} doc
 * @returns {number}
 */
function versionOf(doc) {
  const stem = (doc.relativePath ?? doc.path).replace(/\.yaml$/, '').split('/').pop();
  const match = stem.match(/-v(\d+)$/);
  return match ? parseInt(match[1], 10) : 1;
}
