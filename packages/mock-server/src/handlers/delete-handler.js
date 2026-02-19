/**
 * Handler for DELETE /resources/{id}
 */

import { findById, deleteResource } from '../database-manager.js';

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
      const existing = findById(apiMetadata.name, resourceId);
      if (!existing) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: `${capitalize(paramName.replace(/Id$/, ''))} not found`
        });
      }
      
      // Delete the resource
      deleteResource(apiMetadata.name, resourceId);
      
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
