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
import { followRef, indexByRelativePath, isRemoteRef } from './ref-lookup.js';

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
 * The documents one or more domains need, and nothing else.
 *
 * A domain filter alone is not enough and fails in a way that only shows up at
 * runtime: `intake`'s specs reference `base/components/parameters.yaml` and
 * `common/schemas/income.yaml`, which belong to no domain. Dropping those
 * leaves an artifact that parses and then cannot resolve a ref. So the named
 * domains are a starting set, and this follows every `$ref` out of them until
 * nothing new is reached.
 *
 * `platform` always comes along. The mock server seeds platform registries and
 * task queues whatever domain is being demonstrated, and nothing `$ref`s them,
 * so a closure would never pull them in.
 *
 * Resolution goes through `followRef`, the same path everything else uses, so
 * a ref this keeps is a ref that will resolve later — including the forms it
 * tolerates, like one written a level too shallow.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {string[]} domains - Domain names to keep
 * @returns {import('../types.js').Doc[]} The closure, in the original order
 */
export function domainClosure(docs, domains) {
  const wanted = new Set([...domains, 'platform']);
  const byRelativePath = indexByRelativePath(docs);
  const positioned = new Map(docs.filter((d) => d.relativePath).map((d) => [d.relativePath, d]));

  const keep = new Set(
    docs.filter((doc) => doc.relativePath && wanted.has(doc.domain)).map((doc) => doc.relativePath)
  );

  // Fixed point: a document pulled in can itself reference another.
  let growing = true;
  while (growing) {
    growing = false;
    for (const relativePath of [...keep]) {
      const doc = positioned.get(relativePath);
      if (!doc) continue;

      for (const ref of doc.refs().values()) {
        if (!ref.external || !ref.file || isRemoteRef(ref.file)) continue;
        const found = followRef(ref.file, byRelativePath, relativePath);
        if (found && !keep.has(found.relativePath)) {
          keep.add(found.relativePath);
          growing = true;
        }
      }
    }
  }

  return docs.filter((doc) => keep.has(doc.relativePath));
}

/**
 * The whole contract set, reduced to data.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {object} [options]
 * @param {string[]} [options.domains] - Keep only these domains, plus
 *   `platform`, plus whatever they reference. Omit for the whole set.
 * @returns {{ artifactVersion: number, docs: object[] }}
 */
export function buildArtifact(docs, { domains = null } = {}) {
  const selected = domains?.length ? domainClosure(docs, domains) : docs;
  return {
    artifactVersion: ARTIFACT_VERSION,
    docs: selected.map(plainDoc),
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
