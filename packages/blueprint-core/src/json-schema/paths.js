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

import { readFileSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import yaml from 'js-yaml';

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
 * @param {{ spec?: object, specFilePath?: string }} ctx
 * @param {number} depth
 * @returns {object}
 */
export function resolveSchemaRefs(schema, { spec = null, specFilePath = null } = {}, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 10) return schema;

  if (typeof schema.$ref === 'string') {
    if (schema.$ref.startsWith('#')) {
      if (spec) {
        const parts = schema.$ref.slice(2).split('/');
        let node = spec;
        for (const part of parts) node = node?.[part];
        if (node && node !== schema) return resolveSchemaRefs(node, { spec, specFilePath }, depth + 1);
      }
      return schema;
    } else {
      if (specFilePath) {
        const [filePart, jsonPointer] = schema.$ref.split('#');
        const fullPath = join(dirname(specFilePath), filePart);
        const resolvedFull = resolve(fullPath);
        const projectRoot = resolve(process.cwd());
        const refRel = relative(projectRoot, resolvedFull);
        if (refRel.startsWith('..') || isAbsolute(refRel)) return schema;
        try {
          const externalDoc = yaml.load(readFileSync(resolvedFull, 'utf8'), { schema: yaml.DEFAULT_SCHEMA });
          let resolved = externalDoc;
          if (jsonPointer) {
            const parts = jsonPointer.slice(1).split('/');
            for (const part of parts) resolved = resolved?.[part];
          }
          if (resolved && resolved !== schema) {
            return resolveSchemaRefs(resolved, { spec: externalDoc, specFilePath: fullPath }, depth + 1);
          }
        } catch { /* fall through */ }
      }
      return schema;
    }
  }

  const out = { ...schema };
  const ctx = { spec, specFilePath };

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

// =============================================================================
// Path enumeration
// =============================================================================

/**
 * Enumerate all JSON Schema paths within an object schema.
 * Returns an array of { path, schema } pairs for every reachable property.
 *
 * Array items are denoted with [] (e.g. "members[].dateOfBirth").
 * Circular references are detected via a WeakSet and skipped.
 *
 * @param {object} spec     - The root spec document (for $ref resolution).
 * @param {object} schema   - The schema object to enumerate.
 * @param {string} prefix   - Path prefix to prepend (e.g. "application").
 * @returns {{ path: string, schema: object }[]}
 */
export function getPathsForObject(spec, schema, prefix = '') {
  const results = [];
  const visited = new WeakSet();
  walkObject(spec, schema, prefix, results, visited);
  return results;
}

function resolveNode(spec, schema) {
  if (schema?.$ref) return resolveRef(spec, schema.$ref) ?? schema;
  return schema;
}

function collectProps(spec, schema) {
  const props = {};
  if (!schema) return props;

  for (const combinator of ['allOf', 'oneOf', 'anyOf']) {
    for (const sub of (schema[combinator] || [])) {
      Object.assign(props, collectProps(spec, resolveNode(spec, sub)));
    }
  }

  if (schema.properties) Object.assign(props, schema.properties);
  return props;
}

/** Schema name suffixes that are stripped when resolving a PascalCase schema name. */
const SCHEMA_SUFFIXES = ['List', 'Create', 'Update', 'Writable'];

/**
 * Resolve an annotation key or PascalCase schema name to all matching spec-relative
 * field inventory paths.
 *
 * Accepts three input formats:
 *   - PascalCase schema name: "ApplicationMemberList", "ApplicationCreate" —
 *     known suffixes (List, Create, Update, Writable) are stripped before lookup,
 *     so "ApplicationMemberList" → "ApplicationMember" → "application.members[]".
 *   - Spec-relative:   "application.members[].dateOfBirth" — first segment is a
 *     root resource prefix (camelCase schema name). Returned as-is.
 *   - Schema-relative: "applicationMember.dateOfBirth" — first segment is a
 *     sub-resource schema name (camelCase). Expanded to every spec-relative path
 *     where that schema appears as array items (e.g. all usages of ApplicationMember).
 *
 * Returns an array of spec-relative paths. Returns [key] unchanged when no
 * schema-relative expansion is found (unresolvable or already spec-relative).
 *
 * @param {object} spec - OpenAPI spec document.
 * @param {string} key  - Annotation key, spec-relative path, or PascalCase schema name.
 * @returns {string[]}
 */
export function findSpecRelativePaths(spec, key) {
  const schemas = spec?.components?.schemas ?? {};

  const dot = key.indexOf('.');
  const firstSegment = dot === -1 ? key : key.slice(0, dot);
  const restPath = dot === -1 ? '' : key.slice(dot + 1);

  // PascalCase the first segment to look up the schema, stripping known suffixes
  // so callers can pass raw schema names like "ApplicationMemberList" directly.
  let schemaName = firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1);
  if (!schemas[schemaName]) {
    for (const suffix of SCHEMA_SUFFIXES) {
      if (schemaName.endsWith(suffix)) {
        const stripped = schemaName.slice(0, -suffix.length);
        if (schemas[stripped]) { schemaName = stripped; break; }
      }
    }
  }
  if (!schemas[schemaName]) return [key];

  // Search all root schemas for array properties whose items reference schemaName.
  // These represent schema-relative annotation keys — e.g. "applicationMember.dob"
  // resolves to "application.members[].dob" when ApplicationMember appears as
  // items of application.members[].
  const targetRef = `#/components/schemas/${schemaName}`;
  function itemsMatchesSchema(items) {
    if (!items) return false;
    if (items.$ref === targetRef) return true;
    for (const combinator of ['oneOf', 'anyOf', 'allOf']) {
      if (items[combinator]?.some(s => s.$ref === targetRef)) return true;
    }
    return false;
  }

  const arrayPaths = [];
  for (const [rootName, rootSchema] of Object.entries(schemas)) {
    const rootPrefix = rootName.charAt(0).toLowerCase() + rootName.slice(1);
    for (const { path, schema: pathSchema } of getPathsForObject(spec, rootSchema, rootPrefix)) {
      if (path.endsWith('[]') && itemsMatchesSchema(pathSchema.items)) {
        arrayPaths.push(path);
      }
    }
  }

  // Filter out pagination list-wrapper paths. List wrappers store their payload in
  // a property named `items` — domain arrays use meaningful names (members[], programs[]).
  // A path ending in `.items[]` is always a list wrapper, never a meaningful annotation
  // context. Removing these lets spec-relative keys like "application.id" fall through
  // unchanged instead of expanding to "applicationList.items[].id".
  const meaningfulPaths = arrayPaths.filter(p => !p.endsWith('.items[]'));

  if (meaningfulPaths.length > 0) {
    // Schema-relative key: expand to all spec-relative array usages.
    return meaningfulPaths.map(p => (restPath ? `${p}.${restPath}` : p));
  }

  // No meaningful array usages found. Derive the root path from the schema name,
  // always stripping known suffixes (ApplicationList → application, DeterminationCreate
  // → determination) so field paths match data dictionary card IDs.
  let baseName = schemaName;
  for (const suffix of SCHEMA_SUFFIXES) {
    if (baseName.endsWith(suffix)) {
      baseName = baseName.slice(0, -suffix.length);
      break;
    }
  }
  const rootPath = baseName.charAt(0).toLowerCase() + baseName.slice(1);
  return [restPath ? `${rootPath}.${restPath}` : rootPath];
}

function walkObject(spec, schema, prefix, results, visited) {
  if (!schema || typeof schema !== 'object') return;
  const resolved = resolveNode(spec, schema);
  if (!resolved || visited.has(resolved)) return;
  visited.add(resolved);

  const props = collectProps(spec, resolved);

  for (const [name, propSchema] of Object.entries(props)) {
    const propResolved = resolveNode(spec, propSchema);
    if (!propResolved) continue;

    const path = prefix ? `${prefix}.${name}` : name;

    if (propResolved.type === 'array') {
      const arrayPath = `${path}[]`;
      results.push({ path: arrayPath, schema: propResolved });
      const items = resolveNode(spec, propResolved.items);
      if (items && typeof items === 'object' && !visited.has(items)) {
        walkObject(spec, items, arrayPath, results, visited);
      }
    } else {
      results.push({ path, schema: propResolved });
      const nestedProps = collectProps(spec, propResolved);
      if (Object.keys(nestedProps).length > 0) {
        walkObject(spec, propResolved, path, results, visited);
      }
    }
  }
}
