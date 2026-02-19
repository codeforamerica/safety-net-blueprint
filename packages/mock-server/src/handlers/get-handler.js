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
  const paramName = extractPathParam(endpoint.path);
  return (req, res) => {
    try {
      const resourceId = req.params[paramName] || req.params.id;

      const resource = findById(apiMetadata.name, resourceId);

      if (!resource) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: `${capitalize(paramName.replace(/Id$/, ''))} not found`
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
