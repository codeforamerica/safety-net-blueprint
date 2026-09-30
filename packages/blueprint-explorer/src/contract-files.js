/**
 * The contract set as a map, for the builders that index by file.
 *
 * Replaces blueprint-core's `loadContractFiles`, which walked the tree a
 * second time. `discover` already reports each file's type and domain, so
 * this only adds the parsed content and the keying the builders want.
 */

import { discover, load } from '@codeforamerica/blueprint-core';

/**
 * A Doc already carries `content`, `type`, `relativePath` and `domain`, so the
 * map holds the Doc itself rather than a projection of it. Builders that only
 * destructure those fields are unaffected, and the ones that need to follow a
 * `$ref` can use `refs()` instead of reimplementing the walk.
 *
 * @param {string} dir - Root of the contract set
 * @returns {Map<string, import('@codeforamerica/blueprint-core').Doc>}
 *   Keyed by absolute path
 */
export function contractFileMap(dir) {
  return new Map(discover(dir).map((file) => [file.path, load(file)]));
}
