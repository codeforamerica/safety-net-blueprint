/**
 * Reading the file an overlay action's `$ref` names, for `replace` and `add`.
 * Node only: a page has no files to read, so the overlay resolver takes this
 * as an option (overlay-resolver.js, applyOverlay's loadRef) instead of
 * importing it, which keeps the resolver runnable in a browser.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

/**
 * Load a replacement schema from a $ref path
 * @param {string} refPath - The $ref path (e.g., "./replacements/expenses.yaml#/CaliforniaExpenses")
 * @param {string} baseDir - The base directory to resolve relative paths from
 * @returns {{ value: Object | null, error: string | null }}
 */
export function loadReplacementRef(refPath, baseDir) {
  // Parse the $ref: "./path/to/file.yaml#/SchemaName"
  const [filePath, pointer] = refPath.split('#');

  if (!filePath) {
    return { value: null, error: 'Invalid $ref: missing file path' };
  }

  const fullPath = join(baseDir, filePath);

  if (!existsSync(fullPath)) {
    return { value: null, error: `Replacement file not found: ${fullPath}` };
  }

  try {
    const content = readFileSync(fullPath, 'utf8');
    const parsed = yaml.load(content);

    if (pointer) {
      // Extract the specific schema from the file
      const schemaName = pointer.startsWith('/') ? pointer.slice(1) : pointer;
      if (!parsed[schemaName]) {
        return { value: null, error: `Schema '${schemaName}' not found in ${filePath}` };
      }
      return { value: parsed[schemaName], error: null };
    }

    // Return entire file contents if no pointer
    return { value: parsed, error: null };
  } catch (err) {
    return { value: null, error: `Failed to load replacement: ${err.message}` };
  }
}
