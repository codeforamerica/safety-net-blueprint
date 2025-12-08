/**
 * Handler for GET /resources/{id}
 */

import { findById } from '../database-manager.js';

/**
 * Create get-by-id handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {Function} Express handler
 */
export function createGetHandler(apiMetadata, endpoint) {
  return (req, res) => {
    try {
      const resourceId = req.params[`${apiMetadata.name.slice(0, -1)}Id`] || req.params.id;
      
      const resource = findById(apiMetadata.name, resourceId);
      
      if (!resource) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: `${capitalize(apiMetadata.name.slice(0, -1))} not found`
        });
      }
      
      res.json(resource);
    } catch (error) {
      console.error('Get handler error:', error);
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
