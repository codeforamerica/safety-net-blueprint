/**
 * Action handlers — merged registry of all platform and domain-specific actions.
 *
 * Platform actions (createResource, triggerTransition) are generic and available
 * to all domain rule sets. Domain-specific actions (assignToQueue, setPriority)
 * are co-located here since all domains share the same rule evaluation pipeline.
 *
 * To add domain-specific actions: create a <domain>-action-handlers.js file,
 * export a Map, and merge it into actionRegistry below.
 */

import { platformActionRegistry } from './platform-action-handlers.js';
import { workflowActionRegistry } from './workflow-action-handlers.js';

const actionRegistry = new Map([
  ...platformActionRegistry,
  ...workflowActionRegistry
]);

/**
 * Execute all actions in an action object against a resource.
 * @param {Object} action - Action object (e.g., { assignToQueue: "snap-intake", setPriority: "high" })
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
