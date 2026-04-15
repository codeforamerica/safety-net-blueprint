/**
 * Handler for DELETE /resources/{id}
 */

import { findById, deleteResource } from '../database-manager.js';
import { emitEvent } from '../emit-event.js';
import { isConfigManaged } from '../config-registry.js';

/**
 * Create delete handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {Function} Express handler
 */
export function createDeleteHandler(apiMetadata, endpoint) {
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

      // Block deletion of config-managed resources
      if (isConfigManaged(endpoint.collectionName, resourceId)) {
        return res.status(409).json({
          code: 'CONFIG_MANAGED',
          message: `${capitalize(paramName.replace(/Id$/, ''))} is managed by deployment configuration and cannot be deleted`
        });
      }

      // Delete the resource
      deleteResource(endpoint.collectionName, resourceId);

      // Auto-emit deleted event
      try {
        const domain = apiMetadata.serverBasePath.replace(/^\//, '');
        const object = endpoint.collectionName.replace(/s$/, '');
        emitEvent({
          domain,
          object,
          action: 'deleted',
          resourceId,
          source: apiMetadata.serverBasePath,
          data: null,
          callerId: req.headers['x-caller-id'] || null,
          traceparent: req.headers['traceparent'] || null,
          now: new Date().toISOString(),
        });
      } catch (eventError) {
        console.error('Failed to emit deleted event:', eventError.message);
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete handler error:', error);
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
