/**
 * Handler for POST /resources/{id}/{trigger} (state machine transitions)
 */

import { findById, findAll, update, create } from '../database-manager.js';
import { findTransition, evaluateGuards, applyEffects } from '../state-machine-engine.js';
import { updateSlaInfo } from '../sla-engine.js';
import { processRuleEvaluations } from './rule-evaluation.js';
import { eventBus } from '../event-bus.js';

/**
 * Create a transition handler for an RPC endpoint.
 * @param {string} resourceName - Database resource name (e.g., "tasks")
 * @param {Object} stateMachine - The state machine contract
 * @param {string} trigger - Transition trigger name (e.g., "claim")
 * @param {string} paramName - URL parameter name for the resource ID
 * @param {Array} rules - Array from discoverRules()
 * @returns {Function} Express handler
 */
export function createTransitionHandler(resourceName, stateMachine, trigger, paramName, rules, slaTypes = []) {
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

      // Parse caller roles from header (comma-separated)
      const callerRoles = req.headers['x-caller-roles']
        ? req.headers['x-caller-roles'].split(',').map(r => r.trim()).filter(Boolean)
        : [];

      // Enforce actors — if transition defines actors, caller must have at least one matching role
      if (transition.actors && transition.actors.length > 0) {
        if (!callerRoles.some(r => transition.actors.includes(r))) {
          return res.status(403).json({
            code: 'FORBIDDEN',
            message: `Transition "${trigger}" requires one of the following roles: ${transition.actors.join(', ')}`
          });
        }
      }

      // Support X-Mock-Now header for clock simulation in testing
      const now = req.headers['x-mock-now'] || new Date().toISOString();
      const context = {
        caller: {
          id: callerId,
          roles: callerRoles
        },
        object: { ...resource },  // Pre-transition snapshot
        request: req.body || {},
        now
      };

      const guardsMap = Object.fromEntries((stateMachine.guards || []).map(g => [g.id, g]));
      const guardResult = evaluateGuards(
        transition.guards,
        guardsMap,
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
      if (resource.slaInfo) updated.slaInfo = resource.slaInfo.map(e => ({ ...e }));
      const { pendingCreates, pendingRuleEvaluations, pendingEvents } = applyEffects(transition.effects, updated, context);
      // Only update status if the transition declares a non-empty target state.
      // In-place transitions (assign, set-priority) omit `to` and leave status unchanged.
      if (transition.to != null && transition.to !== '') {
        updated.status = transition.to;
      }

      // Update SLA clock state based on new status
      if (slaTypes.length > 0 && updated.slaInfo?.length > 0) {
        updateSlaInfo(updated, slaTypes, now, stateMachine.states || {});
      }

      // Process pending rule evaluations
      processRuleEvaluations(pendingRuleEvaluations, updated, rules, stateMachine.domain);

      // Compute diff (only changed fields)
      const diff = {};
      for (const [key, value] of Object.entries(updated)) {
        if (resource[key] !== value) {
          diff[key] = value;
        }
      }

      // Persist changes
      const result = update(resourceName, resourceId, diff);

      // Execute pending creates
      for (const { entity, data } of pendingCreates) {
        try {
          create(entity, data);
        } catch (createError) {
          console.error(`Failed to create ${entity}:`, createError.message);
        }
      }

      // Emit pending domain events
      for (const event of pendingEvents) {
        try {
          const stored = create('events', {
            domain: stateMachine.domain,
            resource: stateMachine.object.toLowerCase(),
            action: event.action,
            resourceId: resource.id,
            performedById: callerId,
            occurredAt: now,
            data: event.data
          });
          eventBus.emit('domain-event', stored);
        } catch (eventError) {
          console.error(`Failed to emit event "${event.action}":`, eventError.message);
        }
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
