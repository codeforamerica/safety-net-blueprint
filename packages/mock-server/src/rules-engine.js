/**
 * Rules engine — pure logic, no Express or database dependencies.
 * Evaluates rule conditions using JSON Logic and returns matched actions.
 */

import jsonLogic from 'json-logic-js';

/**
 * Resolve a dot-notation path against an object.
 * Strips the leading namespace segment (e.g., "task.subjectId" → resource.subjectId).
 * @param {Object} obj - The object to traverse
 * @param {string} path - Dot-notation path (e.g., "task.subjectId")
 * @returns {*} Resolved value, or undefined if not found
 */
export function resolvePath(obj, path) {
  const parts = path.split('.');
  // Strip leading namespace (e.g., "task") — the resource IS the namespace root
  const fields = parts.length > 1 ? parts.slice(1) : parts;
  return fields.reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

/**
 * Build a context object from context bindings and a resource.
 * String bindings like ["task.*"] produce { task: { ...resource } }.
 * Pre-resolved entities (from object-form bindings) are merged in by alias.
 * @param {Array} contextBindings - Array of string or object binding definitions
 * @param {Object} resource - The primary resource to bind
 * @param {Object} resolvedEntities - Pre-fetched entities keyed by alias { application: {...} }
 * @returns {Object} Context object for rule evaluation
 */
export function buildRuleContext(contextBindings, resource, resolvedEntities = {}) {
  const context = {};
  for (const binding of contextBindings || []) {
    if (typeof binding === 'string') {
      const match = binding.match(/^(\w+)\.\*$/);
      if (match) {
        context[match[1]] = { ...resource };
      }
    }
    // Object-form bindings are resolved by the caller and passed in resolvedEntities
  }
  return { ...context, ...resolvedEntities };
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
