/**
 * Action handlers — platform action registry.
 *
 * Platform actions (createResource, triggerTransition, forEach, applyStub) are generic
 * and available to all domain rule sets. Domain-specific behavior is now expressed
 * via `set:` steps in inline state machine rules rather than custom action handlers.
 */

import { platformActionRegistry } from './platform-action-handlers.js';

const actionRegistry = new Map([
  ...platformActionRegistry,
]);

/**
 * Execute all actions in an action object against a resource.
 * @param {Object} action - Action object (e.g., { createResource: { ... } })
 * @param {Object} resource - Resource to mutate
 * @param {Object} deps - Dependencies for handlers that need lookups or creation
 * @param {Object|null} fallbackAction - Fallback action if primary fails
 */
export function executeActions(action, resource, deps, fallbackAction = null) {
  if (!action) return;

  for (const [actionType, actionValue] of Object.entries(action)) {
    const handler = actionRegistry.get(actionType);
    if (handler) {
      handler(actionValue, resource, deps, fallbackAction);
    } else {
      console.warn(`Unknown action type: ${actionType}`);
    }
  }
}
