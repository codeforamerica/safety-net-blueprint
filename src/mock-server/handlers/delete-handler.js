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
  return (req, res) => {
    try {
      const resourceId = req.params[`${apiMetadata.name.slice(0, -1)}Id`] || req.params.id;
      
      // Check if resource exists
      const existing = findById(apiMetadata.name, resourceId);
      if (!existing) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: `${capitalize(apiMetadata.name.slice(0, -1))} not found`
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
 * Capitalize first letter of a string
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
