/**
 * Shared state machine transition logic.
 * Called by the HTTP transition handler and by the platform triggerTransition action.
 * Extracted so both paths use identical evaluation, mutation, and event emission.
 */

import { findById, update, create } from './database-manager.js';
import { findOperation, evaluateGuards, applySteps } from './state-machine-engine.js';
import { updateSlaInfo } from './sla-engine.js';
import { executeProcedures, resolveContextLayers } from './handlers/procedure-runner.js';
import { emitEvent, emitEventEnvelope, CLOUDEVENTS_TYPE_PREFIX } from './emit-event.js';
import { mergeByPrecedence, buildInlineRules } from './collection-utils.js';
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
 * @param {Object} options.machine          - Machine entry (from stateMachine.machines[])
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
  machine,
  slaTypes = [],
  requestBody = {},
  traceparent = null
}) {
  const timestamp = now || new Date().toISOString();

  const resource = findById(resourceName, resourceId);
  if (!resource) {
    return { success: false, status: 404, error: `Resource not found: ${resourceId}` };
  }

  const found = findOperation(machine, trigger, resource);
  if (!found.operation) {
    return { success: false, status: 409, error: found.error };
  }
  const operation = found.operation;
  const guardItems = Array.isArray(operation.guards) ? operation.guards : [];
  const steps = operation.steps || [];
  const transitionTo = operation.transition?.to ?? null;

  const baseContext = {
    caller: { id: callerId, roles: callerRoles },
    object: { ...resource },
    request: requestBody,
    now: timestamp
  };

  const operationContext = (machine.actions || []).find(op => op.id === trigger)?.context;

  const entities = resolveContextLayers(
    [stateMachine.context, machine?.context, operationContext],
    resource,
    baseContext
  );
  if (entities === null) {
    return { success: false, status: 409, error: `Context binding failed for action "${trigger}"` };
  }
  const context = { ...baseContext, entities };

  // OR semantics: caller passes if ANY guard clause is satisfied.
  // Within a clause: actors AND conditions must both pass.
  if (guardItems.length > 0) {
    const guardsMap = Object.fromEntries(
      [...(stateMachine._platformGuards || []), ...(stateMachine.guards || []), ...(machine?.guards || [])].map(g => [g.id, g])
    );

    const allActors = guardItems.flatMap(g => g.actors || []);
    const callerHasAnyRole = allActors.length === 0 || callerRoles.some(r => allActors.includes(r));
    if (!callerHasAnyRole) {
      const uniqueActors = [...new Set(allActors)];
      return { success: false, status: 403, error: `Action "${trigger}" requires one of: ${uniqueActors.join(', ')}` };
    }

    const clausePassed = guardItems.some(g => {
      const clauseActors = g.actors || [];
      if (clauseActors.length > 0 && !callerRoles.some(r => clauseActors.includes(r))) return false;
      const clauseConditions = g.conditions || [];
      if (clauseConditions.length === 0) return true;
      return evaluateGuards(clauseConditions, guardsMap, resource, context).pass;
    });

    if (!clausePassed) {
      return { success: false, status: 409, error: `No guard clause passed for action "${trigger}"` };
    }
  }

  // Request body validation: runs after authorization (403) and guard checks (409)
  if (operation?.schema?.request) {
    const { valid, errors } = validate(requestBody, operation.schema.request, `${stateMachine.domain ?? 'unknown'}-${machine?.object ?? 'unknown'}-operation-${trigger}`);
    if (!valid) {
      return { success: false, status: 422, error: 'Request body validation failed', details: errors };
    }
  }

  const updated = { ...resource };
  if (resource.slaInfo) updated.slaInfo = resource.slaInfo.map(e => ({ ...e }));

  const { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents } =
    applySteps(steps, updated, context);

  if (transitionTo != null && transitionTo !== '') {
    updated.status = transitionTo;
  }

  if (slaTypes.length > 0 && updated.slaInfo?.length > 0) {
    updateSlaInfo(updated, slaTypes, timestamp, stateMachine.states || {});
  }

  const inlineRules = buildInlineRules(stateMachine, machine);
  const { pendingEvents: ruleEvents } = executeProcedures(
    pendingProcedures, updated, inlineRules, context
  );

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
  const allEvents = [...pendingEvents, ...(ruleEvents || [])];
  for (const event of allEvents) {
    try {
      if (event.action.includes('.')) {
        emitEventEnvelope({
          type: CLOUDEVENTS_TYPE_PREFIX + event.action,
          source: `/${domain}`,
          subject: event.subject ?? resource.id,
          data: event.data || null,
          time: timestamp,
        });
      } else {
        emitEvent({
          domain,
          object,
          action: event.action,
          resourceId: resource.id,
          subject: event.subject,
          source: `/${domain}`,
          data: event.data || null,
          callerId,
          traceparent,
          now: timestamp
        });
      }
    } catch (e) {
      console.error(`Failed to emit event "${event.action}":`, e.message);
    }
  }

  return { success: true, result };
}
