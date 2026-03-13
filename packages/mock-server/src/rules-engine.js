/**
 * Rules engine — pure logic, no Express or database dependencies.
 * Evaluates rule conditions using JSON Logic and returns matched actions.
 */

import jsonLogic from 'json-logic-js';

/**
 * Build a context object from context bindings and a resource.
 * Bindings like ["task.*"] produce { task: { ...resource } }.
 * @param {string[]} contextBindings - Array of binding expressions (e.g., ["task.*"])
 * @param {Object} resource - The resource to bind
 * @returns {Object} Context object for rule evaluation
 */
export function buildRuleContext(contextBindings, resource) {
  const context = {};
  for (const binding of contextBindings || []) {
    const match = binding.match(/^(\w+)\.\*$/);
    if (match) {
      context[match[1]] = { ...resource };
    }
  }
  return context;
}

/**
 * Evaluate a ruleSet against context data. Uses first-match-wins semantics.
 * @param {Object} ruleSet - RuleSet definition with rules array
 * @param {Object} contextData - Context object built by buildRuleContext
 * @returns {{ matched: boolean, ruleId?: string, action?: Object, fallbackAction?: Object }}
 */
export function evaluateRuleSet(ruleSet, contextData) {
  if (!ruleSet || !ruleSet.rules) {
    return { matched: false };
  }

  // Sort rules by order to ensure correct evaluation sequence
  const sortedRules = [...ruleSet.rules].sort((a, b) => a.order - b.order);

  for (const rule of sortedRules) {
    let conditionMet = false;

    if (rule.condition === true) {
      // Catch-all rule — always matches
      conditionMet = true;
    } else {
      // Evaluate JSON Logic condition
      try {
        conditionMet = jsonLogic.apply(rule.condition, contextData);
      } catch (err) {
        console.warn(`Rule "${rule.id}" condition evaluation failed: ${err.message}`);
        continue;
      }
    }

    if (conditionMet) {
      return {
        matched: true,
        ruleId: rule.id,
        action: rule.action,
        fallbackAction: rule.fallbackAction || null
      };
    }
  }

  return { matched: false };
}
