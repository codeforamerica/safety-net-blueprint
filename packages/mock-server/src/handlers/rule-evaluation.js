/**
 * Shared helper for processing pending rule evaluations.
 * Used by both the transition handler and create handler.
 */

import { findAll, findById } from '../database-manager.js';
import { findRuleSet } from '../rules-loader.js';
import { buildRuleContext, evaluateRuleSet, resolvePath } from '../rules-engine.js';
import { executeActions } from '../action-handlers.js';
import { deriveCollectionName } from '../collection-utils.js';

/**
 * Build the dependencies object for action handlers.
 * Provides database lookup functions without exposing the DB layer directly.
 * @returns {Object} Dependencies object
 */
function buildDependencies() {
  return {
    findByField(collection, field, value) {
      const { items } = findAll(collection, { [field]: value }, { limit: 1 });
      return items.length > 0 ? items[0] : null;
    }
  };
}

/**
 * Resolve context bindings for a rule set by fetching related entities from the database.
 * Bindings are resolved in order; each binding can reference previously resolved entities
 * via its `from` path (chaining). The calling resource fields are also available in `from`
 * path resolution without namespace prefix.
 *
 * Returns null if any required entity cannot be found — the caller should skip the rule set.
 * Logs a warning and skips the binding if `from` resolves to no value on the resource.
 *
 * @param {Array} contextBindings - Array of { as, entity, from } binding objects from ruleSet.context
 * @param {Object} resource - The primary resource being evaluated
 * @returns {Object|null} Map of alias → fetched entity, or null if a required entity is missing
 */
export function resolveContextEntities(contextBindings, resource) {
  const resolved = {};

  for (const binding of contextBindings || []) {
    if (typeof binding !== 'object' || !binding.as || !binding.entity || !binding.from) continue;

    // Derive DB collection name from entity path (e.g., intake/applications/documents → application-documents)
    const collectionName = deriveCollectionName(binding.entity, binding.entity.split('/')[0]);

    // Resolve the from path against resource fields + previously resolved entities (chaining).
    // from: accepts a bare dot-path string or a JSON Logic { var: "..." } expression (Decision 21).
    const fromPath = typeof binding.from === 'object' && binding.from.var ? binding.from.var : binding.from;
    const lookupContext = { ...resource, ...resolved };
    const entityId = resolvePath(lookupContext, fromPath);

    if (!entityId) {
      if (binding.optional) {
        console.warn(
          `Context binding "${binding.as}": "${binding.from}" resolved to no value — skipping binding (optional)`
        );
        continue;
      }
      console.error(
        `Context binding "${binding.as}": "${binding.from}" resolved to no value — skipping rule set`
      );
      return null;
    }

    const entity = findById(collectionName, entityId);
    if (!entity) {
      if (binding.optional) {
        console.warn(
          `Context binding "${binding.as}": "${binding.entity}" with id "${entityId}" not found — skipping binding (optional)`
        );
        continue;
      }
      console.error(
        `Context binding "${binding.as}": "${binding.entity}" with id "${entityId}" not found — skipping rule set`
      );
      return null;
    }

    resolved[binding.as] = entity;
  }

  return resolved;
}

/**
 * Process pending rule evaluations against a resource.
 * Mutates the resource with action results (e.g., sets queueId, priority).
 * @param {Array<{ ruleType: string }>} pendingRuleEvaluations - Rule evaluations to process
 * @param {Object} resource - Resource to mutate
 * @param {Array} rules - All loaded rules from discoverRules()
 * @param {string} domain - Domain name (e.g., "workflow")
 */
export function processRuleEvaluations(pendingRuleEvaluations, resource, rules, domain) {
  if (!pendingRuleEvaluations || pendingRuleEvaluations.length === 0 || !rules) return;

  const deps = buildDependencies();

  for (const { ruleType } of pendingRuleEvaluations) {
    const found = findRuleSet(rules, domain, ruleType);
    if (!found) continue;

    const { ruleSet } = found;
    const resolvedEntities = resolveContextEntities(ruleSet.context, resource);
    if (resolvedEntities === null) continue; // required entity not found — skip rule set

    const contextData = buildRuleContext(resource, resolvedEntities);
    const result = evaluateRuleSet(ruleSet, contextData);

    if (result.matched) {
      executeActions(result.action, resource, deps, result.fallbackAction);
    }
  }
}
