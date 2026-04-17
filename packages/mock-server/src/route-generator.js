/**
 * Dynamic route generator
 * Creates Express routes from OpenAPI specifications
 */

import { createListHandler } from './handlers/list-handler.js';
import { createGetHandler } from './handlers/get-handler.js';
import { createCreateHandler } from './handlers/create-handler.js';
import { createUpdateHandler } from './handlers/update-handler.js';
import { createDeleteHandler } from './handlers/delete-handler.js';
import { createTransitionHandler } from './handlers/transition-handler.js';
import { createSearchHandler } from './handlers/search-handler.js';
import { createMetricsListHandler, createMetricsGetHandler } from './handlers/metrics-handler.js';
import { findSlaTypes } from './sla-loader.js';
import { findAll, update } from './database-manager.js';
import { emitEvent } from './emit-event.js';
import { deriveCollectionName } from './collection-utils.js';

/**
 * Determine if a path is a flat collection endpoint (no path parameters).
 * e.g., /applications
 */
function isCollectionEndpoint(path) {
  return !path.includes('{') && !path.includes('}');
}

/**
 * Determine if a path is a flat item endpoint (exactly one {param}, last segment).
 * e.g., /applications/{applicationId}
 */
function isItemEndpoint(path) {
  const params = path.match(/\{[^}]+\}/g) || [];
  return params.length === 1 && path.trimEnd().endsWith('}');
}

/**
 * Determine if a path is a sub-resource endpoint — a parent {param} precedes a
 * literal final segment. Matches both sub-collections and singletons.
 * e.g., /applications/{applicationId}/documents
 *       /applications/{applicationId}/interview
 */
function isSubResourceEndpoint(path) {
  return path.includes('{') && !path.trimEnd().endsWith('}');
}

/**
 * Determine if a path is a sub-item endpoint — ends with a {param} and has
 * more than one path parameter (at least one parent + the sub-resource id).
 * e.g., /applications/{applicationId}/documents/{documentId}
 */
function isSubItemEndpoint(path) {
  const params = path.match(/\{[^}]+\}/g) || [];
  return path.trimEnd().endsWith('}') && params.length > 1;
}

/**
 * Determine whether a sub-resource endpoint is a singleton (singular last segment)
 * vs. a sub-collection (plural last segment ending in 's').
 * Convention: collections use plural names; singletons use singular.
 * e.g., /applications/{applicationId}/interview → singleton (singular)
 *       /applications/{applicationId}/documents → collection (plural)
 */
function isSingletonSubResource(path) {
  const segments = path.split('/').filter(s => s && !s.startsWith('{'));
  const lastSegment = segments[segments.length - 1];
  return Boolean(lastSegment && !lastSegment.endsWith('s'));
}

/**
 * Extract the parent path parameter name from a sub-resource path.
 * e.g., /intake/applications/{applicationId}/documents → 'applicationId'
 */
function extractParentParam(path) {
  const match = path.match(/\{([^}]+)\}/);
  return match ? match[1] : null;
}

/**
 * Derive the parent collection name from a sub-resource path.
 * Returns the last non-param segment BEFORE the sub-resource segment.
 * e.g., /intake/applications/{applicationId}/documents → 'applications'
 */
function deriveParentCollection(path, basePath) {
  const resourcePath = basePath && path.startsWith(basePath) ? path.slice(basePath.length) : path;
  const segments = resourcePath.split('/').filter(s => s && !s.startsWith('{'));
  return segments.length >= 2 ? segments[segments.length - 2] : '';
}

/**
 * Create a GET handler for a singleton sub-resource.
 * Looks up the resource by parent field value (e.g., applicationId) rather than by its own id.
 */
function createSingletonGetHandler(endpoint, parentParam, parentField) {
  const resourceLabel = endpoint.collectionName.replace(/s$/, '');
  return (req, res) => {
    try {
      const parentId = req.params[parentParam];
      const { items } = findAll(endpoint.collectionName, { [parentField]: parentId }, { limit: 1 });
      if (items.length === 0) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: `${capitalize(resourceLabel)} not found`
        });
      }
      res.json(items[0]);
    } catch (error) {
      console.error('Singleton get handler error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [{ message: error.message }] });
    }
  };
}

/**
 * Create a PATCH handler for a singleton sub-resource.
 * Resolves the resource by parent field, then applies the standard update.
 */
function createSingletonUpdateHandler(apiMetadata, endpoint, parentParam, parentField) {
  const resourceLabel = endpoint.collectionName.replace(/s$/, '');
  return (req, res) => {
    try {
      const parentId = req.params[parentParam];
      const { items } = findAll(endpoint.collectionName, { [parentField]: parentId }, { limit: 1 });
      if (items.length === 0) {
        return res.status(404).json({ code: 'NOT_FOUND', message: `${capitalize(resourceLabel)} not found` });
      }
      const existing = items[0];

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: 'Request body must be a JSON object', details: [{ field: 'body', message: 'must be object' }] });
      }
      if (Object.keys(req.body).length === 0) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: 'Request body must contain at least one field to update', details: [{ field: 'body', message: 'minProperties: 1' }] });
      }

      const updated = update(endpoint.collectionName, existing.id, req.body);

      try {
        const domain = apiMetadata.serverBasePath.replace(/^\//, '');
        emitEvent({
          domain,
          object: resourceLabel,
          action: 'updated',
          resourceId: existing.id,
          source: apiMetadata.serverBasePath,
          data: { changes: [] },
          callerId: req.headers['x-caller-id'] || null,
          traceparent: req.headers['traceparent'] || null,
          now: updated.updatedAt,
        });
      } catch (e) { /* non-fatal */ }

      res.json(updated);
    } catch (error) {
      console.error('Singleton update handler error:', error);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [{ message: error.message }] });
    }
  };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert OpenAPI path format to Express path format
 * Example: /persons/{personId} => /persons/:personId
 */
function convertPathFormat(path) {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}


/**
 * Register routes for an API specification
 * @param {Object} app - Express app
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {string} baseUrl - Base URL for Location headers
 * @param {Array} stateMachines - State machine entries for this API's domain (from discoverStateMachines)
 * @param {Array|null} rules - Rules for this API's domain (null if none)
 * @returns {Array} Array of registered endpoint info
 */
export function registerRoutes(app, apiMetadata, baseUrl, stateMachines, rules, slaTypes = []) {
  const registeredEndpoints = [];

  console.log(`  Registering routes for ${apiMetadata.title}...`);

  for (const endpoint of apiMetadata.endpoints) {
    const expressPath = convertPathFormat(endpoint.path);
    const method = endpoint.method.toLowerCase();
    const collectionName = deriveCollectionName(endpoint.path, apiMetadata.serverBasePath);
    const endpointWithCollection = { ...endpoint, collectionName };

    let handler = null;
    let description = '';

    // Determine handler based on method and path type.
    // Check order matters: sub-resource/sub-item checks must come before the flat
    // item check because both contain '{' parameters.
    if (endpoint.operationId === 'streamEvents') {
      // Handled by manual registration in server.js before routes are registered
      continue;
    } else if (endpoint.operationId === 'search') {
      // Cross-resource search endpoint — custom handler
      handler = createSearchHandler(apiMetadata);
      description = 'Cross-resource search';
    } else if (method === 'get' && isCollectionEndpoint(endpoint.path)) {
      // GET /resources - List/search
      handler = createListHandler(apiMetadata, endpointWithCollection);
      description = 'List/search resources';
    } else if (method === 'post' && isCollectionEndpoint(endpoint.path)) {
      // POST /resources - Create
      // Only pass state machine to the collection that matches the governed object.
      // Use kebab-plural comparison to handle multi-word names (ApplicationDocument → application-documents).
      const smEntry = (Array.isArray(stateMachines) ? stateMachines : []).find(s => {
        const obj = s.object;
        return obj?.toLowerCase() + 's' === collectionName ||
          obj?.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() + 's' === collectionName;
      });
      const smForEndpoint = smEntry?.stateMachine || null;
      const domainSlaTypes = smForEndpoint ? findSlaTypes(slaTypes, smForEndpoint.domain) : [];
      handler = createCreateHandler(apiMetadata, endpointWithCollection, baseUrl, smForEndpoint, rules, domainSlaTypes);
      description = 'Create resource';
    } else if (isSubResourceEndpoint(endpoint.path)) {
      // Sub-resource endpoint: /resources/{parentId}/sub or /resources/{parentId}/sub/{subId}
      // Last path segment is a literal (not a {param}).
      const parentParam = extractParentParam(endpoint.path);
      const parentField = parentParam; // URL param name == field name on the sub-resource
      if (isSingletonSubResource(endpoint.path)) {
        // Singleton: at most one child per parent (e.g., /applications/{applicationId}/interview)
        if (method === 'get') {
          handler = createSingletonGetHandler(endpointWithCollection, parentParam, parentField);
          description = 'Get singleton sub-resource';
        } else if (method === 'patch') {
          handler = createSingletonUpdateHandler(apiMetadata, endpointWithCollection, parentParam, parentField);
          description = 'Update singleton sub-resource';
        } else {
          console.warn(`    Warning: Unsupported method ${method.toUpperCase()} on singleton ${endpoint.path}`);
          continue;
        }
      } else {
        // Sub-collection: /resources/{parentId}/subResources
        if (method === 'get') {
          const parentCollection = deriveParentCollection(endpoint.path, apiMetadata.serverBasePath);
          const pagination = apiMetadata.pagination || {};
          handler = (req, res) => {
            try {
              const parentId = req.params[parentParam];
              // Verify parent exists before listing sub-resources
              if (parentCollection) {
                const { items: parentCheck } = findAll(parentCollection, { id: parentId }, { limit: 1 });
                if (parentCheck.length === 0) {
                  const label = capitalize(parentCollection.replace(/s$/, ''));
                  return res.status(404).json({ code: 'NOT_FOUND', message: `${label} not found` });
                }
              }
              // List sub-resources filtered by parent ID
              // Note: req.query mutation does not work reliably in Express 5 (getter re-evaluates),
              // so we call findAll directly rather than routing through createListHandler.
              const limit = Math.min(parseInt(req.query.limit) || pagination.limitDefault || 25, pagination.limitMax || 100);
              const offset = parseInt(req.query.offset) || 0;
              const result = findAll(endpointWithCollection.collectionName, { [parentField]: parentId }, { limit, offset });
              return res.json(result);
            } catch (error) {
              res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [{ message: error.message }] });
            }
          };
          description = 'List sub-resources';
        } else if (method === 'post') {
          const baseCreateHandler = createCreateHandler(apiMetadata, endpointWithCollection, baseUrl, null, null, []);
          handler = (req, res) => {
            req.body = { ...(req.body || {}), [parentField]: req.params[parentParam] };
            return baseCreateHandler(req, res);
          };
          description = 'Create sub-resource';
        } else {
          console.warn(`    Warning: Unsupported method ${method.toUpperCase()} on sub-collection ${endpoint.path}`);
          continue;
        }
      }
    } else if (isSubItemEndpoint(endpoint.path)) {
      // Sub-item: /resources/{parentId}/sub/{subId} — standard item handlers, correct collection
      if (method === 'get') {
        handler = createGetHandler(apiMetadata, endpointWithCollection);
        description = 'Get sub-resource by ID';
      } else if (method === 'patch') {
        handler = createUpdateHandler(apiMetadata, endpointWithCollection, null, rules);
        description = 'Update sub-resource';
      } else if (method === 'delete') {
        handler = createDeleteHandler(apiMetadata, endpointWithCollection);
        description = 'Delete sub-resource';
      } else {
        console.warn(`    Warning: Unsupported method ${method.toUpperCase()} on sub-item ${endpoint.path}`);
        continue;
      }
    } else if (method === 'get' && isItemEndpoint(endpoint.path)) {
      // GET /resources/{id} - Get by ID
      handler = createGetHandler(apiMetadata, endpointWithCollection);
      description = 'Get resource by ID';
    } else if (method === 'patch' && isItemEndpoint(endpoint.path)) {
      // PATCH /resources/{id} - Update
      const smEntry = (Array.isArray(stateMachines) ? stateMachines : []).find(s => {
        const obj = s.object;
        return obj?.toLowerCase() + 's' === collectionName ||
          obj?.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() + 's' === collectionName;
      });
      const smForEndpoint = smEntry?.stateMachine || null;
      handler = createUpdateHandler(apiMetadata, endpointWithCollection, smForEndpoint, rules);
      description = 'Update resource';
    } else if (method === 'delete' && isItemEndpoint(endpoint.path)) {
      // DELETE /resources/{id} - Delete
      handler = createDeleteHandler(apiMetadata, endpointWithCollection);
      description = 'Delete resource';
    } else {
      console.warn(`    Warning: Unsupported endpoint ${method.toUpperCase()} ${endpoint.path}`);
      continue;
    }

    // Register the route
    app[method](expressPath, handler);

    registeredEndpoints.push({
      method: method.toUpperCase(),
      path: endpoint.path,
      expressPath,
      description,
      operationId: endpoint.operationId
    });

    console.log(`    ${method.toUpperCase().padEnd(6)} ${expressPath} - ${description}`);
  }

  return registeredEndpoints;
}

/**
 * Register routes for all API specifications
 * @param {Object} app - Express app
 * @param {Array} apiSpecs - Array of API metadata objects
 * @param {string} baseUrl - Base URL for Location headers
 * @param {Array} stateMachines - Array from discoverStateMachines()
 * @param {Array} rules - Array from discoverRules()
 * @returns {Array} Array of all registered endpoints grouped by API
 */
export function registerAllRoutes(app, apiSpecs, baseUrl, stateMachines = [], rules = [], slaTypes = [], metrics = []) {
  console.log('\nRegistering API routes...');

  const allEndpoints = [];

  // Register custom metrics routes FIRST so they take priority over standard CRUD handlers
  // for the /workflow/metrics paths declared in workflow-openapi.yaml.
  if (metrics.length > 0) {
    console.log('  Registering metrics routes...');
    app.get('/workflow/metrics', createMetricsListHandler(metrics));
    app.get('/workflow/metrics/:metricId', createMetricsGetHandler(metrics));
    console.log('    GET    /workflow/metrics - List computed metrics');
    console.log('    GET    /workflow/metrics/:metricId - Get computed metric');
  }

  for (const apiSpec of apiSpecs) {
    // Pass all state machines for this domain — there may be more than one (e.g., Application + ApplicationDocument)
    const domainSMs = stateMachines.filter(s => s.domain === apiSpec.name);
    const endpoints = registerRoutes(app, apiSpec, baseUrl, domainSMs, rules, slaTypes);
    allEndpoints.push({
      apiName: apiSpec.name,
      title: apiSpec.title,
      endpoints
    });
  }

  console.log('✓ All routes registered\n');
  return allEndpoints;
}

/**
 * Register state machine RPC routes (e.g., POST /tasks/:taskId/claim).
 * @param {Object} app - Express app
 * @param {Array} stateMachines - Array from discoverStateMachines()
 * @param {Array} apiSpecs - Array of API metadata objects
 * @param {Array} rules - Array from discoverRules()
 * @returns {Array} Array of registered RPC endpoint info
 */
export function registerStateMachineRoutes(app, stateMachines, apiSpecs, rules = [], slaTypes = []) {
  const registeredEndpoints = [];

  for (const sm of stateMachines) {
    // Match state machine to its API spec by domain
    const apiSpec = apiSpecs.find(spec => spec.name === sm.domain);
    if (!apiSpec) {
      console.warn(`  No API spec found for domain "${sm.domain}" — skipping state machine routes`);
      continue;
    }

    // Find the item endpoint that matches the state machine object
    // e.g., object "Task" matches path "/tasks/{taskId}"
    const objectCollection = sm.object.toLowerCase() + 's';
    const itemEndpoint = apiSpec.endpoints.find(
      e => e.method.toLowerCase() === 'get' && isItemEndpoint(e.path)
        && deriveCollectionName(e.path, apiSpec.serverBasePath) === objectCollection
    );
    if (!itemEndpoint) {
      console.warn(`  No item endpoint found for "${sm.domain}" — skipping state machine routes`);
      continue;
    }

    const basePath = itemEndpoint.path; // e.g., /tasks/{taskId}
    const paramMatch = basePath.match(/\{([^}]+)\}/);
    const paramName = paramMatch ? paramMatch[1] : 'id';

    // Derive collection name from the resource path
    const collectionName = deriveCollectionName(itemEndpoint.path, apiSpec.serverBasePath);

    console.log(`  Registering state machine routes for ${sm.domain}/${sm.object}...`);

    for (const transition of sm.stateMachine.transitions) {
      const rpcPath = `${basePath}/${transition.trigger}`;
      const expressPath = convertPathFormat(rpcPath);

      const domainSlaTypes = findSlaTypes(slaTypes, sm.domain);
      const handler = createTransitionHandler(
        collectionName,
        sm.stateMachine,
        transition.trigger,
        paramName,
        rules,
        domainSlaTypes
      );

      app.post(expressPath, handler);

      registeredEndpoints.push({
        method: 'POST',
        path: rpcPath,
        expressPath,
        description: `${transition.trigger}: ${transition.from} → ${transition.to}`,
        trigger: transition.trigger
      });

      console.log(`    POST   ${expressPath} - ${transition.trigger}: ${transition.from} → ${transition.to}`);
    }
  }

  return registeredEndpoints;
}
