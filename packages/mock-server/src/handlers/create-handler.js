/**
 * Handler for POST /resources (create)
 */

import { create, update } from '../database-manager.js';
import { validate, createErrorResponse } from '../validator.js';
import { applyEffects } from '../state-machine-engine.js';
import { initializeSlaInfo } from '../sla-engine.js';
import { processRuleEvaluations } from './rule-evaluation.js';
import { eventBus } from '../event-bus.js';

/**
 * Create create handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @param {string} baseUrl - Base URL for Location header
 * @param {Object|null} stateMachine - State machine contract (null for APIs without one)
 * @param {Array|null} rules - Rules from discoverRules() (null for APIs without rules)
 * @returns {Function} Express handler
 */
export function createCreateHandler(apiMetadata, endpoint, baseUrl, stateMachine, rules, slaTypes = []) {
  return (req, res) => {
    try {
      // Check if request body is an object (400 for malformed request)
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          message: 'Request body must be a JSON object',
          details: [{ field: 'body', message: 'must be object' }]
        });
      }

      // Validate request body (422 for validation errors)
      if (endpoint.requestSchema) {
        const { valid, errors } = validate(
          req.body,
          endpoint.requestSchema,
          `${endpoint.collectionName}-create`
        );

        if (!valid) {
          return res.status(422).json(createErrorResponse(errors, 422));
        }
      }

      // Create resource in database
      const resource = create(endpoint.collectionName, req.body);

      // Execute onCreate effects if this resource has a state machine
      if (stateMachine?.onCreate?.effects) {
        const callerId = req.headers['x-caller-id'] || 'system';
        const now = new Date().toISOString();

        // Parse caller roles from header (comma-separated)
        const callerRoles = req.headers['x-caller-roles']
          ? req.headers['x-caller-roles'].split(',').map(r => r.trim()).filter(Boolean)
          : [];

        // Enforce onCreate actors if defined
        if (stateMachine.onCreate.actors && stateMachine.onCreate.actors.length > 0) {
          if (!callerRoles.some(r => stateMachine.onCreate.actors.includes(r))) {
            return res.status(403).json({
              code: 'FORBIDDEN',
              message: `Creating this resource requires one of the following roles: ${stateMachine.onCreate.actors.join(', ')}`
            });
          }
        }

        const context = {
          caller: {
            id: callerId,
            roles: callerRoles
          },
          object: { ...resource },
          request: req.body || {},
          now
        };

        const { pendingCreates, pendingRuleEvaluations, pendingEvents } = applyEffects(
          stateMachine.onCreate.effects,
          resource,
          context
        );

        // Process rule evaluations (sets queueId, priority, etc.)
        processRuleEvaluations(pendingRuleEvaluations, resource, rules, stateMachine.domain);

        // Initialize SLA info if SLA types are configured
      if (slaTypes.length > 0) {
        initializeSlaInfo(resource, slaTypes, now);
      }

      // Persist rule-driven mutations back to DB
        const diff = {};
        const original = JSON.parse(JSON.stringify(resource));
        for (const [key, value] of Object.entries(resource)) {
          if (original[key] !== value && key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
            diff[key] = value;
          }
        }

        if (Object.keys(diff).length > 0) {
          update(endpoint.collectionName, resource.id, diff);
          // Refresh resource with updated timestamps
          Object.assign(resource, diff);
        }

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
      }

      // Build Location header
      const location = `${baseUrl}${endpoint.path}/${resource.id}`;

      res.status(201)
        .header('Location', location)
        .json(resource);
    } catch (error) {
      console.error('Create handler error:', error);

      // Handle unique constraint violations
      if (error.message?.includes('UNIQUE constraint')) {
        return res.status(409).json({
          code: 'CONFLICT',
          message: 'A resource with this identifier already exists'
        });
      }

      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      });
    }
  };
}
