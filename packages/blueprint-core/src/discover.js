/**
 * Find contract files on disk.
 *
 * The only function in the package that takes a directory. Everything
 * downstream operates on the documents the caller loads from these paths.
 */

import { readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { detectType, isDeprecated, extractDomain } from './contract-types.js';
import { readYaml } from './load.js';

/**
 * Walk a directory tree for contract files, reporting each file's type.
 *
 * `relativePath` is the file's position within the contract set, and is part
 * of a document's identity there — generated overlays address their targets by
 * relative path, so a document that does not know where it sits cannot be
 * projected into its sibling spec.
 *
 * Dot-prefixed directories and node_modules are skipped. A file that does not
 * parse throws, naming the file. Skipping it instead left the set without it:
 * validate never saw the file, so nothing reported it, and a state machine
 * with a typo simply was not there.
 *
 * Deprecated documents are skipped too. They stay in the tree for reference
 * but are not resolved, validated or served, and every caller was filtering
 * them out immediately after discovering them.
 *
 * `domain` is what the file declares, and null where it declares none.
 *
 * @param {string} dir - Absolute path to the directory to walk
 * @param {string} [type] - Optional contract type to filter by (e.g. 'rules')
 * @returns {{ path: string, relativePath: string, type: string, domain: string|null }[]}
 *   Always this shape, filtered or not
 */
export function discover(dir, type) {
  const found = [];
  if (!existsSync(dir)) return found;

  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;

      const absPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue;

      const content = readYaml(absPath);
      if (isDeprecated(content)) continue;

      found.push({
        path: absPath,
        relativePath: relative(dir, absPath).replace(/\\/g, '/'),
        type: detectType(entry.name, content),
        content,
      });
    }
  }

  walk(dir);

  const complete = found.map(({ content, ...file }) => ({
    ...file,
    domain: extractDomain(content),
  }));

  return type ? complete.filter((f) => f.type === type) : complete;
}
