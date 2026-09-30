/**
 * JSON Schema path utilities.
 *
 * Generic functions for navigating and enumerating paths in any JSON Schema
 * compatible document (OpenAPI schemas, state machine schemas, rules schemas, etc.).
 *
 * Path format: dot-separated property names with [] denoting array items.
 *   application.members[].dateOfBirth
 *   verification.category
 */

// =============================================================================
// Ref resolution
// =============================================================================

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import yaml from 'js-yaml';

/** Package root per directory, so the walk up happens once per location. */
const packageRoots = new Map();

/**
 * The package a file belongs to, as the nearest ancestor holding a package.json.
 *
 * This bounds `$ref` following: a document may reference its siblings but not
 * reach outside the package that ships it. Derived from the referring file
 * rather than `process.cwd()`, which is wherever the command happened to be
 * run from — resolving the same contracts from a workspace directory silently
 * dropped every cross-file ref and reported hundreds of missing fields.
 *
 * @param {string} filePath - Absolute path to the referring document
 * @returns {string|null} Absolute package root, or null if none found
 */
function packageRootOf(filePath) {
  let dir = dirname(resolve(filePath));

  if (packageRoots.has(dir)) return packageRoots.get(dir);

  const start = dir;
  let root = null;

  for (let parent = dir; ; parent = dirname(parent)) {
    if (existsSync(join(parent, 'package.json'))) {
      root = parent;
      break;
    }
    if (parent === dirname(parent)) break;  // filesystem root
  }

  packageRoots.set(start, root);
  return root;
}

/**
 * Resolve an internal $ref (e.g. '#/components/schemas/Foo') within a spec document.
 *
 * @param {object} spec
 * @param {string} ref
 * @returns {object|null}
 */
export function resolveRef(spec, ref) {
  if (!ref?.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let node = spec;
  for (const part of parts) {
    if (!node || typeof node !== 'object') return null;
    node = node[part];
  }
  return node ?? null;
}

/**
 * Recursively resolve all $refs in a schema, including external file refs.
 * Returns a new schema object with all refs inlined.
 *
 * @param {object} schema
 * @param {{ spec?: object, specFilePath?: string, setRoot?: string }} ctx
 * @param {number} depth
 * @returns {object}
 */
export function resolveSchemaRefs(schema, { spec = null, specFilePath = null, setRoot = null } = {}, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 10) return schema;

  if (typeof schema.$ref === 'string') {
    if (schema.$ref.startsWith('#')) {
      if (spec) {
        const parts = schema.$ref.slice(2).split('/');
        let node = spec;
        for (const part of parts) node = node?.[part];
        if (node && node !== schema) return resolveSchemaRefs(node, { spec, specFilePath, setRoot }, depth + 1);
      }
      return schema;
    } else {
      if (specFilePath) {
        const [filePart, jsonPointer] = schema.$ref.split('#');
        const fullPath = join(dirname(specFilePath), filePart);
        const resolvedFull = resolve(fullPath);
        // The contract set the referring document belongs to. Falls back to
        // its package when the caller has no set root to give — a document
        // loaded on its own is not part of a set.
        const bound = setRoot ?? packageRootOf(specFilePath);
        if (!bound) return schema;
        const refRel = relative(bound, resolvedFull);
        if (refRel.startsWith('..') || isAbsolute(refRel)) return schema;
        try {
          const externalDoc = yaml.load(readFileSync(resolvedFull, 'utf8'), { schema: yaml.DEFAULT_SCHEMA });
          let resolved = externalDoc;
          if (jsonPointer) {
            const parts = jsonPointer.slice(1).split('/');
            for (const part of parts) resolved = resolved?.[part];
          }
          if (resolved && resolved !== schema) {
            // setRoot is carried through: following a ref moves which file we
            // are in, not which contract set.
            return resolveSchemaRefs(resolved, { spec: externalDoc, specFilePath: fullPath, setRoot }, depth + 1);
          }
        } catch { /* fall through */ }
      }
      return schema;
    }
  }

  const out = { ...schema };
  const ctx = { spec, specFilePath, setRoot };

  for (const combinator of ['allOf', 'oneOf', 'anyOf']) {
    if (schema[combinator]) {
      out[combinator] = schema[combinator].map(sub => resolveSchemaRefs(sub, ctx, depth + 1));
    }
  }
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out.properties[k] = resolveSchemaRefs(v, ctx, depth + 1);
    }
  }
  if (schema.items) out.items = resolveSchemaRefs(schema.items, ctx, depth + 1);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    out.additionalProperties = resolveSchemaRefs(schema.additionalProperties, ctx, depth + 1);
  }

  return out;
}

// =============================================================================
// Property collection
// =============================================================================

/**
 * Collect top-level property names from a schema, following $ref, allOf/oneOf/anyOf.
 * Returns a Map: fieldName → resolved property schema.
 *
 * @param {object} spec
 * @param {object} schema
 * @param {number} depth
 * @returns {Map<string, object>}
 */
export function collectTopLevelProperties(spec, schema, depth = 0) {
  const props = new Map();
  if (!schema || depth > 8) return props;

  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref);
    return resolved ? collectTopLevelProperties(spec, resolved, depth + 1) : props;
  }

  for (const combinator of ['allOf', 'oneOf', 'anyOf']) {
    for (const sub of (schema[combinator] || [])) {
      for (const [k, v] of collectTopLevelProperties(spec, sub, depth + 1)) props.set(k, v);
    }
  }

  if (schema.properties) {
    for (const [key, val] of Object.entries(schema.properties)) {
      const resolved = val?.$ref ? (resolveRef(spec, val.$ref) ?? val) : val;
      props.set(key, resolved);
    }
  }

  return props;
}

// =============================================================================
// Path resolution
// =============================================================================

/**
 * Walk a dot-separated JSON Schema path through a schema, returning the schema
 * node at that location. Array segments are denoted with [] (e.g. members[]).
 * Returns null if any segment is not found.
 *
 * Works on both resolved specs (no $refs) and unresolved specs ($refs followed).
 *
 * @param {object} spec  - The root spec document (for $ref resolution).
 * @param {object} schema - The schema to start from.
 * @param {string} path  - Dot-separated path, e.g. "members[].dateOfBirth".
 * @returns {object|null}
 */
export function getPropertyAtPath(spec, schema, path) {
  const parts = path.split('.');
  let current = schema;

  for (const part of parts) {
    if (!current) return null;
    if (current.$ref) current = resolveRef(spec, current.$ref);
    if (!current) return null;

    // Strip [] suffix — navigate into the array items first, then look up the property
    const isArraySegment = part.endsWith('[]');
    const name = isArraySegment ? part.slice(0, -2) : part;

    const props = { ...(current.properties || {}) };

    for (const combinator of ['allOf', 'oneOf', 'anyOf']) {
      for (const sub of (current[combinator] || [])) {
        const resolved = sub.$ref ? (resolveRef(spec, sub.$ref) ?? sub) : sub;
        if (resolved?.properties) Object.assign(props, resolved.properties);
      }
    }

    // If name not found at this level, try unwrapping array items
    if (!props[name] && current.items) {
      const items = current.items.$ref ? (resolveRef(spec, current.items.$ref) ?? current.items) : current.items;
      if (items?.properties) Object.assign(props, items.properties);
    }

    current = props[name] ?? null;

    // After navigating to an array property, step into items for subsequent segments
    if (current && isArraySegment && current.type === 'array' && current.items) {
      current = current.items.$ref ? (resolveRef(spec, current.items.$ref) ?? current.items) : current.items;
    }
  }

  return current;
}
