/**
 * The mock server's runtime view of an OpenAPI spec.
 *
 * Discovery and parsing are blueprint-core's `discover` and `load`; what is
 * here is the shape the server itself needs — server base path, endpoint
 * list, schemas, error responses, pagination defaults. That is a runtime
 * concern, not a contract one, which is why it lives with the server.
 */

import { basename } from 'path';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { discover } from '@codeforamerica/blueprint-core';

/**
 * Discover all API specification files in the given specs directory.
 * Matches files ending in -openapi.yaml (the naming convention for OpenAPI specs).
 * @param {Object} options
 * @param {string} options.specsDir - Path to the specs file or directory (required)
 */
export function discoverApiSpecs({ specsDir } = {}) {
  if (!specsDir) {
    throw new Error('specsDir is required — pass --spec <path> to specify the specs file or directory');
  }

  // discover() identifies type from content rather than filename, so a spec
  // without the -openapi.yaml suffix is still found, and it already skips
  // deprecated documents.
  return discover(specsDir, 'openapi')
    .map((file) => ({
      name: basename(file.path, '-openapi.yaml'),
      specPath: file.path,
    }));
}

/**
 * Load and dereference (resolve all $refs) an OpenAPI specification
 * @param {string} specPath - Path to the OpenAPI spec file
 * @returns {Promise<Object>} Dereferenced OpenAPI specification
 */
export async function loadSpec(specPath) {
  try {
    // Use $RefParser to dereference all $refs (including external file refs)
    const spec = await $RefParser.dereference(specPath, {
      dereference: {
        circular: 'ignore'
      }
    });
    return spec;
  } catch (error) {
    console.error(`Error loading spec ${specPath}:`, error.message);
    throw error;
  }
}

/**
 * Extract metadata from a dereferenced OpenAPI spec
 * @param {Object} spec - Dereferenced OpenAPI specification
 * @param {string} resourceName - Name of the resource (e.g., 'persons')
 * @returns {Object} Metadata about the API
 */
export function extractMetadata(spec, resourceName) {
  const paths = spec.paths || {};

  // Extract base path from the localhost server URL (e.g., http://localhost:1080/intake -> /intake)
  const localhostServer = spec.servers?.find(s => s.url?.includes('localhost'));
  let serverBasePath = '';
  if (localhostServer) {
    try {
      const url = new URL(localhostServer.url);
      serverBasePath = url.pathname.replace(/\/$/, ''); // strip trailing slash
    } catch {
      // Ignore invalid URLs
    }
  }

  const metadata = {
    name: resourceName,
    title: spec.info?.title || resourceName,
    version: spec.info?.version || '1.0.0',
    serverBasePath,
    baseResource: serverBasePath
      ? `${serverBasePath}${Object.keys(paths).find(p => !p.includes('{') && !p.startsWith(serverBasePath)) || `/${resourceName}`}`
      : (Object.keys(paths).find(p => !p.includes('{')) || `/${resourceName}`),
    endpoints: [],
    schemas: {},
    errorResponses: {},
    pagination: {
      limitDefault: 25,
      limitMax: 100,
      offsetDefault: 0
    }
  };
  
  // Extract pagination defaults from spec
  const limitParam = spec.components?.parameters?.LimitParam;
  if (limitParam?.schema) {
    metadata.pagination.limitDefault = limitParam.schema.default || 25;
    metadata.pagination.limitMax = limitParam.schema.maximum || 100;
  }
  
  const offsetParam = spec.components?.parameters?.OffsetParam;
  if (offsetParam?.schema) {
    metadata.pagination.offsetDefault = offsetParam.schema.default || 0;
  }
  
  // Extract schemas
  if (spec.components?.schemas) {
    for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
      metadata.schemas[schemaName] = schema;
    }
  }

  // Extract error responses
  if (spec.components?.responses) {
    for (const [responseName, response] of Object.entries(spec.components.responses)) {
      if (responseName.includes('Error') || responseName === 'NotFound' || 
          responseName === 'BadRequest' || responseName === 'UnprocessableEntity') {
        metadata.errorResponses[responseName] = response;
      }
    }
  }
  
  // Extract endpoints
  for (const [path, pathItem] of Object.entries(paths)) {
    // Get path-level parameters
    const pathParameters = pathItem.parameters || [];
    
    for (const [method, operation] of Object.entries(pathItem)) {
      // Skip parameters object and unsupported methods
      if (method === 'parameters' || !['get', 'post', 'patch', 'delete', 'put'].includes(method)) {
        continue;
      }
      
      // Skip action endpoints (like /submit)
      if (path.includes('/submit')) {
        continue;
      }
      
      // Merge path-level and operation-level parameters
      const operationParameters = operation.parameters || [];
      const allParameters = [...pathParameters, ...operationParameters];
      
      const endpoint = {
        path: serverBasePath && !path.startsWith(serverBasePath) ? `${serverBasePath}${path}` : path,
        method: method.toUpperCase(),
        operationId: operation.operationId,
        summary: operation.summary,
        parameters: allParameters,
        // Sort configuration from the operation's x-sortable extension (if
        // declared). Undefined when the operation does not opt into sorting;
        // the list handler / executeSearch reject ?sort= for such endpoints.
        sortable: operation['x-sortable'],
        requestSchema: null,
        responseSchema: null,
        errorSchemas: {}
      };

      // Extract request schema
      if (operation.requestBody?.content?.['application/json']?.schema) {
        endpoint.requestSchema = operation.requestBody.content['application/json'].schema;
      }

      // Extract response schema (200/201)
      const successStatus = method === 'post' ? '201' : '200';
      if (operation.responses?.[successStatus]?.content?.['application/json']?.schema) {
        endpoint.responseSchema = operation.responses[successStatus].content['application/json'].schema;
      }
      
      // Extract error schemas
      for (const [statusCode, response] of Object.entries(operation.responses || {})) {
        if (statusCode >= 400 && response.content?.['application/json']?.schema) {
          endpoint.errorSchemas[statusCode] = response.content['application/json'].schema;
        }
      }
      
      metadata.endpoints.push(endpoint);
    }
  }
  
  return metadata;
}



/**
 * Load all API specifications
 * @param {Object} options
 * @param {string} options.specsDir - Path to the specs directory (required)
 * @returns {Promise<Array>} Array of API metadata objects
 */
export async function loadAllSpecs({ specsDir } = {}) {
  const apiSpecs = discoverApiSpecs({ specsDir });
  const loadedSpecs = [];

  for (const apiSpec of apiSpecs) {
    try {
      const spec = await loadSpec(apiSpec.specPath);
      const metadata = extractMetadata(spec, apiSpec.name);
      loadedSpecs.push(metadata);
    } catch (error) {
      console.warn(`Warning: Could not load ${apiSpec.name}:`, error.message);
    }
  }

  return loadedSpecs;
}
