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

/**
 * Determine if a path is a collection endpoint (no {id} parameter)
 */
function isCollectionEndpoint(path) {
  return !path.includes('{') && !path.includes('}');
}

/**
 * Determine if a path is an item endpoint (has {id} parameter)
 */
function isItemEndpoint(path) {
  return path.includes('{') && path.includes('}');
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
 * @returns {Array} Array of registered endpoint info
 */
export function registerRoutes(app, apiMetadata, baseUrl) {
  const registeredEndpoints = [];
  
  console.log(`  Registering routes for ${apiMetadata.title}...`);
  
  for (const endpoint of apiMetadata.endpoints) {
    const expressPath = convertPathFormat(endpoint.path);
    const method = endpoint.method.toLowerCase();
    
    let handler = null;
    let description = '';
    
    // Determine handler based on method and path type
    if (method === 'get' && isCollectionEndpoint(endpoint.path)) {
      // GET /resources - List/search
      handler = createListHandler(apiMetadata, endpoint);
      description = 'List/search resources';
    } else if (method === 'get' && isItemEndpoint(endpoint.path)) {
      // GET /resources/{id} - Get by ID
      handler = createGetHandler(apiMetadata, endpoint);
      description = 'Get resource by ID';
    } else if (method === 'post' && isCollectionEndpoint(endpoint.path)) {
      // POST /resources - Create
      handler = createCreateHandler(apiMetadata, endpoint, baseUrl);
      description = 'Create resource';
    } else if (method === 'patch' && isItemEndpoint(endpoint.path)) {
      // PATCH /resources/{id} - Update
      handler = createUpdateHandler(apiMetadata, endpoint);
      description = 'Update resource';
    } else if (method === 'delete' && isItemEndpoint(endpoint.path)) {
      // DELETE /resources/{id} - Delete
      handler = createDeleteHandler(apiMetadata, endpoint);
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
 * @returns {Array} Array of all registered endpoints grouped by API
 */
export function registerAllRoutes(app, apiSpecs, baseUrl) {
  console.log('\nRegistering API routes...');
  
  const allEndpoints = [];
  
  for (const apiSpec of apiSpecs) {
    const endpoints = registerRoutes(app, apiSpec, baseUrl);
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
 * @returns {Array} Array of registered RPC endpoint info
 */
export function registerStateMachineRoutes(app, stateMachines, apiSpecs) {
  const registeredEndpoints = [];

  for (const sm of stateMachines) {
    // Match state machine to its API spec by domain
    const apiSpec = apiSpecs.find(spec => spec.name === sm.domain);
    if (!apiSpec) {
      console.warn(`  No API spec found for domain "${sm.domain}" — skipping state machine routes`);
      continue;
    }

    // Find the collection endpoint to derive the base path and param name
    const itemEndpoint = apiSpec.endpoints.find(
      e => e.method.toLowerCase() === 'get' && isItemEndpoint(e.path)
    );
    if (!itemEndpoint) {
      console.warn(`  No item endpoint found for "${sm.domain}" — skipping state machine routes`);
      continue;
    }

    const basePath = itemEndpoint.path; // e.g., /tasks/{taskId}
    const paramMatch = basePath.match(/\{([^}]+)\}/);
    const paramName = paramMatch ? paramMatch[1] : 'id';

    console.log(`  Registering state machine routes for ${sm.domain}/${sm.object}...`);

    for (const transition of sm.stateMachine.transitions) {
      const rpcPath = `${basePath}/${transition.trigger}`;
      const expressPath = convertPathFormat(rpcPath);

      const handler = createTransitionHandler(
        apiSpec.name,
        sm.stateMachine,
        transition.trigger,
        paramName
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
