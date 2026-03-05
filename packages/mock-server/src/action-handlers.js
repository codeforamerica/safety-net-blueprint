/**
 * Action handlers — registry of functions that execute rule actions.
 * Each handler mutates the resource based on the action value.
 */

/**
 * Assign a task to a queue by looking up the queue by name.
 * @param {string} queueName - Name of the queue to assign to
 * @param {Object} resource - Resource to mutate
 * @param {Object} deps - Dependencies (findByField function)
 * @param {Object|null} fallbackAction - Fallback action if queue not found
 */
function assignToQueue(queueName, resource, deps, fallbackAction) {
  const queue = deps.findByField('queues', 'name', queueName);
  if (queue) {
    resource.queueId = queue.id;
  } else if (fallbackAction?.assignToQueue) {
    // Try fallback queue
    const fallbackQueue = deps.findByField('queues', 'name', fallbackAction.assignToQueue);
    if (fallbackQueue) {
      resource.queueId = fallbackQueue.id;
    } else {
      console.warn(`Queue "${queueName}" and fallback "${fallbackAction.assignToQueue}" not found`);
    }
  } else {
    console.warn(`Queue "${queueName}" not found, no fallback configured`);
  }
}

/**
 * Set the priority of a resource.
 * @param {string} priority - Priority value to set
 * @param {Object} resource - Resource to mutate
 */
function setPriority(priority, resource) {
  resource.priority = priority;
}

/**
 * Registry of action type → handler function.
 * Each handler signature: (actionValue, resource, deps, fallbackAction)
 */
const actionRegistry = new Map([
  ['assignToQueue', assignToQueue],
  ['setPriority', setPriority]
]);

/**
 * Execute all actions in an action object against a resource.
 * @param {Object} action - Action object (e.g., { assignToQueue: "snap-intake", setPriority: "high" })
 * @param {Object} resource - Resource to mutate
 * @param {Object} deps - Dependencies for handlers that need lookups
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
