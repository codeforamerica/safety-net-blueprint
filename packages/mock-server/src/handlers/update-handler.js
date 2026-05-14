/**
 * Handler for PATCH /resources/{id} (update)
 */

import { findById, update } from '../database-manager.js';
import { validate, createErrorResponse } from '../validator.js';
import { applyEffects, applySteps } from '../state-machine-engine.js';
import { executeProcedures, resolveContextLayers } from './procedure-runner.js';
import { mergeByPrecedence, buildInlineRules } from '../collection-utils.js';
import { emitEvent } from '../emit-event.js';

/**
 * Deep equality check for change detection.
 * Handles scalars, arrays, and objects so unchanged non-scalar fields
 * are not falsely reported as changed.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object' && !Array.isArray(a)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Build a field-level changes array by comparing two snapshots.
 * Excludes system-managed fields (id, createdAt, updatedAt).
 * Uses deep equality so unchanged arrays/objects are not reported.
 * @param {Object} before - Snapshot before mutations
 * @param {Object} after - Snapshot after all mutations have settled
 * @returns {Array<{ field: string, before: *, after: * }>}
 */
export function buildChanges(before, after) {
  const excluded = new Set(['id', 'createdAt', 'updatedAt']);
  const allFields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const field of allFields) {
    if (excluded.has(field)) continue;
    const beforeVal = before[field] ?? null;
    const afterVal = after[field] ?? null;
    if (!deepEqual(beforeVal, afterVal)) {
      changes.push({ field, before: beforeVal, after: afterVal });
    }
  }
  return changes;
}

/**
 * Create update handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @param {Object|null} stateMachine - State machine contract (for onUpdate effects)
 * @returns {Function} Express handler
 */
export function createUpdateHandler(apiMetadata, endpoint, stateMachine = null, slaTypes = [], machine = null) {
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

      // Snapshot existing state before any mutations
      const existingSnapshot = { ...existing };

      // Update in database (database manager handles deep merge and updatedAt timestamp)
      const updated = update(endpoint.collectionName, resourceId, req.body);

      // Fire onUpdate steps/effects if any watched fields changed.
      // Must run before emitting so rule-driven mutations (e.g. priority re-scored
      // because isExpedited changed) are included in the event's changes array.
      const newOnUpdate = machine?.triggers?.onUpdate;
      const oldOnUpdate = stateMachine?.onUpdate;
      const hasOnUpdate = newOnUpdate?.steps?.length > 0 || oldOnUpdate?.effects?.length > 0;

      if (hasOnUpdate) {
        const watchedFields = newOnUpdate?.fields ?? oldOnUpdate?.fields;
        const patchedFields = Object.keys(req.body);
        const shouldFire = !watchedFields || watchedFields.length === 0
          || patchedFields.some(f => watchedFields.includes(f));

        if (shouldFire) {
          const callerRoles = req.headers['x-caller-roles']
            ? req.headers['x-caller-roles'].split(',').map(r => r.trim()).filter(Boolean)
            : [];
          const baseContext = {
            caller: {
              id: req.headers['x-caller-id'],
              roles: callerRoles
            },
            object: { ...existing },
            request: req.body,
            now: new Date().toISOString(),
          };

          const entities = resolveContextLayers(
            [stateMachine?.context, machine?.context, newOnUpdate?.context ?? oldOnUpdate?.context],
            updated,
            baseContext
          );
          if (entities === null) {
            console.error('onUpdate: required context binding failed — skipping trigger');
          }
          const context = entities !== null ? { ...baseContext, entities } : baseContext;

          let pendingProcedures;
          if (newOnUpdate?.steps?.length > 0) {
            ({ pendingProcedures } = applySteps(newOnUpdate.steps, updated, context));
          } else {
            ({ pendingProcedures } = applyEffects(oldOnUpdate.effects, updated, context));
          }
          const inlineRules = buildInlineRules(stateMachine, machine);
          executeProcedures(pendingProcedures, updated, inlineRules, context);

          // Persist any rule-driven mutations (e.g. priority, queueId) back to DB
          const onUpdateDiff = {};
          for (const [key, value] of Object.entries(updated)) {
            if (existingSnapshot[key] !== value && !req.body.hasOwnProperty(key)
                && key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
              onUpdateDiff[key] = value;
            }
          }
          if (Object.keys(onUpdateDiff).length > 0) {
            update(endpoint.collectionName, resourceId, onUpdateDiff);
          }
        }
      }

      // Build changes diff after all mutations have settled (PATCH fields + any rule-driven mutations)
      const changes = buildChanges(existingSnapshot, updated);

      // Emit updated event with complete field-level diff
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
 * Returns the LAST parameter so sub-item paths like
 * /resources/{parentId}/sub/{subId} resolve to the sub-resource id.
 */
function extractPathParam(path) {
  const matches = path.match(/\{([^}]+)\}/g);
  if (!matches) return 'id';
  return matches[matches.length - 1].replace(/[{}]/g, '');
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
