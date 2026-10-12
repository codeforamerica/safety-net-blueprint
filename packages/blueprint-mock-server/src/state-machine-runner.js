/**
 * Shared state machine transition logic.
 * Called by the HTTP transition handler and by the platform triggerTransition action.
 * Extracted so both paths use identical evaluation, mutation, and event emission.
 */

import { findOperation, evaluateGuards, applySteps } from './state-machine-engine.js';
import { updateSlaInfo } from './sla-engine.js';
import { executeProcedures, resolveContextLayers } from './handlers/procedure-runner.js';
import { emitEventEnvelope, authContext } from './emit-event.js';
import { mergeByPrecedence, buildInlineRules } from './collection-utils.js';
import { validate } from './validator.js';

/**
 * Check guard clauses, as an action's or a governed resource's create.
 *
 * OR semantics: the caller passes if ANY clause is satisfied. Within a clause,
 * actors AND conditions must both pass. Named conditions come from the platform,
 * the state machine document and the machine, the innermost winning.
 *
 * Checked in this order: who is calling (403), then the request body (422,
 * through `checkBody`), then the conditions (409). Conditions often read the
 * body — when a line was spoken, say — so a body missing a field is reported
 * as that, not as a condition that failed.
 *
 * @param {Object} options
 * @param {Array}  options.guardItems  - Guard clauses
 * @param {Object} options.stateMachine
 * @param {Object} options.machine
 * @param {string[]} options.callerRoles
 * @param {Object} options.resource    - The record the conditions read as `object`
 * @param {Object} options.context     - Condition context: caller, object, request, now, entities
 * @param {string} options.label       - Names what is guarded, for the refusal
 * @param {Function} [options.checkBody] - `() => refusal|null`, run after the role check and before the conditions
 * @returns {{ status: number, error: string, details?: object[] }|null} The refusal, or null when the caller passes
 */
export function checkGuardClauses({ guardItems, stateMachine, machine, callerRoles, resource, context, label, checkBody }) {
  if (!guardItems || guardItems.length === 0) return checkBody?.() ?? null;

  const guardsMap = Object.fromEntries(
    [...(stateMachine._platformGuards || []), ...(stateMachine.guards || []), ...(machine?.guards || [])].map(g => [g.id, g])
  );

  const allActors = guardItems.flatMap(g => g.actors || []);
  const callerHasAnyRole = allActors.length === 0 || callerRoles.some(r => allActors.includes(r));
  if (!callerHasAnyRole) {
    const uniqueActors = [...new Set(allActors)];
    return { status: 403, error: `${capitalized(label)} requires one of: ${uniqueActors.join(', ')}` };
  }

  const invalid = checkBody?.();
  if (invalid) return invalid;

  // Which condition stopped each clause, so the refusal can say why.
  const failed = [];
  const clausePassed = guardItems.some(g => {
    const clauseActors = g.actors || [];
    if (clauseActors.length > 0 && !callerRoles.some(r => clauseActors.includes(r))) return false;
    const clauseConditions = g.conditions || [];
    if (clauseConditions.length === 0) return true;
    const result = evaluateGuards(clauseConditions, guardsMap, resource, context);
    if (!result.pass && result.failedGuard) failed.push(result.failedGuard);
    return result.pass;
  });

  if (clausePassed) return null;
  const why = failed.length > 0 ? `: ${[...new Set(failed)].join(', ')} did not hold` : '';
  return { status: 409, error: `No guard clause passed for ${label}${why}` };
}

const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);

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
 * @param {string} [options.causationid]    - CloudEvents causation extension: id of the triggering event
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
  traceparent = null,
  causationid = null,
  store,
  stepCalls = null
}) {
  const timestamp = now || new Date().toISOString();

  const resource = store.findById(resourceName, resourceId);
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
    baseContext,
    store
  );
  if (entities === null) {
    return { success: false, status: 409, error: `Context binding failed for action "${trigger}"` };
  }
  const context = { ...baseContext, entities };

  const checkBody = () => {
    if (!operation?.schema?.request) return null;
    const { valid, errors } = validate(requestBody, operation.schema.request, `${stateMachine.domain ?? 'unknown'}-${machine?.object ?? 'unknown'}-operation-${trigger}`);
    return valid ? null : { status: 422, error: 'Request body validation failed', details: errors };
  };
  const refused = checkGuardClauses({ guardItems, stateMachine, machine, callerRoles, resource, context, label: `action "${trigger}"`, checkBody });
  if (refused) return { success: false, ...refused };

  const updated = { ...resource };
  if (resource.slaInfo) updated.slaInfo = resource.slaInfo.map(e => ({ ...e }));

  const { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents } =
    applySteps(steps, updated, context, store);

  if (transitionTo != null && transitionTo !== '') {
    updated.status = transitionTo;
  }

  if (slaTypes.length > 0 && updated.slaInfo?.length > 0) {
    updateSlaInfo(updated, slaTypes, timestamp, stateMachine.states || {});
  }

  const inlineRules = buildInlineRules(stateMachine, machine);
  const { pendingEvents: ruleEvents } = executeProcedures(
    pendingProcedures, updated, inlineRules, context, store
  );

  const diff = {};
  for (const [key, value] of Object.entries(updated)) {
    if (resource[key] !== value) diff[key] = value;
  }
  const result = store.update(resourceName, resourceId, diff);

  for (const { entity, data } of pendingCreates) {
    try { store.create(entity, data); }
    catch (e) { console.error(`Failed to create ${entity}:`, e.message); }
  }

  // Calls that name a record — a nested create, an update, another action —
  // mean what the API's route at that method and path means (step-calls.js).
  if (stepCalls) {
    const calls = [
      ...pendingOperations.map(({ path, body }) => ({ method: 'POST', path, body })),
      ...pendingAppends.map(({ path, body }) => ({ method: 'PATCH', path, body })),
    ];
    for (const call of calls) {
      try {
        stepCalls.apply(call, {
          caller: { id: callerId, roles: callerRoles },
          traceparent,
          causationid,
          now: timestamp,
          runAction: ({ entry, collection, id, action, body }) => executeTransition({
            resourceName: collection,
            resourceId: id,
            trigger: action,
            callerId,
            callerRoles,
            now: timestamp,
            stateMachine: entry.stateMachine,
            machine: entry.machine,
            slaTypes: stepCalls.slaTypesFor(entry.domain),
            requestBody: body,
            traceparent,
            causationid,
            store,
            stepCalls,
          }),
        });
      } catch (e) {
        console.error(`Action "${trigger}": ${e.message}`);
      }
    }
  }

  const domain = stateMachine.domain;
  const allEvents = [...pendingEvents, ...(ruleEvents || [])];
  for (const event of allEvents) {
    try {
      emitEventEnvelope({
        type: event.type,
        source: `/${domain}`,
        subject: event.subject ?? resource.id,
        data: event.data || null,
        time: timestamp,
        traceparent,
        causationid: event.causationid || causationid || undefined,
        ...authContext(callerId, callerRoles),
      }, store);
    } catch (e) {
      console.error(`Failed to emit event "${event.type}":`, e.message);
    }
  }

  return { success: true, result };
}
