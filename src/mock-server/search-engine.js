/**
 * Search and filter engine for building dynamic SQL queries
 * Supports searching across JSON fields in SQLite
 *
 * Supports the `q` parameter with Elasticsearch/GitHub-style search syntax:
 *   q=term                      # Full-text search
 *   q=field:value               # Exact match
 *   q=field:>value              # Greater than
 *   q=field:>=value             # Greater than or equal
 *   q=field:<value              # Less than
 *   q=field:<=value             # Less than or equal
 *   q=field:val1,val2           # Match any (OR)
 *   q=-field:value              # Exclude/negate
 *   q=field:*                   # Field exists
 *   q=term1 term2               # Multiple conditions (AND)
 *   q=field.nested:value        # Nested field (dot notation)
 */

import { parseQueryString, tokensToSqlConditions } from './query-parser.js';

/**
 * Build search conditions for SQLite JSON queries
 * @param {Object} queryParams - Request query parameters
 * @param {Array} searchableFields - List of fields that support search
 * @returns {Object} {whereClauses: Array, params: Array}
 */
export function buildSearchConditions(queryParams = {}, searchableFields = []) {
  const whereClauses = [];
  const params = [];

  // Ensure queryParams is an object
  if (!queryParams || typeof queryParams !== 'object') {
    return { whereClauses, params };
  }

  // Handle the `q` parameter with search syntax
  if (queryParams.q) {
    const tokens = parseQueryString(queryParams.q);
    const { whereClauses: qClauses, params: qParams } = tokensToSqlConditions(tokens, searchableFields);
    whereClauses.push(...qClauses);
    params.push(...qParams);
  }

  // Handle legacy 'search' parameter (searches across multiple fields)
  // This provides backward compatibility
  if (queryParams.search && searchableFields.length > 0) {
    const searchClauses = searchableFields.map(field =>
      `LOWER(COALESCE(json_extract(data, '$.${field}'), '')) LIKE LOWER(?)`
    );
    whereClauses.push(`(${searchClauses.join(' OR ')})`);

    // Add search pattern for each field
    const searchPattern = `%${queryParams.search}%`;
    searchableFields.forEach(() => params.push(searchPattern));
  }

  // Handle specific field filters (exact match) - legacy support
  // Skip if using `q` parameter to avoid double-filtering
  if (!queryParams.q) {
    for (const [key, value] of Object.entries(queryParams)) {
      // Skip special parameters
      if (['search', 'q', 'limit', 'offset', 'page'].includes(key)) {
        continue;
      }

      // Handle array parameters (e.g., programs[])
      if (Array.isArray(value)) {
        // For array fields, check if the JSON array contains the value
        const arrayClauses = value.map(() =>
          `EXISTS (
            SELECT 1 FROM json_each(json_extract(data, '$.${key}'))
            WHERE value = ?
          )`
        );
        whereClauses.push(`(${arrayClauses.join(' OR ')})`);
        params.push(...value);
      } else if (value !== undefined && value !== null && value !== '') {
        // Exact match for single values
        whereClauses.push(`json_extract(data, '$.${key}') = ?`);
        params.push(value);
      }
    }
  }

  return { whereClauses, params };
}

/**
 * Build complete WHERE clause from conditions
 * @param {Array} whereClauses - Array of WHERE clause strings
 * @returns {string} Complete WHERE clause or empty string
 */
export function buildWhereClause(whereClauses) {
  if (whereClauses.length === 0) {
    return '';
  }
  return `WHERE ${whereClauses.join(' AND ')}`;
}

/**
 * Parse pagination parameters
 * @param {Object} queryParams - Request query parameters
 * @param {Object} defaults - Default pagination values
 * @returns {Object} {limit: number, offset: number}
 */
export function parsePagination(queryParams = {}, defaults = { limit: 25, offset: 0 }) {
  // Ensure defaults exist
  const defaultLimit = defaults.limit || defaults.limitDefault || 25;
  const defaultOffset = defaults.offset || defaults.offsetDefault || 0;
  
  let limit = parseInt(queryParams.limit) || defaultLimit;
  let offset = parseInt(queryParams.offset) || defaultOffset;
  
  // Ensure limits are within bounds
  const maxLimit = defaults.limitMax || 100;
  limit = Math.max(1, Math.min(limit, maxLimit));
  offset = Math.max(0, offset);
  
  return { limit, offset };
}

/**
 * Execute search query with filters and pagination
 * @param {Object} db - SQLite database instance
 * @param {Object} queryParams - Request query parameters
 * @param {Array} searchableFields - Fields that support search
 * @param {Object} paginationDefaults - Default pagination values
 * @returns {Object} {items: Array, total: number, limit: number, offset: number, hasNext: boolean}
 */
export function executeSearch(db, queryParams = {}, searchableFields = [], paginationDefaults = {}) {
  const { whereClauses, params } = buildSearchConditions(queryParams, searchableFields);
  const whereClause = buildWhereClause(whereClauses);
  const { limit, offset } = parsePagination(queryParams, paginationDefaults);
  
  try {
    // Get total count
    const countQuery = `SELECT COUNT(*) as count FROM resources ${whereClause}`.trim();
    const countStmt = db.prepare(countQuery);
    const countResult = countStmt.get(...params);
    const total = countResult?.count || 0;
    
    // Get paginated items
    // Use COALESCE to handle NULL createdAt values (sorts them last)
    const selectQuery = `
      SELECT data FROM resources 
      ${whereClause}
      ORDER BY COALESCE(json_extract(data, '$.createdAt'), '1970-01-01T00:00:00Z') DESC
      LIMIT ? OFFSET ?
    `.trim();
    const selectStmt = db.prepare(selectQuery);
    const rows = selectStmt.all(...params, limit, offset);
    
    // Safely parse JSON, handle any parse errors
    const items = rows.map(row => {
      try {
        return JSON.parse(row.data);
      } catch (parseError) {
        console.error('Failed to parse row data:', parseError);
        return null;
      }
    }).filter(item => item !== null);
    
    // Calculate hasNext
    const hasNext = offset + limit < total;
    
    return { items, total, limit, offset, hasNext };
  } catch (error) {
    console.error('Execute search error:', error);
    console.error('Query params:', queryParams);
    console.error('Where clause:', whereClause);
    console.error('Params:', params);
    
    // Return empty result instead of throwing
    return { 
      items: [], 
      total: 0, 
      limit, 
      offset, 
      hasNext: false 
    };
  }
}
