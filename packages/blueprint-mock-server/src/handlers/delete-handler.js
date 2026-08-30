/**
 * Handler for DELETE /resources/{id}
 */

import { findById, deleteResource } from '../database-manager.js';
import { emitEvent } from '../emit-event.js';
import { isConfigManaged } from '../config-registry.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { extractPrimaryParam, capitalize } from '../collection-utils.js';
import { extractCallerRoles } from '../auth-context.js';

/**
 * Create delete handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {Function} Express handler
 */
export function createDeleteHandler(apiMetadata, endpoint) {
  const paramName = extractPrimaryParam(endpoint.path) ?? 'id';
  return (req, res) => {
    try {
      const httpStub = matchAndPopHttp(req.method, req.path);
      if (httpStub) {
        const status = httpStub.response?.status ?? 204;
        return status === 204 || !httpStub.response?.body
          ? res.status(status).end()
          : res.status(status).json(httpStub.response.body);
      }

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
          callerRoles: extractCallerRoles(req),
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

