/**
 * Contract navigation helpers used only by the explorer.
 *
 * These moved out of blueprint-core when its surface collapsed to the five
 * pipeline verbs. None of them is part of resolving or validating a contract
 * set — they read a already-loaded document set to render documentation:
 *
 *   buildEventIndex        who emits and who subscribes to each event type
 *   findSpecRelativePaths  where a field sits relative to its root schema
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import yaml from 'js-yaml';

/**
 * Build a cross-domain event index from an array of parsed state machine objects.
 *
 * @param {Array<{ domain: string, machines: Array }>} allStateMachines
 * @returns {{ emitters: Record<string, { domain, object }>, subscribers: Record<string, Array<{ domain, object }>> }}
 */
export function buildEventIndex(allStateMachines) {
  const emitters = {};
  const subscribers = {};

  for (const sm of allStateMachines) {
    for (const machine of sm.machines) {
      for (const op of (machine.actions || [])) {
        for (const eventType of collectEmitSteps(getSteps(op))) {
          emitters[eventType] = { domain: sm.domain, object: machine.object };
        }
      }
      for (const sub of machine.events || []) {
        if (!subscribers[sub.type]) subscribers[sub.type] = [];
        subscribers[sub.type].push({ domain: sm.domain, object: machine.object });
      }
    }
  }

  return { emitters, subscribers };
}


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
