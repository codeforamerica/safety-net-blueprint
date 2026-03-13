/**
 * Shared helper for processing pending rule evaluations.
 * Used by both the transition handler and create handler.
 */

import { findAll } from '../database-manager.js';
import { findRuleSet } from '../rules-loader.js';
import { buildRuleContext, evaluateRuleSet } from '../rules-engine.js';
import { executeActions } from '../action-handlers.js';

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

    const { ruleSet, context: contextBindings } = found;
    const contextData = buildRuleContext(contextBindings, resource);
    const result = evaluateRuleSet(ruleSet, contextData);

    if (result.matched) {
      executeActions(result.action, resource, deps, result.fallbackAction);
    }
  }
}
