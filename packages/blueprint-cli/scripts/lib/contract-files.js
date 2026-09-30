/**
 * The contract set as a map, keyed by absolute path.
 *
 * `discover` already reports each file's type and domain; this adds the
 * parsed content and the keying the generators want, without walking the
 * tree a second time.
 */

import { discover, load } from '@codeforamerica/blueprint-core';

/**
 * @param {string} dir - Root of the contract set
 * @returns {Map<string, { content: object, type: string, relativePath: string, domain: string|null }>}
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
