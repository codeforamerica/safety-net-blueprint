/**
 * Handler for POST /resources (create)
 */

import { create } from '../database-manager.js';
import { validate, createErrorResponse } from '../validator.js';

/**
 * Create create handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @param {string} baseUrl - Base URL for Location header
 * @returns {Function} Express handler
 */
export function createCreateHandler(apiMetadata, endpoint, baseUrl) {
  return (req, res) => {
    try {
      // Check if request body is an object (400 for malformed request)
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          message: 'Request body must be a JSON object',
          details: [{ field: 'body', message: 'must be object' }]
        });
      }
      
      // Validate request body (422 for validation errors)
      if (endpoint.requestSchema) {
        const { valid, errors } = validate(
          req.body, 
          endpoint.requestSchema,
          `${apiMetadata.name}-create`
        );
        
        if (!valid) {
          return res.status(422).json(createErrorResponse(errors, 422));
        }
      }
      
      // Create resource in database
      const resource = create(apiMetadata.name, req.body);
      
      // Build Location header
      const location = `${baseUrl}${endpoint.path}/${resource.id}`;
      
      res.status(201)
        .header('Location', location)
        .json(resource);
    } catch (error) {
      console.error('Create handler error:', error);
      
      // Handle unique constraint violations
      if (error.message?.includes('UNIQUE constraint')) {
        return res.status(409).json({
          code: 'CONFLICT',
          message: 'A resource with this identifier already exists'
        });
      }
      
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      });
    }
  };
}
