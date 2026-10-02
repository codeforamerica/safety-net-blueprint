/**
 * Reading a contracts artifact.
 *
 * `blueprint-bundle-contracts` writes the whole contract set — every document,
 * and the OpenAPI specs dereferenced — into one JSON file. This reads it back.
 *
 * It exists because `discover` is a directory walk and a page has no directory
 * (#448). The same file also serves Node: `blueprint-mock --spec=contracts.json`
 * boots without walking anything, and gets exactly the documents the artifact
 * was built from rather than whatever is on disk now.
 *
 * No filesystem here. The caller supplies the parsed artifact — read from a
 * file in Node, fetched or imported in a page.
 */

import { extractMetadata } from './spec-loader.js';

/** The artifact layout this module understands. */
export const SUPPORTED_ARTIFACT_VERSION = 1;

/**
 * Check an artifact is the shape and vintage we can read.
 *
 * @param {object} artifact
 * @throws {Error} When it is not usable
 */
export function assertArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('Contracts artifact is not an object.');
  }
  if (artifact.artifactVersion !== SUPPORTED_ARTIFACT_VERSION) {
    throw new Error(
      `Contracts artifact is version ${artifact.artifactVersion ?? '(none)'}, ` +
      `and this version of blueprint-mock-server reads ${SUPPORTED_ARTIFACT_VERSION}. ` +
      'Rebuild it with blueprint-bundle-contracts.'
    );
  }
  if (!Array.isArray(artifact.docs) || artifact.docs.length === 0) {
    throw new Error('Contracts artifact carries no documents.');
  }
  if (!artifact.specs || typeof artifact.specs !== 'object') {
    throw new Error('Contracts artifact carries no OpenAPI specs.');
  }
}

/**
 * Verify the artifact's payload matches the hash it was written with.
 *
 * The artifact asserts it was validated when it was built, and that claim is
 * only worth anything if the bytes are the ones the builder produced —
 * `validate` needs a Doc's methods, so a consumer cannot re-check the contracts
 * themselves. This catches truncation, corruption and casual editing. It is not
 * tamper-proof against someone who recomputes the hash; that would need a
 * signature.
 *
 * @param {object} artifact
 * @returns {Promise<{ ok: boolean, expected: string, actual: string }>}
 */
export async function verifyIntegrity(artifact) {
  const expected = artifact?.integrity?.hash ?? null;
  const payload = JSON.stringify({ docs: artifact.docs, specs: artifact.specs });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const actual = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { ok: expected === actual, expected, actual };
}

/**
 * The API metadata the route generator takes, from an artifact's specs.
 *
 * The specs were dereferenced when the artifact was built, so this is the half
 * of `loadAllSpecs` that is left once `$RefParser` has already run — and the
 * half that was always pure.
 *
 * @param {object} artifact
 * @returns {object[]} Same shape as `loadAllSpecs`
 */
export function specsFromArtifact(artifact) {
  const loaded = [];
  for (const [name, spec] of Object.entries(artifact.specs)) {
    try {
      loaded.push(extractMetadata(spec, name));
    } catch (error) {
      console.warn(`Warning: Could not read spec ${name}:`, error.message);
    }
  }
  return loaded;
}

/**
 * Whether a `--spec` value names an artifact rather than a directory.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isArtifactPath(value) {
  return typeof value === 'string' && value.endsWith('.json');
}
