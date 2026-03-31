/**
 * Handler for GET /metrics and GET /metrics/{metricId}
 */

import { findAll } from '../database-manager.js';
import jsonLogic from 'json-logic-js';

/**
 * Apply a JSON Logic filter to a list of records.
 * Returns records where the filter evaluates to true (or all records if no filter).
 */
function applyFilter(records, filter) {
  if (!filter) return records;
  return records.filter(r => {
    try {
      return Boolean(jsonLogic.apply(filter, r));
    } catch {
      return false;
    }
  });
}

/**
 * Apply time window and field filters to a collection of records.
 * @param {Array} records - All records in the collection
 * @param {Object} queryFilters - { from, to, queueId, program }
 * @param {string} collection - "tasks" or "events"
 */
function applyQueryFilters(records, queryFilters, collection) {
  let filtered = records;

  if (queryFilters.from) {
    const fromMs = new Date(queryFilters.from).getTime();
    filtered = filtered.filter(r => {
      const ts = collection === 'events' ? r.occurredAt : r.createdAt;
      return ts && new Date(ts).getTime() >= fromMs;
    });
  }

  if (queryFilters.to) {
    const toMs = new Date(queryFilters.to).getTime();
    filtered = filtered.filter(r => {
      const ts = collection === 'events' ? r.occurredAt : r.createdAt;
      return ts && new Date(ts).getTime() <= toMs;
    });
  }

  if (queryFilters.queueId && collection === 'tasks') {
    filtered = filtered.filter(r => r.queueId === queryFilters.queueId);
  }

  if (queryFilters.program && collection === 'tasks') {
    filtered = filtered.filter(r => r.programType === queryFilters.program);
  }

  return filtered;
}

/**
 * Get all records from a named collection.
 */
function getCollection(name) {
  try {
    return findAll(name).items || [];
  } catch {
    return [];
  }
}

/**
 * Compute the scalar value for a metric.
 * @param {Object} metric - Metric definition
 * @param {Object} collections - { tasks: [], events: [] }
 * @param {Object} queryFilters - { from, to, queueId, program }
 * @returns {number|null}
 */
function computeScalar(metric, collections, queryFilters) {
  switch (metric.aggregate) {
    case 'count': {
      const col = applyQueryFilters(collections[metric.source.collection], queryFilters, metric.source.collection);
      return applyFilter(col, metric.source.filter).length;
    }

    case 'ratio': {
      const sourceCol = applyQueryFilters(collections[metric.source.collection], queryFilters, metric.source.collection);
      const numerator = applyFilter(sourceCol, metric.source.filter).length;

      const totalDefinition = metric.total ?? { collection: metric.source.collection };
      const totalCol = applyQueryFilters(collections[totalDefinition.collection], queryFilters, totalDefinition.collection);
      const denominator = applyFilter(totalCol, totalDefinition.filter).length;

      if (denominator === 0) return 0;
      return numerator / denominator;
    }

    case 'duration': {
      const fromCol = applyQueryFilters(collections[metric.from.collection], queryFilters, metric.from.collection);
      const toCol = applyQueryFilters(collections[metric.to.collection], queryFilters, metric.to.collection);

      const fromEvents = applyFilter(fromCol, metric.from.filter);
      const toEvents = applyFilter(toCol, metric.to.filter);

      const pairBy = metric.pairBy || 'objectId';

      // Build a map of pairBy value → first from-event timestamp
      const fromMap = new Map();
      for (const e of fromEvents) {
        const key = e[pairBy];
        if (key && !fromMap.has(key)) {
          fromMap.set(key, new Date(e.occurredAt ?? e.createdAt).getTime());
        }
      }

      // Compute duration for each to-event that has a matching from-event
      const durations = [];
      for (const e of toEvents) {
        const key = e[pairBy];
        if (key && fromMap.has(key)) {
          const toMs = new Date(e.occurredAt ?? e.createdAt).getTime();
          const fromMs = fromMap.get(key);
          if (toMs > fromMs) {
            durations.push(toMs - fromMs);
          }
        }
      }

      if (durations.length === 0) return null;

      // Median
      durations.sort((a, b) => a - b);
      const mid = Math.floor(durations.length / 2);
      const medianMs = durations.length % 2 === 0
        ? (durations[mid - 1] + durations[mid]) / 2
        : durations[mid];

      // Return median in seconds
      return Math.round(medianMs / 1000);
    }

    default:
      return null;
  }
}

/**
 * Compute a grouped breakdown for a metric.
 * @param {Object} metric - Metric definition
 * @param {Object} collections - { tasks: [], events: [] }
 * @param {string} groupBy - Field to group by
 * @param {Object} queryFilters - { from, to, queueId, program }
 * @returns {Object} Map of group value → computed metric value
 */
function computeBreakdown(metric, collections, groupBy, queryFilters) {
  // Determine the primary collection for groupBy
  const primaryCollectionName = metric.source?.collection ?? metric.from?.collection ?? 'tasks';
  const primaryCol = applyQueryFilters(collections[primaryCollectionName], queryFilters, primaryCollectionName);

  // Get unique group values
  const groupValues = [...new Set(primaryCol.map(r => r[groupBy]).filter(v => v != null))];

  const breakdown = {};
  for (const groupValue of groupValues) {
    // Filter collections to this group value
    const groupedCollections = {
      tasks: collections.tasks.filter(r => r[groupBy] === groupValue),
      events: collections.events.filter(r => r[groupBy] === groupValue)
    };
    breakdown[groupValue] = computeScalar(metric, groupedCollections, queryFilters);
  }

  return breakdown;
}

/**
 * Format a metric definition + computed value into an API response object.
 */
function formatMetric(metric, domain, value, breakdown, computedAt) {
  return {
    id: metric.id,
    name: metric.name,
    domain,
    aggregate: metric.aggregate,
    value: breakdown ? null : value,
    breakdown: breakdown ?? null,
    targets: metric.targets ?? [],
    computedAt
  };
}

/**
 * Create the GET /metrics handler.
 * @param {Array} allMetrics - Array from discoverMetrics()
 * @returns {Function} Express handler
 */
export function createMetricsListHandler(allMetrics) {
  return (req, res) => {
    try {
      const queryFilters = {
        from: req.query.from || null,
        to: req.query.to || null,
        queueId: req.query.queueId || null,
        program: req.query.program || null
      };
      const groupBy = req.query.groupBy || null;
      const domainFilter = req.query.domain || null;
      const q = req.query.q || null;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;

      const computedAt = new Date().toISOString();
      const collections = {
        tasks: getCollection('tasks'),
        events: getCollection('events')
      };

      // Collect all metric definitions, optionally filtered by domain
      let entries = allMetrics;
      if (domainFilter) {
        entries = entries.filter(e => e.domain === domainFilter);
      }

      // Flatten and optionally filter by q (search by id or name)
      let flat = entries.flatMap(e => e.metrics.map(m => ({ metric: m, domain: e.domain })));
      if (q) {
        const lower = q.toLowerCase();
        flat = flat.filter(({ metric }) =>
          metric.id.toLowerCase().includes(lower) ||
          metric.name.toLowerCase().includes(lower)
        );
      }

      const total = flat.length;
      const page = flat.slice(offset, offset + limit);

      const items = page.map(({ metric, domain }) => {
        const breakdown = groupBy ? computeBreakdown(metric, collections, groupBy, queryFilters) : null;
        const value = breakdown ? null : computeScalar(metric, collections, queryFilters);
        return formatMetric(metric, domain, value, breakdown, computedAt);
      });

      res.json({
        items,
        total,
        limit,
        offset,
        hasNext: offset + limit < total
      });
    } catch (error) {
      console.error('Metrics list handler error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      });
    }
  };
}

/**
 * Create the GET /metrics/{metricId} handler.
 * @param {Array} allMetrics - Array from discoverMetrics()
 * @returns {Function} Express handler
 */
export function createMetricsGetHandler(allMetrics) {
  return (req, res) => {
    try {
      const { metricId } = req.params;
      const queryFilters = {
        from: req.query.from || null,
        to: req.query.to || null,
        queueId: req.query.queueId || null,
        program: req.query.program || null
      };
      const groupBy = req.query.groupBy || null;

      // Find metric across all domains
      let found = null;
      for (const entry of allMetrics) {
        const metric = entry.metrics.find(m => m.id === metricId);
        if (metric) {
          found = { metric, domain: entry.domain };
          break;
        }
      }

      if (!found) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: `Metric not found: ${metricId}`
        });
      }

      const computedAt = new Date().toISOString();
      const collections = {
        tasks: getCollection('tasks'),
        events: getCollection('events')
      };

      const breakdown = groupBy
        ? computeBreakdown(found.metric, collections, groupBy, queryFilters)
        : null;
      const value = breakdown ? null : computeScalar(found.metric, collections, queryFilters);

      res.json(formatMetric(found.metric, found.domain, value, breakdown, computedAt));
    } catch (error) {
      console.error('Metrics get handler error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      });
    }
  };
}
