/**
 * Shared helper for executing inline procedures (steps).
 * Used by transition handler, create handler, update handler, and event subscriptions.
 */

import jsonLogic from 'json-logic-js';
import { deriveCollectionName, resolveDotPath } from '../collection-utils.js';
import { applySteps, applyStepsWithCalls, fillValue, whenReady, caughtEntities } from '../state-machine-engine.js';
import { emitEvent } from '../emit-event.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { evaluateCEL } from '@codeforamerica/blueprint-core/cel';

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
    const alias = val.slice(1, dot);
    // Check current-layer resolved first; fall back to prior-layer entities for cross-layer refs
    const entity = resolved[alias] ?? context?.entities?.[alias];
    return resolveDotPath(entity, val.slice(dot + 1));
  }
  return val;
}

/**
 * Resolve context bindings from a state machine procedure's `context:` array.
 * Each item is { alias: { from, where? } }.
 *
 * RETURN TYPE — always one record, or null. A binding names one record; to work
 * with every match, a step uses forEach:, which takes the same from:/where:.
 *   where: { id: <value> }           → that record (findById)
 *   where: { otherField: <value> }   → the first record matching
 *   JSON Logic or CEL where:         → the first record the condition is true for
 *   (no where)                       → binding is skipped with a warning; alias resolves to null
 *
 * WHERE CLAUSE — three supported forms:
 *
 *   (1) Field-value equality pairs. Values may be:
 *         $object.field  → field on the primary resource being evaluated
 *         $this.field    → field on the triggering event/context (nested dot paths ok)
 *         $alias.field   → field on a previously resolved binding (chaining)
 *         literal string → exact match value
 *
 *   (2) JSON Logic expression — evaluated per candidate record. Variable references:
 *         { var: "fieldName" }        → field on the candidate record
 *         { var: "this.field" }       → field on the triggering event/context
 *         { var: "alias.field" }      → field on a previously resolved binding
 *
 *   (3) CEL expression — a string, evaluated per candidate record:
 *         item      → the candidate record
 *         object    → the primary resource
 *         request   → the request body
 *         this      → the triggering event/context
 *         alias     → a previously resolved binding
 *
 * Bindings are resolved in order; each binding may reference previously resolved aliases.
 * A binding that finds no record resolves to null.
 *
 * @param {Array} contextBindings - Array of single-key objects { alias: { from, where } }
 * @param {Object} resource - Primary resource for $object.field resolution
 * @param {Object} [context] - Step context for $this.field and previously resolved alias resolution
 * @returns {Object} Map of alias → entity|null
 */
function resolveContextBindings(contextBindings, resource, context, store) {
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

    if (typeof where === 'string') {
      const { items: candidates } = store.findAll(collection, {}, { limit: null });
      const scope = {
        ...(context?.entities ?? {}),
        ...resolved,
        object: resource,
        request: context?.request ?? {},
        this: context?.this ?? {},
      };
      const matches = (item) => {
        try {
          return evaluateCEL(where, { ...scope, item }) === true;
        } catch {
          return false; // A field the candidate does not have: not this record.
        }
      };
      resolved[alias] = candidates.find(matches) ?? null;
      continue;
    }

    const logicOperators = new Set(['==', '!=', '>', '>=', '<', '<=', 'and', 'or', 'not', 'in', '!', 'if', 'var', 'missing', 'all', 'none', 'some', 'merge', 'cat', 'substr', 'log']);
    const isJsonLogic = Object.keys(where).some(k => logicOperators.has(k));

    if (isJsonLogic) {
      const { items: allItems } = store.findAll(collection, {}, { limit: null });
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
      resolved[alias] = store.findById(collection, query.id) ?? null;
    } else {
      const { items } = store.findAll(collection, query, { limit: 1 });
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
export function resolveContextLayers(layers, resource, baseContext, store) {
  let entities = { ...(baseContext.entities || {}) };
  for (const bindings of layers) {
    if (!bindings || bindings.length === 0) continue;
    const layerContext = { ...baseContext, entities };
    const resolved = resolveContextBindings(bindings, resource, layerContext, store);
    Object.assign(entities, resolved);
  }
  return entities;
}

/**
 * Apply a pending array-append (PATCH with $push body) to a resource in the database.
 */
function applyPendingAppend({ path, body }, store) {
  const parts = path.split('/');
  const id = parts.pop();
  const collectionPath = parts.join('/');
  const domain = parts[0];
  const collection = deriveCollectionName(collectionPath, domain);

  const existing = store.findById(collection, id);
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

  store.update(collection, id, patch);
}

/**
 * Return true if a procedure object carries a step key directly (single-step inline form).
 */
function hasProcedureStepKey(proc) {
  return proc.call !== undefined || proc.set !== undefined || proc.emit !== undefined ||
         proc.if !== undefined || proc.match !== undefined || proc.forEach !== undefined;
}

/**
 * Resolve a single with: argument value against a step context. Objects are
 * resolved field by field.
 */
function resolveWithArgValue(val, context) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object' && !Array.isArray(val)) {
    const result = {};
    for (const [k, v] of Object.entries(val)) {
      const value = resolveWithArgValue(v, context);
      if (value !== undefined) result[k] = value;
    }
    return result;
  }
  // A value expression, a string with value expressions embedded in braces,
  // or a literal: filled in the same way as any step value, so one that
  // finds nothing is left out.
  return fillValue(val, context);
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
      const value = resolveWithArgValue(val, context);
      if (value !== undefined) params[key] = value;
    }
  }
  return params;
}

/**
 * Create the records a procedure's steps left to create, and make its appends.
 */
function applyPendingWrites(procedureId, { pendingCreates, pendingAppends }, store, perform = null) {
  for (const { entity, domain, eventObject, stubUrl, data: createData } of pendingCreates) {
    if (stubUrl) {
      const fullPath = domain ? `/${domain}${stubUrl}` : stubUrl;
      const httpStub = matchAndPopHttp('POST', fullPath);
      if (httpStub) {
        console.log(`[stub] matched ${httpStub.id} → intercepted POST ${fullPath}`);
        continue;
      }
    }
    try {
      const created = store.create(entity, createData);
      // Where a procedure runs for an action or a reaction, the record is
      // settled as one a step there creates: clocks started, created event sent.
      if (perform?.settleCreated && perform.settleCreated(`${domain}${stubUrl ?? ''}`, created)) continue;
      if (domain && eventObject) {
        emitEvent({
          store,
          domain,
          object: eventObject,
          action: 'created',
          resourceId: created.id,
          source: `/${domain}`,
          data: { ...created },
          callerId: 'system',
        });
      }
    } catch (e) {
      console.error(`Procedure "${procedureId}": create "${entity}" failed: ${e.message}`);
    }
  }

  for (const append of pendingAppends) {
    applyPendingAppend(append, store);
  }
}

/** Put a record back as it was, for a procedure whose call failed. */
function restore(resource, before) {
  for (const key of Object.keys(resource)) if (!(key in before)) delete resource[key];
  Object.assign(resource, before);
}

/**
 * Execute a named inline procedure from a state machine's procedures/rules block.
 *
 * A call to an operation in its steps is made where it stands, through
 * `perform`. One that fails ends the procedure as an action's does: what its
 * steps did is undone and its `catch:` runs instead — a procedure has no
 * transition, so `to:` is ignored there — and with none, the failure is
 * returned for whatever called the procedure. A failure ends only the
 * procedure it happens in, so a call that may fail for one item of many
 * belongs in a procedure called for each.
 *
 * @param {string} procedureId - The procedure id to find
 * @param {Array} inlineProcedures - Combined procedures from the state machine
 * @param {Object} resource - Resource to mutate in place
 * @param {Object} context - State machine context
 * @param {Object} store
 * @param {Function|null} [perform] - Makes a call to an operation (performerFor)
 * @returns {{ operations: Array, events: Array, failed?: Object }|Promise<{ operations: Array, events: Array, failed?: Object }>}
 */
function executeProcedure(procedureId, inlineProcedures, resource, context, store, perform = null) {
  const proc = (inlineProcedures || []).find(r => r.id === procedureId);
  if (!proc) {
    console.warn(`Procedure "${procedureId}" not found in state machine`);
    return { operations: [], events: [] };
  }

  const entities = resolveContextBindings(proc.context, resource, context, store);
  if (entities === null) return { operations: [], events: [] };

  const stepContext = { ...context, entities: { ...(context.entities || {}), ...entities } };

  if (proc.steps !== undefined || hasProcedureStepKey(proc)) {
    const steps = proc.steps != null ? proc.steps : [proc];
    const before = { ...resource };

    const finish = (applied, at) => {
      applyPendingWrites(procedureId, applied, store, perform);
      const operations = [...applied.pendingOperations];
      const events = [...(applied.pendingEvents || [])];
      if (applied.pendingProcedures.length === 0) return { operations, events };
      return whenReady(
        executeProcedures(applied.pendingProcedures, resource, inlineProcedures, at, store, perform),
        (nested) => ({
          operations: [...operations, ...(nested.pendingOperations || [])],
          events: [...events, ...(nested.pendingEvents || [])],
          ...(nested.failed ? { failed: nested.failed } : {}),
        }),
      );
    };

    return whenReady(applyStepsWithCalls(steps, resource, stepContext, store, perform), (applied) => {
      if (!applied.failed) return finish(applied, stepContext);
      const { step, outcome } = applied.failed;
      restore(resource, before);
      if (!step.catch) return { operations: [], events: [], failed: applied.failed };
      if (step.catch.to) {
        console.warn(`Procedure "${procedureId}": catch.to applies only to a transition — ignored`);
      }
      const failureContext = {
        ...stepContext,
        object: { ...before },
        entities: caughtEntities(step, outcome, stepContext.entities),
      };
      return whenReady(
        applyStepsWithCalls(step.catch.do ?? [], resource, failureContext, store, perform),
        (handled) => {
          if (!handled.failed) return finish(handled, failureContext);
          restore(resource, before);
          return { operations: [], events: [], failed: handled.failed };
        },
      );
    });
  }

  const allPendingOperations = [];
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
        applySteps(cond.then || [], resource, stepContext, store);

      for (const { entity, domain, eventObject, stubUrl, data: createData } of pendingCreates) {
        if (stubUrl) {
          const fullPath = domain ? `/${domain}${stubUrl}` : stubUrl;
          const httpStub = matchAndPopHttp('POST', fullPath);
          if (httpStub) {
            console.log(`[stub] matched ${httpStub.id} → intercepted POST ${fullPath}`);
            continue;
          }
        }
        try {
          const created = store.create(entity, createData);
          if (domain && eventObject) {
            emitEvent({
            store,
              domain,
              object: eventObject,
              action: 'created',
              resourceId: created.id,
              source: `/${domain}`,
              data: { ...created },
              callerId: 'system',
            });
          }
        } catch (e) {
          console.error(`executeProcedure: create "${entity}" failed: ${e.message}`);
        }
      }

      for (const append of pendingAppends) {
        applyPendingAppend(append, store);
      }

      allPendingOperations.push(...pendingOperations);
      allPendingEvents.push(...(pendingEvents || []));

      if (pendingProcedures.length > 0) {
        const { pendingOperations: nestedOps, pendingEvents: nestedEvents } = executeProcedures(
          pendingProcedures, resource, inlineProcedures, stepContext, store
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
 * Execute pending procedures against a resource, in order.
 *
 * Synchronous unless a procedure makes a call to an operation; then the rest
 * follow its outcome and a promise is returned. A failure no procedure
 * handled stops the rest and is returned as `failed`.
 *
 * @param {Array<{ procedureId?: string, with?: Object }>} pendingProcedures
 * @param {Object} resource - Resource to mutate
 * @param {Array} [inlineProcedures] - Inline procedures from the state machine
 * @param {Object} [context] - State machine context
 * @param {Object} [store]
 * @param {Function|null} [perform] - Makes a call to an operation (performerFor)
 * @returns {{ pendingOperations: Array, pendingEvents: Array, failed?: Object }|Promise<{ pendingOperations: Array, pendingEvents: Array, failed?: Object }>}
 */
export function executeProcedures(pendingProcedures, resource, inlineProcedures = [], context = null, store, perform = null) {
  const allPendingOperations = [];
  const allPendingEvents = [];
  const done = () => ({ pendingOperations: allPendingOperations, pendingEvents: allPendingEvents });
  if (!pendingProcedures || pendingProcedures.length === 0) return done();

  const stepContext = context ?? {
    caller: { id: 'system', roles: [] },
    object: { ...resource },
    request: {},
    now: new Date().toISOString()
  };

  const run = (index) => {
    for (let i = index; i < pendingProcedures.length; i++) {
      const item = pendingProcedures[i];
      const { procedureId } = item;
      if (!procedureId) continue;

      let callContext = stepContext;
      if (item.with && Object.keys(item.with).length > 0) {
        const resolvedParams = resolveWithArgs(item.with, item.at ?? stepContext);
        callContext = { ...stepContext, params: { ...(stepContext.params || {}), ...resolvedParams } };
      }
      const result = executeProcedure(procedureId, inlineProcedures, resource, callContext, store, perform);
      const collect = ({ operations: ops, events: evts, failed }) => {
        allPendingOperations.push(...(ops || []));
        allPendingEvents.push(...(evts || []));
        return failed;
      };
      if (result && typeof result.then === 'function') {
        return result.then((settled) => {
          const failed = collect(settled);
          return failed ? { ...done(), failed } : run(i + 1);
        });
      }
      const failed = collect(result);
      if (failed) return { ...done(), failed };
    }
    return done();
  };
  return run(0);
}
