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
import { applyEffects } from './state-machine-engine.js';
import { processRuleEvaluations } from './handlers/rule-evaluation.js';
import { emitEvent } from './emit-event.js';
import { deriveCollectionName } from './collection-utils.js';

const FULL_TYPE_PREFIX = 'org.codeforamerica.safety-net-blueprint.';

/**
 * Test whether a CloudEvents type matches the `on:` field value.
 * Accepts the full type or a short suffix (last three dot-segments).
 * Examples:
 *   on: "org.codeforamerica.safety-net-blueprint.intake.application.submitted" → matches exactly
 *   on: "intake.application.submitted" → matches by suffix
 */
function eventTypeMatches(eventType, onValue) {
  if (!onValue || !eventType) return false;
  if (eventType === onValue) return true;
  // Short form: accept if the event type ends with the declared suffix
  return eventType === FULL_TYPE_PREFIX + onValue;
}

/**
 * Find the state machine for a domain/resource entity reference.
 * @param {string} entity - "domain/resource[/sub-resource]" format (e.g., "intake/applications/documents")
 * @param {Array} allStateMachines - from discoverStateMachines()
 * @returns {Object|null} The state machine contract, or null
 */
function findStateMachineForEntity(entity, allStateMachines) {
  const domainName = entity.split('/')[0];
  const collectionName = deriveCollectionName(entity, domainName);
  const match = allStateMachines.find(sm => {
    if (sm.domain !== domainName) return false;
    // Convert PascalCase object name to kebab-plural: ApplicationDocument → application-documents
    const kebabPlural = sm.object
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase() + 's';
    return kebabPlural === collectionName;
  });
  return match?.stateMachine || null;
}

/**
 * Build rich deps for platform actions (createResource, triggerTransition).
 * These actions need access to the full server context: DB, state machines, rules.
 */
function buildPlatformDeps(ruleContext, allRules, allStateMachines, allSlaTypes) {
  return {
    // For assignToQueue / setPriority (existing on-demand deps)
    findByField(collection, field, value) {
      const { items } = findAll(collection, { [field]: value }, { limit: 1 });
      return items.length > 0 ? items[0] : null;
    },

    // For createResource
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

    // For triggerTransition / appendToArray
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
export function registerEventSubscriptions(allRules, allStateMachines, allSlaTypes = []) {
  // Collect all event-triggered rule sets across all rule files
  const subscriptions = [];
  for (const ruleFile of allRules) {
    for (const ruleSet of ruleFile.ruleSets || []) {
      if (ruleSet.on) {
        subscriptions.push({ ruleSet, domain: ruleFile.domain, resource: ruleFile.resource });
      }
    }
  }

  if (subscriptions.length === 0) return;

  console.log(`\n✓ Registered ${subscriptions.length} event subscription(s):`);
  for (const { ruleSet, domain } of subscriptions) {
    console.log(`  - ${domain}/${ruleSet.id} → on: ${ruleSet.on}`);
  }

  eventBus.on('domain-event', (event) => {
    for (const { ruleSet } of subscriptions) {
      if (!eventTypeMatches(event.type, ruleSet.on)) continue;

      try {
        // Resolve context bindings with the event envelope as "this"
        const resolvedEntities = resolveContextEntities(ruleSet.context, event);
        if (resolvedEntities === null) continue; // required binding failed

        // Build rule context: this = event envelope, plus resolved entities
        const ruleContext = buildRuleContext(event, resolvedEntities);

        // Build rich deps for platform actions (needed for both evaluation paths)
        const deps = buildPlatformDeps(ruleContext, allRules, allStateMachines, allSlaTypes);

        if (ruleSet.evaluation === 'all-match') {
          // Execute every matching rule's action in order
          const matches = evaluateAllMatchRuleSet(ruleSet, ruleContext);
          for (const match of matches) {
            executeActions(match.action, event, deps, match.fallbackAction);
          }
        } else {
          // first-match-wins (default)
          const result = evaluateRuleSet(ruleSet, ruleContext);
          if (!result.matched) continue;
          executeActions(result.action, event, deps, result.fallbackAction);
        }
      } catch (e) {
        console.error(`Event subscription "${ruleSet.id}" failed for event "${event.type}":`, e.message);
      }
    }
  });
}
