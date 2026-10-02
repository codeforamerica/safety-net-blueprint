/**
 * The mock server's runtime view of an OpenAPI spec.
 *
 * Discovery and parsing are blueprint-core's `discover` and `load`; what is
 * `basename` is local rather than from `node:path` so this module carries no
 * Node-only import: the only thing needed is the last path segment, with an
 * optional suffix removed.
 *
 * here is the shape the server itself needs — server base path, endpoint
 * list, schemas, error responses, pagination defaults. That is a runtime
 * concern, not a contract one, which is why it lives with the server.
 */

import { discover, load } from '@codeforamerica/blueprint-core';
import { resolverFor } from './schema-refs.js';

/**
 * Discover all API specification files in the given specs directory.
 * Matches files ending in -openapi.yaml (the naming convention for OpenAPI specs).
 * @param {Object} options
 * @param {string} options.specsDir - Path to the specs file or directory (required)
 */
/**
 * The last segment of a path, with an optional suffix removed.
 *
 * @param {string} path
 * @param {string} [suffix]
 * @returns {string}
 */
function basename(path, suffix = '') {
  const last = path.split('/').pop() ?? '';
  return suffix && last.endsWith(suffix) ? last.slice(0, -suffix.length) : last;
}

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
 * Extract the server's metadata from an OpenAPI document.
 *
 * Takes the document as written, `$ref`s and all. Only the top hop of each
 * schema is followed, by `resolve`: enough that a caller holding
 * `endpoint.responseSchema` has the schema object rather than a pointer to it,
 * while the nested refs inside stay refs for whatever walks in. That is the
 * difference between resolving and dereferencing — this follows one link, it
 * does not flatten a tree (#448).
 *
 * Parameters are resolved outright because they are small and every consumer
 * reads `name` and `in` off them. `components.schemas` is passed through
 * untouched: those are the definitions, not references to them.
 *
 * @param {Object} spec - An OpenAPI document, refs intact
 * @param {string} resourceName - Name of the resource (e.g., 'persons')
 * @param {{ node: Function, schema: Function }} [resolve] - Bound to this
 *   document and its set. Omitted for an already-flat document, in which case
 *   nothing needs following.
 * @returns {Object} Metadata about the API
 */
export function extractMetadata(spec, resourceName, resolve = null) {
  // An already-flat document needs no resolution, so callers that have one —
  // the tests, and anything handed a dereferenced spec — can omit the resolver.
  const follow = resolve?.schema ?? ((schema) => schema);
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
  const limitParam = follow(spec.components?.parameters?.LimitParam);
  if (limitParam?.schema) {
    metadata.pagination.limitDefault = limitParam.schema.default || 25;
    metadata.pagination.limitMax = limitParam.schema.maximum || 100;
  }
  
  const offsetParam = follow(spec.components?.parameters?.OffsetParam);
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
        metadata.errorResponses[responseName] = follow(response);
      }
    }
  }
  
  // Extract endpoints
  for (const [path, pathItem] of Object.entries(paths)) {
    // Get path-level parameters
    const pathParameters = (pathItem.parameters || []).map(follow);
    
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
      const allParameters = [...pathParameters, ...operationParameters].map(follow);
      
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
        endpoint.requestSchema = follow(operation.requestBody.content['application/json'].schema);
      }

      // Extract response schema (200/201)
      const successStatus = method === 'post' ? '201' : '200';
      if (operation.responses?.[successStatus]?.content?.['application/json']?.schema) {
        endpoint.responseSchema = follow(operation.responses[successStatus].content['application/json'].schema);
      }
      
      // Extract error schemas
      for (const [statusCode, response] of Object.entries(operation.responses || {})) {
        if (statusCode >= 400 && follow(response).content?.['application/json']?.schema) {
          endpoint.errorSchemas[statusCode] = follow(follow(response).content['application/json'].schema);
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
  if (!specsDir) {
    throw new Error('specsDir is required — pass --spec <path> to specify the specs file or directory');
  }
  return apiSpecsFromDocs(discover(specsDir).map(load));
}

/**
 * The server's view of every OpenAPI document in a set.
 *
 * Takes `docs` rather than a directory, which is what lets the same call serve
 * both boot paths: Node walks a tree, a page reads an artifact, and from there
 * the question is identical (#448).
 *
 * No dereferencing. The refs in these documents all name other documents in
 * the same set, so nothing is missing — and inlining them would multiply every
 * shared schema by the number of places referencing it. Each API carries a
 * `resolve` bound to its own document instead, so a caller walking a schema
 * follows a ref where it meets one.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {object[]} One metadata object per OpenAPI document
 */
export function apiSpecsFromDocs(docs) {
  const loaded = [];

  for (const doc of docs.filter((d) => d.type === 'openapi')) {
    const name = basename(doc.path, '-openapi.yaml');
    try {
      const resolve = resolverFor(doc, docs);
      loaded.push({ ...extractMetadata(doc.content, name, resolve), resolve });
    } catch (error) {
      console.warn(`Warning: Could not read spec ${name}:`, error.message);
    }
  }

  return loaded;
}
