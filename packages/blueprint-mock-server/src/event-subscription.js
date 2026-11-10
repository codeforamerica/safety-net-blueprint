/**
 * Event subscription engine — evaluates event-triggered rule sets.
 *
 * Subscribes to the event bus and, when a domain event fires, finds all rule sets
 * whose `on:` field matches the event type. For each matching rule set, resolves
 * context bindings using the event envelope as "this", evaluates rule conditions,
 * and executes actions (createResource, triggerTransition, etc.).
 *
 * The event envelope is the evaluation "resource" — this.subject, this.type,
 * this.source, this.data, etc. Context bindings resolve related entities from
 * the envelope fields (e.g., from: subject looks up the subject entity by ID).
 */

import { deliverEvent } from './routing.js';
import { arrivedThrough } from './routed-events.js';
import { theSystem } from './auth-context.js';
import { executeTransition, performerFor } from './state-machine-runner.js';
import { applyStepsWithCalls, evaluateGuards, whenReady, caughtEntities } from './state-machine-engine.js';
import { executeProcedures, resolveContextLayers } from './handlers/procedure-runner.js';
import { emitEvent, emitEventEnvelope, authContext } from './emit-event.js';
import { deriveCollectionName, mergeByPrecedence, buildInlineRules } from './collection-utils.js';
import { referencesByTarget } from './references.js';

/**
 * Test whether a CloudEvents type matches the `on:` field value.
 */
function eventTypeMatches(eventType, onValue) {
  if (!onValue || !eventType) return false;
  return eventType === onValue;
}

/**
 * The collection a machine's records are stored in, from the contracts' model:
 * its resource's collection path, named the way the mock names it when it
 * registers that resource's routes — a nested resource under its parent
 * (`determination-decisions`). Null when the model has no resource for the
 * machine; then there is no record to find, and none is guessed.
 *
 * @param {{ resource?: { path(part: string): string|null } | null }} smEntry
 * @returns {string|null}
 */
function collectionOf(smEntry) {
  const path = smEntry.resource?.path?.('collection');
  return path ? deriveCollectionName(path, '') : null;
}

/**
 * Find the smEntry (domain + object + stateMachine + machine) for a domain/collection pair.
 * @param {Array} allStateMachines - from discoverStateMachines()
 * @param {string} domain - e.g. "intake"
 * @param {string} collection - kebab-plural e.g. "applications"
 */
function findSmEntryForCollection(allStateMachines, domain, collection) {
  return allStateMachines.find(sm => {
    if (sm.domain !== domain) return false;
    return collectionOf(sm) === collection;
  }) || null;
}

/**
 * Execute a pending operation trigger (invoke: { POST: domain/collection/{id}/operation }).
 * The path is fully interpolated: domain/collection/uuid/operation.
 */
function executePendingOperation({ path, body }, now, allStateMachines, allSlaTypes, caller, traceparent = null, causationid = null, { store, instance, stepCalls }) {
  if (stepCalls) {
    applyThroughRoutes({ method: 'POST', path, body }, { now, caller, traceparent, causationid, store, instance, stepCalls });
    return;
  }
  const parts = path.split('/');
  if (parts.length < 4) {
    console.error(`executePendingOperation: path "${path}" must have at least 4 segments`);
    return;
  }
  const operation = parts.pop();    // "open"
  const resourceId = parts.pop();   // UUID
  const collectionPath = parts.join('/');
  const domain = parts[0];
  const collection = deriveCollectionName(collectionPath, domain);

  const smEntry = findSmEntryForCollection(allStateMachines, domain, collection);
  if (!smEntry) {
    console.error(`executePendingOperation: no state machine for ${domain}/${collection}`);
    return;
  }

  try {
    // Runs at once, as before, unless a step calls an operation; a failure
    // after that is reported here rather than left unhandled.
    executeTransition({
      store,
      instance,
      resourceName: collection,
      resourceId,
      trigger: operation,
      callerId: caller?.id || 'system',
      callerRoles: caller?.roles || ['system'],
      stateMachine: smEntry.stateMachine,
      machine: smEntry.machine,
      slaTypes: allSlaTypes,
      requestBody: body || {},
      traceparent,
      causationid,
      now,
    }).catch((e) => console.error(`executePendingOperation: "${operation}" on ${collection}/${resourceId} failed: ${e.message}`));
  } catch (e) {
    console.error(`executePendingOperation: "${operation}" on ${collection}/${resourceId} failed: ${e.message}`);
  }
}

/**
 * Apply a pending array-append (invoke: { PATCH: domain/collection/{id}, body: { field: { $push: value } } }).
 */
function executePendingAppend({ path, body }, { store, instance, stepCalls }) {
  if (stepCalls) {
    applyThroughRoutes({ method: 'PATCH', path, body }, { caller: { id: 'system', roles: ['system'] }, store, instance, stepCalls });
    return;
  }
  const parts = path.split('/');
  const id = parts.pop();
  const collectionPath = parts.join('/');
  const domain = parts[0];
  const collection = deriveCollectionName(collectionPath, domain);

  const existing = store.findById(collection, id);
  if (!existing) {
    console.error(`executePendingAppend: ${collection}/${id} not found`);
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
 * Run each of a function's calls for one key after the one before it settles,
 * and a call for a key with nothing running at once. The reactions to events
 * that share a partitionkey run in order this way; events with no key wait
 * for nothing.
 *
 * @param {Map<unknown, Promise<void>>} running - The mock's reactions still running, by key
 * @param {unknown} key
 * @param {() => unknown} run
 */
export function inOrder(running, key, run) {
  if (key == null) return run();
  const before = running.get(key);
  const result = before ? before.then(run) : run();
  if (!result || typeof result.then !== 'function') return;
  const settled = result.then(() => {}, () => {});
  running.set(key, settled);
  settled.then(() => { if (running.get(key) === settled) running.delete(key); });
}

/**
 * Do a reaction's call the way the API's route at that method and path means
 * (step-calls.js): a nested create, an update, or an action, which runs as the
 * system.
 */
function applyThroughRoutes(call, { now, caller, traceparent = null, causationid = null, store, instance, stepCalls }) {
  const actor = { id: caller?.id || 'system', roles: caller?.roles || ['system'] };
  try {
    const done = stepCalls.apply(call, {
      caller: actor,
      traceparent,
      causationid,
      now,
      runAction: ({ entry, collection, id, action, body }) => executeTransition({
        store,
        instance,
        resourceName: collection,
        resourceId: id,
        trigger: action,
        callerId: actor.id,
        callerRoles: actor.roles,
        stateMachine: entry.stateMachine,
        machine: entry.machine,
        slaTypes: stepCalls.slaTypesFor(entry.domain),
        requestBody: body || {},
        traceparent,
        causationid,
        now,
        stepCalls,
      }),
    });
    // An action it runs returns a promise; report its failure here.
    if (done && typeof done.then === 'function') {
      done.catch((e) => console.error(`onEvent call ${call.method} ${call.path} failed: ${e.message}`));
    }
  } catch (e) {
    console.error(`onEvent call ${call.method} ${call.path} failed: ${e.message}`);
  }
}

/**
 * Whether an event is about a machine's own resource: its type ends
 * `{domain}.{resource}.{event}` with the machine's domain and its resource's
 * event name, which is how every event is named. A state's type prefix, if
 * any, comes before.
 *
 * @param {string} type
 * @param {string} domain - The machine's domain
 * @param {string|undefined} eventName - Its resource's name in events, from core's model
 * @returns {boolean}
 */
function aboutOwnResource(type, domain, eventName) {
  const parts = String(type ?? '').split('.');
  if (parts.length < 3 || !domain || !eventName) return false;
  const [eventDomain, resource] = parts.slice(-3);
  return eventDomain === domain && resource === eventName;
}

/**
 * Register event subscriptions for all state machines that declare `on:`
 * entries, on the mock's own bus. Call once, when the mock is assembled.
 *
 * @param {object[]} allStateMachines
 * @param {object[]} [allSlaTypes]
 * @param {object[]} [apiSpecs]
 * @param {object} instance - The mock reacting (instance.js)
 * @param {object|null} [stepCalls] - What a step's call means, read against
 *   the API (step-calls.js); without it, calls fall back to reading the path
 *   by convention, which cannot create a nested record
 * @param {{ receives: Array<{ api: string, event: string, id: string, entry: object }>, apiOfFile: Map<string, string> }} [routedEvents]
 *   The received events routing sends elsewhere (routing.js); read when an
 *   event fires, so it can be filled in after this registers.
 */
export function registerEventSubscriptions(allStateMachines, allSlaTypes = [], apiSpecs = [], instance, stepCalls = null, routedEvents = { receives: [], apiOfFile: new Map() }) {
  const { store, reactions } = instance;
  // Replace rather than accumulate, for a mock rebuilt from an edited
  // contract set: otherwise the first set of handlers stays attached, and
  // every event is handled twice.
  if (reactions.dispatch) {
    instance.bus.off('domain-event', reactions.dispatch);
    reactions.dispatch = null;
  }
  reactions.running.clear();
  const deps = { store, instance, stepCalls };

  // Collect each machine's on: entries — the events it reacts to
  const machineEventSubs = [];
  for (const smEntry of allStateMachines) {
    const onEvents = smEntry.machine?.on;
    if (!Array.isArray(onEvents)) continue;
    for (const entry of onEvents) {
      if (entry.type && Array.isArray(entry.steps)) {
        machineEventSubs.push({ smEntry, entry });
      }
    }
  }

  if (machineEventSubs.length === 0) return;

  console.log(`\n✓ Registered ${machineEventSubs.length} machine onEvent subscription(s):`);
  for (const { smEntry, entry } of machineEventSubs) {
    console.log(`  - ${smEntry.domain}/${smEntry.machine.object} onEvent → on: ${entry.type}`);
  }

  // Which resource each event names, and which records name each resource.
  const resourceOfEvent = new Map();
  for (const api of apiSpecs) {
    for (const top of api.doc?.model?.()?.resources ?? []) {
      for (const resource of [top, ...top.children, ...top.singletons]) {
        if (resource.name && resource.eventName) resourceOfEvent.set(resource.eventName, resource.name);
      }
    }
  }
  const references = referencesByTarget(apiSpecs);

  /**
   * For a transition on an event about another resource, this machine's
   * records that name the event's subject through a declared relationship
   * (validation requires exactly one). Null when the event is about the
   * machine's own resource: then the record is the subject.
   */
  function relatedRecords(smEntry, event) {
    if (aboutOwnResource(event.type, smEntry.domain, smEntry.resource?.eventName)) return null;
    const parts = String(event.type ?? '').split('.');
    const named = resourceOfEvent.get(parts[parts.length - 2]);
    const collection = collectionOf(smEntry);
    const via = (references.get(named) ?? []).filter((reference) => reference.collection === collection);
    if (via.length !== 1) return null;
    const [{ path }] = via;
    return store.findAll(collection, {}, { limit: null }).items
      .filter((record) => path.reduce((value, key) => value?.[key], record) === event.subject);
  }

  // Each subscription to an event's type handles it, in order with the
  // events before it that share its partitionkey (inOrder below). One whose
  // API's receive operation is routed doesn't run here: the event is
  // delivered to whoever answers it instead, once, however many of the API's
  // machines react to it.
  reactions.dispatch = (event) => {
    const routed = routedEvents.receives.filter((receive) => eventTypeMatches(event.type, receive.event));
    // One that came from a service isn't sent back to it.
    const from = arrivedThrough(instance, event);
    for (const receive of routed) if (receive.entry !== from) deliverEvent(event, receive);
    for (const { smEntry, entry } of machineEventSubs) {
      if (!eventTypeMatches(event.type, entry.type)) continue;
      const api = routedEvents.apiOfFile.get(smEntry.api?.relativePath);
      if (routed.some((receive) => receive.api === api)) continue;
      // A transition on an event about another resource applies to this
      // machine's records that name it, through their declared relationship.
      const related = entry.transition ? relatedRecords(smEntry, event) : null;
      if (related) {
        for (const record of related) inOrder(reactions.running, event.partitionkey, () => react(smEntry, entry, event, record));
      } else {
        inOrder(reactions.running, event.partitionkey, () => react(smEntry, entry, event));
      }
    }
  };

  // One subscription handling one event. What it returns settles when the
  // reaction, and every call it makes, is done.
  function react(smEntry, entry, event, relatedRecord = null) {
    try {
      const now = new Date().toISOString();
      const caller = theSystem();

      // When transition: is present, the event targets an existing resource
      // (identified by event.subject). Look it up and enforce the from state guard.
      let resource = {};
      let targetCollection = null;
      let originalSnapshot = null;
      if (entry.transition) {
        targetCollection = collectionOf(smEntry);
        if (!targetCollection) {
          console.error(`Machine onEvent "${entry.type}": the contracts' model has no resource for ${smEntry.machine.object} — skipping`);
          return;
        }
        const found = relatedRecord ?? store.findById(targetCollection, event.subject);
        if (!found) {
          console.error(`Machine onEvent "${entry.type}": resource "${event.subject}" not found in ${targetCollection} — skipping`);
          return;
        }
        const from = entry.transition.from;
        if (from) {
          const fromArr = Array.isArray(from) ? from : [from];
          if (!fromArr.includes(found.status)) return;
        }
        resource = { ...found };
        originalSnapshot = { ...found };
      } else if (aboutOwnResource(event.type, smEntry.domain, smEntry.resource?.eventName)) {
        // No transition, but the event is about one of this machine's own
        // records — a decision's machine hearing that a decision was created
        // — so $object is that record, found by the event's subject as a
        // transition finds it. An event about another resource gives the
        // machine no record of its own, and no $object: it reads the record's
        // id from this.subject and what the event carries from this.data.
        // The payload is never taken for the record.
        const collection = collectionOf(smEntry);
        const found = collection && store.findById(collection, event.subject);
        if (found) resource = { ...found };
      }

      const baseContext = {
        caller,
        object: { ...resource },
        request: {},
        this: event,
        now,
      };

      const entities = resolveContextLayers(
        [smEntry.stateMachine?.context, smEntry.machine?.context, entry.context],
        resource,
        baseContext,
        store
      );
      if (entities === null) {
        console.error(`Machine onEvent "${entry.type}": required context binding failed — skipping`);
        return;
      }
      // The schemas the steps' values go into, so a null one doesn't accept is
      // left out (step-calls.js, schemasFor).
      const context = { ...baseContext, entities, schemas: stepCalls?.schemasFor?.(smEntry.machine), instance };

      // Evaluate guards if defined on this onEvent entry
      const guardConditions = entry.guards?.conditions || [];
      if (guardConditions.length > 0) {
        const guardsMap = Object.fromEntries(
          mergeByPrecedence(smEntry.stateMachine?.guards || [], smEntry.machine?.guards || [])
            .map(g => [g.id, g])
        );
        const guardResult = evaluateGuards(guardConditions, guardsMap, resource, context);
        if (!guardResult.pass) return;
      }

      // A call to an operation is made where it stands, as the system, its
      // events caused by this one. One that fails ends the reaction as an
      // action's does: its catch: runs instead of the steps, and with
      // none, nothing it did is saved.
      const perform = performerFor({
        callerId: caller.id, callerRoles: caller.roles, timestamp: now,
        traceparent: event.traceparent ?? null, causationid: event.id ?? null, store, instance, stepCalls,
      });
      const before = { ...resource };
      const restore = () => {
        for (const key of Object.keys(resource)) if (!(key in before)) delete resource[key];
        Object.assign(resource, before);
      };
      const unhandled = ({ step, outcome }) => {
        restore();
        const named = typeof step.call === 'string' ? step.call : step.call.operationId;
        // The fields at fault, when the API named them: "invalid data" alone
        // leaves whoever reads the log to reproduce the call to find out.
        const why = (outcome.body?.details ?? []).map((d) => `${d.field}: ${d.message}`).join('; ');
        console.error(`Machine onEvent "${entry.type}": call ${named} failed with ${outcome.status}: ${outcome.body?.message ?? ''}${why ? ` (${why})` : ''} — nothing saved`);
      };

      const reaction = whenReady(applyStepsWithCalls(entry.steps, resource, context, store, perform), (applied) => {
        if (!applied.failed) return finish(applied, context, entry.transition?.to);
        const { step, outcome } = applied.failed;
        if (!step.catch) return unhandled(applied.failed);
        restore();
        const failureContext = {
          ...context,
          object: { ...before },
          entities: caughtEntities(step, outcome, context.entities),
        };
        return whenReady(applyStepsWithCalls(step.catch.do ?? [], resource, failureContext, store, perform), (handled) =>
          handled.failed ? unhandled(handled.failed) : finish(handled, failureContext, step.catch.to ?? entry.transition?.to));
      });
      if (reaction && typeof reaction.then === 'function') {
        reaction.catch((e) => console.error(`Machine onEvent "${entry.type}" failed:`, e.message));
      }
      return reaction;
      // What a reaction's steps left to do, once they have run.
      function finish(applied, at, target) {
        const { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents } = applied;

        // Apply state transition if present (mutations are persisted after procedures run)
        if (target) {
          resource.status = target;
        }

        // Handle collection creates
        for (const { entity, domain: entDomain, eventObject, stubUrl, data } of pendingCreates) {
          try {
            const stored = store.create(entity, data);
            const created = stepCalls?.startClocksAt(`${entDomain}${stubUrl ?? ''}`, stored, now) ?? stored;
            // Named for the resource the API serves at that path, where the
            // route can be found; otherwise for the path's last segment.
            let object = eventObject || entity.replace(/s$/, '');
            try {
              const resolved = stepCalls?.resolve('POST', `${entDomain}${stubUrl ?? ''}`);
              if (resolved?.resource?.eventName) object = resolved.resource.eventName;
            } catch { /* not a declared route: keep the path's name */ }
            emitEvent({
              instance,
              domain: entDomain || smEntry.domain,
              object,
              action: 'created',
              resourceId: created.id,
              source: `/${entDomain || smEntry.domain}`,
              data: { ...created },
              callerId: 'system',
              traceparent: event.traceparent,
              causationid: event.id,
              now,
            });
          } catch (e) {
            console.error(`onEvent create failed for ${entity}:`, e.message);
          }
        }

        // Handle array appends
        for (const append of pendingAppends) {
          try {
            executePendingAppend(append, deps);
          } catch (e) {
            console.error(`onEvent append failed for "${append.path}":`, e.message);
          }
        }

        // Handle operation triggers
        for (const op of pendingOperations) {
          try {
            executePendingOperation(op, now, allStateMachines, allSlaTypes, caller, event.traceparent, event.id, deps);
          } catch (e) {
            console.error(`onEvent operation failed for "${op.path}":`, e.message);
          }
        }

        // Handle events emitted directly by onEvent steps
        const domain = smEntry.domain;
        // The record transitioned: the subject, or one naming it.
        const recordId = relatedRecord?.id ?? event.subject;
        const subjectId = entry.transition ? recordId : null;
        const allPendingEvents = [...(pendingEvents || [])];

        // Procedure calls (call: steps in on: blocks) run before anything is
        // saved; one whose call failed with nothing to handle it saves nothing.
        const inlineRules = buildInlineRules(smEntry.stateMachine, smEntry.machine);
        const procedures = pendingProcedures.length > 0
          ? executeProcedures(pendingProcedures, resource, inlineRules, at, store, perform)
          : { pendingOperations: [], pendingEvents: [] };

        return whenReady(procedures, ({ pendingOperations: procOps, pendingEvents: procEvts, failed }) => {
          if (failed) return unhandled(failed);
          for (const op of procOps) {
            try {
              executePendingOperation(op, now, allStateMachines, allSlaTypes, caller, event.traceparent, event.id, deps);
            } catch (e) {
              console.error(`onEvent procedure operation failed for "${op.path}":`, e.message);
            }
          }
          allPendingEvents.push(...(procEvts || []));

          // Persist all resource mutations (from direct steps and procedures) after everything runs
          if (entry.transition && targetCollection && originalSnapshot) {
            const diff = {};
            for (const [key, value] of Object.entries(resource)) {
              if (originalSnapshot[key] !== value && key !== 'id' && key !== 'createdAt') {
                diff[key] = value;
              }
            }
            if (Object.keys(diff).length > 0) {
              store.update(targetCollection, recordId, diff);
            }
          }

          for (const evt of allPendingEvents) {
            try {
              emitEventEnvelope({
                type: evt.type,
                source: `/${domain}`,
                subject: evt.subject ?? subjectId,
                data: evt.data || null,
                traceparent: event.traceparent,
                causationid: event.id,
                time: now,
                ...authContext('system'),
              }, instance);
            } catch (e) {
              console.error(`onEvent emit "${evt.type}" failed:`, e.message);
            }
          }
        });
      }
    } catch (e) {
      console.error(`Machine onEvent "${entry.type}" failed:`, e.message);
    }
  }

  instance.bus.on('domain-event', reactions.dispatch);
}
