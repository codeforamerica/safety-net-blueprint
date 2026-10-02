/**
 * A contract set as one serializable object.
 *
 * `generate(docs, 'artifact')` writes it, `extract(artifact, 'docs')` reads it
 * back. Both live here so the format is stated once, rather than split between
 * the command that writes the file and the consumer that parses it (#448).
 *
 * It exists because `discover` is a directory walk and a page has no directory.
 * Everything expensive or Node-bound happens before this — the tree is walked,
 * the YAML parsed, the overlays applied and the OpenAPI `$ref`s dereferenced by
 * `blueprint-resolve --bundle`. What is left is data, and data crosses into a
 * browser.
 *
 * What is deliberately *not* here:
 *
 *   - **Derived facts.** No seed records, config catalogs, compiled graphs or
 *     registries. Those are read out of the documents at boot by the same calls
 *     Node makes, so the artifact cannot disagree with the library reading it.
 *     Storing them would version-lock the file to the code that derived them.
 *   - **A separate `specs` key.** The OpenAPI documents are already in `docs`,
 *     dereferenced, because resolve dereferenced them. Carrying them twice is
 *     how this started out, and it was duplication, not design.
 *   - **An integrity hash.** A hash covers bytes, and this returns an object;
 *     whoever serializes it is the only thing holding bytes to hash. Keeping it
 *     out also keeps `node:crypto` clear of `extract`'s module graph.
 */

import { toDoc } from './doc.js';

/** Bumped when the layout below changes in a way a reader must notice. */
export const ARTIFACT_VERSION = 1;

/**
 * Strip a Doc to the data it can be rebuilt from.
 *
 * A Doc's methods cannot survive JSON, which is the whole reason `toDoc`
 * exists to put them back.
 *
 * @param {import('../types.js').Doc} doc
 * @returns {object}
 */
function plainDoc(doc) {
  return {
    path: doc.path,
    relativePath: doc.relativePath,
    domain: doc.domain,
    type: doc.type,
    content: doc.content,
    provenance: doc.provenance ?? null,
  };
}

/**
 * The whole contract set, reduced to data.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {{ artifactVersion: number, docs: object[] }}
 */
export function buildArtifact(docs) {
  return {
    artifactVersion: ARTIFACT_VERSION,
    docs: docs.map(plainDoc),
  };
}

/**
 * The contract set inside an artifact.
 *
 * Takes the parsed artifact rather than a path: the caller has already read it,
 * whether with `readFileSync` or `await (await fetch(…)).json()`. Returns the
 * whole set in one call instead of a per-document function, so there is no
 * `.map(fn)` — `Array.prototype.map` passes an index as the second argument,
 * which silently becomes an argument to anything that later grows a second
 * parameter.
 *
 * @param {object} artifact - Parsed output of `generate(docs, 'artifact')`
 * @returns {import('../types.js').Doc[]}
 * @throws {Error} When the artifact is not a shape or vintage this can read
 */
export function docsFromArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('extract(artifact, \'docs\'): not an artifact object.');
  }

  if (artifact.artifactVersion !== ARTIFACT_VERSION) {
    throw new Error(
      `extract(artifact, 'docs'): artifact is version ${artifact.artifactVersion ?? '(none)'}, ` +
      `and this version of blueprint-core reads ${ARTIFACT_VERSION}. ` +
      'Rebuild it with blueprint-bundle-contracts.'
    );
  }

  if (!Array.isArray(artifact.docs) || artifact.docs.length === 0) {
    throw new Error('extract(artifact, \'docs\'): artifact carries no documents.');
  }

  return artifact.docs.map((doc) => toDoc(doc));
}
