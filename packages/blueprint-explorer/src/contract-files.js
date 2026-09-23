/**
 * The contract set as a map, for the builders that index by file.
 *
 * Replaces blueprint-core's `loadContractFiles`, which walked the tree a
 * second time. `discover` already reports each file's type and domain, so
 * this only adds the parsed content and the keying the builders want.
 */

import { discover, load } from '@codeforamerica/blueprint-core';

/**
 * @param {string} dir - Root of the contract set
 * @returns {Map<string, { content: object, type: string, relativePath: string, domain: string|null }>}
 *   Keyed by absolute path
 */
export function contractFileMap(dir) {
  return new Map(
    discover(dir).map((file) => [
      file.path,
      {
        content: load(file).content,
        type: file.type,
        relativePath: file.relativePath,
        domain: file.domain,
      },
    ])
  );
}
