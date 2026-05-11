/**
 * Handler for POST /resources (create)
 */

import { create, update } from '../database-manager.js';
import { validate, createErrorResponse } from '../validator.js';
import { hasConfigManagedResources } from '../config-registry.js';
import { applyEffects, applySteps } from '../state-machine-engine.js';
import { initializeSlaInfo } from '../sla-engine.js';
import { processRuleEvaluations } from './rule-evaluation.js';
import { emitEvent } from '../emit-event.js';

/**
 * Create create handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @param {string} baseUrl - Base URL for Location header
 * @param {Object|null} stateMachine - State machine contract (null for APIs without one)
 * @param {Array|null} rules - Rules from discoverRules() (null for APIs without rules)
 * @returns {Function} Express handler
 */
export function createCreateHandler(apiMetadata, endpoint, baseUrl, stateMachine, rules, slaTypes = [], machine = null) {
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

      // Create resource in database — merge any enrichment data set by pre-create middleware
      // (e.g. catalog-derived fields that aren't in the create schema)
      const createData = req.enrichmentData ? { ...req.body, ...req.enrichmentData } : req.body;
      const resource = create(endpoint.collectionName, createData);

      // Mark runtime-created resources as user-sourced when the collection
      // also has config-managed (system) entries, so consumers can distinguish them
      if (hasConfigManagedResources(endpoint.collectionName)) {
        resource.source = 'user';
        update(endpoint.collectionName, resource.id, { source: 'user' });
      }

      // Apply initial state from state machine
      // New format: machine.initialState; old format: stateMachine.initialState
      const initialState = machine?.initialState ?? stateMachine?.initialState;
      if (initialState) {
        resource.status = initialState;
        update(endpoint.collectionName, resource.id, { status: initialState });
      }

      const callerId = req.headers['x-caller-id'] || 'system';
      const now = new Date().toISOString();
      const traceparent = req.headers['traceparent'] || null;
      const domain = apiMetadata.serverBasePath.replace(/^\//, '');
      const object = endpoint.collectionName.replace(/s$/, '');

      // Resolve onCreate — new format: machine.triggers.onCreate; old format: stateMachine.onCreate
      const isNewFormat = machine && machine.triggers;
      const onCreate = isNewFormat ? machine.triggers?.onCreate : stateMachine?.onCreate;

      // Execute onCreate steps/effects if this resource has a state machine
      if (onCreate) {
        // Parse caller roles from header (comma-separated)
        const callerRoles = req.headers['x-caller-roles']
          ? req.headers['x-caller-roles'].split(',').map(r => r.trim()).filter(Boolean)
          : [];

        // Enforce onCreate actors if defined
        if (onCreate.actors && onCreate.actors.length > 0) {
          if (!callerRoles.some(r => onCreate.actors.includes(r))) {
            return res.status(403).json({
              code: 'FORBIDDEN',
              message: `Creating this resource requires one of the following roles: ${onCreate.actors.join(', ')}`
            });
          }
        }

        // Snapshot before any steps/effects mutate resource (for DB diff later)
        const original = JSON.parse(JSON.stringify(resource));

        const context = {
          caller: { id: callerId, roles: callerRoles },
          object: { ...resource },
          request: req.body || {},
          now
        };

        const { pendingCreates, pendingRuleEvaluations } = isNewFormat
          ? applySteps(onCreate.then || [], resource, context)
          : applyEffects(onCreate.effects || [], resource, context);

        // Process rule evaluations (sets queueId, priority, etc.)
        processRuleEvaluations(pendingRuleEvaluations, resource, rules, stateMachine?.domain, stateMachine?.rules, context);

        // Execute pending creates
        for (const { entity, data } of pendingCreates) {
          try {
            create(entity, data);
          } catch (createError) {
            console.error(`Failed to create ${entity}:`, createError.message);
          }
        }

        // Initialize SLA info if SLA types are configured
        if (slaTypes.length > 0) {
          initializeSlaInfo(resource, slaTypes, now);
        }

        // Persist rule-driven and SLA mutations back to DB
        const diff = {};
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
      }

      // Auto-emit created event with full resource snapshot (after effects applied)
      try {
        emitEvent({
          domain,
          object,
          action: 'created',
          resourceId: resource.id,
          source: apiMetadata.serverBasePath,
          data: { ...resource },
          callerId,
          traceparent,
          now,
        });
      } catch (eventError) {
        console.error('Failed to emit created event:', eventError.message);
      }

      // Build Location header — use req.path (actual URL) rather than endpoint.path
      // so sub-resource POSTs like /applications/app-123/documents get the right URL.
      const location = `${baseUrl}${req.path}/${resource.id}`;

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
