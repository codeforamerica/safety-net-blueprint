/**
 * Dynamic route generator
 * Creates Express routes from OpenAPI specifications
 */

import { createListHandler } from './handlers/list-handler.js';
import { createGetHandler } from './handlers/get-handler.js';
import { createCurrentUserHandler } from './handlers/current-user-handler.js';
import { createCreateHandler } from './handlers/create-handler.js';
import { createUpdateHandler } from './handlers/update-handler.js';
import { createDeleteHandler } from './handlers/delete-handler.js';
import { createTransitionHandler } from './handlers/transition-handler.js';
import { createSearchHandler } from './handlers/search-handler.js';
import { createMetricsListHandler, createMetricsGetHandler } from './handlers/metrics-handler.js';
import { createDocumentUploadHandler, createDocumentVersionUploadHandler } from './handlers/document-upload-handler.js';
import { createDocumentContentHandler } from './handlers/document-content-handler.js';
import { findSlaTypes } from './sla-loader.js';
import { generateStateSchemas } from '@codeforamerica/safety-net-blueprint-contracts/compositions';
import { assembleSectionIndex, assembleSectionPanel, assemblePlainComposition, deriveStateResource, findStateRecord, listStateRecords, upsertStateRecord, toExpressPath, registerParentLink } from './composition-assembler.js';
import { findAll, findById, insertResource, update, registerCollectionDefaults } from './database-manager.js';
import { emitEvent } from './emit-event.js';
import { deriveCollectionName, isSingletonSubResource, extractPrimaryParam } from './collection-utils.js';
import { randomUUID } from 'node:crypto';

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
 * Derive the parent collection name from a sub-resource path.
 * Strips the sub-resource segment and applies deriveCollectionName to the parent path,
 * so nested sub-resources resolve to the correct DB collection.
 * e.g., /intake/applications/{applicationId}/documents → 'applications'
 * e.g., /intake/applications/{applicationId}/members/{memberId}/incomes → 'application-members'
 */
function deriveParentCollection(path, basePath) {
  const lastSlash = path.lastIndexOf('/');
  const parentPath = path.slice(0, lastSlash);
  return deriveCollectionName(parentPath, basePath);
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
 * Upsert semantics: creates the record if it doesn't exist, updates it if it does.
 * Singleton sub-resources have no POST endpoint, so PATCH must serve as the creation
 * path for resources not auto-created by the rules engine (e.g., household-info).
 */
function createSingletonUpdateHandler(apiMetadata, endpoint, parentParam, parentField) {
  const resourceLabel = endpoint.collectionName.replace(/s$/, '');
  return (req, res) => {
    try {
      const parentId = req.params[parentParam];

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: 'Request body must be a JSON object', details: [{ field: 'body', message: 'must be object' }] });
      }
      if (Object.keys(req.body).length === 0) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: 'Request body must contain at least one field to update', details: [{ field: 'body', message: 'minProperties: 1' }] });
      }

      const { items } = findAll(endpoint.collectionName, { [parentField]: parentId }, { limit: 1 });
      let result;
      let action;

      if (items.length === 0) {
        // No record yet — create one (upsert)
        const newRecord = { id: randomUUID(), [parentField]: parentId, ...req.body };
        insertResource(endpoint.collectionName, newRecord);
        result = findAll(endpoint.collectionName, { id: newRecord.id }, { limit: 1 }).items[0];
        action = 'created';
      } else {
        result = update(endpoint.collectionName, items[0].id, req.body);
        action = 'updated';
      }

      try {
        const domain = apiMetadata.serverBasePath.replace(/^\//, '');
        emitEvent({
          domain,
          object: resourceLabel,
          action,
          resourceId: result.id,
          source: apiMetadata.serverBasePath,
          data: { changes: [] },
          callerId: req.headers['x-caller-id'] || null,
          traceparent: req.headers['traceparent'] || null,
          now: result.updatedAt,
        });
      } catch (e) { /* non-fatal */ }

      res.json(result);
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
 * Merge URL path params into a request body for sub-resource POST handlers.
 *
 * Sub-sub-resource routes like POST /applications/{applicationId}/members/{memberId}/incomes
 * have multiple {paramName} path segments. The persisted record needs every
 * parent FK denormalized onto it (per the schema's required[] list); the
 * URL is the authoritative source for those identities.
 *
 * Spreading every param into the body is safe because request schemas in
 * the contracts use additionalProperties: true. Path params win on key
 * collision: a client cannot override the URL-supplied parent FK by also
 * passing it in the body.
 */
export function mergePathParamsIntoBody(body, params) {
  return { ...(body || {}), ...(params || {}) };
}

/**
 * Extract default values for required fields in a JSON Schema (handles allOf).
 *
 * The engine guarantees the response schema's `required` contract for every
 * persisted resource. Two cases produce a default:
 *   - required + type: 'array'            -> []
 *   - required + type: ['X', 'null']      -> null  (any nullable type wins)
 *
 * Non-required fields and required non-nullable scalars get no default — the
 * caller (request body or state-machine procedure) must supply them or fail
 * loudly via schema validation. This prevents masking real validation gaps.
 *
 * Returns a defaults map like { evidence: [], description: null }.
 */
export function extractRequiredDefaults(responseSchema) {
  if (!responseSchema) return {};
  const defaults = {};
  const schemas = responseSchema.allOf || [responseSchema];
  for (const s of schemas) {
    const props = s.properties || {};
    for (const field of (s.required || [])) {
      const prop = props[field];
      if (!prop) continue;
      // Nullable wins over array: a type union that includes 'null' means
      // the schema explicitly allows null content, even for arrays.
      if (Array.isArray(prop.type) && prop.type.includes('null')) {
        defaults[field] = null;
      } else if (prop.type === 'array') {
        defaults[field] = [];
      }
    }
  }
  return defaults;
}

/**
 * Register routes for an API specification
 * @param {Object} app - Express app
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {string} baseUrl - Base URL for Location headers
 * @param {Array} stateMachines - State machine entries for this API's domain (from discoverStateMachines)
 * @returns {Array} Array of registered endpoint info
 */
export function registerRoutes(app, apiMetadata, baseUrl, stateMachines, slaTypes = [], uploadsDir = null) {
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
    } else if (endpoint.operationId === 'uploadDocument' && uploadsDir) {
      const [middleware, uploadHandler] = createDocumentUploadHandler(uploadsDir, baseUrl);
      app.post(expressPath, middleware, uploadHandler);
      registeredEndpoints.push({ method: 'POST', path: expressPath, description: 'Upload document (multipart)' });
      console.log(`    POST   ${expressPath} - Upload document (multipart)`);
      continue;
    } else if (endpoint.operationId === 'uploadDocumentVersion' && uploadsDir) {
      const [middleware, uploadHandler] = createDocumentVersionUploadHandler(uploadsDir, baseUrl);
      app.post(expressPath, middleware, uploadHandler);
      registeredEndpoints.push({ method: 'POST', path: expressPath, description: 'Upload document version (multipart)' });
      console.log(`    POST   ${expressPath} - Upload document version (multipart)`);
      continue;
    } else if (endpoint.operationId === 'getDocumentVersionContent' && uploadsDir) {
      const contentHandler = createDocumentContentHandler(uploadsDir);
      app.get(expressPath, contentHandler);
      registeredEndpoints.push({ method: 'GET', path: expressPath, description: 'Get document version file content' });
      console.log(`    GET    ${expressPath} - Get document version file content`);
      continue;
    } else if (endpoint.operationId === 'search') {
      // Cross-resource search endpoint — custom handler
      handler = createSearchHandler(apiMetadata);
      description = 'Cross-resource search';
    } else if (method === 'get' && endpoint.path.endsWith('/me')) {
      // GET /resource/me — current-user singleton
      handler = createCurrentUserHandler(apiMetadata, endpointWithCollection);
      description = 'Get authenticated user';
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
      const machineForEndpoint = smEntry?.machine || null;
      const domainSlaTypes = smForEndpoint ? findSlaTypes(slaTypes, smForEndpoint.domain) : [];
      const requiredDefaults = extractRequiredDefaults(endpoint.responseSchema);
      if (machineForEndpoint?.initialState) requiredDefaults.status = machineForEndpoint.initialState;
      if (Object.keys(requiredDefaults).length > 0) registerCollectionDefaults(collectionName, requiredDefaults);
      handler = createCreateHandler(apiMetadata, endpointWithCollection, baseUrl, smForEndpoint, domainSlaTypes, machineForEndpoint);
      description = 'Create resource';
    } else if (isSubResourceEndpoint(endpoint.path)) {
      // Sub-resource endpoint: /resources/{parentId}/sub or /resources/{parentId}/sub/{subId}
      // Last path segment is a literal (not a {param}).
      const parentParam = extractPrimaryParam(endpoint.path);
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
              // List sub-resources filtered by parent ID plus any extra query field filters.
              // Note: req.query mutation does not work reliably in Express 5 (getter re-evaluates),
              // so we call findAll directly rather than routing through createListHandler.
              const limit = Math.min(parseInt(req.query.limit) || pagination.limitDefault || 25, pagination.limitMax || 100);
              const offset = parseInt(req.query.offset) || 0;
              const reservedParams = new Set(['limit', 'offset', 'q', 'sort']);
              const extraFilters = Object.fromEntries(
                Object.entries(req.query).filter(([k]) => !reservedParams.has(k))
              );
              const { items, total } = findAll(endpointWithCollection.collectionName, { [parentField]: parentId, ...extraFilters }, { limit, offset });
              return res.json({ items, total, limit, offset, hasNext: offset + items.length < total });
            } catch (error) {
              res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [{ message: error.message }] });
            }
          };
          description = 'List sub-resources';
        } else if (method === 'post') {
          const subResourceName = endpoint.path.split('/').pop();
          const subSmEntry = (Array.isArray(stateMachines) ? stateMachines : []).find(s => {
            const obj = s.object;
            return obj?.toLowerCase() + 's' === subResourceName ||
              obj?.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() + 's' === subResourceName;
          });
          const subSmForEndpoint = subSmEntry?.stateMachine || null;
          const subMachineForEndpoint = subSmEntry?.machine || null;
          const subDomainSlaTypes = subSmForEndpoint ? findSlaTypes(slaTypes, subSmForEndpoint.domain) : [];
          const subRequiredDefaults = extractRequiredDefaults(endpoint.responseSchema);
          if (subMachineForEndpoint?.initialState) subRequiredDefaults.status = subMachineForEndpoint.initialState;
          if (Object.keys(subRequiredDefaults).length > 0) registerCollectionDefaults(collectionName, subRequiredDefaults);
          const baseCreateHandler = createCreateHandler(apiMetadata, endpointWithCollection, baseUrl, subSmForEndpoint, subDomainSlaTypes, subMachineForEndpoint, { eventSubjectField: parentField });
          handler = (req, res) => {
            // Spread ALL path params, not just the last one — sub-sub-resource
            // routes (e.g. /applications/{applicationId}/members/{memberId}/incomes)
            // need every parent FK on the persisted record. See mergePathParamsIntoBody.
            req.body = mergePathParamsIntoBody(req.body, req.params);
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
        handler = createUpdateHandler(apiMetadata, endpointWithCollection, null);
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
      const machineForEndpoint = smEntry?.machine || null;
      handler = createUpdateHandler(apiMetadata, endpointWithCollection, smForEndpoint, [], machineForEndpoint);
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
 * @returns {Array} Array of all registered endpoints grouped by API
 */
export function registerAllRoutes(app, apiSpecs, baseUrl, stateMachines = [], slaTypes = [], metrics = [], uploadsDir = null) {
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
    const endpoints = registerRoutes(app, apiSpec, baseUrl, domainSMs, slaTypes, uploadsDir);
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
 * Build a map from resource collection name to the OpenAPI item path pattern.
 * Used to generate _links.self URLs for items when a section declares links: true.
 *
 * e.g. "application-members" → "/applications/{applicationId}/members/{memberId}"
 *
 * @param {Array} apiSpecs - Array of API metadata objects from loadAllSpecs()
 * @returns {Map<string, string>}
 */
function buildResourceItemPathMap(apiSpecs) {
  const map = new Map();
  for (const spec of apiSpecs) {
    for (const endpoint of (spec.endpoints || [])) {
      if (endpoint.method.toLowerCase() !== 'get') continue;
      if (!endpoint.path.trimEnd().endsWith('}')) continue;
      const collectionName = deriveCollectionName(endpoint.path, spec.serverBasePath || '');
      if (collectionName && !map.has(collectionName)) {
        map.set(collectionName, endpoint.path);
      }
    }
  }
  return map;
}

/**
 * Register routes for all discovered composition files.
 *
 * For each sectionView composition that declares an endpoint, registers:
 *   GET {endpoint.path}           — section index (list of section names + hrefs)
 *   GET {endpoint.path}/:section  — section panel (primary items + includes)
 *
 * @param {Object} app - Express app
 * @param {Array} compositionFiles - Array from discoverCompositions()
 * @param {Array} apiSpecs - Array of API metadata (used to resolve domain base paths)
 * @returns {Array} Registered endpoint info
 */
export function registerCompositionRoutes(app, compositionFiles = [], apiSpecs = []) {
  const registeredEndpoints = [];
  const resourceItemPathMap = buildResourceItemPathMap(apiSpecs);

  for (const { domain, doc, filePath } of compositionFiles) {
    // Look up the server base path for this domain (e.g. "/intake" for the intake domain)
    const apiSpec = apiSpecs.find(s => s.name === domain);
    const basePath = apiSpec?.serverBasePath ?? '';

    for (const [compositionName, composition] of Object.entries(doc.compositions || {})) {
      const endpointPath = composition.endpoint?.path;
      if (!endpointPath) continue;

      const fullPath = basePath && !endpointPath.startsWith(basePath)
        ? `${basePath}${endpointPath}`
        : endpointPath;

      const indexExpressPath = toExpressPath(fullPath);
      const panelExpressPath = `${indexExpressPath}/:section`;
      const primaryParam = extractPrimaryParam(endpointPath);

      // parentLink: true — register the parent resource path so get-handler
      // can inject _links.{compositionName} into parent GET by ID responses.
      // Uses fullPath (with server base) because endpoint.path in the loaded
      // apiSpecs includes the server base prefix.
      if (composition.endpoint?.parentLink) {
        const parentFullPath = fullPath.replace(/\/[^/]+$/, '');
        registerParentLink(parentFullPath, compositionName, fullPath);
      }

      // Merge doc-level derives so the assembler can resolve $ref expressions in views and derive fields
      const compositionWithDoc = {
        ...composition,
        derives: doc.derives || {},
      };

      // Seed state schemas into apiSpec.schemas so loadStateDefaults can read defaults.
      // Only fills in schemas not already present — overlay-applied versions in the
      // resolved spec take precedence over the generated baseline.
      if (composition.state && apiSpec?.schemas) {
        const generated = generateStateSchemas(composition.state);
        for (const [key, schema] of Object.entries(generated)) {
          if (!(key in apiSpec.schemas)) {
            apiSpec.schemas[key] = schema;
          }
        }
      }

      // Load state defaults from the generated OpenAPI schema (empty if no state declared)
      const stateDefaults = loadStateDefaults(composition.state, apiSpec);

      const paginationDefaults = apiSpec?.pagination || {};
      const assemblerOpts = { resourceItemPathMap, serverBasePath: basePath };

      if (composition.compositeType === 'sectionView') {
        // Section index
        app.get(indexExpressPath, (req, res) => {
          try {
            const parentId = primaryParam ? req.params[primaryParam] : null;
            if (parentId && !findById(composition.resource, parentId)) {
              return res.status(404).json({ code: 'NOT_FOUND', message: `${composition.resource} "${parentId}" not found` });
            }
            res.json(assembleSectionIndex(compositionWithDoc, req.params, indexExpressPath, stateDefaults, assemblerOpts));
          } catch (error) {
            console.error('Composition index handler error:', error);
            res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [{ message: error.message }] });
          }
        });

        // Section panel — passes query params through so assembleSectionPanel can
        // apply q= filtering and limit/offset pagination on the assembled items.
        app.get(panelExpressPath, (req, res) => {
          try {
            const parentId = primaryParam ? req.params[primaryParam] : null;
            if (parentId && !findById(composition.resource, parentId)) {
              return res.status(404).json({ code: 'NOT_FOUND', message: `${composition.resource} "${parentId}" not found` });
            }
            const panelOpts = { ...assemblerOpts, queryParams: req.query, paginationDefaults };
            const panel = assembleSectionPanel(compositionWithDoc, req.params.section, req.params, stateDefaults, panelOpts);
            if (!panel) {
              return res.status(404).json({ code: 'NOT_FOUND', message: `Section "${req.params.section}" not found` });
            }
            if (panel.error) {
              const details = panel.error.field !== undefined ? [{ field: panel.error.field, message: panel.error.message }] : [];
              return res.status(400).json({ code: panel.error.code, message: panel.error.message, details });
            }
            res.json(panel);
          } catch (error) {
            console.error('Composition panel handler error:', error);
            res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [{ message: error.message }] });
          }
        });

        // Pre-register 405 for write methods on the index endpoint
        for (const writeMethod of ['post', 'patch', 'put', 'delete']) {
          app[writeMethod](indexExpressPath, (req, res) => {
            res.status(405).set('Allow', 'GET').json({ code: 'METHOD_NOT_ALLOWED', message: 'This endpoint is read-only' });
          });
        }

        console.log(`    GET    ${indexExpressPath} - ${compositionName} section index`);
        console.log(`    GET    ${panelExpressPath} - ${compositionName} section panel`);

        registeredEndpoints.push(
          { method: 'GET', path: fullPath, expressPath: indexExpressPath, description: `${compositionName} section index` },
          { method: 'GET', path: `${fullPath}/:section`, expressPath: panelExpressPath, description: `${compositionName} section panel` }
        );
      } else {
        // Plain composition — single GET endpoint returning the root resource record
        app.get(indexExpressPath, (req, res) => {
          try {
            const result = assemblePlainComposition(compositionWithDoc, req.params, assemblerOpts);
            if (!result) {
              return res.status(404).json({ code: 'NOT_FOUND', message: `${composition.resource} not found` });
            }
            res.json(result);
          } catch (error) {
            console.error('Plain composition handler error:', error);
            res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [{ message: error.message }] });
          }
        });

        // Pre-register 405 for write methods
        for (const writeMethod of ['post', 'patch', 'put', 'delete']) {
          app[writeMethod](indexExpressPath, (req, res) => {
            res.status(405).set('Allow', 'GET').json({ code: 'METHOD_NOT_ALLOWED', message: 'This endpoint is read-only' });
          });
        }

        console.log(`    GET    ${indexExpressPath} - ${compositionName} plain composition`);

        registeredEndpoints.push(
          { method: 'GET', path: fullPath, expressPath: indexExpressPath, description: `${compositionName} plain composition` }
        );
      }

      // Register state resource routes if the composition declares state:
      if (composition.state) {
        const stateInfo = deriveStateResource(composition.state, endpointPath, basePath);
        if (stateInfo) {
          const stateEndpoints = registerStateRoutes(
            app, composition, compositionName, stateInfo, stateDefaults,
            endpointPath, fullPath, basePath
          );
          registeredEndpoints.push(...stateEndpoints);
        }
      }
    }
  }

  return registeredEndpoints;
}

/**
 * Load default field values for the state resource from the generated OpenAPI writable schema.
 * generateStateSchemas merges {Name}Writable into apiSpec.schemas before this is called,
 * so apiSpec.schemas reflects the resolved composition state schema with defaults.
 *
 * @param {Object|undefined} stateConfig - composition.state
 * @param {Object|undefined} apiSpec - Loaded API spec metadata ({ schemas, ... })
 * @returns {Object} Map of field name → default value (empty if no defaults or schema not found)
 */
function loadStateDefaults(stateConfig, apiSpec) {
  const name = stateConfig?.schema?.name;
  if (!name || !apiSpec?.schemas) return {};

  const writableSchemaName = `${name}Writable`;
  const schema = apiSpec.schemas[writableSchemaName];
  if (!schema?.properties) return {};

  const defaults = {};
  for (const [field, def] of Object.entries(schema.properties)) {
    if (def.default !== undefined) defaults[field] = def.default;
  }
  return defaults;
}

/**
 * Register GET/PUT/PATCH routes for a composition state resource.
 *
 * Generates endpoints at:
 *   GET    {stateBasePath}/{section}          — paginated list of state records for that section
 *   GET    {stateBasePath}/{section}/{itemId} — single state record (collection-backed sections)
 *   PUT    {stateBasePath}/{section}          — replace state (singleton sections)
 *   PATCH  {stateBasePath}/{section}          — partial update (singleton sections)
 *   PUT    {stateBasePath}/{section}/{itemId} — replace state for a collection item
 *   PATCH  {stateBasePath}/{section}/{itemId} — partial update for a collection item
 *
 * @param {Object} app - Express app
 * @param {Object} composition - Composition definition
 * @param {string} compositionName - Key name for the composition
 * @param {{ defsKey: string, pathSegment: string, collectionName: string, camelKey: string }} stateInfo
 * @param {Object} stateDefaults - Default field values from companion schema
 * @param {string} endpointPath - OpenAPI-style endpoint path (e.g. /applications/{applicationId}/review)
 * @param {string} fullPath - Absolute path including server base (e.g. /intake/applications/{applicationId}/review)
 * @param {string} basePath - Server base path (e.g. /intake)
 * @returns {Array} Registered endpoint descriptors
 */
function registerStateRoutes(app, composition, compositionName, stateInfo, stateDefaults, endpointPath, fullPath, basePath) {
  const bindParam = extractPrimaryParam(endpointPath);
  if (!bindParam) return [];

  // Derive the parent base path: strip the last path segment from the composition endpoint
  // e.g. /applications/{applicationId}/review → /applications/{applicationId}
  const parentBase = endpointPath.replace(/\/[^/]+$/, '');
  const stateResourcePath = `${parentBase}/${stateInfo.pathSegment}`;
  const stateFullPath = basePath && !stateResourcePath.startsWith(basePath)
    ? `${basePath}${stateResourcePath}`
    : stateResourcePath;

  const stateExpressBase = toExpressPath(stateFullPath);
  const sectionPath = `${stateExpressBase}/:section`;
  const itemPath = `${stateExpressBase}/:section/:itemId`;

  const internalError = (res, error) => {
    console.error('Composition state handler error:', error);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [{ message: error.message }] });
  };

  // GET /{section} — paginated list of state records for that section
  app.get(sectionPath, (req, res) => {
    try {
      const parent = findById(composition.resource, req.params[bindParam]);
      if (!parent) return res.status(404).json({ code: 'NOT_FOUND', message: 'Parent resource not found' });

      const limit = Math.min(parseInt(req.query.limit) || 25, 1000);
      const offset = parseInt(req.query.offset) || 0;
      const result = listStateRecords(stateInfo.collectionName, bindParam, req.params[bindParam], req.params.section, { limit, offset });
      res.json(result);
    } catch (error) { internalError(res, error); }
  });

  // GET /{section}/{itemId} — single state record
  app.get(itemPath, (req, res) => {
    try {
      const record = findStateRecord(stateInfo.collectionName, bindParam, req.params[bindParam], req.params.section, req.params.itemId);
      if (!record) return res.status(404).json({ code: 'NOT_FOUND', message: 'State record not found' });
      res.json(record);
    } catch (error) { internalError(res, error); }
  });

  // PUT/PATCH /{section} — singleton write
  for (const method of ['put', 'patch']) {
    app[method](sectionPath, (req, res) => {
      try {
        const parent = findById(composition.resource, req.params[bindParam]);
        if (!parent) return res.status(404).json({ code: 'NOT_FOUND', message: 'Parent resource not found' });
        const body = method === 'put' ? { ...stateDefaults, ...req.body } : req.body;
        const record = upsertStateRecord(stateInfo.collectionName, bindParam, req.params[bindParam], req.params.section, null, body);
        res.json(record);
      } catch (error) { internalError(res, error); }
    });
  }

  // PUT/PATCH /{section}/{itemId} — collection item write
  for (const method of ['put', 'patch']) {
    app[method](itemPath, (req, res) => {
      try {
        const parent = findById(composition.resource, req.params[bindParam]);
        if (!parent) return res.status(404).json({ code: 'NOT_FOUND', message: 'Parent resource not found' });
        const body = method === 'put' ? { ...stateDefaults, ...req.body } : req.body;
        const record = upsertStateRecord(stateInfo.collectionName, bindParam, req.params[bindParam], req.params.section, req.params.itemId, body);
        res.json(record);
      } catch (error) { internalError(res, error); }
    });
  }

  console.log(`    GET    ${sectionPath} - ${compositionName} state list`);
  console.log(`    GET    ${itemPath} - ${compositionName} state item`);
  console.log(`    PUT    ${sectionPath} - ${compositionName} state replace`);
  console.log(`    PATCH  ${sectionPath} - ${compositionName} state update`);
  console.log(`    PUT    ${itemPath} - ${compositionName} state item replace`);
  console.log(`    PATCH  ${itemPath} - ${compositionName} state item update`);

  return [
    { method: 'GET',   path: `${stateFullPath}/{section}`,          expressPath: sectionPath, description: `${compositionName} state list` },
    { method: 'GET',   path: `${stateFullPath}/{section}/{itemId}`,  expressPath: itemPath,    description: `${compositionName} state item` },
    { method: 'PUT',   path: `${stateFullPath}/{section}`,          expressPath: sectionPath, description: `${compositionName} state replace` },
    { method: 'PATCH', path: `${stateFullPath}/{section}`,          expressPath: sectionPath, description: `${compositionName} state update` },
    { method: 'PUT',   path: `${stateFullPath}/{section}/{itemId}`,  expressPath: itemPath,    description: `${compositionName} state item replace` },
    { method: 'PATCH', path: `${stateFullPath}/{section}/{itemId}`,  expressPath: itemPath,    description: `${compositionName} state item update` },
  ];
}

/**
 * Register state machine RPC routes (e.g., POST /tasks/:taskId/claim).
 * @param {Object} app - Express app
 * @param {Array} stateMachines - Array from discoverStateMachines()
 * @param {Array} apiSpecs - Array of API metadata objects
 * @returns {Array} Array of registered RPC endpoint info
 */
export function registerStateMachineRoutes(app, stateMachines, apiSpecs, slaTypes = []) {
  const registeredEndpoints = [];

  for (const sm of stateMachines) {
    // Match state machine to its API spec by domain
    const apiSpec = apiSpecs.find(spec => spec.name === sm.domain);
    if (!apiSpec) {
      console.warn(`  No API spec found for domain "${sm.domain}" — skipping state machine routes`);
      continue;
    }

    // Find the item endpoint that matches the state machine object.
    // Uses suffix matching so single-word objects (e.g., "Verification") correctly match
    // sub-resource collections like "application-verifications".
    // e.g., object "Task" matches "tasks"; object "Verification" matches "application-verifications"
    const objectPluralSuffix = sm.object.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() + 's';
    const itemEndpoint = apiSpec.endpoints.find(
      e => e.method.toLowerCase() === 'get' && (isItemEndpoint(e.path) || isSubItemEndpoint(e.path))
        && (() => {
          const col = deriveCollectionName(e.path, apiSpec.serverBasePath);
          return col === objectPluralSuffix || col.endsWith('-' + objectPluralSuffix);
        })()
    );
    if (!itemEndpoint) {
      console.warn(`  No item endpoint found for "${sm.domain}" — skipping state machine routes`);
      continue;
    }

    const basePath = itemEndpoint.path; // e.g., /tasks/{taskId} or /applications/{applicationId}/verifications/{verificationId}
    const allParams = [...basePath.matchAll(/\{([^}]+)\}/g)];
    const paramName = allParams.length > 0 ? allParams[allParams.length - 1][1] : 'id';

    // Derive collection name from the resource path
    const collectionName = deriveCollectionName(itemEndpoint.path, apiSpec.serverBasePath);

    console.log(`  Registering state machine routes for ${sm.domain}/${sm.object}...`);

    const entries = sm.machine.actions.map(op => ({
      id: op.id,
      from: op.transition?.from,
      to: op.transition?.to
    }));

    // Deduplicate by id — same operation id may appear with different from-states
    // (e.g., escalate from pending vs in_progress). Register the route once; the runner
    // iterates all matching operations to find the right one for the current state.
    const seenIds = new Set();

    for (const entry of entries) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);

      const rpcPath = `${basePath}/${entry.id}`;
      const expressPath = convertPathFormat(rpcPath);

      const domainSlaTypes = findSlaTypes(slaTypes, sm.domain);
      const handler = createTransitionHandler(
        collectionName,
        sm.stateMachine,
        entry.id,
        paramName,
        domainSlaTypes,
        sm.machine
      );

      app.post(expressPath, handler);

      registeredEndpoints.push({
        method: 'POST',
        path: rpcPath,
        expressPath,
        description: `${entry.id}: ${entry.from} → ${entry.to ?? '(in-place)'}`,
        trigger: entry.id
      });

      console.log(`    POST   ${expressPath} - ${entry.id}: ${entry.from} → ${entry.to ?? '(in-place)'}`);
    }
  }

  return registeredEndpoints;
}
