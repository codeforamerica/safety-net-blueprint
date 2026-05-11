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
import { create, update, findAll, findById } from './database-manager.js';
import { buildRuleContext, evaluateRuleSet, evaluateAllMatchRuleSet, resolvePath } from './rules-engine.js';
import { resolveContextEntities } from './handlers/rule-evaluation.js';
import { executeActions } from './action-handlers.js';
import { executeTransition } from './state-machine-runner.js';
import { applyEffects, applySteps } from './state-machine-engine.js';
import { processRuleEvaluations } from './handlers/rule-evaluation.js';
import { emitEvent, CLOUDEVENTS_TYPE_PREFIX } from './emit-event.js';
import { deriveCollectionName } from './collection-utils.js';

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
 * Find the state machine for a domain/resource entity reference.
 */
function findStateMachineForEntity(entity, allStateMachines) {
  const domainName = entity.split('/')[0];
  const collectionName = deriveCollectionName(entity, domainName);
  const match = allStateMachines.find(sm => {
    if (sm.domain !== domainName) return false;
    const kebabPlural = sm.object
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase() + 's';
    return collectionName === kebabPlural || collectionName.endsWith('-' + kebabPlural);
  });
  return match?.stateMachine || null;
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
function executePendingOperation({ path, body }, now, allRules, allStateMachines, allSlaTypes, caller) {
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
      rules: allRules,
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
 * Build rich deps for platform actions (createResource, triggerTransition).
 */
function buildPlatformDeps(ruleContext, allRules, allStateMachines, allSlaTypes, apiSpecs = []) {
  const eventSchemas = {};
  for (const spec of apiSpecs) {
    if (spec.eventSchemas) Object.assign(eventSchemas, spec.eventSchemas);
  }
  return {
    findByField(collection, field, value) {
      const { items } = findAll(collection, { [field]: value }, { limit: 1 });
      return items.length > 0 ? items[0] : null;
    },

    context: ruleContext,
    dbCreate: create,
    dbUpdate: update,
    findStateMachine: (entity) => findStateMachineForEntity(entity, allStateMachines),
    applyEffects,
    processRuleEvaluations,
    allRules,
    allSlaTypes,
    emitCreatedEvent(domainName, collectionName, resource) {
      try {
        emitEvent({
          domain: domainName,
          object: collectionName.replace(/s$/, ''),
          action: 'created',
          resourceId: resource.id,
          source: `/${domainName}`,
          data: { ...resource },
          callerId: 'system'
        });
      } catch (e) {
        console.error(`Failed to emit created event for ${domainName}/${collectionName}:`, e.message);
      }
    },

    eventSchemas,

    resolvePath,
    dbFindById: findById,
    executeTransition: (opts) => executeTransition({ ...opts, allRules, allSlaTypes })
  };
}

/**
 * Register event subscriptions for all loaded rule sets that declare an `on:` field.
 * Call once at server startup after rules and state machines are loaded.
 *
 * @param {Array} allRules         - from discoverRules()
 * @param {Array} allStateMachines - from discoverStateMachines()
 * @param {Array} [allSlaTypes]    - from discoverSlaTypes()
 */
export function registerEventSubscriptions(allRules, allStateMachines, allSlaTypes = [], apiSpecs = []) {
  // Collect all event-triggered rule sets across all rule files
  const subscriptions = [];
  for (const ruleFile of allRules) {
    for (const ruleSet of ruleFile.ruleSets || []) {
      if (ruleSet.on) {
        subscriptions.push({ ruleSet, domain: ruleFile.domain, resource: ruleFile.resource });
      }
    }
  }

  // Collect triggers.onEvent entries from new-format state machines
  const machineEventSubs = [];
  for (const smEntry of allStateMachines) {
    const onEvents = smEntry.machine?.triggers?.onEvent;
    if (!Array.isArray(onEvents)) continue;
    for (const entry of onEvents) {
      if (entry.name && Array.isArray(entry.then)) {
        machineEventSubs.push({ smEntry, entry });
      }
    }
  }

  const totalSubs = subscriptions.length + machineEventSubs.length;
  if (totalSubs === 0) return;

  console.log(`\n✓ Registered ${subscriptions.length} rule event subscription(s) and ${machineEventSubs.length} machine onEvent subscription(s):`);
  for (const { ruleSet, domain } of subscriptions) {
    console.log(`  - ${domain}/${ruleSet.id} → on: ${ruleSet.on}`);
  }
  for (const { smEntry, entry } of machineEventSubs) {
    console.log(`  - ${smEntry.domain}/${smEntry.machine.object} onEvent → on: ${entry.name}`);
  }

  eventBus.on('domain-event', (event) => {
    // Rule-set subscriptions (old format)
    for (const { ruleSet } of subscriptions) {
      if (!eventTypeMatches(event.type, ruleSet.on)) continue;

      try {
        const resolvedEntities = resolveContextEntities(ruleSet.context, event);
        if (resolvedEntities === null) continue;

        const ruleContext = buildRuleContext(event, resolvedEntities);
        const deps = buildPlatformDeps(ruleContext, allRules, allStateMachines, allSlaTypes, apiSpecs);

        if (ruleSet.evaluation === 'all-match') {
          const matches = evaluateAllMatchRuleSet(ruleSet, ruleContext);
          for (const match of matches) {
            executeActions(match.action, event, deps, match.fallbackAction);
          }
        } else {
          const result = evaluateRuleSet(ruleSet, ruleContext);
          if (!result.matched) continue;
          executeActions(result.action, event, deps, result.fallbackAction);
        }
      } catch (e) {
        console.error(`Event subscription "${ruleSet.id}" failed for event "${event.type}":`, e.message);
      }
    }

    // Machine onEvent subscriptions (new format triggers.onEvent)
    for (const { smEntry, entry } of machineEventSubs) {
      if (!eventTypeMatches(event.type, entry.name)) continue;

      try {
        const now = new Date().toISOString();
        const caller = { id: 'system', roles: ['system'] };
        const context = {
          caller,
          object: {},
          request: {},
          this: event,   // $this.subject, $this.data, etc.
          now,
        };

        const resource = {};
        const { pendingCreates, pendingOperations, pendingAppends, pendingRuleEvaluations } =
          applySteps(entry.then, resource, context);

        // Handle collection creates
        for (const { entity, data } of pendingCreates) {
          try {
            const created = create(entity, data);
            emitEvent({
              domain: smEntry.domain,
              object: entity.replace(/s$/, ''),
              action: 'created',
              resourceId: created.id,
              source: `/${smEntry.domain}`,
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
            executePendingOperation(op, now, allRules, allStateMachines, allSlaTypes, caller);
          } catch (e) {
            console.error(`onEvent operation failed for "${op.path}":`, e.message);
          }
        }

        // Handle rule evaluations (evaluate: steps in onEvent then: blocks)
        if (pendingRuleEvaluations.length > 0) {
          const inlineRules = smEntry.stateMachine?.rules || [];
          try {
            const { pendingOperations: ruleOps } = processRuleEvaluations(
              pendingRuleEvaluations, resource, allRules, smEntry.domain, inlineRules, context
            );
            for (const op of ruleOps) {
              try {
                executePendingOperation(op, now, allRules, allStateMachines, allSlaTypes, caller);
              } catch (e) {
                console.error(`onEvent rule operation failed for "${op.path}":`, e.message);
              }
            }
          } catch (e) {
            console.error(`onEvent processRuleEvaluations failed:`, e.message);
          }
        }
      } catch (e) {
        console.error(`Machine onEvent "${entry.name}" failed:`, e.message);
      }
    }
  });
}
