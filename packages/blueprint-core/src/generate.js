/**
 * Generate an artifact from a contract set.
 *
 * `discover`, `load`, `resolve` and `validate` act on contracts. `generate`
 * produces something else *from* them, and the second argument says what:
 *
 *   overlay   OpenAPI Overlays that add the endpoints and schemas a
 *             composition, ruleset or state machine action implies
 *   graph     compiled decision graphs, one per ruleset
 *   postman   a Postman collection exercising every endpoint
 *   examples  the contract set's example records, grouped by collection
 *
 * Takes the whole document set because an overlay targets a sibling spec by
 * relative path, and rules compile against schemas other documents declare.
 * Nothing is written here — the caller decides where artifacts go.
 */

import { generateCompositionOverlays } from './compositions.js';
import { generateRulesResults } from './rules.js';
import { detectComponentPrefix, rewriteComponentRefs } from './generate/refs.js';
import { generateRpcOverlays } from './generate/rpc.js';
import { buildPostman } from './generate/postman.js';
import { buildExamples } from './generate/examples.js';
import { basename } from 'path';
import { stemOf, siblingPath } from './contract-types.js';

/** What `generate` knows how to produce. */
const BUILDERS = {
  overlay: buildOverlays,
  graph: buildGraphs,
  postman: buildPostman,
  examples: buildExamples,
};

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {'overlay'|'graph'|'postman'|'examples'} type - Which artifact to build
 * @param {object} [options] - Passed to the builder that needs them
 * @returns {*} Whatever that artifact is
 */
export function generate(docs, type, options) {
  const builder = BUILDERS[type];
  if (!builder) {
    throw new Error(
      `generate: unknown artifact type "${type}". Known types: ${Object.keys(BUILDERS).join(', ')}.`
    );
  }

  const positioned = docs.filter((doc) => doc.relativePath !== null);
  assertPositioned(docs, positioned);

  return builder(positioned, options);
}

/**
 * Overlays ready for `resolve` to apply.
 *
 * The `domain` each generator reports is how its target spec is found, so
 * refs can be aligned to that spec's convention. Once that is done the
 * pairing has served its purpose and resolve just applies documents.
 *
 * @param {import('../types.js').Doc[]} positioned
 * @returns {import('../types.js').Overlay[]}
 */
function buildOverlays(positioned) {

  const inputFiles = specsOf(positioned);

  // RPC overlays align their own refs, because finding the target spec is
  // part of generating them — the state machine names it in apiSpec:.
  const rpc = generateRpcOverlays(positioned).map((entry) => entry.overlay);
  const rules = rulesArtifacts(positioned, inputFiles);

  return [
    ...rpc,
    ...alignRefs([...compositionOverlays(positioned, inputFiles), ...rules.overlays], positioned),
  ];
}

/**
 * Compiled decision graphs, with where each should be written.
 *
 * Each graph records its own `domain` and `ruleset`, so only the write
 * location is added here.
 *
 * @param {import('../types.js').Doc[]} positioned
 * @returns {{ path: string, graph: object }[]}
 */
function buildGraphs(positioned) {
  const { graphs } = rulesArtifacts(positioned, specsOf(positioned));
  return [...graphs].map(([path, graph]) => ({ path, graph }));
}

/**
 * @param {import('../types.js').Doc[]} positioned
 * @returns {{ relativePath: string, spec: object }[]}
 */
function specsOf(positioned) {
  return positioned.map((doc) => ({ relativePath: doc.relativePath, spec: doc.content }));
}

/**
 * Point each generated overlay at the document it actually patches.
 *
 * A generator names its target by filename, and derives that filename from
 * whatever it knows — compositions from the stem of their own path, rules
 * from the declared `domain:`. Only the first happens to be a full relative
 * path. Overlay targeting matches `file:` against the exact relativePath, so
 * a bare filename resolves to nothing and the overlay silently applies
 * nowhere.
 *
 * Both are rewritten to the target's real path, and refs are aligned to the
 * prefix that target uses, since a generator has no idea where it sits.
 *
 * @param {{ domain: string, overlay: object }[]} generated
 * @param {import('../types.js').Doc[]} docs
 * @returns {object[]} Overlay documents
 */
function alignRefs(generated, docs) {
  return generated.map(({ domain: stem, overlay }) => {
    const target =
      docs.find((doc) => doc.relativePath === siblingPath(stem, 'openapi')) ??
      docs.find((doc) => basename(doc.relativePath ?? '') === basename(siblingPath(stem, 'openapi') ?? ''));

    if (!target) return overlay;

    for (const action of overlay.actions ?? []) {
      if (typeof action.file === 'string' && basename(action.file) === basename(target.relativePath)) {
        action.file = target.relativePath;
      }
    }

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
