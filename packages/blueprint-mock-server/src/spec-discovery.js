/**
 * Finding OpenAPI specs on disk.
 *
 * Split out of `spec-loader.js` because these two read a directory and that
 * module must not: the browser entry reaches it for `apiSpecsFromDocs`, and a
 * bundler resolves a whole module graph before tree-shaking, so one `fs`
 * import there fails a page build (#448).
 *
 * Both are conveniences over `discover`/`load` plus `apiSpecsFromDocs`, kept
 * because the CLI tools and `test-utils` are given a path rather than
 * documents.
 */

import { discover, load } from '@codeforamerica/blueprint-core';
import { apiSpecsFromDocs, specNameOf } from './spec-loader.js';

/**
 * Every OpenAPI document in a directory, with the name and path of each.
 *
 * @param {object} options
 * @param {string} options.specsDir - Path to the specs file or directory
 * @returns {{ name: string, specPath: string }[]}
 */
export function discoverApiSpecs({ specsDir } = {}) {
  if (!specsDir) {
    throw new Error('specsDir is required — pass --spec <path> to specify the specs file or directory');
  }

  // discover() identifies type from content rather than filename, so a spec
  // without the -openapi.yaml suffix is still found, and it already skips
  // deprecated documents.
  return discover(specsDir, 'openapi').map((file) => ({
    name: specNameOf(file.path),
    specPath: file.path,
  }));
}

/**
 * The server's view of every OpenAPI document in a directory.
 *
 * @param {object} options
 * @param {string} options.specsDir - Path to the specs directory
 * @returns {Promise<object[]>} One metadata object per OpenAPI document
 */
export async function loadAllSpecs({ specsDir } = {}) {
  if (!specsDir) {
    throw new Error('specsDir is required — pass --spec <path> to specify the specs file or directory');
  }
  return apiSpecsFromDocs(discover(specsDir).map(load));
}
