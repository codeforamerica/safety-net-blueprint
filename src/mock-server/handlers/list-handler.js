/**
 * Handler for GET /resources (list/search)
 */

import { getDatabase } from '../database-manager.js';
import { executeSearch } from '../search-engine.js';

/**
 * Create list handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {Function} Express handler
 */
export function createListHandler(apiMetadata, endpoint) {
  return (req, res) => {
    try {
      // Get database (this will create it if it doesn't exist)
      const db = getDatabase(apiMetadata.name);
      
      // Ensure req.query exists
      const queryParams = req.query || {};
      
      // Determine searchable fields from query parameters in spec
      const searchableFields = [];
      for (const param of endpoint.parameters || []) {
        if (param.in === 'query' && param.name === 'search') {
          // Generic search parameter - look for name fields and email by default
          searchableFields.push('name.firstName', 'name.lastName', 'email');
          break;
        }
      }
      
      // Ensure pagination defaults exist
      const paginationDefaults = apiMetadata.pagination || {
        limitDefault: 25,
        limitMax: 100,
        offsetDefault: 0
      };
      
      // Execute search with filters and pagination
      const result = executeSearch(
        db, 
        queryParams, 
        searchableFields,
        paginationDefaults
      );
      
      // Ensure result has all required fields
      const safeResult = {
        items: result.items || [],
        total: result.total || 0,
        limit: result.limit || paginationDefaults.limitDefault || 25,
        offset: result.offset || 0,
        hasNext: result.hasNext || false
      };
      
      res.json(safeResult);
    } catch (error) {
      console.error('List handler error:', error);
      console.error('Error stack:', error.stack);
      console.error('API:', apiMetadata.name);
      console.error('Query params:', req.query);
      
      // Return empty list instead of error for better UX
      res.json({
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
        hasNext: false
      });
    }
  };
}
