/**
 * Shared state machine transition logic.
 * Called by the HTTP transition handler and by the platform triggerTransition action.
 * Extracted so both paths use identical evaluation, mutation, and event emission.
 */

import { findOperation, evaluateGuards, applyStepsInOrder, caughtEntities, resolveBodyValue } from './state-machine-engine.js';
import { fitToSchema } from './payload-fit.js';
import { updateSlaInfo, earliestDeadline } from './sla-engine.js';
import { executeProcedures, resolveContextLayers } from './handlers/procedure-runner.js';
import { emitEventEnvelope, authContext } from './emit-event.js';
import { mergeByPrecedence, buildInlineRules } from './collection-utils.js';
import { playsAnyOf, theSystem } from './auth-context.js';
import { whenFree } from './record-turns.js';
import { whatsWrong } from './validator.js';
import { openTransaction } from './transaction.js';

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
  const callerHasAnyRole = playsAnyOf(callerRoles, allActors);
  if (!callerHasAnyRole) {
    const uniqueActors = [...new Set(allActors)];
    return { status: 403, error: `Only ${listed(uniqueActors, 'or')} can ${label}.` };
  }

  const invalid = checkBody?.();
  if (invalid) return invalid;

  // Which condition stopped each clause, so the refusal can say why.
  const failed = [];
  const clausePassed = guardItems.some(g => {
    const clauseActors = g.actors || [];
    if (!playsAnyOf(callerRoles, clauseActors)) return false;
    const clauseConditions = g.conditions || [];
    if (clauseConditions.length === 0) return true;
    const result = evaluateGuards(clauseConditions, guardsMap, resource, context);
    if (!result.pass && result.failedGuard) failed.push(result.failedGuard);
    return result.pass;
  });

  if (clausePassed) return null;
  // Each condition not met, as its guard describes it — or by its id where it
  // has no description.
  const reasons = [...new Set(failed)].map((id) => (guardsMap[id]?.description ?? `the ${id} condition holds`).replace(/\.$/, ''));
  return { status: 409, error: `Can't ${label}.${reasons.length ? ` It requires that ${reasons.join(', and that ')}.` : ''}` };
}

/** `['a', 'b', 'c']` → `a, b or c`. */
const listed = (items, conjunction) => (items.length < 2 ? items.join('')
  : `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`);

/** `TranscriptEntry` → `transcript entry`, for a refusal a person reads. */
/**
 * The file each state machine was read from, so an action's request schema is
 * checked as declared there: its refs into other files resolve from it.
 */
const declaredIn = new WeakMap();

/** @param {{ stateMachine: object, relativePath?: string }[]} entries */
export function rememberMachineFiles(entries) {
  for (const entry of entries ?? []) {
    if (entry?.stateMachine && entry.relativePath) declaredIn.set(entry.stateMachine, entry.relativePath);
  }
}

export const inWords = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

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
 * @param {string} [options.authorization]  - The caller's Authorization header, which a call made
 *   as the caller carries on; kept apart from the caller, so no expression reads it
 * @param {Object} options.store
 * @param {Object} options.instance         - The mock running it (instance.js)
 * @param {{ schema: Object, follow: Function }|null} [options.responseSchema] - The 200 response schema
 *   the action's endpoint declares, which an action's `response.payload` is fitted to
 * Steps run in order; a call to an operation is made as it is reached. When
 * one fails, what the steps did to the domain's records is undone, its
 * `catch:` runs instead and names the state the action ends in, and the
 * action answers with the call's failure and the record in `details`. With
 * no `catch:`, the action fails. A call by method and path is made once the
 * record is saved, as the system; one that fails fails the action, with the
 * call's status (makePathCalls).
 *
 * The action and the calls it makes to its own domain are one transaction
 * (transaction.js): when the action fails, every record of the domain they
 * changed is put back, and none of their events is sent. A call to another
 * domain is done once it succeeds.
 *
 * It waits for any action or reaction already changing the record, and holds
 * the record until it's saved (record-turns.js); what it does after — its
 * calls to other records' actions, its events — runs once it's let go, so
 * nothing it sets off waits on it.
 *
 * @returns {Promise<{ success: boolean, result?: Object, status?: number, code?: string, error?: string, details?: Object[] }>}
 */
export async function executeTransition(options) {
  const { instance, resourceName, resourceId } = options;
  let letGo = whenFree(instance, resourceName, resourceId);
  if (typeof letGo.then === 'function') letGo = await letGo;
  // The id of the first event this action sends, chosen now so a call it
  // makes can name it as the cause of the call's own events.
  const actionEventId = crypto.randomUUID();
  const transaction = openTransaction({ store: options.store, instance, domain: options.stateMachine.domain, cause: actionEventId });
  let outcome;
  try {
    outcome = await transitionRecord({ ...options, actionEventId }, letGo);
  } catch (e) {
    transaction.rollback();
    throw e;
  } finally {
    letGo();
  }
  // A failure catch: handled ends where it said, and is kept.
  const { caught, ...result } = outcome;
  if (result.success === false && !caught) transaction.rollback();
  else transaction.commit();
  return result;
}

async function transitionRecord({
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
  authorization = null,
  store,
  instance,
  stepCalls = null,
  responseSchema = null,
  actionEventId,
}, letGo) {
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
    now: timestamp,
    instance,
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
  // The schemas the steps' values go into, so a null one doesn't accept is
  // left out (step-calls.js, schemasFor).
  const context = { ...baseContext, entities, schemas: stepCalls?.schemasFor?.(machine), instance };

  const checkBody = () => {
    if (!operation?.schema?.request) return null;
    const relativePath = declaredIn.get(stateMachine);
    const source = relativePath ? { relativePath, defs: stateMachine.$defs } : null;
    const { valid, errors } = instance.schemas.validate(requestBody, operation.schema.request, `${stateMachine.domain ?? 'unknown'}-${machine?.object ?? 'unknown'}-operation-${trigger}`, source);
    return valid ? null : { status: 422, error: `The request body is invalid${whatsWrong(errors)}`, details: errors };
  };
  const refused = checkGuardClauses({ guardItems, stateMachine, machine, callerRoles, resource, context, label: `${trigger.replace(/-/g, ' ')} this ${inWords(machine?.object ?? 'record')}`, checkBody });
  if (refused) return { success: false, ...refused };

  // A call to an operation that requires an Idempotency-Key is made with this
  // record's id as the key: accepting a suggestion calls once, and only a call
  // that succeeds is kept under the key.
  const perform = performerFor({
    callerId, callerRoles, authorization, timestamp, traceparent, causationid: actionEventId, store, instance, stepCalls,
    idempotencyKey: resource?.id ?? null,
  });

  const fresh = () => {
    const copy = { ...resource };
    if (resource.slaInfo) copy.slaInfo = resource.slaInfo.map(e => ({ ...e }));
    return copy;
  };
  let updated = fresh();
  // What the steps' calls do to the domain is undone if one fails, so a
  // catch: starts from the records as they were before the steps.
  const stepsDid = openTransaction({ store, instance, domain: stateMachine.domain, cause: actionEventId });
  let applied;
  try {
    applied = await applyStepsInOrder(steps, updated, context, store, perform);
  } catch (e) {
    stepsDid.rollback();
    throw e;
  }
  let target = transitionTo;
  let failure = null;

  // A call that failed: its catch: runs instead of the action's steps, and
  // says where the action ends; with none, the action fails and nothing is saved.
  if (applied.failed?.step.catch) stepsDid.rollback();
  else stepsDid.commit();
  if (applied.failed) {
    const { step, outcome } = applied.failed;
    if (!step.catch) return refusedBy(outcome);
    failure = outcome;
    updated = fresh();
    const failureContext = {
      ...context,
      // As the record was before the steps that failed, not as they left it.
      object: { ...resource },
      entities: caughtEntities(step, outcome, context.entities ?? {}),
    };
    applied = await applyStepsInOrder(step.catch.do ?? [], updated, failureContext, store, perform);
    if (applied.failed) return refusedBy(applied.failed.outcome);
    target = step.catch.to ?? transitionTo;
  }
  const { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents } = applied;

  if (target != null && target !== '') {
    updated.status = target;
  }

  if (slaTypes.length > 0 && updated.slaInfo?.length > 0) {
    updateSlaInfo(updated, slaTypes, timestamp, stateMachine.states || {});
    // A record that keeps a slaDeadline keeps it current: a resume moves its
    // deadlines.
    if ('slaDeadline' in updated) updated.slaDeadline = earliestDeadline(updated.slaInfo);
  }

  const inlineRules = buildInlineRules(stateMachine, machine);
  // Procedures run after the action's own steps and its SLA clocks, so they
  // read the record as the action left it: a resume's deadline, not the one
  // from while it was paused.
  const procedures = await executeProcedures(
    pendingProcedures, updated, inlineRules, { ...context, object: { ...updated } }, store, perform
  );
  // A procedure's call that failed with nothing to handle it fails the action.
  if (procedures.failed) return refusedBy(procedures.failed.outcome);
  const ruleEvents = procedures.pendingEvents;

  const diff = {};
  for (const [key, value] of Object.entries(updated)) {
    if (resource[key] !== value) diff[key] = value;
  }
  const result = store.update(resourceName, resourceId, diff);
  letGo();

  // Calls that name a record — a nested create, an update, another action —
  // mean what the API's route at that method and path means (step-calls.js).
  // Made once the record is saved, so an action called on it reads it as this
  // one left it; one that fails fails the action, and its transaction puts
  // back what it and the calls before it did.
  if (stepCalls) {
    const failed = await makePathCalls([
      ...pendingOperations.map(({ path, body }) => ({ method: 'POST', path, body })),
      ...(procedures.pendingOperations ?? []).map(({ path, body }) => ({ method: 'POST', path, body })),
      ...pendingAppends.map(({ path, body }) => ({ method: 'PATCH', path, body })),
    ], { stepCalls, store, instance, now: timestamp, traceparent, causationid: actionEventId });
    if (failed) {
      return { success: false, status: failed.status, code: failed.code, error: failed.message, details: failed.details };
    }
  }

  // A record a step creates directly has its SLA clocks started and is
  // announced as a create through the API would be, caused by the action.
  for (const { entity, domain, stubUrl, data } of pendingCreates) {
    try {
      const record = store.create(entity, data);
      stepCalls?.settleCreated(`${domain}${stubUrl ?? ''}`, record, {
        caller: { id: callerId, roles: callerRoles }, traceparent, causationid: actionEventId, now: timestamp,
      });
    } catch (e) { console.error(`Failed to create ${entity}:`, e.message); }
  }

  const domain = stateMachine.domain;
  const allEvents = [...pendingEvents, ...(ruleEvents || [])];
  for (const [i, event] of allEvents.entries()) {
    try {
      emitEventEnvelope({
        ...(i === 0 ? { id: actionEventId } : {}),
        type: event.type,
        source: `/${domain}`,
        subject: event.subject ?? resource.id,
        data: event.data || null,
        time: timestamp,
        traceparent,
        causationid: event.causationid || causationid || undefined,
        ...authContext(callerId, callerRoles),
      }, instance);
    } catch (e) {
      console.error(`Failed to emit event "${event.type}":`, e.message);
    }
  }

  // The call failed and catch: handled it: the action ends where it said,
  // and answers with the call's failure, the record as it now is in details.
  if (failure) {
    return {
      caught: true,
      success: false,
      status: failure.status,
      code: failure.body?.code,
      error: failure.body?.message ?? `The call failed with ${failure.status}`,
      details: [result],
    };
  }

  // An action that says what it answers with answers with that — a value a
  // step's call bound, say — read once the steps have run and the record is
  // saved; one that doesn't answers with the record.
  // A null the response schema the action's endpoint declares doesn't accept
  // is left out (payload-fit.js).
  if (operation.response?.payload !== undefined) {
    const payload = resolveBodyValue(operation.response.payload, { ...context, object: result });
    return { success: true, result: fitToSchema(payload, responseSchema?.schema, responseSchema?.follow) };
  }
  return { success: true, result };
}

/**
 * Make an action's or a reaction's calls by method and path, in order, each
 * meaning what the API's route at that method and path means (step-calls.js):
 * a nested create, an update, or another record's action. Made as the system
 * (behavioral-contract-dsl.md, Function model): an action called this way
 * skips only role matching — its `from`, its conditions and its request
 * schema still apply. Stops at the first that fails.
 *
 * @param {Array<{ method: string, path: string, body?: Object }>} calls - Paths interpolated
 * @param {Object} options
 * @param {Object} options.stepCalls
 * @param {Object} options.store
 * @param {Object} options.instance
 * @param {string} options.now
 * @param {string|null} [options.traceparent]
 * @param {string|null} [options.causationid]
 * @returns {Promise<{ call: Object, status: number, code?: string, message: string, details?: Object[] }|null>}
 *   The failure — an action's refusal, or a call that means nothing or writes
 *   what the schema refuses — or null when every call succeeded
 */
export async function makePathCalls(calls, { stepCalls, store, instance, now, traceparent = null, causationid = null }) {
  const system = theSystem();
  for (const call of calls) {
    let outcome;
    try {
      outcome = await stepCalls.apply(call, {
        caller: system,
        traceparent,
        causationid,
        now,
        runAction: ({ entry, collection, id, action, body }) => executeTransition({
          resourceName: collection,
          resourceId: id,
          trigger: action,
          callerId: system.id,
          callerRoles: system.roles,
          now,
          stateMachine: entry.stateMachine,
          machine: entry.machine,
          slaTypes: stepCalls.slaTypesFor(entry.domain),
          requestBody: body ?? {},
          traceparent,
          causationid,
          store,
          instance,
          stepCalls,
        }),
      });
    } catch (e) {
      return { call, status: 500, code: 'INTERNAL_ERROR', message: e.message };
    }
    if (outcome?.success === false) {
      return { call, status: outcome.status, code: outcome.code, message: outcome.error, details: outcome.details };
    }
  }
  return null;
}

/** An action refused because a call it made failed with nothing to handle it. */
function refusedBy(outcome) {
  return {
    success: false,
    status: outcome.status,
    code: outcome.body?.code,
    error: outcome.body?.message ?? `The call failed with ${outcome.status}`,
    details: outcome.body?.details,
  };
}

/**
 * What makes a step's calls to operations, as the step says to run each one:
 * for an action, a procedure it calls, or an event's reaction.
 *
 * @param {Object} options
 * @param {string|null} options.callerId
 * @param {string[]} options.callerRoles
 * @param {string} options.timestamp
 * @param {string|null} options.traceparent
 * @param {string|null} options.causationid - The event the call's own events name as their cause
 * @param {Object} options.store
 * @param {Object} options.instance
 * @param {Object|null} options.stepCalls
 * @returns {((call: Object, step: Object) => Promise<{ ok: boolean, status: number, body: * }>) & { settleCreated: (path: string, record: Object) => Object|null }}
 */
export function performerFor(options) {
  const perform = (call, step) => performCall(call, step, options);
  // A record a procedure's step creates directly is settled the same way — its
  // SLA clocks started and its created event sent — as whoever this performs for.
  perform.settleCreated = (path, record) => options.stepCalls?.settleCreated(path, record, {
    caller: { id: options.callerId, roles: options.callerRoles },
    traceparent: options.traceparent,
    causationid: options.causationid,
    now: options.timestamp,
  }) ?? null;
  return perform;
}

function performCall(call, step, { callerId, callerRoles, authorization = null, timestamp, traceparent, causationid, store, instance, stepCalls, idempotencyKey = null }) {
  if (!stepCalls) {
    return Promise.resolve({ ok: false, status: 500, body: { code: 'INTERNAL_ERROR', message: 'This mock cannot make calls to operations.' } });
  }
  return stepCalls.perform(call, {
    runAs: step.runAs ?? 'system',
    caller: { id: callerId, roles: callerRoles },
    authorization,
    traceparent,
    causationid,
    idempotencyKey,
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
      authorization,
      store,
      instance,
      stepCalls,
    }),
  });
}
