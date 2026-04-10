/**
 * Handler for PATCH /resources/{id} (update)
 */

import { findById, update } from '../database-manager.js';
import { validate, createErrorResponse } from '../validator.js';
import { applyEffects } from '../state-machine-engine.js';
import { processRuleEvaluations } from './rule-evaluation.js';
import { emitEvent } from '../emit-event.js';

/**
 * Create update handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @param {Object|null} stateMachine - State machine contract (for onUpdate effects)
 * @param {Array} rules - Rules for rule evaluation effects
 * @returns {Function} Express handler
 */
export function createUpdateHandler(apiMetadata, endpoint, stateMachine = null, rules = [], slaTypes = []) {
  const paramName = extractPathParam(endpoint.path);
  return (req, res) => {
    try {
      const resourceId = req.params[paramName] || req.params.id;

      // Check if resource exists
      const existing = findById(endpoint.collectionName, resourceId);
      if (!existing) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: `${capitalize(paramName.replace(/Id$/, ''))} not found`
        });
      }

      // Check if request body is an object (400 for malformed request)
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          message: 'Request body must be a JSON object',
          details: [{ field: 'body', message: 'must be object' }]
        });
      }

      // Check minProperties requirement for PATCH (at least 1 field)
      if (Object.keys(req.body).length === 0) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          message: 'Request body must contain at least one field to update',
          details: [{ field: 'body', message: 'minProperties: 1' }]
        });
      }

      // For PATCH, merge with existing data first, then validate the complete merged object
      // This ensures the final result is valid while allowing partial updates
      const mergedData = { ...existing, ...req.body };

      // Validate merged data (422 for validation errors)
      if (endpoint.requestSchema) {
        const { valid, errors } = validate(
          mergedData,
          endpoint.requestSchema,
          `${endpoint.collectionName}-update`
        );

        if (!valid) {
          return res.status(422).json(createErrorResponse(errors, 422));
        }
      }

      // Compute field-level diff (before values for the updated event)
      const changedFields = Object.keys(req.body);
      const beforeValues = {};
      for (const field of changedFields) {
        beforeValues[field] = existing[field] ?? null;
      }

      // Update in database (database manager handles deep merge and updatedAt timestamp)
      const updated = update(endpoint.collectionName, resourceId, req.body);

      // Build changes array for the updated event
      const changes = changedFields
        .filter(field => updated[field] !== existing[field])
        .map(field => ({ field, before: beforeValues[field], after: updated[field] ?? null }));

      // Auto-emit updated event with field-level diff
      try {
        const domain = apiMetadata.serverBasePath.replace(/^\//, '');
        const object = endpoint.collectionName.replace(/s$/, '');
        emitEvent({
          domain,
          object,
          action: 'updated',
          resourceId,
          source: apiMetadata.serverBasePath,
          data: { changes },
          callerId: req.headers['x-caller-id'] || null,
          traceparent: req.headers['traceparent'] || null,
          now: updated.updatedAt,
        });
      } catch (eventError) {
        console.error('Failed to emit updated event:', eventError.message);
      }

      // Fire onUpdate effects if any watched fields changed
      if (stateMachine?.onUpdate?.effects?.length > 0) {
        const watchedFields = stateMachine.onUpdate.fields;
        const changedFields = Object.keys(req.body);
        const shouldFire = !watchedFields || watchedFields.length === 0
          || changedFields.some(f => watchedFields.includes(f));

        if (shouldFire) {
          const callerRoles = req.headers['x-caller-roles']
            ? req.headers['x-caller-roles'].split(',').map(r => r.trim()).filter(Boolean)
            : [];
          const context = {
            caller: {
              id: req.headers['x-caller-id'],
              roles: callerRoles
            },
            object: { ...existing },
            request: req.body,
            now: new Date().toISOString(),
          };
          const { pendingRuleEvaluations } = applyEffects(stateMachine.onUpdate.effects, updated, context);
          processRuleEvaluations(pendingRuleEvaluations, updated, rules, stateMachine.domain);
        }
      }

      res.json(updated);
    } catch (error) {
      console.error('Update handler error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      });
    }
  };
}

/**
 * Extract the path parameter name from an OpenAPI path pattern.
 * Example: /cases/{caseId} => caseId
 */
function extractPathParam(path) {
  const match = path.match(/\{([^}]+)\}/);
  return match ? match[1] : 'id';
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
