/**
 * Apply OpenAPI Overlay documents across a contract set.
 *
 * Action application itself lives in overlay/overlay-resolver.js, which
 * implements the Overlay Specification for one document. This pass is the
 * dispatcher: it works out which documents each action targets and applies the
 * action to each of them.
 */

import { applyOverlay } from '../overlay/overlay-resolver.js';
import { resolveActionTargets } from './targets.js';

/**
 * Contract types whose content is authored as lists that a state extends.
 * Replacing one of these wholesale is almost always a mistake, so it is
 * reported.
 */
const LIST_AUTHORED_TYPES = new Set([
  'state-machine', 'rules', 'compositions', 'metrics', 'sla-types', 'annotations', 'policies',
]);

/**
 * @param {import('../../types.js').Doc[]} docs
 * @param {object[]} overlays - Overlay documents, applied in order
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
export function applyOverlays(docs, overlays) {
  const warnings = [];
  const applied = [];

  const resolved = overlays.reduce(
    (set, overlay) => {
      const result = applyOne(set, overlay);
      warnings.push(...result.warnings);
      applied.push(...result.applied);
      return result.docs;
    },
    docs
  );

  return { docs: resolved, warnings, applied };
}

/**
 * Apply every action of one overlay to the documents it targets.
 *
 * @param {import('../../types.js').Doc[]} docs
 * @param {object} overlay
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
function applyOne(docs, overlay) {
  const warnings = [];
  const applied = [];

  if (!Array.isArray(overlay?.actions)) {
    return { docs, warnings, applied };
  }

  let current = docs;

  for (const action of overlay.actions) {
    const { targets, warnings: targetWarnings } = resolveActionTargets(action, current);
    warnings.push(...targetWarnings);

    if (targets.length === 0) continue;

    current = current.map((doc) => {
      if (!targets.includes(doc)) return doc;

      if (Array.isArray(action.update) && LIST_AUTHORED_TYPES.has(doc.type)) {
        warnings.push(
          `"update:" on "${action.target}" in ${doc.relativePath ?? doc.path} replaces all ` +
          `baseline entries. Use "append:" to add items without removing baseline content. ` +
          `(action: "${describe(action)}")`
        );
      }

      const { result } = applyOverlay(doc.content, { actions: [action] }, { silent: true });
      applied.push(`${describe(action)} -> ${doc.relativePath ?? doc.path}`);
      return { ...doc, content: result };
    });
  }

  return { docs: current, warnings, applied };
}

/**
 * @param {object} action
 * @returns {string}
 */
function describe(action) {
  return action.description || action.target;
}
