/**
 * Handler for /users/me — returns the authenticated user's own record.
 */

import { findById } from '../database-manager.js';
import { extractAuthContext } from '../auth-context.js';

/**
 * Create a handler for the current-user singleton endpoint.
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {Function} Express handler
 */
export function createCurrentUserHandler(apiMetadata, endpoint) {
  return (req, res) => {
    try {
      const auth = extractAuthContext(req);
      if (!auth) {
        return res.status(401).json({
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      const resource = findById(endpoint.collectionName, auth.userId);
      if (!resource) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      res.json(resource);
    } catch (error) {
      console.error('Current user handler error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      });
    }
  };
}
