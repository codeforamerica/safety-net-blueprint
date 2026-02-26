/**
 * Handler for POST /resources/{id}/{trigger} (state machine transitions)
 */

import { findById, update } from '../database-manager.js';
import { findTransition, evaluateGuards, applyEffects } from '../state-machine-engine.js';

/**
 * Create a transition handler for an RPC endpoint.
 * @param {string} resourceName - Database resource name (e.g., "workflow")
 * @param {Object} stateMachine - The state machine contract
 * @param {string} trigger - Transition trigger name (e.g., "claim")
 * @param {string} paramName - URL parameter name for the resource ID
 * @returns {Function} Express handler
 */
export function createTransitionHandler(resourceName, stateMachine, trigger, paramName) {
  return (req, res) => {
    try {
      const resourceId = req.params[paramName];

      // Require caller identity
      const callerId = req.headers['x-caller-id'];
      if (!callerId) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          message: 'X-Caller-Id header is required for state transitions'
        });
      }

      // Load the resource
      const resource = findById(resourceName, resourceId);
      if (!resource) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: `Resource not found: ${resourceId}`
        });
      }

      // Find a valid transition
      const { transition, error } = findTransition(stateMachine, trigger, resource);
      if (!transition) {
        return res.status(409).json({
          code: 'CONFLICT',
          message: error
        });
      }

      // Evaluate guards
      const context = { caller: { id: callerId } };
      const guardResult = evaluateGuards(
        transition.guards,
        stateMachine.guards || {},
        resource,
        context
      );

      if (!guardResult.pass) {
        return res.status(409).json({
          code: 'CONFLICT',
          message: `Guard "${guardResult.failedGuard}" failed: ${guardResult.reason}`
        });
      }

      // Clone resource, apply effects, update status
      const updated = { ...resource };
      applyEffects(transition.effects, updated, context);
      updated.status = transition.to;

      // Compute diff (only changed fields)
      const diff = {};
      for (const [key, value] of Object.entries(updated)) {
        if (resource[key] !== value) {
          diff[key] = value;
        }
      }

      // Persist changes
      const result = update(resourceName, resourceId, diff);

      res.json(result);
    } catch (error) {
      console.error('Transition handler error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      });
    }
  };
}
