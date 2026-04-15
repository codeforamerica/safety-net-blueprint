/**
 * Platform-level action handlers — generic, available to all domains.
 * These actions create resources and trigger state machine transitions;
 * they are not specific to any one domain's rules.
 */

import jsonLogic from 'json-logic-js';

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

  const parts = entity.split('/');
  const domainName = parts[0];
  const collectionName = parts[1];

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

  const collectionName = entity.split('/')[1];

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

export const platformActionRegistry = new Map([
  ['createResource', createResource],
  ['triggerTransition', triggerTransition]
]);
