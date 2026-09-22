/**
 * Derive artifacts from the contract types that project into OpenAPI.
 *
 * Compositions and rules describe something at a higher level than an API —
 * a view over resources, a decision graph — and each produces an OpenAPI
 * Overlay that adds the endpoints and schemas implementing it. Generate builds
 * those overlays; `resolve` applies them. Nothing is written here.
 *
 * Takes the whole document set because an overlay targets a sibling spec by
 * relative path, and because rules compile against the schemas other documents
 * declare.
 */

import { generateCompositionOverlays } from './compositions.js';
import { generateRulesResults } from './rules.js';

/**
 * @param {import('../types.js').Doc[]} docs
 * @returns {import('../types.js').Artifacts}
 */
export function generate(docs) {
  const positioned = docs.filter((doc) => doc.relativePath !== null);
  assertPositioned(docs, positioned);

  const inputFiles = positioned.map((doc) => ({
    relativePath: doc.relativePath,
    spec: doc.content,
  }));

  const rules = rulesArtifacts(positioned, inputFiles);

  return {
    overlays: [...compositionOverlays(positioned, inputFiles), ...rules.overlays],
    // Keyed by output path internally; flattened so both artifact kinds are
    // arrays and a caller iterates them the same way.
    graphs: [...rules.graphs].map(([path, graph]) => ({ path, graph })),
  };
}

/**
 * Refuse to generate from documents that do not know where they sit.
 *
 * An overlay addresses its target by relative path, so a document loaded
 * outside a contract set cannot be projected. Failing here is better than
 * emitting an overlay that silently targets nothing.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {import('../types.js').Doc[]} positioned
 */
function assertPositioned(docs, positioned) {
  if (positioned.length === docs.length) return;

  const orphans = docs
    .filter((doc) => doc.relativePath === null)
    .filter((doc) => doc.type === 'compositions' || doc.type === 'rules')
    .map((doc) => doc.path);

  if (orphans.length > 0) {
    throw new Error(
      'generate() needs each document\'s position within the contract set to address ' +
      'overlay targets, but these were loaded without one:\n  ' + orphans.join('\n  ') +
      '\nLoad them via discover(), which supplies relativePath.'
    );
  }
}

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {{ relativePath: string, spec: object }[]} inputFiles
 * @returns {{ domain: string, overlay: object }[]}
 */
function compositionOverlays(docs, inputFiles) {
  const compositionFiles = docs
    .filter((doc) => doc.type === 'compositions' && doc.content?.compositions)
    .map((doc) => ({
      filePath: doc.path,
      // The stem of the relative path, which is how the generated overlay
      // addresses the sibling OpenAPI spec it patches.
      domain: doc.relativePath.replace('-compositions.yaml', ''),
      doc: doc.content,
    }));

  return compositionFiles.length > 0
    ? generateCompositionOverlays(compositionFiles, inputFiles)
    : [];
}

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {{ relativePath: string, spec: object }[]} inputFiles
 * @returns {{ graphs: object[], overlays: object[] }}
 */
function rulesArtifacts(docs, inputFiles) {
  const rulesFiles = docs
    .filter((doc) => doc.type === 'rules' && doc.content?.rulesets)
    .map((doc) => ({ relativePath: doc.relativePath, doc: doc.content }));

  return rulesFiles.length > 0
    ? generateRulesResults(rulesFiles, inputFiles)
    : { graphs: [], overlays: [] };
}
