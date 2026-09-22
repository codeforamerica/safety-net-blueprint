/**
 * Find contract files on disk.
 *
 * The only function in the package that takes a directory. Everything
 * downstream operates on the documents the caller loads from these paths.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import yaml from 'js-yaml';
import { detectType } from './openapi/contract-files.js';

/**
 * Walk a directory tree for contract files, reporting each file's type.
 *
 * `relativePath` is the file's position within the contract set, and is part
 * of a document's identity there — generated overlays address their targets by
 * relative path, so a document that does not know where it sits cannot be
 * projected into its sibling spec.
 *
 * Dot-prefixed directories and node_modules are skipped. Files that fail to
 * parse are skipped rather than throwing — a malformed file is not a contract,
 * and `validate` is where parse failures should surface.
 *
 * @param {string} dir - Absolute path to the directory to walk
 * @param {string} [type] - Optional contract type to filter by (e.g. 'rules')
 * @returns {{ path: string, relativePath: string, type: string }[]}
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

      let content;
      try {
        content = yaml.load(readFileSync(absPath, 'utf8'), { schema: yaml.CORE_SCHEMA });
      } catch {
        continue;
      }
      found.push({
        path: absPath,
        relativePath: relative(dir, absPath).replace(/\\/g, '/'),
        type: detectType(entry.name, content),
      });
    }
  }

  walk(dir);
  return type ? found.filter((f) => f.type === type) : found;
}
