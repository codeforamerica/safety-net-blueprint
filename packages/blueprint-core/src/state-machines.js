/**
 * State machine utilities shared across the blueprint toolchain.
 *
 * These helpers read the parsed state machine YAML structure and are used by
 * the explorer tools (state-machine-docs, event-catalog) and any other tooling
 * that needs to index or walk state machine definitions.
 *
 * Also exports schema navigation utilities used by validators that need to
 * resolve $refs and walk schema properties.
 */

import { readFileSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import yaml from 'js-yaml';

// =============================================================================
// Schema navigation utilities
// =============================================================================

/**
 * Recursively resolve all $refs in a schema, including external file refs.
 * Returns a new schema object with all refs inlined.
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

/** Resolve an internal $ref (e.g. '#/components/schemas/Foo') within a spec document. */
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

    if (!props[part] && current.items) {
      const items = current.items.$ref ? (resolveRef(spec, current.items.$ref) ?? current.items) : current.items;
      if (items?.properties) Object.assign(props, items.properties);
    }

    current = props[part] ?? null;
  }

  return current;
}

// =============================================================================
// Step traversal utilities
// =============================================================================

/** Return the step list for an action or step node, handling both `steps` and `then` keys. */
export function getSteps(node) {
  return node?.steps || node?.then || [];
}

/** Return the branch map for a match/on step. */
export function getMatchBranches(step) {
  return step?.when || step?.on || {};
}

/** Return the body steps for a forEach step. */
export function getForEachBody(forEach) {
  return forEach?.do || forEach?.then || [];
}

/**
 * Recursively collect all emit.type values from a step list,
 * walking into if/else, match, and forEach branches.
 */
export function collectEmitSteps(steps) {
  const emits = [];
  for (const step of steps || []) {
    if (step.emit) {
      emits.push(step.emit.type);
    } else if (step.if !== undefined) {
      emits.push(...collectEmitSteps(getSteps(step)));
      emits.push(...collectEmitSteps(step.else || []));
    } else if (step.match !== undefined) {
      for (const branchSteps of Object.values(getMatchBranches(step))) {
        emits.push(...collectEmitSteps(branchSteps));
      }
    } else if (step.forEach) {
      emits.push(...collectEmitSteps(getForEachBody(step.forEach)));
    }
  }
  return emits;
}

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
