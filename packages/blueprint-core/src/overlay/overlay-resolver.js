/**
 * OpenAPI Overlay Resolution Module
 *
 * Core functions for applying OpenAPI Overlay Specification (1.0.0)
 * transformations to base schemas, including behavioral YAML files.
 *
 * Supports a subset of JSONPath (RFC 9535), the syntax the specification
 * gives `target`:
 * - Dotted names: $.foo.bar.baz
 * - Quoted names, for a key with a dot or brackets in it: $.outputs['risks.cashIncome']
 * - Index selectors, negative from the end: $.machines[0], $.items[-1]
 * - Filter expressions: $.items[?(@.id == 'value')].field
 * - append: action for non-destructive array additions
 *
 * Any other syntax is an error naming the target. It used to be read as a
 * literal key name, which matched nothing, so the action was skipped with a
 * warning among many.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';

// =============================================================================
// Path Parsing
// =============================================================================

const SUPPORTED = "Overlays support dotted names, ['quoted names'], [n] indexes and [?(@.field == value)] filters";

/**
 * Parse a JSONPath target into tokens.
 *
 * @param {string} path - e.g. "$.slaTypes[?(@.id == 'x')].durationDays"
 * @returns {Array<{type: 'key', value: string} | {type: 'index', value: number} | {type: 'filter', field: string, value: *}>}
 * @throws {Error} Naming the target, for syntax overlays don't support
 */
export function parsePath(path) {
  const fail = (why) => {
    throw new Error(`Overlay target "${path}" ${why}. ${SUPPORTED}.`);
  };
  // A target written without the root, as `foo.bar`, has always been accepted.
  const text = path.startsWith('$') ? path : `$.${path}`;
  const tokens = [];
  let i = 1;

  while (i < text.length) {
    if (text[i] === '.') {
      if (text[i + 1] === '.') fail("uses '..', a descendant selector, which overlays don't support");
      let end = i + 1;
      while (end < text.length && text[end] !== '.' && text[end] !== '[') end++;
      const name = text.slice(i + 1, end);
      if (!name) fail('has an empty name');
      if (name === '*') fail("uses '*', a wildcard, which overlays don't support");
      tokens.push({ type: 'key', value: name });
      i = end;
    } else if (text[i] === '[') {
      const quote = text[i + 1];
      if (quote === "'" || quote === '"') {
        let end = i + 2;
        let name = '';
        while (end < text.length && text[end] !== quote) {
          if (text[end] === '\\') end++;
          name += text[end];
          end++;
        }
        if (text[end] !== quote || text[end + 1] !== ']') fail('has a quoted name that is never closed');
        tokens.push({ type: 'key', value: name });
        i = end + 2;
      } else {
        // A filter's own parentheses close it, so a ']' inside its value doesn't.
        const close = text.startsWith('[?(', i) ? text.indexOf(')]', i) + 1 : text.indexOf(']', i);
        if (close <= i) fail("has a '[' that is never closed");
        const content = text.slice(i + 1, close);
        if (/^-?\d+$/.test(content)) {
          tokens.push({ type: 'index', value: Number(content) });
        } else {
          const filter = parseFilterToken(content);
          if (!filter) fail(`uses '[${content}]', which overlays don't support`);
          tokens.push(filter);
        }
        i = close + 1;
      }
    } else {
      fail(`has '${text[i]}' where a '.' or '[' belongs`);
    }
  }

  return tokens;
}

/**
 * Parse a filter expression string like ?(@.field == 'value') or ?(@.field == 42)
 * @param {string} content - Content inside brackets, e.g. "?(@.id == 'snap_expedited')"
 * @returns {{type: 'filter', field: string, value: *} | null} Null for anything else
 */
function parseFilterToken(content) {
  // Match ?(@.field == 'value'), ?(@.field == "value"), or ?(@.field == value)
  const quoted = content.match(/^\?\(@\.(\w+)\s*==\s*'([^']*)'\)$/) ||
                 content.match(/^\?\(@\.(\w+)\s*==\s*"([^"]*)"\)$/);
  if (quoted) {
    return { type: 'filter', field: quoted[1], value: quoted[2] };
  }

  const unquoted = content.match(/^\?\(@\.(\w+)\s*==\s*([^)]+)\)$/);
  if (unquoted) {
    let value = unquoted[2].trim();
    if (!isNaN(value)) value = Number(value);
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    return { type: 'filter', field: unquoted[1], value };
  }

  return null;
}

/**
 * Write tokens back out as a target: a name as `.name` when it can be, and
 * quoted otherwise.
 *
 * @param {Array} tokens - Result of parsePath()
 * @returns {string}
 */
export function formatPath(tokens) {
  return '$' + tokens.map((token) => {
    if (token.type === 'index') return `[${token.value}]`;
    if (token.type === 'filter') {
      const value = typeof token.value === 'string' ? `'${token.value}'` : String(token.value);
      return `[?(@.${token.field} == ${value})]`;
    }
    return /^[^.[\]'"\s]+$/.test(token.value) ? `.${token.value}` : `['${token.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
  }).join('');
}

/**
 * The child a filter or index selects in a list, or undefined. A key is read
 * by each caller, since some create what's missing.
 *
 * @param {*} current
 * @param {{type: 'index', value: number} | {type: 'filter', field: string, value: *}} token
 * @returns {*}
 */
function selectItem(current, token) {
  if (!Array.isArray(current)) return undefined;
  if (token.type === 'index') return current[token.value < 0 ? current.length + token.value : token.value];
  return current.find((item) => item && item[token.field] === token.value);
}

/** The position an index selects, or -1 when it is outside the list. */
function indexIn(array, index) {
  const at = index < 0 ? array.length + index : index;
  return at >= 0 && at < array.length ? at : -1;
}

/**
 * Navigate an object following a sequence of tokens, returning the value
 * at the end of the path. For filter tokens, returns the first matching item.
 * @param {Object} obj
 * @param {Array} tokens - Result of parsePath()
 * @returns {*} Value at the path, or undefined
 */
function navigatePath(obj, tokens) {
  let current = obj;
  for (const token of tokens) {
    if (current === undefined || current === null) return undefined;
    current = token.type === 'key' ? current[token.value] : selectItem(current, token);
  }
  return current;
}

// =============================================================================
// Path Operations
// =============================================================================

/**
 * Apply a JSONPath-like target to get values in an object.
 * Supports basic JSONPath ($.foo.bar.baz) and filter expressions
 * ($.items[?(@.id == 'value')].field).
 *
 * @param {Object} obj - The object to traverse
 * @param {string} path - JSONPath-like path
 * @returns {*} The value at the path, or undefined if not found
 */
export function resolvePath(obj, path) {
  return navigatePath(obj, parsePath(path));
}

/**
 * Set a value at a JSONPath-like location.
 * For object values, merges with the existing object. For arrays and scalars,
 * replaces. Supports filter expressions in intermediate path segments.
 *
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path
 * @param {*} value - The value to set
 */
export function setAtPath(obj, path, value) {
  const tokens = parsePath(path);
  if (tokens.length === 0) return;

  const lastToken = tokens[tokens.length - 1];
  const navTokens = tokens.slice(0, -1);

  // Navigate to the parent
  let current = obj;
  for (const token of navTokens) {
    if (token.type === 'key') {
      if (current[token.value] === undefined) {
        current[token.value] = {};
      }
      current = current[token.value];
    } else {
      const item = selectItem(current, token);
      if (item === undefined) return;
      current = item;
    }
  }

  // Set at the last token
  if (lastToken.type === 'key') {
    const key = lastToken.value;
    // For objects, merge rather than replace to support adding properties
    if (typeof value === 'object' && !Array.isArray(value) && typeof current[key] === 'object' && !Array.isArray(current[key])) {
      current[key] = { ...current[key], ...value };
    } else {
      current[key] = value;
    }
  } else if (lastToken.type === 'index') {
    const at = Array.isArray(current) ? indexIn(current, lastToken.value) : -1;
    if (at === -1) return;
    const existing = current[at];
    const merge = typeof value === 'object' && value !== null && !Array.isArray(value) && typeof existing === 'object' && existing !== null && !Array.isArray(existing);
    current[at] = merge ? { ...existing, ...value } : value;
  } else if (lastToken.type === 'filter') {
    // Filter as last token: merge value into all matching array items
    if (!Array.isArray(current)) return;
    for (const item of current) {
      if (item && item[lastToken.field] === lastToken.value) {
        if (typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(item, value);
        }
      }
    }
  }
}

/**
 * Remove a value at a JSONPath-like location.
 * When the last path segment is a filter expression, removes all matching
 * items from the parent array.
 *
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path
 */
export function removeAtPath(obj, path) {
  const tokens = parsePath(path);
  if (tokens.length === 0) return;

  const lastToken = tokens[tokens.length - 1];
  const navTokens = tokens.slice(0, -1);

  // Navigate to the parent
  let current = obj;
  for (const token of navTokens) {
    if (token.type === 'key') {
      if (current[token.value] === undefined) return;
      current = current[token.value];
    } else {
      const item = selectItem(current, token);
      if (item === undefined) return;
      current = item;
    }
  }

  if (lastToken.type === 'key') {
    delete current[lastToken.value];
  } else if (lastToken.type === 'index') {
    const at = Array.isArray(current) ? indexIn(current, lastToken.value) : -1;
    if (at !== -1) current.splice(at, 1);
  } else if (lastToken.type === 'filter') {
    // Remove all matching items from the parent array
    if (!Array.isArray(current)) return;
    for (let i = current.length - 1; i >= 0; i--) {
      if (current[i] && current[i][lastToken.field] === lastToken.value) {
        current.splice(i, 1);
      }
    }
  }
}

/**
 * Rename a property at a JSONPath-like location
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path to the property to rename
 * @param {string} newName - The new property name
 * @returns {boolean} True if rename succeeded, false if source doesn't exist
 */
export function renameAtPath(obj, path, newName) {
  const tokens = parsePath(path);
  if (tokens.length === 0) return false;

  const lastToken = tokens[tokens.length - 1];
  if (lastToken.type !== 'key') return false;

  const navTokens = tokens.slice(0, -1);
  let current = obj;
  for (const token of navTokens) {
    if (token.type === 'key') {
      if (current[token.value] === undefined) return false;
      current = current[token.value];
    } else {
      const item = selectItem(current, token);
      if (item === undefined) return false;
      current = item;
    }
  }

  const oldName = lastToken.value;
  if (!Object.prototype.hasOwnProperty.call(current, oldName)) {
    return false;
  }

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
  const tokens = parsePath(path);
  if (tokens.length === 0) {
    return { rootExists: false, fullPathExists: false, missingAt: null };
  }

  // Root must be a key token
  const rootToken = tokens[0];
  if (rootToken.type !== 'key' || !Object.prototype.hasOwnProperty.call(obj, rootToken.value)) {
    return { rootExists: false, fullPathExists: false, missingAt: null };
  }

  // Check full path. Where it stops is reported as written, without the
  // leading '$.' a caller adds.
  const at = (i) => formatPath(tokens.slice(0, i + 1)).replace(/^\$\.?/, '');
  let current = obj;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'key') {
      if (current === undefined || current === null || !Object.prototype.hasOwnProperty.call(current, token.value)) {
        return { rootExists: true, fullPathExists: false, missingAt: at(i) };
      }
      current = current[token.value];
    } else {
      const item = selectItem(current, token);
      if (item === undefined) {
        return { rootExists: true, fullPathExists: false, missingAt: at(i) };
      }
      current = item;
    }
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
  const tokens = parsePath(path);
  if (tokens.length === 0) return false;
  const rootToken = tokens[0];
  if (rootToken.type !== 'key') return false;
  return Object.prototype.hasOwnProperty.call(obj, rootToken.value);
}

/**
 * Replace a value at a JSONPath-like location (no merging, complete replacement)
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path
 * @param {*} value - The value to set (replaces entirely)
 */
export function replaceAtPath(obj, path, value) {
  const tokens = parsePath(path);
  if (tokens.length === 0) return;

  const lastToken = tokens[tokens.length - 1];
  const navTokens = tokens.slice(0, -1);

  let current = obj;
  for (const token of navTokens) {
    if (token.type === 'key') {
      if (current[token.value] === undefined) {
        current[token.value] = {};
      }
      current = current[token.value];
    } else {
      const item = selectItem(current, token);
      if (item === undefined) return;
      current = item;
    }
  }

  if (lastToken.type === 'key') {
    current[lastToken.value] = value;
  } else if (lastToken.type === 'index') {
    const at = Array.isArray(current) ? indexIn(current, lastToken.value) : -1;
    if (at !== -1) current[at] = value;
  }
}

/**
 * Append items to an array at a JSONPath-like location.
 * Does not remove existing items — use update: to replace the whole array.
 *
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path to an array
 * @param {*} items - Item or array of items to append
 */
export function appendAtPath(obj, path, items) {
  const target = navigatePath(obj, parsePath(path));
  if (Array.isArray(target)) {
    const toAppend = Array.isArray(items) ? items : [items];
    target.push(...toAppend);
  } else if (target !== null && typeof target === 'object') {
    const toMerge = Array.isArray(items) ? Object.assign({}, ...items) : items;
    Object.assign(target, toMerge);
  }
}

/**
 * Add a value at a JSONPath-like location.
 * Unlike setAtPath, navigates the parent path strictly — does not auto-create intermediate
 * keys. Only sets the key if it is absent; returns { added: false, reason: 'already exists' }
 * if the key is already present so callers can warn and skip.
 *
 * @param {Object} obj - The object to modify
 * @param {string} path - JSONPath-like path
 * @param {*} value - The value to add
 * @returns {{ added: boolean, reason: string | null }}
 */
export function addAtPath(obj, path, value) {
  const tokens = parsePath(path);
  if (tokens.length === 0) return { added: false, reason: 'empty path' };

  const lastToken = tokens[tokens.length - 1];
  if (lastToken.type !== 'key') {
    return { added: false, reason: 'last path segment must be a key, not a filter expression or index' };
  }

  const navTokens = tokens.slice(0, -1);
  let current = obj;
  for (const token of navTokens) {
    if (token.type === 'key') {
      if (current[token.value] === undefined || current[token.value] === null) {
        return { added: false, reason: `parent path does not exist at '${token.value}'` };
      }
      current = current[token.value];
    } else {
      const item = selectItem(current, token);
      if (item === undefined) return { added: false, reason: `nothing in the parent path matched ${formatPath([token])}` };
      current = item;
    }
  }

  const key = lastToken.value;
  if (Object.prototype.hasOwnProperty.call(current, key)) {
    return { added: false, reason: 'already exists' };
  }

  current[key] = value;
  return { added: true, reason: null };
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
 * Apply overlay actions to a spec.
 * Supports: update, remove, rename, replace (with optional $ref), append.
 *
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
    const { target, update, remove, rename, replace, append, add } = action;

    if (!target) {
      if (!silent) {
        console.warn('Overlay action missing target, skipping');
      }
      continue;
    }

    // Check if this file has the root schema (e.g., Person, transitions, slaTypes)
    if (!rootExists(result, target)) {
      continue;
    }

    // Check full path existence for warning purposes
    const pathCheck = checkPathExists(result, target);

    // Determine if this is an "update properties" action (adding new fields is expected)
    const isAddingProperties = target.endsWith('.properties') && typeof update === 'object';

    // Warn if target doesn't fully exist (except when intentionally adding new properties or replacing)
    if (!pathCheck.fullPathExists && !isAddingProperties && !replace && add === undefined) {
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
    } else if (append !== undefined) {
      // Custom extension: append action (adds items to existing array)
      appendAtPath(result, target, append);
      if (!silent && action.description) {
        console.log(`  - Appended: ${action.description}`);
      }
    } else if (update !== undefined) {
      setAtPath(result, target, update);
      if (!silent && action.description) {
        console.log(`  - Applied: ${action.description}`);
      }
    } else if (add !== undefined) {
      // Custom extension: add action (create at path only if absent; warns and skips if key exists)
      let addValue = add;

      if (add && typeof add === 'object' && add.$ref) {
        if (!overlayDir) {
          warnings.push(`Cannot resolve $ref in add action: overlayDir not provided (action: "${action.description || target}")`);
          continue;
        }
        const { value, error } = loadReplacementRef(add.$ref, overlayDir);
        if (error) {
          warnings.push(`${error} (action: "${action.description || target}")`);
          continue;
        }
        addValue = value;
      }

      const { added, reason } = addAtPath(result, target, addValue);
      if (!added) {
        const actionDesc = action.description || target;
        if (reason === 'already exists') {
          warnings.push(`add: target already exists, skipping (action: "${actionDesc}")`);
        } else if (reason) {
          warnings.push(`add: ${reason} (action: "${actionDesc}")`);
        }
      } else if (!silent && action.description) {
        console.log(`  - Added: ${action.description}`);
      }
    }
  }

  return { result, warnings };
}
