/**
 * The mock server's runtime view of an OpenAPI spec.
 *
 * What the server itself needs out of a spec — server base path, endpoint
 * list, schemas, error responses, pagination defaults. A runtime concern
 * rather than a contract one, which is why it lives with the server and not
 * in blueprint-core.
 *
 * Nothing here reads a file, deliberately. The browser entry reaches this
 * module for `apiSpecsFromDocs`, and a bundler resolves every import in a
 * graph before it tree-shakes — so a single Node import here would fail a
 * page build even though nothing in a page would call it. The functions that
 * do walk a directory are in `spec-discovery.js` (#448).
 */

import { resolverFor } from './schema-refs.js';

/**
 * The name an API is known by, from the path of its OpenAPI document.
 *
 * `domains/intake/intake-openapi.yaml` is `intake`. Written out rather than
 * taken from `node:path` so this module carries no Node import, and both
 * separators are treated as separators because `doc.path` is an OS path.
 *
 * @param {string} path
 * @returns {string}
 */
export function specNameOf(path) {
  const last = String(path ?? '').split(/[/\\]/).pop() ?? '';
  return last.endsWith('-openapi.yaml') ? last.slice(0, -'-openapi.yaml'.length) : last;
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
        // The ref as written, when the schema was one. `requestSchema` is the
        // object it names, for anything walking it; this is how ajv is told
        // which document to resolve the refs *inside* it against (#448).
        requestSchemaRef: null,
        responseSchema: null,
        responseSchemaRef: null,
        errorSchemas: {}
      };

      // Extract request schema
      const rawRequest = operation.requestBody?.content?.['application/json']?.schema;
      if (rawRequest) {
        endpoint.requestSchema = follow(rawRequest);
        endpoint.requestSchemaRef = typeof rawRequest.$ref === 'string' ? rawRequest.$ref : null;
      }

      // Extract response schema (200/201)
      const successStatus = method === 'post' ? '201' : '200';
      const rawResponse = operation.responses?.[successStatus]?.content?.['application/json']?.schema;
      if (rawResponse) {
        endpoint.responseSchema = follow(rawResponse);
        endpoint.responseSchemaRef = typeof rawResponse.$ref === 'string' ? rawResponse.$ref : null;
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
    const name = specNameOf(doc.path);
    try {
      const resolve = resolverFor(doc, docs);
      loaded.push({ ...extractMetadata(doc.content, name, resolve), resolve, relativePath: doc.relativePath });
    } catch (error) {
      console.warn(`Warning: Could not read spec ${name}:`, error.message);
    }
  }

  return loaded;
}
