/**
 * Shared state machine transition logic.
 * Called by the HTTP transition handler and by the platform triggerTransition action.
 * Extracted so both paths use identical evaluation, mutation, and event emission.
 */

import { findById, update, create } from './database-manager.js';
import { findTransition, findOperation, evaluateGuards, applyEffects, applySteps } from './state-machine-engine.js';
import { updateSlaInfo } from './sla-engine.js';
import { processRuleEvaluations, resolveContextLayers } from './handlers/rule-evaluation.js';
import { emitEvent } from './emit-event.js';
import { mergeByPrecedence } from './collection-utils.js';
import { validate } from './validator.js';

/**
 * Execute a state machine transition programmatically.
 *
 * @param {Object} options
 * @param {string} options.resourceName     - DB collection name (e.g., "applications")
 * @param {string} options.resourceId       - UUID of the resource to transition
 * @param {string} options.trigger          - Transition trigger (e.g., "open")
 * @param {string} options.callerId         - Caller identity (use "system" for automated transitions)
 * @param {string[]} options.callerRoles    - Caller roles (e.g., ["system"])
 * @param {string} [options.now]            - ISO timestamp; defaults to current time
 * @param {Object} options.stateMachine     - State machine contract
 * @param {Array}  options.rules            - Rules from discoverRules()
 * @param {Array}  [options.slaTypes]       - SLA types from discoverSlaTypes()
 * @param {Object} [options.requestBody]     - Request body passed to effects as $request.*; empty for system transitions
 * @param {string} [options.traceparent]    - W3C traceparent for distributed tracing
 * @returns {{ success: boolean, result?: Object, status?: number, error?: string }}
 */
export function executeTransition({
  resourceName,
  resourceId,
  trigger,
  callerId,
  callerRoles,
  now,
  stateMachine,
  machine = null,
  rules,
  slaTypes = [],
  requestBody = {},
  traceparent = null
}) {
  const timestamp = now || new Date().toISOString();

  const resource = findById(resourceName, resourceId);
  if (!resource) {
    return { success: false, status: 404, error: `Resource not found: ${resourceId}` };
  }

  // New format: machine entry has operations; old format: stateMachine has transitions
  const isNewFormat = machine && Array.isArray(machine.operations);

  let actors, guardConditions, steps, transitionTo;

  if (isNewFormat) {
    const { operation, error } = findOperation(machine, trigger, resource);
    if (!operation) {
      return { success: false, status: 409, error };
    }
    actors = operation.guards?.actors || [];
    guardConditions = operation.guards?.conditions || [];
    steps = operation.then || [];
    transitionTo = operation.transition?.to ?? null;

    if (operation.requestBody) {
      const { valid, errors } = validate(requestBody, operation.requestBody, `operation-${trigger}`);
      if (!valid) {
        return { success: false, status: 422, error: 'Request body validation failed', details: errors };
      }
    }
  } else {
    const { transition, error } = findTransition(stateMachine, trigger, resource);
    if (!transition) {
      return { success: false, status: 409, error };
    }
    actors = transition.actors || [];
    guardConditions = transition.guards || [];
    steps = null;
    transitionTo = transition.to ?? null;
    // store for applyEffects below
    var legacyEffects = transition.effects;
  }

  if (actors.length > 0) {
    if (!callerRoles.some(r => actors.includes(r))) {
      return {
        success: false,
        status: 403,
        error: `Transition "${trigger}" requires one of: ${actors.join(', ')}`
      };
    }
  }

  const baseContext = {
    caller: { id: callerId, roles: callerRoles },
    object: { ...resource },
    request: requestBody,
    now: timestamp
  };

  const operationContext = isNewFormat
    ? (machine.operations || []).find(op => op.name === trigger)?.context
    : null;

  const entities = resolveContextLayers(
    [stateMachine.context, machine?.context, operationContext],
    resource,
    baseContext
  );
  if (entities === null) {
    return { success: false, status: 409, error: `Context binding failed for operation "${trigger}"` };
  }
  const context = { ...baseContext, entities };

  const guardsMap = Object.fromEntries(
    [...(stateMachine.guards || []), ...(machine?.guards || [])].map(g => [g.id, g])
  );
  const guardResult = evaluateGuards(guardConditions, guardsMap, resource, context);
  if (!guardResult.pass) {
    return {
      success: false,
      status: 409,
      error: `Guard "${guardResult.failedGuard}" failed: ${guardResult.reason}`
    };
  }

  const updated = { ...resource };
  if (resource.slaInfo) updated.slaInfo = resource.slaInfo.map(e => ({ ...e }));

  const { pendingCreates, pendingOperations, pendingAppends, pendingRuleEvaluations, pendingEvents } = isNewFormat
    ? applySteps(steps, updated, context)
    : { ...applyEffects(legacyEffects, updated, context), pendingOperations: [], pendingAppends: [] };

  if (transitionTo != null && transitionTo !== '') {
    updated.status = transitionTo;
  }

  if (slaTypes.length > 0 && updated.slaInfo?.length > 0) {
    updateSlaInfo(updated, slaTypes, timestamp, stateMachine.states || {});
  }

  const inlineRules = mergeByPrecedence(stateMachine.rules, machine?.rules);
  processRuleEvaluations(pendingRuleEvaluations, updated, rules, stateMachine.domain, inlineRules, context);

  const diff = {};
  for (const [key, value] of Object.entries(updated)) {
    if (resource[key] !== value) diff[key] = value;
  }
  const result = update(resourceName, resourceId, diff);

  for (const { entity, data } of pendingCreates) {
    try { create(entity, data); }
    catch (e) { console.error(`Failed to create ${entity}:`, e.message); }
  }

  const domain = stateMachine.domain;
  const object = (machine?.object || stateMachine.object).toLowerCase();
  for (const event of pendingEvents) {
    try {
      emitEvent({
        domain,
        object,
        action: event.action,
        resourceId: resource.id,
        source: `/${domain}`,
        data: event.data || null,
        callerId,
        traceparent,
        now: timestamp
      });
    } catch (e) {
      console.error(`Failed to emit event "${event.action}":`, e.message);
    }
  }

  return { success: true, result };
}
