/**
 * Build a Postman collection from a contract set.
 *
 * Requests are derived from each spec's endpoints and seeded with the example
 * data the contracts ship, so an imported collection exercises a running mock
 * server without anyone hand-writing bodies. State machines contribute an
 * ordered sequence of RPC calls that walks an object through its lifecycle.
 *
 * Nothing here reads the filesystem: every document it needs — specs, seed
 * examples, state machines — is in the set it is given.
 */

import { basename } from 'path';
import { collectionToSchemaPrefix, extractIndividualResources } from '../openapi/utils.js';

/**
 * The contract set, keyed by filename, for the duration of one build.
 *
 * Module-level rather than threaded through every helper: the lookups happen
 * several layers down and passing it would add a parameter to a dozen
 * functions that otherwise have nothing to do with it.
 *
 * @type {Map<string, object>}
 */
let contracts = new Map();

/**
 * @param {import('../../types.js').Doc[]} docs
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Value of the collection's baseUrl variable
 * @param {string} [options.collectionId] - Preserved across regenerations
 * @returns {object} A Postman v2.1 collection
 */
export function buildPostman(docs, { baseUrl = 'http://localhost:1080', collectionId = null } = {}) {
  contracts = new Map(docs.map((doc) => [basename(doc.path), doc.content]));

  const apiSpecs = docs
    .filter((doc) => doc.type === 'openapi')
    .map((doc) => apiMetadataOf(doc, docs));

  return assembleCollection(apiSpecs, { baseUrl, collectionId });
}

/**
 * What the request builders need from one spec.
 *
 * Paths are prefixed with the server's base path, because that is the URL a
 * request actually goes to. The rest is the operation detail each request
 * template reads: parameters to fill, a request schema to build a body from,
 * a response schema to assert against.
 *
 * Parameters are almost always `$ref`s into a shared component library, so
 * they are followed here: a request template needs the parameter's name and
 * enum to fill it in, and `{ $ref }` carries neither.
 *
 * @param {import('../../types.js').Doc} doc - An OpenAPI document
 * @param {import('../../types.js').Doc[]} docs - The set, for following refs
 * @returns {{ name: string, title: string, endpoints: object[] }}
 */
function apiMetadataOf(doc, docs) {
  const spec = doc.content ?? {};
  const name = basename(doc.path, '-openapi.yaml');
  const refs = doc.refs();

  const deref = (param) => {
    if (!param?.$ref) return param;
    const entry = refs.get(param.$ref);
    if (entry && !entry.external && entry.target) return entry.target;
    const external = doc.resolveRef(param.$ref, docs);
    return external && Object.keys(external).length ? external : param;
  };

  const localhost = spec.servers?.find((s) => s.url?.includes('localhost'));
  let base = '';
  if (localhost) {
    try {
      base = new URL(localhost.url).pathname.replace(/\/$/, '');
    } catch {
      // A malformed server URL just means no base path.
    }
  }

  const endpoints = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const pathParameters = pathItem?.parameters ?? [];

    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = pathItem?.[method];
      if (!operation) continue;

      const success = method === 'post' ? '201' : '200';
      endpoints.push({
        path: base && !path.startsWith(base) ? `${base}${path}` : path,
        method: method.toUpperCase(),
        operationId: operation.operationId,
        summary: operation.summary,
        parameters: [...pathParameters, ...(operation.parameters ?? [])].map(deref),
        sortable: operation['x-sortable'],
        requestSchema: operation.requestBody?.content?.['application/json']?.schema ?? null,
        responseSchema: operation.responses?.[success]?.content?.['application/json']?.schema ?? null,
      });
    }
  }

  return { name, title: spec.info?.title ?? name, endpoints };
}

/**
 * Assemble the collection: one folder per API, plus its variables.
 *
 * @param {{ name: string, title: string }[]} apiSpecs
 * @param {{ baseUrl: string, collectionId: string|null }} options
 * @returns {object}
 */
function assembleCollection(apiSpecs, { baseUrl, collectionId }) {
  const collection = {
    info: {
      name: 'Safety Net API Collection',
      description: 'Auto-generated from OpenAPI specifications',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      _postman_id: collectionId || uuid()
    },
    item: [],
    variable: [
      {
        key: 'baseUrl',
        value: baseUrl,
        type: 'string'
      }
    ]
  };

  // Add folder for each resource (multi-resource specs get multiple folders)
  console.log('\nGenerating requests...');
  for (const api of apiSpecs) {
    console.log(`  Processing ${api.title}...`);
    const { folders, callerId } = generateApiRequests(api);

    for (const { resourceName, items: requests } of folders) {
      const folderName = capitalize(resourceName);
      console.log(`    Generated ${requests.length} requests → ${folderName}`);

      collection.item.push({
        name: folderName,
        item: requests,
        description: api.title
      });

      // Add resource ID variables
      const rawExamples = loadExamples(api.name);
      const schemaPrefix = collectionToSchemaPrefix(resourceName);
      const filtered = {};
      for (const [key, value] of Object.entries(rawExamples)) {
        if (key.startsWith(schemaPrefix)) filtered[key] = value;
      }
      const examples = extractIndividualResources(filtered);
      if (examples.length > 0) {
        const varName = `${singularize(resourceName)}Id`;
        collection.variable.push({
          key: varName,
          value: examples[0].data.id,
          type: 'string'
        });
      }
    }

    // Add callerId variable if this API has state machine transitions
    if (callerId) {
      collection.variable.push({
        key: 'callerId',
        value: callerId,
        type: 'string'
      });
    }
  }

  return collection;
}

/**
 * A v4 UUID for the collection, when there is no existing one to preserve.
 *
 * @returns {string}
 */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

// =============================================================================
// Examples
// =============================================================================

/**
 * Load examples for a resource. Checks for a seed file first, then falls
 * back to inline examples embedded in the OpenAPI spec.
 */
function loadExamples(resourceName) {
  // A dedicated seed file (e.g., persons.yaml) wins over inline examples.
  const seed = contracts.get(`${resourceName}.yaml`);
  if (seed) return seed;

  const spec = contracts.get(`${resourceName}-openapi.yaml`);
  if (!spec) return {};

  const componentExamples = spec?.components?.examples || {};
  const flat = {};
  for (const [key, ex] of Object.entries(componentExamples)) {
    if (ex?.value) flat[key] = ex.value;
  }
  return flat;
}


// =============================================================================
// State Machine Support
// =============================================================================

/**
 * Load and normalize a state machine definition for an API (if one exists).
 * Returns a flat object with domain, object, initialState, actions, guards.
 */
function loadStateMachine(apiName) {
  const doc = contracts.get(`${apiName}-state-machine.yaml`);
  if (!doc) return null;
  try {
    if (Array.isArray(doc.machines) && doc.machines.length > 0) {
      const machine = doc.machines[0];
      return {
        domain: doc.domain,
        object: machine.object,
        initialState: machine.initialState,
        actions: machine.actions || [],
        guards: [...(doc.guards || []), ...(machine.guards || [])],
      };
    }
    return null;
  } catch {
    return null;
  }
}

function actionFromStates(action) {
  const from = action.transition?.from;
  if (!from) return [];
  return Array.isArray(from) ? from : [from];
}

/**
 * BFS over actions to find an ordering that covers every action at least once.
 * Returns an array of action ids in execution order.
 */
function computeActionOrder(stateMachine, startState) {
  const actions = stateMachine.actions || [];
  if (actions.length === 0) return [];

  const allIds = new Set(actions.filter(a => a.transition?.from).map(a => a.id));
  if (allIds.size === 0) return [];

  const queue = [{ currentState: startState, path: [], covered: new Set() }];
  const visited = new Map();
  let bestPath = [];

  while (queue.length > 0) {
    const { currentState, path, covered } = queue.shift();

    if (covered.size === allIds.size) return path;
    if (covered.size > bestPath.length) bestPath = path;

    for (const a of actions) {
      const froms = actionFromStates(a);
      if (froms.length === 0 || !froms.includes(currentState)) continue;

      const nextState = a.transition?.to ?? currentState;
      const newCovered = new Set(covered);
      newCovered.add(a.id);

      const key = `${nextState}|${[...newCovered].sort().join(',')}`;
      if (visited.has(key)) continue;
      visited.set(key, true);

      queue.push({ currentState: nextState, path: [...path, a.id], covered: newCovered });
    }
  }

  return bestPath;
}

/**
 * Pick the best example for RPC execution and determine the caller ID.
 * Returns { example, callerId, transitionOrder }.
 */
function planRpcExecution(stateMachine, examples) {
  const actions = stateMachine.actions || [];
  const initialState = stateMachine.initialState;
  const standardOrder = computeActionOrder(stateMachine, initialState);

  const initialExample = examples.find(e => e.data.status === initialState);
  if (initialExample) {
    const callerId = initialExample.data.assignedToId || 'postman-test-user';
    return { example: initialExample, callerId, transitionOrder: standardOrder };
  }

  for (const example of examples) {
    const exState = example.data.status;
    if (!exState) continue;
    const hasAction = actions.some(a => actionFromStates(a).includes(exState));
    if (!hasAction) continue;
    const order = computeActionOrder(stateMachine, exState);
    if (order && order.length > 0) {
      const callerId = example.data.assignedToId || 'postman-test-user';
      return { example, callerId, transitionOrder: order };
    }
  }

  const callerId = examples[0]?.data?.assignedToId || 'postman-test-user';
  return { example: examples[0], callerId, transitionOrder: standardOrder };
}

// =============================================================================
// Test Script Generation
// =============================================================================

/**
 * Generate basic test script for a CRUD request
 */
function generateTestScript(method, endpoint) {
  const tests = [];

  // Status code test based on method
  if (method === 'GET') {
    tests.push(`pm.test("Status code is 200", function () {`);
    tests.push(`    pm.response.to.have.status(200);`);
    tests.push(`});`);
    tests.push(``);
    tests.push(`pm.test("Response is JSON", function () {`);
    tests.push(`    pm.response.to.be.json;`);
    tests.push(`});`);

    // List endpoint tests
    if (!endpoint.path.includes('{')) {
      tests.push(``);
      tests.push(`pm.test("Response has required list properties", function () {`);
      tests.push(`    const jsonData = pm.response.json();`);
      tests.push(`    pm.expect(jsonData).to.have.property('items');`);
      tests.push(`    pm.expect(jsonData).to.have.property('total');`);
      tests.push(`    pm.expect(jsonData).to.have.property('limit');`);
      tests.push(`    pm.expect(jsonData).to.have.property('offset');`);
      tests.push(`    pm.expect(jsonData.items).to.be.an('array');`);
      tests.push(`});`);
    } else {
      // Get by ID tests
      tests.push(``);
      tests.push(`pm.test("Response has id property", function () {`);
      tests.push(`    const jsonData = pm.response.json();`);
      tests.push(`    pm.expect(jsonData).to.have.property('id');`);
      tests.push(`});`);
    }
  } else if (method === 'POST') {
    tests.push(`pm.test("Status code is 201", function () {`);
    tests.push(`    pm.response.to.have.status(201);`);
    tests.push(`});`);
    tests.push(``);
    tests.push(`pm.test("Response has id and timestamps", function () {`);
    tests.push(`    const jsonData = pm.response.json();`);
    tests.push(`    pm.expect(jsonData).to.have.property('id');`);
    tests.push(`    pm.expect(jsonData).to.have.property('createdAt');`);
    tests.push(`    pm.expect(jsonData).to.have.property('updatedAt');`);
    tests.push(`});`);
    tests.push(``);
    tests.push(`pm.test("Location header is present", function () {`);
    tests.push(`    pm.response.to.have.header("Location");`);
    tests.push(`});`);
  } else if (method === 'PATCH') {
    tests.push(`pm.test("Status code is 200", function () {`);
    tests.push(`    pm.response.to.have.status(200);`);
    tests.push(`});`);
    tests.push(``);
    tests.push(`pm.test("Response has updatedAt timestamp", function () {`);
    tests.push(`    const jsonData = pm.response.json();`);
    tests.push(`    pm.expect(jsonData).to.have.property('updatedAt');`);
    tests.push(`});`);
  } else if (method === 'DELETE') {
    tests.push(`pm.test("Status code is 204", function () {`);
    tests.push(`    pm.response.to.have.status(204);`);
    tests.push(`});`);
  }

  return tests.join('\n');
}

/**
 * Generate test script for an RPC (state transition) request
 * @param {Object} options
 * @param {boolean} options.expectConflict - If true, expect 409 (unreachable transition)
 */
function generateRpcTestScript({ expectConflict = false } = {}) {
  const tests = [];
  if (expectConflict) {
    tests.push(`pm.test("Status code is 409 (transition not valid from current state)", function () {`);
    tests.push(`    pm.response.to.have.status(409);`);
    tests.push(`});`);
  } else {
    tests.push(`pm.test("Status code is 200", function () {`);
    tests.push(`    pm.response.to.have.status(200);`);
    tests.push(`});`);
    tests.push(``);
    tests.push(`pm.test("Response is JSON with id", function () {`);
    tests.push(`    const jsonData = pm.response.json();`);
    tests.push(`    pm.expect(jsonData).to.have.property('id');`);
    tests.push(`});`);
  }
  return tests.join('\n');
}

// =============================================================================
// Request Helpers
// =============================================================================

/**
 * Create a Postman request object
 */
function createRequest(method, url, body = null, description = '') {
  const request = {
    method,
    header: [],
    url
  };

  if (body) {
    request.header.push({
      key: 'Content-Type',
      value: 'application/json',
      type: 'text'
    });
    request.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: {
        raw: {
          language: 'json'
        }
      }
    };
  }

  if (description) {
    request.description = description;
  }

  return request;
}

/**
 * Parse URL with Postman variable syntax
 */
function createPostmanUrl(path, baseUrl = '{{baseUrl}}') {
  const segments = path.split('/').filter(s => s);
  const pathSegments = [];
  const variables = [];

  for (const segment of segments) {
    if (segment.startsWith('{') && segment.endsWith('}')) {
      const varName = segment.slice(1, -1);
      pathSegments.push(`{{${varName}}}`);
      variables.push(varName);
    } else {
      pathSegments.push(segment);
    }
  }

  return {
    raw: `${baseUrl}/${pathSegments.join('/')}`,
    host: [baseUrl],
    path: pathSegments,
    variables
  };
}

/**
 * Substitute a concrete ID into a Postman URL's path parameter placeholder.
 */
function substituteId(url, id) {
  const paramName = url.variables[0];
  return {
    ...url,
    raw: url.raw.replace(`{{${paramName}}}`, id),
    path: url.path.map(seg => seg === `{{${paramName}}}` ? id : seg)
  };
}

/**
 * Capitalize first letter
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert plural to singular (simple)
 */
function singularize(str) {
  return str.endsWith('s') ? str.slice(0, -1) : str;
}

// =============================================================================
// CRUD Request Generators
// =============================================================================

/**
 * Generate requests for a GET list endpoint
 */
function generateListRequests(apiMetadata, endpoint, examples) {
  const requests = [];
  const url = createPostmanUrl(endpoint.path);

  // 1. List all (default pagination)
  requests.push({
    name: `List All ${capitalize(apiMetadata.name)}`,
    request: createRequest('GET', {
      ...url,
      query: [
        { key: 'limit', value: '25', description: 'Maximum number of items' },
        { key: 'offset', value: '0', description: 'Number of items to skip' }
      ]
    }),
    event: [{
      listen: 'test',
      script: {
        exec: generateTestScript('GET', endpoint).split('\n')
      }
    }]
  });

  // 2. List with custom pagination
  requests.push({
    name: `List ${capitalize(apiMetadata.name)} (Paginated)`,
    request: createRequest('GET', {
      ...url,
      query: [
        { key: 'limit', value: '2', description: 'Get only 2 items' },
        { key: 'offset', value: '0', description: 'Start from beginning' }
      ]
    }),
    event: [{
      listen: 'test',
      script: {
        exec: generateTestScript('GET', endpoint).split('\n')
      }
    }]
  });

  // 3. Search examples (if q or search parameter exists)
  const searchParam = endpoint.parameters.find(p => p.name === 'q' || p.name === 'search');
  if (searchParam && examples.length > 0) {
    // Get a searchable value from the first example using contains syntax
    const rawValue = examples[0].data.name?.firstName ||
                     examples[0].data.name ||
                     examples[0].data.email?.split('@')[0] ||
                     'test';
    // Use wildcard contains syntax so the mock server's q parser matches
    const searchValue = searchParam.name === 'q' ? `*${rawValue}*` : rawValue;

    requests.push({
      name: `Search ${capitalize(apiMetadata.name)}`,
      request: createRequest('GET', {
        ...url,
        query: [
          { key: searchParam.name, value: searchValue, description: 'Search query (contains match)' },
          { key: 'limit', value: '10', description: 'Maximum results' }
        ]
      }),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('GET', endpoint).split('\n')
        }
      }]
    });
  }

  // 4. Filter examples (if other query params exist)
  for (const param of endpoint.parameters) {
    if (['q', 'search', 'limit', 'offset'].includes(param.name)) {
      continue;
    }

    // `sort` is not a filter — it's an ordering parameter validated against
    // the endpoint's x-sortable allowlist. Generating `?sort=example` would
    // produce a 400 FIELD_NOT_SORTABLE on every migrated list endpoint.
    // Sort coverage lives in the unit/integration tests instead.
    if (param.name === 'sort') {
      continue;
    }

    // Add filter example
    const filterValue = param.schema?.enum?.[0] || 'example';
    requests.push({
      name: `Filter by ${param.name}`,
      request: createRequest('GET', {
        ...url,
        query: [
          { key: param.name, value: filterValue, description: param.description || `Filter by ${param.name}` }
        ]
      }),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('GET', endpoint).split('\n')
        }
      }]
    });
  }

  return requests;
}

/**
 * Generate requests for a GET by ID endpoint
 */
function generateGetByIdRequests(apiMetadata, endpoint, examples) {
  const requests = [];

  // Create one request per example
  for (const example of examples) {
    const urlWithId = substituteId(createPostmanUrl(endpoint.path), example.data.id);

    requests.push({
      name: `Get ${example.name}`,
      request: createRequest('GET', urlWithId),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('GET', endpoint).split('\n')
        }
      }]
    });
  }

  // Add 404 test example
  const notFoundUrl = substituteId(createPostmanUrl(endpoint.path), '00000000-0000-0000-0000-000000000000');

  requests.push({
    name: `Get Non-Existent ${capitalize(singularize(apiMetadata.name))} (404)`,
    request: createRequest('GET', notFoundUrl),
    event: [{
      listen: 'test',
      script: {
        exec: [
          'pm.test("Status code is 404", function () {',
          '    pm.response.to.have.status(404);',
          '});',
          '',
          'pm.test("Error response has code and message", function () {',
          '    const jsonData = pm.response.json();',
          '    pm.expect(jsonData).to.have.property(\'code\');',
          '    pm.expect(jsonData).to.have.property(\'message\');',
          '});'
        ]
      }
    }]
  });

  return requests;
}

/**
 * Generate requests for a POST endpoint
 */
function generateCreateRequests(apiMetadata, endpoint, examples) {
  const requests = [];
  const url = createPostmanUrl(endpoint.path);

  if (examples.length === 0) {
    return requests;
  }

  // 1. Create with minimal required fields
  const minimalData = { ...examples[0].data };
  delete minimalData.id;
  delete minimalData.createdAt;
  delete minimalData.updatedAt;

  requests.push({
    name: `Create ${capitalize(singularize(apiMetadata.name))}`,
    request: createRequest('POST', url, minimalData,
      `Create a new ${singularize(apiMetadata.name)} with example data`),
    event: [{
      listen: 'test',
      script: {
        exec: generateTestScript('POST', endpoint).split('\n')
      }
    }]
  });

  // 2. Create with different data (if we have multiple examples)
  if (examples.length > 1) {
    const altData = { ...examples[1].data };
    delete altData.id;
    delete altData.createdAt;
    delete altData.updatedAt;

    requests.push({
      name: `Create ${capitalize(singularize(apiMetadata.name))} (Alternative)`,
      request: createRequest('POST', url, altData,
        `Create another ${singularize(apiMetadata.name)} with different data`),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('POST', endpoint).split('\n')
        }
      }]
    });
  }

  return requests;
}

/**
 * Generate requests for a PATCH endpoint
 */
function generateUpdateRequests(apiMetadata, endpoint, examples) {
  const requests = [];

  if (examples.length === 0) {
    return requests;
  }

  const example = examples[0];
  const urlWithId = substituteId(createPostmanUrl(endpoint.path), example.data.id);

  // 1. Update single field
  const singleFieldUpdate = {};
  const numericField = Object.keys(example.data).find(key =>
    typeof example.data[key] === 'number' && !['id'].includes(key)
  );
  if (numericField) {
    singleFieldUpdate[numericField] = example.data[numericField] + 100;
  }

  if (Object.keys(singleFieldUpdate).length > 0) {
    requests.push({
      name: `Update ${capitalize(singularize(apiMetadata.name))} - Single Field`,
      request: createRequest('PATCH', urlWithId, singleFieldUpdate,
        `Update a single field of ${example.name}`),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('PATCH', endpoint).split('\n')
        }
      }]
    });
  }

  // 2. Update nested object (if exists)
  const nestedField = Object.keys(example.data).find(key =>
    example.data[key] && typeof example.data[key] === 'object' &&
    !Array.isArray(example.data[key]) &&
    !['id', 'createdAt', 'updatedAt'].includes(key)
  );

  if (nestedField) {
    const nestedUpdate = { [nestedField]: example.data[nestedField] };
    requests.push({
      name: `Update ${capitalize(singularize(apiMetadata.name))} - ${capitalize(nestedField)}`,
      request: createRequest('PATCH', urlWithId, nestedUpdate,
        `Update ${nestedField} of ${example.name}`),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('PATCH', endpoint).split('\n')
        }
      }]
    });
  }

  // 3. Update multiple fields
  const multiFieldUpdate = {};
  let fieldCount = 0;
  for (const [key, value] of Object.entries(example.data)) {
    if (['id', 'createdAt', 'updatedAt'].includes(key) || fieldCount >= 3) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      multiFieldUpdate[key] = value;
      fieldCount++;
    }
  }

  if (Object.keys(multiFieldUpdate).length > 1) {
    requests.push({
      name: `Update ${capitalize(singularize(apiMetadata.name))} - Multiple Fields`,
      request: createRequest('PATCH', urlWithId, multiFieldUpdate,
        `Update multiple fields of ${example.name}`),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('PATCH', endpoint).split('\n')
        }
      }]
    });
  }

  return requests;
}

/**
 * Generate requests for a DELETE endpoint
 */
function generateDeleteRequests(apiMetadata, endpoint, examples) {
  const requests = [];

  if (examples.length === 0) {
    return requests;
  }

  const example = examples[examples.length - 1]; // Use last example for delete
  const urlWithId = substituteId(createPostmanUrl(endpoint.path), example.data.id);

  requests.push({
    name: `Delete ${capitalize(singularize(apiMetadata.name))}`,
    request: createRequest('DELETE', urlWithId,
      null,
      `Delete ${example.name}`),
    event: [{
      listen: 'test',
      script: {
        exec: generateTestScript('DELETE', endpoint).split('\n')
      }
    }]
  });

  return requests;
}

// =============================================================================
// RPC Request Generators
// =============================================================================

/**
 * Generate example body data from an OpenAPI schema definition
 */
function generateExampleBody(schema) {
  if (!schema || !schema.properties) return null;
  const body = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    switch (prop.type) {
      case 'number':
      case 'integer':
        body[key] = 0;
        break;
      case 'boolean':
        body[key] = true;
        break;
      default:
        body[key] = `example ${key}`;
    }
  }
  return Object.keys(body).length > 0 ? body : null;
}

/**
 * Generate a single RPC request for a state transition endpoint.
 * @param {Object} apiMetadata - API metadata
 * @param {Object} endpoint - The RPC endpoint
 * @param {Object} rpcContext - { example, callerId } from planRpcExecution
 */
function generateRpcRequest(apiMetadata, endpoint, rpcContext, { expectConflict = false } = {}) {
  // Extract trigger name from last path segment (/tasks/{taskId}/claim → claim)
  const pathSegments = endpoint.path.split('/').filter(s => s);
  const triggerName = pathSegments[pathSegments.length - 1];
  const displayName = `${capitalize(triggerName)} ${capitalize(singularize(apiMetadata.name))}`;

  const url = createPostmanUrl(endpoint.path);

  // Substitute the chosen example's ID into the path parameter
  let urlWithId = url;
  if (rpcContext.example && url.variables.length > 0) {
    urlWithId = substituteId(url, rpcContext.example.data.id);
  }

  const body = generateExampleBody(endpoint.requestSchema);

  const request = createRequest('POST', urlWithId, body,
    `Trigger the ${triggerName} transition`);

  // Add X-Caller-Id header with the planned caller ID
  request.header.push({
    key: 'X-Caller-Id',
    value: '{{callerId}}',
    type: 'text'
  });

  const testName = expectConflict ? `${displayName} (409 Conflict)` : displayName;

  return {
    name: testName,
    request,
    event: [{
      listen: 'test',
      script: {
        exec: generateRpcTestScript({ expectConflict }).split('\n')
      }
    }]
  };
}

/**
 * Generate all RPC requests for an API, ordered by valid state machine
 * transition sequence so tests pass when run in order.
 */
function generateOrderedRpcRequests(apiMetadata, rpcEndpoints, examples, stateMachine) {
  if (rpcEndpoints.length === 0) return { requests: [], callerId: null };

  // Build a map of trigger name → endpoint
  const endpointByTrigger = new Map();
  for (const ep of rpcEndpoints) {
    const segments = ep.path.split('/').filter(s => s);
    const trigger = segments[segments.length - 1];
    endpointByTrigger.set(trigger, ep);
  }

  // Plan execution: pick example, caller ID, and transition order
  const rpcContext = planRpcExecution(stateMachine, examples);

  // Order endpoints by the computed transition sequence
  const ordered = [];
  for (const trigger of rpcContext.transitionOrder) {
    const ep = endpointByTrigger.get(trigger);
    if (ep) {
      ordered.push(generateRpcRequest(apiMetadata, ep, rpcContext));
      endpointByTrigger.delete(trigger);
    }
  }

  // Append any RPC endpoints not reachable in the transition sequence.
  // These expect 409 since the resource is no longer in a valid "from" state.
  for (const [, ep] of endpointByTrigger) {
    ordered.push(generateRpcRequest(apiMetadata, ep, rpcContext, { expectConflict: true }));
  }

  return { requests: ordered, callerId: rpcContext.callerId };
}

// =============================================================================
// API Request Generation
// =============================================================================

/**
 * Generate all requests for an API
 */
function generateApiRequests(apiMetadata) {
  const rawExamples = loadExamples(apiMetadata.name);

  // Group endpoints by their top-level resource path (e.g., /tasks, /queues, /events)
  // This ensures multi-resource specs like workflow get separate folders per resource.
  const resourceGroups = new Map();

  // Sort endpoints: GET (list), GET (id), POST (create), PATCH, DELETE
  // RPC endpoints (POST on item sub-paths) are collected separately for ordering.
  const sortedEndpoints = [...apiMetadata.endpoints].sort((a, b) => {
    const order = { GET: 0, POST: 1, PATCH: 2, DELETE: 3 };
    const aOrder = order[a.method] ?? 999;
    const bOrder = order[b.method] ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;

    // GET list before GET by ID
    if (a.method === 'GET' && b.method === 'GET') {
      return a.path.includes('{') ? 1 : -1;
    }
    return 0;
  });

  for (const endpoint of sortedEndpoints) {
    // Skip endpoints that don't return JSON (e.g., SSE streams, file downloads)
    if (endpoint.method === 'GET' && !endpoint.responseSchema) {
      continue;
    }

    // Skip /me singleton endpoints — they require auth context not available in the generic collection
    if (endpoint.path.endsWith('/me')) {
      continue;
    }

    const endpointCollection = endpoint.path.split('/').filter(s => s)[0];
    if (!resourceGroups.has(endpointCollection)) {
      resourceGroups.set(endpointCollection, { items: [], rpcEndpoints: [] });
    }
    const group = resourceGroups.get(endpointCollection);

    const displayMeta = { ...apiMetadata, name: endpointCollection };
    const isCollection = !endpoint.path.includes('{');
    const isItem = endpoint.path.includes('{');
    // Sub-collection POSTs (path ends with a plural noun after a {param}) are CRUD creates,
    // not state machine transitions. Only classify POST as RPC when the last segment is singular
    // (a verb/action name like "submit", "open", "close") — never when it ends with 's'.
    const endsWithPluralNoun = /\/[a-z][a-z0-9_-]*s$/.test(endpoint.path.trimEnd());
    const isRpc = endpoint.method === 'POST' && isItem && !endsWithPluralNoun;

    // Match examples to endpoints by resource type
    const schemaPrefix = collectionToSchemaPrefix(endpointCollection);
    const filtered = {};
    for (const [key, value] of Object.entries(rawExamples)) {
      if (key.startsWith(schemaPrefix)) filtered[key] = value;
    }
    const examples = extractIndividualResources(filtered);

    let requests = [];

    if (endpoint.method === 'GET' && isCollection) {
      requests = generateListRequests(displayMeta, endpoint, examples);
    } else if (endpoint.method === 'GET' && isItem) {
      requests = generateGetByIdRequests(displayMeta, endpoint, examples);
    } else if (endpoint.method === 'POST' && isCollection) {
      requests = generateCreateRequests(displayMeta, endpoint, examples);
    } else if (isRpc) {
      group.rpcEndpoints.push(endpoint);
      continue; // handled below
    } else if (endpoint.method === 'PATCH' && isItem) {
      requests = generateUpdateRequests(displayMeta, endpoint, examples);
    } else if (endpoint.method === 'DELETE' && isItem) {
      requests = generateDeleteRequests(displayMeta, endpoint, examples);
    }

    group.items.push(...requests);
  }

  // Generate RPC requests per resource group
  const folders = [];
  let callerId = null;

  for (const [resourceName, group] of resourceGroups) {
    const displayMeta = { ...apiMetadata, name: resourceName };

    if (group.rpcEndpoints.length > 0) {
      const stateMachine = loadStateMachine(apiMetadata.name);
      if (stateMachine) {
        const smPrefix = stateMachine.object || collectionToSchemaPrefix(resourceName);
        const smFiltered = {};
        for (const [key, value] of Object.entries(rawExamples)) {
          if (key.startsWith(smPrefix)) smFiltered[key] = value;
        }
        const smExamples = extractIndividualResources(smFiltered);
        const result = generateOrderedRpcRequests(displayMeta, group.rpcEndpoints, smExamples, stateMachine);
        group.items.push(...result.requests);
        callerId = result.callerId;
      } else {
        const primaryExamples = extractIndividualResources(rawExamples);
        const rpcContext = { example: primaryExamples[0], callerId: 'postman-test-user' };
        for (const ep of group.rpcEndpoints) {
          group.items.push(generateRpcRequest(displayMeta, ep, rpcContext));
        }
      }
    }

    folders.push({ resourceName, items: group.items });
  }

  return { folders, callerId };
}
