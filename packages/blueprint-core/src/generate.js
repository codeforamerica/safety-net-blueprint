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
import { detectComponentPrefix, rewriteComponentRefs } from './generate/refs.js';
import { stemOf, siblingPath } from './contract-types.js';

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
    // Overlay documents ready to apply. The `domain` each generator reports is
    // how its target spec is found so refs can be aligned to that spec's
    // convention; once that is done the pairing has served its purpose and
    // resolve just applies documents.
    overlays: alignRefs(
      [...compositionOverlays(positioned, inputFiles), ...rules.overlays],
      positioned
    ),
    // Keyed by output path internally; flattened so both artifact kinds are
    // arrays and a caller iterates them the same way.
    graphs: [...rules.graphs].map(([path, graph]) => ({ path, graph })),
  };
}

/**
 * Rewrite each generated overlay's component refs to match the spec it patches.
 *
 * A generator emits refs as `./components/…` because it has no idea where its
 * target sits. The target's own refs say what the prefix should be.
 *
 * @param {{ domain: string, overlay: object }[]} generated
 * @param {import('../types.js').Doc[]} docs
 * @returns {object[]} Overlay documents
 */
function alignRefs(generated, docs) {
  return generated.map(({ domain: stem, overlay }) => {
    const wanted = siblingPath(stem, 'openapi');
    const target = wanted && docs.find((doc) => doc.relativePath === wanted);
    if (!target) return overlay;

    return rewriteComponentRefs(overlay, './', detectComponentPrefix(target.content));
  });
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
      domain: stemOf(doc.relativePath, 'compositions'),
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
