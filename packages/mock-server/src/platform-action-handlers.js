/**
 * Platform-level action handlers — generic, available to all domains.
 * These actions create resources and trigger state machine transitions;
 * they are not specific to any one domain's rules.
 */

import jsonLogic from 'json-logic-js';
import { deriveCollectionName } from './collection-utils.js';
import { emitEventEnvelope, CLOUDEVENTS_TYPE_PREFIX } from './emit-event.js';
import { matchAndPop } from './mock-stub-engine.js';

/**
 * Create a new resource in the specified domain/collection.
 * Field values may be literals or JSON Logic expressions resolved against the
 * current rule context (e.g., { var: "this.subject" } to use the event subject).
 *
 * After creation, runs the entity's state machine onCreate pipeline (initial state
 * + rule evaluations) using the same machinery as the HTTP create handler.
 *
 * @param {Object} actionValue - { entity: "domain/collection", fields: { ... } }
 * @param {Object} resource    - The current "this" context (event envelope or calling resource)
 * @param {Object} deps        - {
 *   context,           // full rule evaluation context for JSON Logic resolution
 *   dbCreate,          // function(collection, fields) → created
 *   dbUpdate,          // function(collection, id, diff)
 *   findStateMachine,  // function(entity) → stateMachine | null
 *   applyEffects,      // function(effects, resource, context) → { pendingRuleEvaluations, ... }
 *   processRuleEvaluations,  // function(pending, resource, rules, domain)
 *   allRules,
 *   allSlaTypes,
 *   emitCreatedEvent   // function(domain, collectionName, resource, callerId)
 * }
 */
function createResource(actionValue, resource, deps) {
  const { entity, fields } = actionValue || {};
  if (!entity || !fields) {
    console.error('createResource: missing required fields "entity" or "fields"');
    return;
  }

  const domainName = entity.split('/')[0];
  const collectionName = deriveCollectionName(entity, domainName);

  // Resolve field values — literals pass through; objects are JSON Logic expressions
  const resolvedFields = {};
  const ctx = deps.context || {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      resolvedFields[key] = jsonLogic.apply(value, ctx);
    } else {
      resolvedFields[key] = value;
    }
  }

  const created = deps.dbCreate(collectionName, resolvedFields);

  // Apply state machine onCreate pipeline if one exists for this entity
  const stateMachine = deps.findStateMachine?.(entity);
  if (stateMachine) {
    // Apply initial state
    if (stateMachine.initialState) {
      created.status = stateMachine.initialState;
      deps.dbUpdate(collectionName, created.id, { status: stateMachine.initialState });
    }

    // Run onCreate effects (evaluate-rules, etc.) using existing applyEffects machinery
    if (stateMachine.onCreate?.effects?.length > 0) {
      const onCreateContext = {
        caller: { id: 'system', roles: ['system'] },
        object: { ...created },
        request: {},
        now: new Date().toISOString()
      };
      const original = JSON.parse(JSON.stringify(created));
      const { pendingRuleEvaluations } = deps.applyEffects(
        stateMachine.onCreate.effects,
        created,
        onCreateContext
      );

      if (pendingRuleEvaluations.length > 0) {
        deps.processRuleEvaluations(pendingRuleEvaluations, created, deps.allRules, domainName);
      }

      // Persist rule-driven mutations
      const diff = {};
      for (const [key, value] of Object.entries(created)) {
        if (original[key] !== value && key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
          diff[key] = value;
        }
      }
      if (Object.keys(diff).length > 0) {
        deps.dbUpdate(collectionName, created.id, diff);
        Object.assign(created, diff);
      }
    }
  }

  // Emit created event so downstream systems can observe the new resource
  deps.emitCreatedEvent?.(domainName, collectionName, created);

  return created;
}

/**
 * Trigger a state machine transition on a related entity.
 * The entity ID is resolved from the current rule context using the idFrom dot-path.
 *
 * @param {Object} actionValue - { entity: "domain/collection", idFrom: "dot.path", transition: "trigger" }
 * @param {Object} resource    - The current "this" context
 * @param {Object} deps        - {
 *   context,           // full rule evaluation context for idFrom resolution
 *   resolvePath,       // function(obj, path) → value
 *   findStateMachine,  // function(entity) → stateMachine | null
 *   executeTransition, // function(options) → { success, result, error }
 *   allRules,
 *   allSlaTypes
 * }
 */
function triggerTransition(actionValue, resource, deps) {
  const { entity, idFrom, transition } = actionValue || {};
  if (!entity || !idFrom || !transition) {
    console.error('triggerTransition: missing required fields "entity", "idFrom", or "transition"');
    return;
  }

  const entityId = deps.resolvePath?.(deps.context || {}, idFrom);
  if (!entityId) {
    console.error(`triggerTransition: "${idFrom}" resolved to no value in rule context`);
    return;
  }

  const stateMachine = deps.findStateMachine?.(entity);
  if (!stateMachine) {
    console.error(`triggerTransition: no state machine found for entity "${entity}"`);
    return;
  }

  const collectionName = deriveCollectionName(entity, entity.split('/')[0]);

  const { success, error } = deps.executeTransition({
    resourceName: collectionName,
    resourceId: entityId,
    trigger: transition,
    callerId: 'system',
    callerRoles: ['system'],
    stateMachine,
    rules: deps.allRules || [],
    slaTypes: deps.allSlaTypes || []
  });

  if (!success) {
    console.error(`triggerTransition: "${transition}" on ${entity}/${entityId} failed — ${error}`);
  }
}

/**
 * Append a value to an array field on an existing resource.
 * If the field doesn't exist yet, initializes it as a single-element array.
 *
 * @param {Object} actionValue - { entity: "domain/collection", idFrom: "dot.path", field: "fieldName", value: literal|jsonLogic }
 * @param {Object} resource    - The current "this" context
 * @param {Object} deps        - { context, resolvePath, dbFindById, dbUpdate }
 */
function appendToArray(actionValue, resource, deps) {
  const { entity, idFrom, field, value } = actionValue || {};
  if (!entity || !idFrom || !field || value === undefined) {
    console.error('appendToArray: missing required fields "entity", "idFrom", "field", or "value"');
    return;
  }

  const collectionName = deriveCollectionName(entity, entity.split('/')[0]);
  const entityId = deps.resolvePath?.(deps.context || {}, idFrom);
  if (!entityId) {
    console.error(`appendToArray: "${idFrom}" resolved to no value in rule context`);
    return;
  }

  const existing = deps.dbFindById?.(collectionName, entityId);
  if (!existing) {
    console.error(`appendToArray: ${entity}/${entityId} not found`);
    return;
  }

  const resolvedValue = (value !== null && typeof value === 'object' && !Array.isArray(value))
    ? jsonLogic.apply(value, deps.context || {})
    : value;

  const currentArray = Array.isArray(existing[field]) ? existing[field] : [];
  deps.dbUpdate(collectionName, entityId, { [field]: [...currentArray, resolvedValue] });
}

/**
 * Iterate over a collection and execute an inner action for each item that
 * satisfies an optional filter condition. The item is bound to `as` in the
 * rule context for both the filter and the inner action's field resolution.
 *
 * @param {Object} actionValue - { in: <JSON Logic>, as: string, filter?: <JSON Logic>,
 *                                  createResource?: {...}, triggerTransition?: {...} }
 * @param {Object} resource    - The current "this" context
 * @param {Object} deps        - Same deps as createResource/triggerTransition
 */
function forEach(actionValue, resource, deps) {
  const { in: inExpr, as: alias, filter, createResource: crValue, triggerTransition: ttValue } = actionValue || {};

  if (!inExpr || !alias) {
    console.error('forEach: missing required fields "in" or "as"');
    return;
  }

  if (!crValue && !ttValue) {
    console.error('forEach: missing inner action (createResource or triggerTransition)');
    return;
  }

  // Resolve the collection from the rule context
  const ctx = deps.context || {};
  let collection;
  try {
    collection = jsonLogic.apply(inExpr, ctx);
  } catch (err) {
    console.error(`forEach: failed to resolve "in" expression: ${err.message}`);
    return;
  }

  if (!Array.isArray(collection)) {
    console.warn(`forEach: "in" expression resolved to a non-array value — skipping`);
    return;
  }

  for (const item of collection) {
    // Bind the item to the alias in the context for filter and field resolution
    const itemCtx = { ...ctx, [alias]: item };

    // Apply per-item filter if present
    if (filter !== undefined) {
      let matches;
      try {
        matches = jsonLogic.apply(filter, itemCtx);
      } catch (err) {
        console.warn(`forEach: filter evaluation failed for item: ${err.message}`);
        continue;
      }
      if (!matches) continue;
    }

    // Execute the inner action with item-scoped context
    const itemDeps = { ...deps, context: itemCtx };
    if (crValue) {
      createResource(crValue, resource, itemDeps);
    } else if (ttValue) {
      triggerTransition(ttValue, resource, itemDeps);
    }
  }
}

/**
 * Fire an arbitrary outbound event from a rule action.
 * Allows rules to emit domain events directly without requiring a state machine
 * transition as intermediary — needed for cross-domain fanout.
 *
 * Field values in `data` may be literals or JSON Logic expressions resolved
 * against the current rule context. `subject` and `source` follow the same pattern.
 *
 * @param {Object} actionValue - {
 *   type: string,              // short event type suffix (e.g., "data_exchange.call.completed")
 *   subject?: literal|logic,   // CloudEvents subject (resource ID)
 *   source?: literal|logic,    // CloudEvents source (defaults to "/system")
 *   data?: { key: literal|logic, ... }  // event payload; each value resolved individually
 * }
 * @param {Object} resource - The current "this" context
 * @param {Object} deps     - { context }
 */
function fireEvent(actionValue, resource, deps) {
  const { type, subject, source, data } = actionValue || {};
  if (!type) {
    console.error('fireEvent: missing required field "type"');
    return;
  }

  const ctx = deps.context || {};

  const resolveValue = (v) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return jsonLogic.apply(v, ctx);
    }
    return v;
  };

  const resolvedSubject = subject !== undefined ? resolveValue(subject) : null;
  const resolvedSource = source !== undefined ? resolveValue(source) : null;

  let resolvedData = null;
  if (data !== null && data !== undefined && typeof data === 'object' && !Array.isArray(data)) {
    resolvedData = {};
    for (const [k, v] of Object.entries(data)) {
      resolvedData[k] = resolveValue(v);
    }
  }

  const fullType = type.startsWith(CLOUDEVENTS_TYPE_PREFIX) ? type : CLOUDEVENTS_TYPE_PREFIX + type;

  emitEventEnvelope({
    type: fullType,
    source: resolvedSource || '/system',
    subject: resolvedSubject,
    data: resolvedData
  });
}

/**
 * Check the stub registry for a pre-programmed response to the current event.
 * If a matching stub is found it is popped (consumed) and its respond event is
 * fired. If no stub matches, the `fallback` action (typically a fireEvent) is
 * executed instead.
 *
 * Only meaningful in event-triggered rule sets — `resource` is the event
 * envelope, which provides both the type for stub matching and the context for
 * JSON Logic resolution in respond field values.
 *
 * @param {Object} actionValue - { fallback?: { fireEvent: {...} } }
 * @param {Object} resource    - The current event envelope ("this" context)
 * @param {Object} deps        - { context }
 */
function applyStub(actionValue, resource, deps) {
  const eventType = resource?.type;
  if (!eventType) {
    console.warn('applyStub: no event type on resource — skipping stub lookup');
    return;
  }

  const stub = matchAndPop(eventType, resource);

  if (stub) {
    const ctx = deps.context || {};
    const resolveValue = (v) => {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return jsonLogic.apply(v, ctx);
      }
      return v;
    };

    const { type, subject, source, data: stubData } = stub.respond;
    const fullType = type.startsWith(CLOUDEVENTS_TYPE_PREFIX) ? type : CLOUDEVENTS_TYPE_PREFIX + type;

    // Subject: use stub's explicit value, or echo trigger's subject.
    const resolvedSubject = subject !== undefined ? resolveValue(subject) : resource.subject;

    // Build response data using the payload schema for the response event type.
    // For each schema field: match by name from trigger data, or derive from
    // the trigger event's entity name for *Id fields (e.g. serviceCallId → subject).
    // Stub's explicit data fields override anything derived from the schema.
    const schema = deps.eventSchemas?.[fullType];
    const triggerData = (resource.data && typeof resource.data === 'object') ? resource.data : {};
    const resolvedStubData = {};
    if (stubData && typeof stubData === 'object' && !Array.isArray(stubData)) {
      for (const [k, v] of Object.entries(stubData)) {
        resolvedStubData[k] = resolveValue(v);
      }
    }

    let resolvedData = null;
    if (schema?.properties) {
      // Derive entity name from trigger event type for *Id field resolution.
      // "org...data_exchange.service_call.created" → "service_call" → "serviceCall"
      const shortType = resource.type?.startsWith(CLOUDEVENTS_TYPE_PREFIX)
        ? resource.type.slice(CLOUDEVENTS_TYPE_PREFIX.length)
        : (resource.type || '');
      const parts = shortType.split('.');
      const entitySnake = parts.length >= 2 ? parts[parts.length - 2] : '';
      const entityCamel = entitySnake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const entityIdField = entityCamel ? entityCamel + 'Id' : null;

      resolvedData = {};
      for (const field of Object.keys(schema.properties)) {
        if (field in resolvedStubData) {
          resolvedData[field] = resolvedStubData[field];
        } else if (field in triggerData) {
          resolvedData[field] = triggerData[field];
        } else if (entityIdField && field === entityIdField) {
          // e.g. serviceCallId → trigger subject (the resource's own ID)
          resolvedData[field] = triggerData.id ?? resource.subject;
        }
        // Fields not derivable are omitted; stub must specify them explicitly.
      }
      // Include any stub-specified fields not in the schema (extra context, overrides).
      for (const [k, v] of Object.entries(resolvedStubData)) {
        if (!(k in resolvedData)) resolvedData[k] = v;
      }
    } else {
      // No schema available — fall back to stub data only.
      resolvedData = Object.keys(resolvedStubData).length > 0 ? resolvedStubData : null;
    }

    emitEventEnvelope({
      type: fullType,
      source: source ? resolveValue(source) : '/system',
      subject: resolvedSubject,
      data: resolvedData
    });

    console.log(`[stub] matched ${stub.id} → fired ${fullType}`);
  } else {
    // No stub matched — execute the fallback action if provided
    const { fallback } = actionValue || {};
    if (fallback?.fireEvent) {
      fireEvent(fallback.fireEvent, resource, deps);
    } else if (fallback) {
      console.warn('applyStub: fallback action type not supported — only fireEvent is currently implemented');
    }
  }
}

export const platformActionRegistry = new Map([
  ['applyStub', applyStub],
  ['appendToArray', appendToArray],
  ['createResource', createResource],
  ['fireEvent', fireEvent],
  ['forEach', forEach],
  ['triggerTransition', triggerTransition],
]);
