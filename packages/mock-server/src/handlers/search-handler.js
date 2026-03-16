/**
 * Handler for GET /search (cross-resource search)
 *
 * Queries across multiple resource databases and returns a unified
 * SearchResult shape with facet counts per resource type.
 */

import { getDatabase } from '../database-manager.js';
import { buildSearchConditions, buildWhereClause, parsePagination } from '../search-engine.js';

/**
 * Resource mapping configuration.
 * Maps each SearchResultType to its database, searchable fields,
 * and functions that produce the uniform SearchResult shape.
 */
const RESOURCE_MAP = {
  person: {
    dbName: 'persons',
    searchableFields: ['name.firstName', 'name.lastName', 'email', 'phoneNumber'],
    title: (r) => {
      const first = r.name?.firstName || '';
      const last = r.name?.lastName || '';
      return `${first} ${last}`.trim() || r.id;
    },
    url: (r) => `/persons/${r.id}`,
    attributes: (r) => [
      r.email && { field: 'email', label: 'Email', value: r.email, type: 'string' },
      r.dateOfBirth && { field: 'dateOfBirth', label: 'Date of Birth', value: r.dateOfBirth, type: 'date' },
      r.phoneNumber && { field: 'phoneNumber', label: 'Phone', value: r.phoneNumber, type: 'string' },
    ].filter(Boolean),
  },

  case: {
    dbName: 'cases',
    searchableFields: ['status'],
    title: (r) => r.id,
    url: (r) => `/cases/${r.id}`,
    attributes: (r) => [
      r.status && { field: 'status', label: 'Status', value: r.status, type: 'string' },
      r.effectiveStartDate && { field: 'effectiveStartDate', label: 'Start Date', value: r.effectiveStartDate, type: 'date' },
    ].filter(Boolean),
  },

  application: {
    dbName: 'applications',
    searchableFields: ['status', 'state'],
    title: (r) => {
      const member = r.household?.members?.[0];
      if (member?.name) {
        const first = member.name.firstName || '';
        const last = member.name.lastName || '';
        return `${first} ${last}`.trim();
      }
      return r.id;
    },
    url: (r) => `/applications/${r.id}`,
    attributes: (r) => [
      r.status && { field: 'status', label: 'Status', value: r.status, type: 'string' },
      r.state && { field: 'state', label: 'State', value: r.state, type: 'string' },
    ].filter(Boolean),
  },

  task: {
    dbName: 'tasks',
    searchableFields: ['name', 'description', 'status'],
    title: (r) => r.name || r.id,
    url: (r) => `/tasks/${r.id}`,
    attributes: (r) => [
      r.status && { field: 'status', label: 'Status', value: r.status, type: 'string' },
      r.description && { field: 'description', label: 'Description', value: r.description, type: 'string' },
    ].filter(Boolean),
  },

  appointment: {
    dbName: 'appointments',
    searchableFields: ['appointmentType', 'status', 'notes'],
    title: (r) => {
      const type = r.appointmentType || 'Appointment';
      const date = r.startAt ? r.startAt.split('T')[0] : '';
      return date ? `${type} — ${date}` : type;
    },
    url: (r) => `/appointments/${r.id}`,
    attributes: (r) => [
      r.status && { field: 'status', label: 'Status', value: r.status, type: 'string' },
      r.appointmentType && { field: 'appointmentType', label: 'Type', value: r.appointmentType, type: 'string' },
      r.startAt && { field: 'startAt', label: 'Start', value: r.startAt, type: 'date' },
    ].filter(Boolean),
  },
};

const ALL_TYPES = Object.keys(RESOURCE_MAP);

/**
 * Create the cross-resource search handler.
 * @param {Object} apiMetadata - API metadata from the search OpenAPI spec
 * @returns {Function} Express handler
 */
export function createSearchHandler(apiMetadata) {
  return (req, res) => {
    try {
      const queryParams = req.query || {};
      const paginationDefaults = apiMetadata.pagination || {
        limitDefault: 25,
        limitMax: 100,
        offsetDefault: 0,
      };
      const { limit, offset } = parsePagination(queryParams, paginationDefaults);

      // Determine which types to search
      let requestedTypes = ALL_TYPES;
      if (queryParams.types) {
        const raw = Array.isArray(queryParams.types)
          ? queryParams.types
          : queryParams.types.split(',');
        const filtered = raw.map(t => t.trim()).filter(t => ALL_TYPES.includes(t));
        if (filtered.length > 0) {
          requestedTypes = filtered;
        }
      }

      // Strip `types` from query params before passing to search engine —
      // it's handled above and would otherwise be treated as a field filter.
      const { types: _types, ...searchParams } = queryParams;

      // Query each resource database
      const allResults = [];
      const facetCounts = {};

      for (const type of requestedTypes) {
        const config = RESOURCE_MAP[type];

        let db;
        try {
          db = getDatabase(config.dbName);
        } catch {
          // Database may not exist if the corresponding spec wasn't loaded
          facetCounts[type] = 0;
          continue;
        }

        // Build search conditions using the existing search engine
        const { whereClauses, params } = buildSearchConditions(
          searchParams,
          config.searchableFields,
        );
        const whereClause = buildWhereClause(whereClauses);

        // Count matching rows for facets
        const countQuery = `SELECT COUNT(*) as count FROM resources ${whereClause}`.trim();
        const countResult = db.prepare(countQuery).get(...params);
        const matchCount = countResult?.count || 0;
        facetCounts[type] = matchCount;

        if (matchCount === 0) continue;

        // Fetch all matching rows (no per-DB pagination — pagination applied to merged set)
        const selectQuery = `
          SELECT data FROM resources
          ${whereClause}
          ORDER BY COALESCE(json_extract(data, '$.createdAt'), '1970-01-01T00:00:00Z') DESC
        `.trim();
        const rows = db.prepare(selectQuery).all(...params);

        for (const row of rows) {
          try {
            const resource = JSON.parse(row.data);
            allResults.push({ type, resource });
          } catch {
            // skip unparseable rows
          }
        }
      }

      // Sort merged results by createdAt descending
      allResults.sort((a, b) => {
        const aDate = a.resource.createdAt || '1970-01-01T00:00:00Z';
        const bDate = b.resource.createdAt || '1970-01-01T00:00:00Z';
        return bDate.localeCompare(aDate);
      });

      // Total across all types
      const total = Object.values(facetCounts).reduce((sum, c) => sum + c, 0);

      // Apply pagination to the merged set
      const page = allResults.slice(offset, offset + limit);

      // Map to SearchResult shape
      const items = page.map(({ type, resource }) => {
        const config = RESOURCE_MAP[type];
        return {
          id: resource.id,
          type,
          title: config.title(resource),
          url: config.url(resource),
          score: 1.0,
          attributes: config.attributes(resource),
          createdAt: resource.createdAt,
          updatedAt: resource.updatedAt,
        };
      });

      // Build facets array (include all requested types, even those with 0 count)
      const facets = requestedTypes.map(type => ({
        type,
        count: facetCounts[type] || 0,
      }));

      res.json({
        items,
        total,
        limit,
        offset,
        hasNext: offset + limit < total,
        facets,
      });
    } catch (error) {
      console.error('Search handler error:', error);
      res.json({
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
        hasNext: false,
        facets: [],
      });
    }
  };
}
