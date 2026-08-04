/**
 * State Machine Cross-Artifact Validator
 *
 * Exports pure functions for validating state machine YAML documents:
 *   validateWithinFile   — within-file consistency (no resolved specs needed)
 *   validateCrossArtifact — field refs, enum values, endpoints (needs resolved specs)
 *
 * Both return an array of { rule, message, path } error objects.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import yaml from 'js-yaml';

export const VALID_ACTOR_ROLES = new Set(['applicant', 'case_worker', 'supervisor', 'system']);

// =============================================================================
// External ref resolution
// =============================================================================

/**
 * Recursively resolve all $refs in a schema, including external file refs.
 * Returns a new schema object with all refs inlined.
 *
 * @param {object} schema - The schema to resolve
 * @param {object} ctx - { spec, specFilePath } — the current document and its path
 * @param {number} depth - Recursion depth guard
 */
export function resolveSchemaRefs(schema, { spec = null, specFilePath = null } = {}, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 10) return schema;

  if (typeof schema.$ref === 'string') {
    if (schema.$ref.startsWith('#')) {
      // Internal ref — resolve within current spec/document
      if (spec) {
        const parts = schema.$ref.slice(2).split('/');
        let node = spec;
        for (const part of parts) node = node?.[part];
        if (node && node !== schema) return resolveSchemaRefs(node, { spec, specFilePath }, depth + 1);
      }
      return schema;
    } else {
      // External ref — load the referenced file
      if (specFilePath) {
        const [filePart, jsonPointer] = schema.$ref.split('#');
        const fullPath = join(dirname(specFilePath), filePart);
        const resolvedFull = resolve(fullPath);
        const projectRoot = resolve(process.cwd());
        const refRel = relative(projectRoot, resolvedFull);
        if (refRel.startsWith('..') || isAbsolute(refRel)) break;
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
        } catch { /* fall through to return schema as-is */ }
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

// Variables whose schema is provided by the runtime, not declared in context
export const SYSTEM_VARIABLES = new Set(['this', 'caller', 'now', 'request', 'params', 'push', 'merge']);

// =============================================================================
// Schema resolution helpers
// =============================================================================

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
 * Collect top-level property names from a schema, following $ref, allOf/oneOf/anyOf.
 * Returns a Map: fieldName → resolved property schema.
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

/**
 * Walk a dot-separated field path through a schema, returning the schema at that leaf.
 * Returns null if any segment is not found.
 */
export function getPropertyAtPath(spec, schema, fieldPath) {
  const parts = fieldPath.split('.');
  let current = schema;

  for (const part of parts) {
    if (!current) return null;
    if (current.$ref) current = resolveRef(spec, current.$ref);
    if (!current) return null;

    const props = { ...(current.properties || {}) };

    for (const combinator of ['allOf', 'oneOf', 'anyOf']) {
      for (const sub of (current[combinator] || [])) {
        const resolved = sub.$ref ? (resolveRef(spec, sub.$ref) ?? sub) : sub;
        if (resolved?.properties) Object.assign(props, resolved.properties);
      }
    }

    // For arrays, also look into items properties
    if (!props[part] && current.items) {
      const items = current.items.$ref ? (resolveRef(spec, current.items.$ref) ?? current.items) : current.items;
      if (items?.properties) Object.assign(props, items.properties);
    }

    current = props[part] ?? null;
  }

  return current;
}

/**
 * Build a schema index from all *-openapi.yaml files in a directory.
 * Returns: Map<schemaName, { spec, schema, properties }>
 */
export function buildSchemaIndex(specsDir) {
  const index = new Map();
  let files;
  try { files = readdirSync(specsDir); } catch { return index; }

  for (const file of files) {
    if (!file.endsWith('-openapi.yaml')) continue;
    const filePath = join(specsDir, file);
    let spec;
    try { spec = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA }); } catch { continue; }

    for (const [name, rawSchema] of Object.entries(spec?.components?.schemas || {})) {
      if (!index.has(name)) {
        const schema = resolveSchemaRefs(rawSchema, { spec, specFilePath: filePath });
        index.set(name, { spec, schema, properties: collectTopLevelProperties(spec, schema) });
      }
    }
  }
  return index;
}

/**
 * Build an endpoint index from all *-openapi.yaml files in a directory.
 * Returns: Map<'domain/collection', schemaName | null>
 *
 * Key format: 'domain/resource' or 'domain/resource/sub-resource'
 * (non-param path segments joined, prefixed by x-domain)
 */
export function buildEndpointIndex(specsDir) {
  const index = new Map();
  let files;
  try { files = readdirSync(specsDir); } catch { return index; }

  for (const file of files) {
    if (!file.endsWith('-openapi.yaml')) continue;
    let spec;
    try { spec = yaml.load(readFileSync(join(specsDir, file), 'utf8'), { schema: yaml.DEFAULT_SCHEMA }); } catch { continue; }

    const domain = spec?.info?.['x-domain'];
    if (!domain || !spec.paths) continue;

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const segments = path.split('/').filter(Boolean);
      const nonParamSegs = segments.filter(s => !s.startsWith('{'));
      if (nonParamSegs.length === 0) continue;

      const endsWithParam = path.endsWith('}');

      // Resolve the schema name for this endpoint.
      const getOp = pathItem.get;
      const schemaRef = getOp?.responses?.['200']?.content?.['application/json']?.schema;
      let schemaName = null;
      if (schemaRef?.$ref) {
        const m = schemaRef.$ref.match(/^#\/components\/schemas\/(.+)$/);
        if (m) schemaName = m[1];
      }
      if (!schemaName) {
        const itemsRef = getOp?.responses?.['200']?.content?.['application/json']?.schema?.properties?.items?.$ref;
        if (itemsRef) {
          const m = itemsRef.match(/^#\/components\/schemas\/(.+)$/);
          if (m) schemaName = m[1];
        }
      }

      const key = `${domain}/${nonParamSegs.join('/')}`;
      if (!endsWithParam && index.has(key)) continue;
      index.set(key, schemaName);

      // For nested item endpoints (e.g. /applications/{id}/members/{id}), also register
      // a shorthand key using the parent collection (singularized) + child collection:
      // "intake/application-members". This matches the state machine convention.
      if (endsWithParam && nonParamSegs.length >= 2) {
        const parent = nonParamSegs[nonParamSegs.length - 2];
        const child = nonParamSegs[nonParamSegs.length - 1];
        const parentSingular = parent.endsWith('s') ? parent.slice(0, -1) : parent;
        const shorthand = `${domain}/${parentSingular}-${child}`;
        if (!index.has(shorthand)) index.set(shorthand, schemaName);
      }
    }
  }
  return index;
}

// =============================================================================
// String pattern extraction
// =============================================================================

const FIELD_REF_RE = /\$([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g;

/** Extract all $variable.field.path references from a string. */
export function extractFieldRefs(str) {
  if (typeof str !== 'string') return [];
  const refs = [];
  let m;
  FIELD_REF_RE.lastIndex = 0;
  while ((m = FIELD_REF_RE.exec(str)) !== null) {
    refs.push({ variable: m[1], field: m[2] });
  }
  return refs;
}

const ENUM_IN_RE = /"([^"]+)"\s+in\s+\$([a-zA-Z_]+)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
const ENUM_EQ_FIELD_RE = /\$([a-zA-Z_]+)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*==\s*"([^"]+)"/g;
const ENUM_EQ_VAL_RE = /"([^"]+)"\s*==\s*\$([a-zA-Z_]+)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;

/** Extract enum string literal comparisons: "val" in $var.field | $var.field == "val" | "val" == $var.field */
export function extractEnumComparisons(str) {
  if (typeof str !== 'string') return [];
  const comparisons = [];
  let m;

  ENUM_IN_RE.lastIndex = 0;
  while ((m = ENUM_IN_RE.exec(str)) !== null) comparisons.push({ value: m[1], variable: m[2], field: m[3] });

  ENUM_EQ_FIELD_RE.lastIndex = 0;
  while ((m = ENUM_EQ_FIELD_RE.exec(str)) !== null) comparisons.push({ value: m[3], variable: m[1], field: m[2] });

  ENUM_EQ_VAL_RE.lastIndex = 0;
  while ((m = ENUM_EQ_VAL_RE.exec(str)) !== null) comparisons.push({ value: m[1], variable: m[2], field: m[3] });

  return comparisons;
}

// =============================================================================
// Document utilities
// =============================================================================

/** Parse context: [{varName: {from: 'domain/collection'}}] → Map<varName, fromPath> */
export function collectContextBindings(contextArray) {
  const bindings = new Map();
  if (!Array.isArray(contextArray)) return bindings;
  for (const item of contextArray) {
    if (!item || typeof item !== 'object') continue;
    for (const [varName, binding] of Object.entries(item)) {
      if (typeof binding === 'object' && binding?.from != null) {
        bindings.set(varName, String(binding.from));
      }
    }
  }
  return bindings;
}

export function loadExtendsDoc(filePath, extendsPath) {
  if (!extendsPath) return null;
  try {
    const dir = dirname(filePath);
    const extPath = join(dir, extendsPath.replace(/^\.\//, ''));
    return yaml.load(readFileSync(extPath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA });
  } catch {
    return null;
  }
}

/** Collect all declared guard IDs (in the file + extends chain). */
export function collectGuardIds(doc, filePath) {
  const ids = new Set();
  for (const g of (doc.guards || [])) if (g?.id) ids.add(g.id);
  for (const machine of (doc.machines || [])) {
    for (const g of (machine.guards || [])) if (g?.id) ids.add(g.id);
  }
  if (doc.extends) {
    const ext = loadExtendsDoc(filePath, doc.extends);
    if (ext) for (const g of (ext.guards || [])) if (g?.id) ids.add(g.id);
  }
  return ids;
}

/** Collect all callable IDs (procedures + actions) visible from a machine. */
export function collectCallableIds(doc, machine, filePath) {
  const ids = new Set();
  for (const p of (machine.procedures || [])) if (p?.id) ids.add(p.id);
  for (const a of (machine.actions || [])) if (a?.id) ids.add(a.id);
  for (const p of (doc.procedures || [])) if (p?.id) ids.add(p.id);
  if (doc.extends) {
    const ext = loadExtendsDoc(filePath, doc.extends);
    if (ext) for (const p of (ext.procedures || [])) if (p?.id) ids.add(p.id);
  }
  return ids;
}

/** Extract condition IDs from a conditions array (handles string, {any:}, {all:} forms). */
export function extractConditionIds(conditions) {
  const ids = [];
  for (const cond of (conditions || [])) {
    if (typeof cond === 'string') {
      ids.push(cond);
    } else if (cond?.any) {
      for (const c of cond.any) if (typeof c === 'string') ids.push(c);
    } else if (cond?.all) {
      for (const c of cond.all) if (typeof c === 'string') ids.push(c);
    }
  }
  return ids;
}

function* walkCallStrings(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (typeof step.call === 'string') yield step.call;
    yield* walkCallStrings(step.then);
    yield* walkCallStrings(step.else);
    yield* walkCallStrings(step.do);
    if (step.when && typeof step.when === 'object') {
      for (const substeps of Object.values(step.when)) yield* walkCallStrings(substeps);
    }
    if (step.forEach?.do) yield* walkCallStrings(step.forEach.do);
  }
}

function* walkSetFields(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (step.set?.field) yield step.set.field;
    yield* walkSetFields(step.then);
    yield* walkSetFields(step.else);
    yield* walkSetFields(step.do);
    if (step.when && typeof step.when === 'object') {
      for (const substeps of Object.values(step.when)) yield* walkSetFields(substeps);
    }
    if (step.forEach?.do) yield* walkSetFields(step.forEach.do);
  }
}

function* walkObjectCalls(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (step.call && typeof step.call === 'object') {
      for (const [method, callPath] of Object.entries(step.call)) {
        if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
          yield { method: method.toUpperCase(), callPath: String(callPath) };
        }
      }
    }
    yield* walkObjectCalls(step.then);
    yield* walkObjectCalls(step.else);
    yield* walkObjectCalls(step.do);
    if (step.when && typeof step.when === 'object') {
      for (const substeps of Object.values(step.when)) yield* walkObjectCalls(substeps);
    }
    if (step.forEach?.do) yield* walkObjectCalls(step.forEach.do);
  }
}

// Walk all string values in a node, skipping description and $schema keys
function* walkAllStrings(node) {
  if (typeof node === 'string') {
    yield node;
  } else if (Array.isArray(node)) {
    for (const item of node) yield* walkAllStrings(item);
  } else if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node)) {
      if (key === 'description' || key === '$schema' || key === 'type') continue;
      yield* walkAllStrings(val);
    }
  }
}

// =============================================================================
// Within-file validation (no resolved specs needed)
// =============================================================================

/**
 * Validate within-file consistency of a state machine document.
 * @param {string} filePath - Path to the file (for loading extends)
 * @param {object} doc - Parsed YAML document
 * @returns {Array<{rule, message, path}>}
 */
export function validateWithinFile(filePath, doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return errors;

  const guardIds = collectGuardIds(doc, filePath);

  for (const machine of (doc.machines || [])) {
    const ctx = `machines[${machine.object ?? '?'}]`;
    const stateIds = new Set((machine.states || []).map(s => s?.id).filter(Boolean));
    const callableIds = collectCallableIds(doc, machine, filePath);

    // No duplicate state IDs
    const seenStates = new Set();
    for (const s of (machine.states || [])) {
      if (s?.id) {
        if (seenStates.has(s.id)) errors.push({ rule: 'duplicate-id', message: `Duplicate state id "${s.id}"`, path: `${ctx}.states` });
        seenStates.add(s.id);
      }
    }

    // No duplicate action IDs
    const seenActions = new Set();
    for (const a of (machine.actions || [])) {
      if (a?.id) {
        if (seenActions.has(a.id)) errors.push({ rule: 'duplicate-id', message: `Duplicate action id "${a.id}"`, path: `${ctx}.actions` });
        seenActions.add(a.id);
      }
    }

    // No duplicate procedure IDs
    const seenProcs = new Set();
    for (const p of (machine.procedures || [])) {
      if (p?.id) {
        if (seenProcs.has(p.id)) errors.push({ rule: 'duplicate-id', message: `Duplicate procedure id "${p.id}"`, path: `${ctx}.procedures` });
        seenProcs.add(p.id);
      }
    }

    // No duplicate guard IDs in this machine
    const seenMachineGuards = new Set();
    for (const g of (machine.guards || [])) {
      if (g?.id) {
        if (seenMachineGuards.has(g.id)) errors.push({ rule: 'duplicate-id', message: `Duplicate guard id "${g.id}"`, path: `${ctx}.guards` });
        seenMachineGuards.add(g.id);
      }
    }

    // Validate actions
    for (const action of (machine.actions || [])) {
      const ap = `${ctx}.actions[${action.id ?? '?'}]`;
      const tr = action.transition;
      if (tr) {
        const froms = Array.isArray(tr.from) ? tr.from : (tr.from != null ? [tr.from] : []);
        const tos = Array.isArray(tr.to) ? tr.to : (tr.to != null ? [tr.to] : []);
        for (const f of froms) {
          if (f !== '*' && !stateIds.has(f)) {
            errors.push({ rule: 'unknown-state', message: `Transition from unknown state "${f}"`, path: `${ap}.transition.from` });
          }
        }
        for (const t of tos) {
          if (t !== '*' && !stateIds.has(t)) {
            errors.push({ rule: 'unknown-state', message: `Transition to unknown state "${t}"`, path: `${ap}.transition.to` });
          }
        }
      }

      for (const guard of (action.guards || [])) {
        for (const actor of (guard.actors || [])) {
          if (!VALID_ACTOR_ROLES.has(actor)) {
            errors.push({ rule: 'invalid-actor-role', message: `Invalid actor role "${actor}" (valid: ${[...VALID_ACTOR_ROLES].join(', ')})`, path: `${ap}.guards` });
          }
        }
        for (const condId of extractConditionIds(guard.conditions)) {
          if (!guardIds.has(condId)) {
            errors.push({ rule: 'unknown-guard', message: `Guard condition "${condId}" is not declared in this file or its extends chain`, path: `${ap}.guards` });
          }
        }
      }

      for (const callId of walkCallStrings(action.steps)) {
        if (!callableIds.has(callId)) {
          errors.push({ rule: 'unknown-callable', message: `call: "${callId}" references undeclared procedure or action`, path: `${ap}.steps` });
        }
      }
    }

    // Validate events
    for (const event of (machine.events || [])) {
      const ep = `${ctx}.events[${event.type ?? '?'}]`;
      for (const callId of walkCallStrings(event.steps)) {
        if (!callableIds.has(callId)) {
          errors.push({ rule: 'unknown-callable', message: `call: "${callId}" references undeclared procedure or action`, path: ep });
        }
      }
    }

    // Validate procedures
    for (const proc of (machine.procedures || [])) {
      const pp = `${ctx}.procedures[${proc.id ?? '?'}]`;
      const paramNames = new Set(proc.parameters || []);

      // $params.X must match declared parameters
      const procStrings = [
        ...walkAllStrings(proc.if),
        ...walkAllStrings(proc.then),
        ...walkAllStrings(proc.steps),
        ...walkAllStrings(proc.context),
      ];
      for (const str of procStrings) {
        for (const { variable, field } of extractFieldRefs(str)) {
          if (variable === 'params') {
            const topLevel = field.split('.')[0];
            if (!paramNames.has(topLevel)) {
              errors.push({ rule: 'unknown-param', message: `$params.${field} references undeclared parameter "${topLevel}"`, path: pp });
            }
          }
        }
      }

      const procSteps = [...(proc.steps || []), ...(proc.then || [])];
      for (const callId of walkCallStrings(procSteps)) {
        if (!callableIds.has(callId)) {
          errors.push({ rule: 'unknown-callable', message: `call: "${callId}" references undeclared procedure or action`, path: pp });
        }
      }
    }
  }

  return errors;
}

// =============================================================================
// Cross-artifact validation (requires resolved specs)
// =============================================================================

/**
 * Validate cross-artifact field references in a state machine document.
 * @param {string} filePath - Path to the file (for error messages)
 * @param {object} doc - Parsed YAML document
 * @param {Map} schemaIndex - From buildSchemaIndex()
 * @param {Map} endpointIndex - From buildEndpointIndex()
 * @returns {Array<{rule, message, path}>}
 */
export function validateCrossArtifact(filePath, doc, schemaIndex, endpointIndex, exceptions = {}) {
  const exceptedFields = new Set(
    (exceptions.unknownFields || []).map(e => `${e.schema}:${e.field}`)
  );
  const errors = [];
  if (!doc || typeof doc !== 'object') return errors;

  for (const machine of (doc.machines || [])) {
    const ctx = `machines[${machine.object ?? '?'}]`;

    // Machine object: name must exist as a schema
    const objectEntry = machine.object ? schemaIndex.get(machine.object) : null;
    if (machine.object && !objectEntry) {
      errors.push({ rule: 'unknown-object', message: `Machine object "${machine.object}" not found in any OpenAPI spec`, path: `${ctx}.object` });
      continue;
    }

    // Build a union of all context bindings across the machine for field ref validation.
    // All procedures can see all event contexts (since procedures are called from event handlers).
    const allContextEntries = new Map(); // varName → { fromPath, schemaEntry }

    if (objectEntry) {
      allContextEntries.set('object', { fromPath: machine.object, schemaEntry: objectEntry });
    }

    function registerContext(contextArray, locationPath) {
      for (const [varName, fromPath] of collectContextBindings(contextArray)) {
        if (!endpointIndex.has(fromPath)) {
          errors.push({ rule: 'unknown-endpoint', message: `Context "${varName}" from: "${fromPath}" does not resolve to a known endpoint`, path: locationPath });
        }
        const schemaName = endpointIndex.get(fromPath);
        const schemaEntry = schemaName ? schemaIndex.get(schemaName) : null;
        allContextEntries.set(varName, { fromPath, schemaEntry });
      }
    }

    for (const action of (machine.actions || [])) {
      registerContext(action.context, `${ctx}.actions[${action.id}].context`);
    }
    for (const event of (machine.events || [])) {
      registerContext(event.context, `${ctx}.events[${event.type}].context`);
    }
    for (const proc of (machine.procedures || [])) {
      registerContext(proc.context, `${ctx}.procedures[${proc.id}].context`);
    }

    // Validate set: {field:} targets exist on object schema
    if (objectEntry) {
      for (const action of (machine.actions || [])) {
        for (const fieldName of walkSetFields(action.steps)) {
          if (!objectEntry.properties.has(fieldName) && !exceptedFields.has(`${machine.object}:${fieldName}`)) {
            errors.push({
              rule: 'unknown-set-field',
              message: `set: field "${fieldName}" does not exist on ${machine.object} schema`,
              path: `${ctx}.actions[${action.id}].steps`
            });
          }
        }
      }
    }

    // Validate $variable.field references and enum comparisons across all strings in the machine
    const allStrings = [...walkAllStrings(machine)];

    for (const str of allStrings) {
      // Field references: check first segment exists on the schema
      for (const { variable, field } of extractFieldRefs(str)) {
        if (SYSTEM_VARIABLES.has(variable)) continue;

        const entry = allContextEntries.get(variable);
        if (!entry) continue; // Unknown variable (loop var, etc.) — skip
        if (!entry.schemaEntry) continue; // Endpoint known but no schema

        const topField = field.split('.')[0];
        const schemaName = endpointIndex.get(entry.fromPath) ?? entry.fromPath;
        if (!entry.schemaEntry.properties.has(topField) && !exceptedFields.has(`${schemaName}:${topField}`)) {
          errors.push({
            rule: 'unknown-field',
            message: `$${variable}.${topField} does not exist on the schema bound to "${variable}" (from ${entry.fromPath})`,
            path: ctx
          });
        }
      }

      // Enum comparisons: check the literal value is a valid enum value for the field
      for (const { value, variable, field } of extractEnumComparisons(str)) {
        if (SYSTEM_VARIABLES.has(variable)) continue;
        const entry = allContextEntries.get(variable);
        if (!entry?.schemaEntry) continue;

        const fieldSchema = getPropertyAtPath(entry.schemaEntry.spec, entry.schemaEntry.schema, field);
        if (!fieldSchema) continue; // Field not found — already caught above

        const enumValues = fieldSchema.enum || fieldSchema.items?.enum;
        if (enumValues && !enumValues.includes(value)) {
          errors.push({
            rule: 'invalid-enum-value',
            message: `"${value}" is not a valid enum value for $${variable}.${field} (valid: ${enumValues.join(', ')})`,
            path: ctx
          });
        }
      }
    }

    // Validate call: {METHOD: path} — strip template vars and check against endpoint index
    function validateCallPaths(steps, locationPath) {
      for (const { method, callPath } of walkObjectCalls(steps)) {
        // Strip $variable references to get static path segments
        const staticPath = callPath
          .replace(/\$[a-zA-Z_][a-zA-Z0-9_.]*(?=\/|$)/g, '')
          .replace(/\/+/g, '/')
          .replace(/\/$/, '')
          .replace(/^\//, '');

        const parts = staticPath.split('/').filter(p => p && !p.startsWith('{'));
        if (parts.length < 2) continue; // Can't validate single-segment paths

        const endpointKey = parts.join('/');
        const known = endpointIndex.has(endpointKey) ||
          [...endpointIndex.keys()].some(k => k === endpointKey || k.startsWith(endpointKey + '/') || endpointKey.startsWith(k + '/'));
        if (!known) {
          errors.push({
            rule: 'unknown-call-path',
            message: `call: {${method}: "${callPath}"} — "${endpointKey}" does not resolve to a known endpoint`,
            path: locationPath
          });
        }
      }
    }

    for (const action of (machine.actions || [])) {
      validateCallPaths(action.steps, `${ctx}.actions[${action.id}].steps`);
    }
    for (const event of (machine.events || [])) {
      validateCallPaths(event.steps, `${ctx}.events[${event.type}].steps`);
    }
    for (const proc of (machine.procedures || [])) {
      const procSteps = [...(proc.steps || []), ...(proc.then || [])];
      validateCallPaths(procSteps, `${ctx}.procedures[${proc.id}]`);
    }
  }

  return errors;
}
