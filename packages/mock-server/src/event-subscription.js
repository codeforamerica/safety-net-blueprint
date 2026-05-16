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

import { eventBus } from './event-bus.js';
import { create, update, findById } from './database-manager.js';
import { executeTransition } from './state-machine-runner.js';
import { applySteps, evaluateGuards } from './state-machine-engine.js';
import { executeProcedures, resolveContextLayers } from './handlers/procedure-runner.js';
import { emitEvent, emitEventEnvelope, CLOUDEVENTS_TYPE_PREFIX } from './emit-event.js';
import { deriveCollectionName, mergeByPrecedence, buildInlineRules } from './collection-utils.js';

/**
 * Test whether a CloudEvents type matches the `on:` field value.
 * Accepts the full type or a short suffix (last three dot-segments).
 */
function eventTypeMatches(eventType, onValue) {
  if (!onValue || !eventType) return false;
  if (eventType === onValue) return true;
  return eventType === CLOUDEVENTS_TYPE_PREFIX + onValue;
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
    const kebabPlural = sm.object
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase() + 's';
    return kebabPlural === collection;
  }) || null;
}

/**
 * Execute a pending operation trigger (invoke: { POST: domain/collection/{id}/operation }).
 * The path is fully interpolated: domain/collection/uuid/operation.
 */
function executePendingOperation({ path, body }, now, allStateMachines, allSlaTypes, caller) {
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
    executeTransition({
      resourceName: collection,
      resourceId,
      trigger: operation,
      callerId: caller?.id || 'system',
      callerRoles: caller?.roles || ['system'],
      stateMachine: smEntry.stateMachine,
      machine: smEntry.machine,
      slaTypes: allSlaTypes,
      requestBody: body || {},
      now,
    });
  } catch (e) {
    console.error(`executePendingOperation: "${operation}" on ${collection}/${resourceId} failed: ${e.message}`);
  }
}

/**
 * Apply a pending array-append (invoke: { PATCH: domain/collection/{id}, body: { field: { $push: value } } }).
 */
function executePendingAppend({ path, body }) {
  const parts = path.split('/');
  const id = parts.pop();
  const collectionPath = parts.join('/');
  const domain = parts[0];
  const collection = deriveCollectionName(collectionPath, domain);

  const existing = findById(collection, id);
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

  update(collection, id, patch);
}

/**
 * Register event subscriptions for all state machines that declare `events:` entries.
 * Call once at server startup after state machines are loaded.
 *
 * @param {Array} allStateMachines - from discoverStateMachines()
 * @param {Array} [allSlaTypes]    - from discoverSlaTypes()
 */
export function registerEventSubscriptions(allStateMachines, allSlaTypes = [], apiSpecs = []) {
  // Collect events entries from new-format state machines
  const machineEventSubs = [];
  for (const smEntry of allStateMachines) {
    const onEvents = smEntry.machine?.events;
    if (!Array.isArray(onEvents)) continue;
    for (const entry of onEvents) {
      if (entry.name && Array.isArray(entry.steps)) {
        machineEventSubs.push({ smEntry, entry });
      }
    }
  }

  if (machineEventSubs.length === 0) return;

  console.log(`\n✓ Registered ${machineEventSubs.length} machine onEvent subscription(s):`);
  for (const { smEntry, entry } of machineEventSubs) {
    console.log(`  - ${smEntry.domain}/${smEntry.machine.object} onEvent → on: ${entry.name}`);
  }

  eventBus.on('domain-event', (event) => {
    // Machine event subscriptions
    for (const { smEntry, entry } of machineEventSubs) {
      if (!eventTypeMatches(event.type, entry.name)) continue;

      try {
        const now = new Date().toISOString();
        const caller = { id: 'system', roles: ['system'] };

        // When transition: is present, the event targets an existing resource
        // (identified by event.subject). Look it up and enforce the from state guard.
        let resource = {};
        let targetCollection = null;
        let originalSnapshot = null;
        if (entry.transition) {
          targetCollection = smEntry.machine.object
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .toLowerCase() + 's';
          const found = findById(targetCollection, event.subject);
          if (!found) {
            console.error(`Machine onEvent "${entry.name}": resource "${event.subject}" not found in ${targetCollection} — skipping`);
            continue;
          }
          const from = entry.transition.from;
          if (from) {
            const fromArr = Array.isArray(from) ? from : [from];
            if (!fromArr.includes(found.status)) continue;
          }
          resource = { ...found };
          originalSnapshot = { ...found };
        } else if (event.data && typeof event.data === 'object' && !Array.isArray(event.data)
            && event.data.id != null && event.data.id === event.subject) {
          // No transition, but the event carries the full resource as its data payload
          // (e.g. *.resource.created events where data: { ...created }). Use it as the
          // primary resource so $object resolves correctly in subscription steps.
          resource = { ...event.data };
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
          baseContext
        );
        if (entities === null) {
          console.error(`Machine onEvent "${entry.name}": required context binding failed — skipping`);
          continue;
        }
        const context = { ...baseContext, entities };

        // Evaluate guards if defined on this onEvent entry
        const guardConditions = entry.guards?.conditions || [];
        if (guardConditions.length > 0) {
          const guardsMap = Object.fromEntries(
            mergeByPrecedence(smEntry.stateMachine?.guards || [], smEntry.machine?.guards || [])
              .map(g => [g.id, g])
          );
          const guardResult = evaluateGuards(guardConditions, guardsMap, resource, context);
          if (!guardResult.pass) continue;
        }

        const { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents } =
          applySteps(entry.steps, resource, context);

        // Apply state transition if present (mutations are persisted after procedures run)
        if (entry.transition?.to) {
          resource.status = entry.transition.to;
        }

        // Handle collection creates
        for (const { entity, domain: entDomain, eventObject, data } of pendingCreates) {
          try {
            const created = create(entity, data);
            emitEvent({
              domain: entDomain || smEntry.domain,
              object: eventObject || entity.replace(/s$/, ''),
              action: 'created',
              resourceId: created.id,
              source: `/${entDomain || smEntry.domain}`,
              data: { ...created },
              callerId: 'system',
              now,
            });
          } catch (e) {
            console.error(`onEvent create failed for ${entity}:`, e.message);
          }
        }

        // Handle array appends
        for (const append of pendingAppends) {
          try {
            executePendingAppend(append);
          } catch (e) {
            console.error(`onEvent append failed for "${append.path}":`, e.message);
          }
        }

        // Handle operation triggers
        for (const op of pendingOperations) {
          try {
            executePendingOperation(op, now, allStateMachines, allSlaTypes, caller);
          } catch (e) {
            console.error(`onEvent operation failed for "${op.path}":`, e.message);
          }
        }

        // Handle events emitted directly by onEvent steps
        const domain = smEntry.domain;
        const object = smEntry.machine.object.toLowerCase();
        const subjectId = entry.transition ? event.subject : null;
        const allPendingEvents = [...(pendingEvents || [])];

        // Handle procedure calls (call: steps in onEvent then: blocks)
        if (pendingProcedures.length > 0) {
          const inlineRules = buildInlineRules(smEntry.stateMachine, smEntry.machine);
          try {
            const { pendingOperations: procOps, pendingEvents: procEvts } = executeProcedures(
              pendingProcedures, resource, inlineRules, context
            );
            for (const op of procOps) {
              try {
                executePendingOperation(op, now, allStateMachines, allSlaTypes, caller);
              } catch (e) {
                console.error(`onEvent procedure operation failed for "${op.path}":`, e.message);
              }
            }
            allPendingEvents.push(...(procEvts || []));
          } catch (e) {
            console.error(`onEvent executeProcedures failed:`, e.message);
          }
        }

        // Persist all resource mutations (from direct steps and procedures) after everything runs
        if (entry.transition && targetCollection && originalSnapshot) {
          const diff = {};
          for (const [key, value] of Object.entries(resource)) {
            if (originalSnapshot[key] !== value && key !== 'id' && key !== 'createdAt') {
              diff[key] = value;
            }
          }
          if (Object.keys(diff).length > 0) {
            update(targetCollection, event.subject, diff);
          }
        }

        for (const evt of allPendingEvents) {
          try {
            if (evt.action.includes('.')) {
              emitEventEnvelope({
                type: CLOUDEVENTS_TYPE_PREFIX + evt.action,
                source: `/${domain}`,
                subject: subjectId,
                data: evt.data || null,
                time: now,
              });
            } else {
              emitEvent({
                domain,
                object,
                action: evt.action,
                resourceId: subjectId,
                source: `/${domain}`,
                data: evt.data || null,
                callerId: 'system',
                now,
              });
            }
          } catch (e) {
            console.error(`onEvent emit "${evt.action}" failed:`, e.message);
          }
        }
      } catch (e) {
        console.error(`Machine onEvent "${entry.name}" failed:`, e.message);
      }
    }
  });
}
