/**
 * Handler for GET /resources (list/search)
 */

import { getDatabase, findById } from '../database-manager.js';
import { executeSearch, PAGINATION_DEFAULTS } from '../search-engine.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { extractAuthContext } from '../auth-context.js';
import { extractExpandFields, applyExpand, getItemSchema, extractLinksFields, applyLinks, extractDerivedFields, applyDerivedFields } from './expand-utils.js';

/**
 * Extract all string-typed field paths from an OpenAPI schema.
 * Walks one level into object properties to support nested fields
 * like name.firstName.
 */
function extractStringFields(schemas) {
  const fields = [];
  for (const schema of Object.values(schemas)) {
    if (!schema.properties) continue;
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (prop.type === 'string') {
        fields.push(key);
      } else if (prop.type === 'object' && prop.properties) {
        for (const [nested, nestedProp] of Object.entries(prop.properties)) {
          if (nestedProp.type === 'string') {
            fields.push(`${key}.${nested}`);
          }
        }
      }
    }
  }
  return [...new Set(fields)];
}

/**
 * Create list handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {Function} Express handler
 */
export function createListHandler(apiMetadata, endpoint) {
  // Derive searchable fields from schema string properties
  const schemaFields = extractStringFields(apiMetadata.schemas || {});

  return (req, res) => {
    try {
      const httpStub = matchAndPopHttp(req.method, req.path);
      if (httpStub) {
        return res.status(httpStub.response?.status ?? 200).json(httpStub.response?.body ?? {});
      }

      // Get database (this will create it if it doesn't exist)
      const db = getDatabase(endpoint.collectionName);

      // Resolve "me" in the q param to the authenticated user's ID.
      // e.g. q=assignedTo:me → q=assignedTo:<callerId>
      const queryParams = { ...(req.query || {}) };
      if (queryParams.q && queryParams.q.includes(':me')) {
        const auth = extractAuthContext(req);
        if (auth) {
          queryParams.q = queryParams.q.replace(/:me(?=[ ,]|$)/g, `:${auth.userId}`);
        }
      }

      // Build the searchable fields allowlist from two sources:
      //   1. Schema string fields (when a `q` or `search` param is declared)
      //   2. Declared query parameters — any `in: query` param is an
      //      intentionally filterable field; including these ensures that params
      //      backed by $ref schemas (which extractStringFields cannot resolve)
      //      still pass the SQL injection allowlist check.
      const RESERVED_PARAMS = new Set(['q', 'search', 'limit', 'offset', 'page', 'sort']);
      let searchableFields = [];
      const declaredQueryParams = (endpoint.parameters || [])
        .filter(p => p.in === 'query' && !RESERVED_PARAMS.has(p.name))
        .map(p => p.name);
      for (const param of endpoint.parameters || []) {
        if (param.in === 'query' && (param.name === 'q' || param.name === 'search')) {
          searchableFields = [...new Set([...schemaFields, ...declaredQueryParams])];
          break;
        }
      }
      // Always include declared query params even without a q/search param,
      // so that endpoints with only explicit filters (no full-text search)
      // still allow those filters through the SQL injection allowlist.
      if (searchableFields.length === 0 && declaredQueryParams.length > 0) {
        searchableFields = declaredQueryParams;
      }

      const paginationDefaults = { ...PAGINATION_DEFAULTS, ...apiMetadata.pagination };

      // Execute search with filters, pagination, and sort
      const result = executeSearch(
        db,
        queryParams,
        searchableFields,
        paginationDefaults,
        endpoint.sortable
      );

      // Sort parser failure → 400 with the documented error code.
      // Match the codebase-wide error shape used by create-handler,
      // update-handler, delete-handler, etc.: {code, message, details[]}
      // so clients can branch on `code` and surface `details[].message`
      // uniformly regardless of which endpoint emitted the error.
      if (result.error) {
        const details = result.error.field !== undefined
          ? [{ field: result.error.field, message: result.error.message }]
          : [];
        return res.status(400).json({
          code: result.error.code,
          message: result.error.message,
          details
        });
      }

      // Ensure result has all required fields
      const safeResult = {
        items: result.items || [],
        total: result.total || 0,
        limit: result.limit || paginationDefaults.limitDefault || 25,
        offset: result.offset || 0,
        hasNext: result.hasNext || false
      };

      const itemSchema = getItemSchema(endpoint.responseSchema, apiMetadata.schemas);
      const expandFields = extractExpandFields(itemSchema);
      const linksFields = extractLinksFields(itemSchema);
      const derivedFields = extractDerivedFields(itemSchema);
      if (expandFields.length > 0 || linksFields.length > 0 || derivedFields.length > 0) {
        safeResult.items = safeResult.items.map(item => {
          let result = expandFields.length > 0 ? applyExpand(item, expandFields, findById) : item;
          if (linksFields.length > 0) result = applyLinks(result, linksFields, apiMetadata.serverBasePath);
          if (derivedFields.length > 0) result = applyDerivedFields(result, derivedFields);
          return result;
        });
      }

      res.json(safeResult);
    } catch (error) {
      console.error('List handler error:', error);
      console.error('Error stack:', error.stack);
      console.error('API:', apiMetadata.name);
      console.error('Query params:', req.query);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      });
    }
  };
}
