/**
 * OpenAPI Overlay Resolution Module
 *
 * Core functions for applying OpenAPI Overlay Specification (1.0.0)
 * transformations to base schemas.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';

/**
 * Apply a JSONPath-like target to get values in an object.
 * Supports basic JSONPath: $.foo.bar.baz
 * @param {Object} obj - The object to traverse
 * @param {string} path - JSONPath-like path (e.g., "$.Person.properties.name")
 * @returns {*} The value at the path, or undefined if not found
 */
export function resolvePath(obj, path) {
  const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
  const parts = cleanPath.split('.');

  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * Set a value at a JSONPath-like location
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path
 * @param {*} value - The value to set
 */
export function setAtPath(obj, path, value) {
  const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
  const parts = cleanPath.split('.');
  const lastPart = parts.pop();

  let current = obj;
  for (const part of parts) {
    if (current[part] === undefined) {
      current[part] = {};
    }
    current = current[part];
  }

  // For objects, merge rather than replace to support adding properties
  if (typeof value === 'object' && !Array.isArray(value) && typeof current[lastPart] === 'object' && !Array.isArray(current[lastPart])) {
    current[lastPart] = { ...current[lastPart], ...value };
  } else {
    current[lastPart] = value;
  }
}

/**
 * Remove a value at a JSONPath-like location
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path
 */
export function removeAtPath(obj, path) {
  const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
  const parts = cleanPath.split('.');
  const lastPart = parts.pop();

  let current = obj;
  for (const part of parts) {
    if (current[part] === undefined) {
      return; // Path doesn't exist
    }
    current = current[part];
  }

  delete current[lastPart];
}

/**
 * Rename a property at a JSONPath-like location
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path to the property to rename
 * @param {string} newName - The new property name
 * @returns {boolean} True if rename succeeded, false if source doesn't exist
 */
export function renameAtPath(obj, path, newName) {
  const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
  const parts = cleanPath.split('.');
  const oldName = parts.pop();

  let current = obj;
  for (const part of parts) {
    if (current[part] === undefined) {
      return false; // Path doesn't exist
    }
    current = current[part];
  }

  if (!current.hasOwnProperty(oldName)) {
    return false; // Source property doesn't exist
  }

  // Copy value to new key and delete old key
  current[newName] = current[oldName];
  delete current[oldName];
  return true;
}

/**
 * Check if a path exists in an object (at least the root schema)
 * @param {Object} obj - The object to check
 * @param {string} path - JSONPath-like path
 * @returns {{ rootExists: boolean, fullPathExists: boolean, missingAt: string | null }}
 */
export function checkPathExists(obj, path) {
  const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
  const parts = cleanPath.split('.');

  // Check if root schema exists (e.g., "Person" or "Application")
  const rootPart = parts[0];
  if (!obj.hasOwnProperty(rootPart)) {
    return { rootExists: false, fullPathExists: false, missingAt: null };
  }

  // Check full path to see where it stops existing
  let current = obj;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current === undefined || current === null || !current.hasOwnProperty(part)) {
      return {
        rootExists: true,
        fullPathExists: false,
        missingAt: parts.slice(0, i + 1).join('.')
      };
    }
    current = current[part];
  }

  return { rootExists: true, fullPathExists: true, missingAt: null };
}

/**
 * Simple check if root schema exists (for filtering which files to process)
 * @param {Object} obj - The object to check
 * @param {string} path - JSONPath-like path
 * @returns {boolean} True if the root schema exists
 */
export function rootExists(obj, path) {
  const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
  const rootPart = cleanPath.split('.')[0];
  return obj.hasOwnProperty(rootPart);
}

/**
 * Replace a value at a JSONPath-like location (no merging, complete replacement)
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path
 * @param {*} value - The value to set (replaces entirely)
 */
export function replaceAtPath(obj, path, value) {
  const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
  const parts = cleanPath.split('.');
  const lastPart = parts.pop();

  let current = obj;
  for (const part of parts) {
    if (current[part] === undefined) {
      current[part] = {};
    }
    current = current[part];
  }

  // Complete replacement, no merging
  current[lastPart] = value;
}

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

/**
 * Apply overlay actions to a spec
 * @param {Object} spec - The base specification object
 * @param {Object} overlay - The overlay object with actions
 * @param {Object} options - Options for applying overlay
 * @param {boolean} options.silent - Suppress console output
 * @param {string} options.overlayDir - Directory containing the overlay file (for resolving $ref in replace)
 * @returns {{ result: Object, warnings: string[] }}
 */
export function applyOverlay(spec, overlay, options = {}) {
  const result = JSON.parse(JSON.stringify(spec)); // Deep clone
  const warnings = [];
  const { silent = false, overlayDir = null } = options;

  if (!overlay.actions || !Array.isArray(overlay.actions)) {
    return { result, warnings };
  }

  for (const action of overlay.actions) {
    const { target, update, remove, rename, replace } = action;

    if (!target) {
      if (!silent) {
        console.warn('Overlay action missing target, skipping');
      }
      continue;
    }

    // Check if this file has the root schema (e.g., Person, Application)
    if (!rootExists(result, target)) {
      continue;
    }

    // Check full path existence for warning purposes
    const pathCheck = checkPathExists(result, target);

    // Determine if this is an "update properties" action (adding new fields is expected)
    const isAddingProperties = target.endsWith('.properties') && typeof update === 'object';

    // Warn if target doesn't fully exist (except when intentionally adding new properties)
    if (!pathCheck.fullPathExists && !isAddingProperties && !replace) {
      const actionDesc = action.description || target;
      warnings.push(`Target $.${pathCheck.missingAt} does not exist in base schema (action: "${actionDesc}")`);
    }

    if (remove === true) {
      removeAtPath(result, target);
      if (!silent && action.description) {
        console.log(`  - Removed: ${action.description}`);
      }
    } else if (rename !== undefined) {
      // Custom extension: rename action
      const success = renameAtPath(result, target, rename);
      if (!silent && action.description) {
        console.log(`  - Renamed: ${action.description}`);
      }
      if (!success && pathCheck.fullPathExists) {
        warnings.push(`Rename failed for target ${target} (action: "${action.description || target}")`);
      }
    } else if (replace !== undefined) {
      // Custom extension: replace action (complete replacement, supports $ref)
      let replacementValue = replace;

      // If replace has a $ref, load the referenced file
      if (replace && typeof replace === 'object' && replace.$ref) {
        if (!overlayDir) {
          warnings.push(`Cannot resolve $ref in replace action: overlayDir not provided (action: "${action.description || target}")`);
          continue;
        }
        const { value, error } = loadReplacementRef(replace.$ref, overlayDir);
        if (error) {
          warnings.push(`${error} (action: "${action.description || target}")`);
          continue;
        }
        replacementValue = value;
      }

      replaceAtPath(result, target, replacementValue);
      if (!silent && action.description) {
        console.log(`  - Replaced: ${action.description}`);
      }
    } else if (update !== undefined) {
      setAtPath(result, target, update);
      if (!silent && action.description) {
        console.log(`  - Applied: ${action.description}`);
      }
    }
  }

  return { result, warnings };
}
