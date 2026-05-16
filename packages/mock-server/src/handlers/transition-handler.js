/**
 * Handler for POST /resources/{id}/{trigger} (state machine transitions)
 */

import { executeTransition } from '../state-machine-runner.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';

/**
 * Create a transition handler for an RPC endpoint.
 * @param {string} resourceName - Database resource name (e.g., "tasks")
 * @param {Object} stateMachine - The state machine contract
 * @param {string} trigger - Transition trigger name (e.g., "claim")
 * @param {string} paramName - URL parameter name for the resource ID
 * @param {Array} [slaTypes] - SLA types from discoverSlaTypes()
 * @returns {Function} Express handler
 */
export function createTransitionHandler(resourceName, stateMachine, trigger, paramName, slaTypes = [], machine = null) {
  return (req, res) => {
    try {
      const httpStub = matchAndPopHttp(req.method, req.path);
      if (httpStub) {
        return res.status(httpStub.response?.status ?? 200).json(httpStub.response?.body ?? {});
      }

      const resourceId = req.params[paramName];

      const callerId = req.headers['x-caller-id'];
      if (!callerId) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          message: 'X-Caller-Id header is required for state transitions'
        });
      }

      const callerRoles = req.headers['x-caller-roles']
        ? req.headers['x-caller-roles'].split(',').map(r => r.trim()).filter(Boolean)
        : [];

      const now = new Date().toISOString();
      const traceparent = req.headers['traceparent'] || null;

      const { success, result, status, error } = executeTransition({
        resourceName,
        resourceId,
        trigger,
        callerId,
        callerRoles,
        now,
        stateMachine,
        machine,
        slaTypes,
        requestBody: req.body || {},
        traceparent
      });

      if (!success) {
        return res.status(status).json({ code: statusCode(status), message: error });
      }

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

function statusCode(status) {
  if (status === 404) return 'NOT_FOUND';
  if (status === 403) return 'FORBIDDEN';
  return 'CONFLICT';
}
