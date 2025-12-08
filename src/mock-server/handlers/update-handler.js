/**
 * Handler for PATCH /resources/{id} (update)
 */

import { findById, update } from '../database-manager.js';
import { validate, createErrorResponse } from '../validator.js';

/**
 * Create update handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {Function} Express handler
 */
export function createUpdateHandler(apiMetadata, endpoint) {
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
          `${apiMetadata.name}-update`
        );
        
        if (!valid) {
          return res.status(422).json(createErrorResponse(errors, 422));
        }
      }
      
      // Update in database (database manager handles deep merge and updatedAt timestamp)
      const updated = update(apiMetadata.name, resourceId, req.body);
      
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
 * Capitalize first letter of a string
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
