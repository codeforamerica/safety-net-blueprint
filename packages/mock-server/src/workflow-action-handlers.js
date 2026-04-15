/**
 * Workflow-domain action handlers.
 * Domain-specific actions for routing and prioritizing workflow tasks.
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

export const workflowActionRegistry = new Map([
  ['assignToQueue', assignToQueue],
  ['setPriority', setPriority]
]);
