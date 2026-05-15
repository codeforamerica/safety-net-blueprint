/**
 * Shared helper for executing inline procedures (steps).
 * Used by transition handler, create handler, update handler, and event subscriptions.
 */

import jsonLogic from 'json-logic-js';
import { create, update, findAll, findById } from '../database-manager.js';
import { deriveCollectionName } from '../collection-utils.js';
import { applySteps, resolveValue } from '../state-machine-engine.js';

/**
 * Resolve a dot-notation path against an object.
 */
function resolveDotPath(obj, path) {
  if (obj == null || !path) return null;
  return path.split('.').reduce((cur, key) => (cur == null ? null : cur[key]), obj) ?? null;
}

/**
 * Resolve a where clause value expression against the current resolution context.
 * Supports: $object.field, $this.field, $alias.field, literal strings.
 */
function resolveWhereValue(val, resource, context, resolved) {
  if (typeof val !== 'string') return val;
  if (val.startsWith('$object.')) return resource[val.slice('$object.'.length)];
  if (val.startsWith('$this.')) return resolveDotPath(context?.this, val.slice('$this.'.length));
  if (val.startsWith('$') && val.includes('.')) {
    const dot = val.indexOf('.');
    return resolveDotPath(resolved[val.slice(1, dot)], val.slice(dot + 1));
  }
  return val;
}

/**
 * Resolve context bindings from a state machine procedure's `context:` array.
 * Each item is { alias: { from, where? } }.
 *
 * RETURN TYPE — single entity vs. array:
 *   where: { id: <value> }           → single entity (findById); null if not found
 *   where: { otherField: <value> }   → array of all matching records (may be empty)
 *   JSON Logic where:                → array of all records passing the condition
 *   (no where)                       → binding is skipped with a warning; alias resolves to null
 *
 * WHERE CLAUSE — two supported forms:
 *
 *   (1) Field-value equality pairs. Values may be:
 *         $object.field  → field on the primary resource being evaluated
 *         $this.field    → field on the triggering event/context (nested dot paths ok)
 *         $alias.field   → field on a previously resolved binding (chaining)
 *         literal string → exact match value
 *
 *   (2) JSON Logic expression — evaluated per-candidate record; matching records are
 *       collected into an array. Variable references:
 *         { var: "fieldName" }        → field on the candidate record
 *         { var: "this.field" }       → field on the triggering event/context
 *         { var: "alias.field" }      → field on a previously resolved binding
 *
 * Bindings are resolved in order; each binding may reference previously resolved aliases.
 * A binding that finds no record resolves to null.
 *
 * @param {Array} contextBindings - Array of single-key objects { alias: { from, where } }
 * @param {Object} resource - Primary resource for $object.field resolution
 * @param {Object} [context] - Step context for $this.field and previously resolved alias resolution
 * @returns {Object} Map of alias → entity|array|null
 */
function resolveContextBindings(contextBindings, resource, context) {
  const resolved = {};

  for (const binding of contextBindings || []) {
    const alias = Object.keys(binding)[0];
    const config = binding[alias];
    if (!config || !config.from) continue;

    const collection = deriveCollectionName(config.from, config.from.split('/')[0]);
    const where = config.where;

    if (!where) {
      console.warn(`Context binding "${alias}": no where clause — skipping binding`);
      resolved[alias] = null;
      continue;
    }

    const logicOperators = new Set(['==', '!=', '>', '>=', '<', '<=', 'and', 'or', 'not', 'in', '!', 'if', 'var', 'missing', 'all', 'none', 'some', 'merge', 'cat', 'substr', 'log']);
    const isJsonLogic = Object.keys(where).some(k => logicOperators.has(k));

    if (isJsonLogic) {
      const { items: allItems } = findAll(collection, {});
      const logicData = {
        this: context?.this ?? {},
        object: resource,
        ...Object.fromEntries(Object.entries(resolved))
      };
      const entity = allItems.find(item => {
        try {
          return jsonLogic.apply(where, { ...logicData, ...item });
        } catch (e) {
          console.warn(`Context binding "${alias}": JSON Logic where filter error — ${e.message}`);
          return false;
        }
      }) ?? null;

      resolved[alias] = entity;
      continue;
    }

    const query = {};
    for (const [field, val] of Object.entries(where)) {
      query[field] = resolveWhereValue(val, resource, context, resolved);
    }

    const hasUndefinedValue = Object.values(query).some(v => v === undefined);
    if (hasUndefinedValue) {
      resolved[alias] = null;
      continue;
    }

    if (query.id) {
      resolved[alias] = findById(collection, query.id) ?? null;
    } else {
      const { items } = findAll(collection, query, { limit: 1 });
      resolved[alias] = items.length > 0 ? items[0] : null;
    }
  }

  return resolved;
}

/**
 * Resolve context bindings across multiple scope levels in declaration order.
 * Domain → machine → trigger/operation. Each layer can reference aliases resolved
 * by prior layers (chaining across levels). Inner scope wins on name conflict.
 *
 * Returns null if any required binding in any layer fails — the caller should
 * skip the trigger or operation.
 *
 * @param {Array<Array|null|undefined>} layers - Binding arrays in scope order (outermost first)
 * @param {Object} resource - Primary resource for $object.* resolution
 * @param {Object} baseContext - Base step context (caller, this, now, existing entities)
 * @returns {Object|null} Merged entities map, or null if a required binding failed
 */
export function resolveContextLayers(layers, resource, baseContext) {
  let entities = { ...(baseContext.entities || {}) };
  for (const bindings of layers) {
    if (!bindings || bindings.length === 0) continue;
    const layerContext = { ...baseContext, entities };
    const resolved = resolveContextBindings(bindings, resource, layerContext);
    Object.assign(entities, resolved);
  }
  return entities;
}

/**
 * Apply a pending array-append (PATCH with $push body) to a resource in the database.
 */
function applyPendingAppend({ path, body }) {
  const parts = path.split('/');
  const id = parts.pop();
  const collectionPath = parts.join('/');
  const domain = parts[0];
  const collection = deriveCollectionName(collectionPath, domain);

  const existing = findById(collection, id);
  if (!existing) {
    console.error(`applyPendingAppend: ${collection}/${id} not found`);
    return;
  }

  const patch = {};
  for (const [field, val] of Object.entries(body || {})) {
    if (val && typeof val === 'object' && '$push' in val) {
      const currentArr = Array.isArray(existing[field]) ? existing[field] : [];
      patch[field] = [...currentArr, val['$push']];
    } else {
      patch[field] = val;
    }
  }

  update(collection, id, patch);
}

/**
 * Return true if a procedure object carries a step key directly (single-step inline form).
 */
function hasProcedureStepKey(proc) {
  return proc.call !== undefined || proc.set !== undefined || proc.emit !== undefined ||
         proc.if !== undefined || proc.match !== undefined || proc.forEach !== undefined;
}

/**
 * Build the CEL/JS evaluation context from a step context.
 */
function buildEvalCtx(context) {
  return {
    caller: context.caller || {},
    object: context.object || {},
    request: context.request || {},
    params: context.params || {},
    ...Object.fromEntries(
      Object.entries(context.entities || {}).map(([k, v]) => [`$${k}`, v])
    ),
    $caller: context.caller || {},
    $object: context.object || {},
    $request: context.request || {},
    $this: context.this || {},
    $params: context.params || {},
    $now: context.now || new Date().toISOString(),
  };
}

/**
 * Resolve a single with: argument value against a step context.
 */
function resolveWithArgValue(val, context) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object' && !Array.isArray(val)) {
    const result = {};
    for (const [k, v] of Object.entries(val)) result[k] = resolveWithArgValue(v, context);
    return result;
  }
  if (typeof val !== 'string') return val;

  if (/^\$[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_.]*)?$/.test(val) || val === '$now') {
    return resolveValue(val, context);
  }

  if (val.includes('$') || val.startsWith('"') || val.includes(' + ')) {
    try {
      const ctx = buildEvalCtx(context);
      const fn = new Function(...Object.keys(ctx), `return (${val});`);
      return fn(...Object.values(ctx));
    } catch (e) {
      console.warn(`resolveWithArgValue: expression "${val}" failed — ${e.message}`);
    }
  }

  return val;
}

/**
 * Resolve all with: arguments against the current step context.
 */
function resolveWithArgs(withArgs, context) {
  if (!withArgs) return {};
  const params = {};
  for (const [key, val] of Object.entries(withArgs)) {
    if (key === '$merge') {
      const merged = resolveWithArgValue(val, context);
      if (merged && typeof merged === 'object' && !Array.isArray(merged)) {
        Object.assign(params, merged);
      }
    } else {
      params[key] = resolveWithArgValue(val, context);
    }
  }
  return params;
}

/**
 * Execute a named inline procedure from a state machine's procedures/rules block.
 *
 * @param {string} procedureId - The procedure id to find
 * @param {Array} inlineProcedures - Combined procedures from the state machine
 * @param {Object} resource - Resource to mutate in place
 * @param {Object} context - State machine context
 * @returns {{ operations: Array, events: Array }}
 */
function executeProcedure(procedureId, inlineProcedures, resource, context) {
  const proc = (inlineProcedures || []).find(r => r.id === procedureId);
  if (!proc) {
    console.warn(`Procedure "${procedureId}" not found in state machine`);
    return { operations: [], events: [] };
  }

  const entities = resolveContextBindings(proc.context, resource, context);
  if (entities === null) return { operations: [], events: [] };

  const stepContext = { ...context, entities: { ...(context.entities || {}), ...entities } };
  const allPendingOperations = [];

  if (proc.steps !== undefined || hasProcedureStepKey(proc)) {
    const steps = proc.steps != null ? proc.steps : [proc];
    const { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents } =
      applySteps(steps, resource, stepContext);

    const allPendingEvents = [...(pendingEvents || [])];

    for (const { entity, data: createData } of pendingCreates) {
      try {
        create(entity, createData);
      } catch (e) {
        console.error(`Procedure "${procedureId}": create "${entity}" failed: ${e.message}`);
      }
    }

    for (const append of pendingAppends) {
      applyPendingAppend(append);
    }

    allPendingOperations.push(...pendingOperations);

    if (pendingProcedures.length > 0) {
      const { pendingOperations: nestedOps, pendingEvents: nestedEvents } = executeProcedures(
        pendingProcedures, resource, inlineProcedures, stepContext
      );
      allPendingOperations.push(...(nestedOps || []));
      allPendingEvents.push(...(nestedEvents || []));
    }

    return { operations: allPendingOperations, events: allPendingEvents };
  }

  // conditions array format (JSON Logic) — for procedures defined with conditions:
  const data = { '$object': { ...resource } };
  for (const [alias, entity] of Object.entries(entities)) {
    data[`$${alias}`] = entity;
  }

  const conditions = [...(proc.conditions || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const allPendingEvents = [];

  for (const cond of conditions) {
    let matches = false;
    try {
      matches = cond.condition === true || jsonLogic.apply(cond.condition, data);
    } catch (e) {
      console.warn(`Procedure "${procedureId}" condition "${cond.id}" evaluation error: ${e.message}`);
      continue;
    }

    if (matches) {
      const { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents } =
        applySteps(cond.then || [], resource, stepContext);

      for (const { entity, data: createData } of pendingCreates) {
        try {
          create(entity, createData);
        } catch (e) {
          console.error(`executeProcedure: create "${entity}" failed: ${e.message}`);
        }
      }

      for (const append of pendingAppends) {
        applyPendingAppend(append);
      }

      allPendingOperations.push(...pendingOperations);
      allPendingEvents.push(...(pendingEvents || []));

      if (pendingProcedures.length > 0) {
        const { pendingOperations: nestedOps, pendingEvents: nestedEvents } = executeProcedures(
          pendingProcedures, resource, inlineProcedures, stepContext
        );
        allPendingOperations.push(...(nestedOps || []));
        allPendingEvents.push(...(nestedEvents || []));
      }

      if (proc.evaluation !== 'all-match') break;
    }
  }

  return { operations: allPendingOperations, events: allPendingEvents };
}

/**
 * Execute pending procedures against a resource.
 *
 * @param {Array<{ procedureId?: string, with?: Object }>} pendingProcedures
 * @param {Object} resource - Resource to mutate
 * @param {Array} [inlineProcedures] - Inline procedures from the state machine
 * @param {Object} [context] - State machine context
 * @returns {{ pendingOperations: Array, pendingEvents: Array }}
 */
export function executeProcedures(pendingProcedures, resource, inlineProcedures = [], context = null) {
  const allPendingOperations = [];
  const allPendingEvents = [];
  if (!pendingProcedures || pendingProcedures.length === 0) {
    return { pendingOperations: allPendingOperations, pendingEvents: allPendingEvents };
  }

  const stepContext = context ?? {
    caller: { id: 'system', roles: [] },
    object: { ...resource },
    request: {},
    now: new Date().toISOString()
  };

  for (const item of pendingProcedures) {
    const { procedureId } = item;
    if (!procedureId) continue;

    let callContext = stepContext;
    if (item.with && Object.keys(item.with).length > 0) {
      const resolvedParams = resolveWithArgs(item.with, stepContext);
      callContext = { ...stepContext, params: { ...(stepContext.params || {}), ...resolvedParams } };
    }
    const { operations: ops, events: evts } = executeProcedure(procedureId, inlineProcedures, resource, callContext);
    allPendingOperations.push(...(ops || []));
    allPendingEvents.push(...(evts || []));
  }

  return { pendingOperations: allPendingOperations, pendingEvents: allPendingEvents };
}
