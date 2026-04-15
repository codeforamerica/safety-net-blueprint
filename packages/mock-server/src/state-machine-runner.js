/**
 * Shared state machine transition logic.
 * Called by the HTTP transition handler and by the platform triggerTransition action.
 * Extracted so both paths use identical evaluation, mutation, and event emission.
 */

import { findById, update, create } from './database-manager.js';
import { findTransition, evaluateGuards, applyEffects } from './state-machine-engine.js';
import { updateSlaInfo } from './sla-engine.js';
import { processRuleEvaluations } from './handlers/rule-evaluation.js';
import { emitEvent } from './emit-event.js';

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

  const { transition, error } = findTransition(stateMachine, trigger, resource);
  if (!transition) {
    return { success: false, status: 409, error };
  }

  if (transition.actors?.length > 0) {
    if (!callerRoles.some(r => transition.actors.includes(r))) {
      return {
        success: false,
        status: 403,
        error: `Transition "${trigger}" requires one of: ${transition.actors.join(', ')}`
      };
    }
  }

  const context = {
    caller: { id: callerId, roles: callerRoles },
    object: { ...resource },
    request: requestBody,
    now: timestamp
  };

  const guardsMap = Object.fromEntries((stateMachine.guards || []).map(g => [g.id, g]));
  const guardResult = evaluateGuards(transition.guards, guardsMap, resource, context);
  if (!guardResult.pass) {
    return {
      success: false,
      status: 409,
      error: `Guard "${guardResult.failedGuard}" failed: ${guardResult.reason}`
    };
  }

  const updated = { ...resource };
  if (resource.slaInfo) updated.slaInfo = resource.slaInfo.map(e => ({ ...e }));

  const { pendingCreates, pendingRuleEvaluations, pendingEvents } = applyEffects(
    transition.effects,
    updated,
    context
  );

  if (transition.to != null && transition.to !== '') {
    updated.status = transition.to;
  }

  if (slaTypes.length > 0 && updated.slaInfo?.length > 0) {
    updateSlaInfo(updated, slaTypes, timestamp, stateMachine.states || {});
  }

  processRuleEvaluations(pendingRuleEvaluations, updated, rules, stateMachine.domain);

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
  const object = stateMachine.object.toLowerCase();
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
