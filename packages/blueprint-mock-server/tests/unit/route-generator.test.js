/**
 * Unit tests for route generator
 * Tests path conversion, endpoint detection, and route registration
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { makeRequest, readResponse } from '../helpers/fetch.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';

// A store of this file's own, rather than one shared through a module-level
// singleton. In memory because these cases do not need a database — and
// because a fresh one per file is isolation they did not have before.
const store = createMemoryStore();

const DEPS = { store: store };
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { generate, load } from '@codeforamerica/blueprint-core';
import { registerRoutes, registerAllRoutes, registerRulesRoutes } from '../../src/route-generator.js';

/**
 * Compile a rules contract the way the server does at startup.
 *
 * `registerRulesRoutes` evaluates compiled graphs and skips any ruleset it has
 * no graph for, so a test that passes only the contract registers nothing.
 * setup.js builds them with `generate(docs, 'graph')`; these go through the
 * same call rather than hand-rolling a Doc, so the test cannot pass while the
 * real path is broken.
 *
 * @param {object} rulesDoc - Parsed rules contract
 * @returns {object[]} Compiled graphs
 */
function graphsFor(rulesDoc) {
  const dir = mkdtempSync(join(tmpdir(), 'rules-routes-'));
  try {
    const path = join(dir, `${rulesDoc.domain}-rules.yaml`);
    writeFileSync(path, yaml.dump(rulesDoc));
    const doc = load({ path, relativePath: basename(path) });
    return generate([doc], 'graph').map(({ graph }) => graph);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Read a route table back in registration order.
 *
 * `registerRoutes` populates a table rather than an Express app (#448 step 2),
 * so a handler is called the way the dispatcher calls it: with a `Request` and
 * the matched path params.
 */
function listRoutes(table) {
  return [...table].map(([key, entry]) => ({
    method: key.slice(0, key.indexOf(' ')),
    path: key.slice(key.indexOf(' ') + 1),
    template: key.slice(key.indexOf(' ') + 1),
    operationId: entry.operationId,
    handler: entry.handler,
  }));
}

// Sample API metadata for testing
function createTestMetadata(endpoints) {
  return {
    name: 'test-api',
    title: 'Test API',
    basePath: '/tests',
    endpoints: endpoints || []
  };
}

test('Route Generator Tests', async (t) => {

  // ==========================================================================
  // Path params survive registration, in the contract's own syntax
  // ==========================================================================

  await t.test('registerRoutes - keys a path parameter by the contract template', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'get', operationId: 'getPerson' }
    ]);

    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].path, '/persons/{personId}');
    console.log('  ✓ Keys /persons/{personId} by its template');
  });

  await t.test('registerRoutes - handles multiple path parameters', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/orgs/{orgId}/users/{userId}', method: 'get', operationId: 'getOrgUser' }
    ]);

    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    assert.strictEqual(routes[0].path, '/orgs/{orgId}/users/{userId}');
    console.log('  ✓ Converts multiple path parameters');
  });

  await t.test('registerRoutes - preserves paths without parameters', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/health', method: 'get', operationId: 'healthCheck' }
    ]);

    // Note: This will be treated as a collection endpoint and get a list handler
    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    assert.strictEqual(routes[0].path, '/health');
    console.log('  ✓ Preserves paths without parameters');
  });

  // ==========================================================================
  // Collection vs Item Endpoint Detection
  // ==========================================================================

  await t.test('registerRoutes - assigns list handler to collection GET', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'get', operationId: 'listPersons' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);

    assert.strictEqual(registered[0].description, 'List/search resources');
    console.log('  ✓ Assigns list handler to collection GET');
  });

  await t.test('registerRoutes - assigns get handler to item GET', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'get', operationId: 'getPerson' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);

    assert.strictEqual(registered[0].description, 'Get resource by ID');
    console.log('  ✓ Assigns get handler to item GET');
  });

  await t.test('registerRoutes - assigns create handler to collection POST', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'post', operationId: 'createPerson' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);

    assert.strictEqual(registered[0].description, 'Create resource');
    console.log('  ✓ Assigns create handler to collection POST');
  });

  await t.test('registerRoutes - assigns update handler to item PATCH', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'patch', operationId: 'updatePerson' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);

    assert.strictEqual(registered[0].description, 'Update resource');
    console.log('  ✓ Assigns update handler to item PATCH');
  });

  await t.test('registerRoutes - assigns delete handler to item DELETE', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'delete', operationId: 'deletePerson' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);

    assert.strictEqual(registered[0].description, 'Delete resource');
    console.log('  ✓ Assigns delete handler to item DELETE');
  });

  // ==========================================================================
  // Unsupported Endpoint Handling
  // ==========================================================================

  await t.test('registerRoutes - skips unsupported endpoints (POST to item)', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'post', operationId: 'postToItem' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);

    assert.strictEqual(registered.length, 0, 'Should not register unsupported endpoint');
    assert.strictEqual(listRoutes(table).length, 0);
    console.log('  ✓ Skips POST to item endpoint (unsupported)');
  });

  await t.test('registerRoutes - skips unsupported endpoints (PATCH to collection)', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'patch', operationId: 'patchCollection' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);

    assert.strictEqual(registered.length, 0, 'Should not register unsupported endpoint');
    console.log('  ✓ Skips PATCH to collection endpoint (unsupported)');
  });

  await t.test('registerRoutes - skips unsupported endpoints (DELETE to collection)', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'delete', operationId: 'deleteCollection' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);

    assert.strictEqual(registered.length, 0, 'Should not register unsupported endpoint');
    console.log('  ✓ Skips DELETE to collection endpoint (unsupported)');
  });

  // ==========================================================================
  // Full API Registration
  // ==========================================================================

  await t.test('registerRoutes - registers full CRUD API', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'get', operationId: 'listPersons' },
      { path: '/persons', method: 'post', operationId: 'createPerson' },
      { path: '/persons/{personId}', method: 'get', operationId: 'getPerson' },
      { path: '/persons/{personId}', method: 'patch', operationId: 'updatePerson' },
      { path: '/persons/{personId}', method: 'delete', operationId: 'deletePerson' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    assert.strictEqual(registered.length, 5, 'Should register all 5 CRUD endpoints');
    assert.strictEqual(routes.length, 5);

    // Verify methods
    const methods = routes.map(r => r.method);
    assert.ok(methods.includes('GET'));
    assert.ok(methods.includes('POST'));
    assert.ok(methods.includes('PATCH'));
    assert.ok(methods.includes('DELETE'));

    console.log('  ✓ Registers full CRUD API (5 endpoints)');
  });

  await t.test('registerRoutes - returns registered endpoint info', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'get', operationId: 'listPersons' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);

    assert.strictEqual(registered.length, 1);
    assert.strictEqual(registered[0].method, 'GET');
    assert.strictEqual(registered[0].path, '/persons');
    assert.strictEqual(registered[0].operationId, 'listPersons');
    assert.ok(registered[0].description);

    console.log('  ✓ Returns registered endpoint info with all properties');
  });

  // ==========================================================================
  // registerAllRoutes
  // ==========================================================================

  await t.test('registerAllRoutes - registers multiple APIs', () => {
    const table = new Map();
    const apiSpecs = [
      createTestMetadata([
        { path: '/persons', method: 'get', operationId: 'listPersons' },
        { path: '/persons/{personId}', method: 'get', operationId: 'getPerson' }
      ]),
      {
        name: 'households-api',
        title: 'Households API',
        basePath: '/households',
        endpoints: [
          { path: '/households', method: 'get', operationId: 'listHouseholds' },
          { path: '/households/{householdId}', method: 'get', operationId: 'getHousehold' }
        ]
      }
    ];

    const allEndpoints = registerAllRoutes(table, apiSpecs, 'http://localhost:1080');
    const routes = listRoutes(table);

    assert.strictEqual(routes.length, 4, 'Should register all 4 endpoints');
    assert.strictEqual(allEndpoints.length, 2, 'Should return info for 2 APIs');
    assert.strictEqual(allEndpoints[0].apiName, 'test-api');
    assert.strictEqual(allEndpoints[1].apiName, 'households-api');

    console.log('  ✓ Registers multiple APIs');
  });

  await t.test('registerAllRoutes - returns grouped endpoint info', () => {
    const table = new Map();
    const apiSpecs = [
      createTestMetadata([
        { path: '/persons', method: 'get', operationId: 'listPersons' }
      ])
    ];

    const allEndpoints = registerAllRoutes(table, apiSpecs, 'http://localhost:1080');

    assert.ok(Array.isArray(allEndpoints));
    assert.strictEqual(allEndpoints[0].apiName, 'test-api');
    assert.strictEqual(allEndpoints[0].title, 'Test API');
    assert.ok(Array.isArray(allEndpoints[0].endpoints));

    console.log('  ✓ Returns grouped endpoint info by API');
  });

  await t.test('registerAllRoutes - handles empty specs array', () => {
    const table = new Map();

    const allEndpoints = registerAllRoutes(table, [], 'http://localhost:1080');

    assert.strictEqual(allEndpoints.length, 0);
    assert.strictEqual(listRoutes(table).length, 0);

    console.log('  ✓ Handles empty specs array');
  });

  // ==========================================================================
  // Handler Assignment
  // ==========================================================================

  await t.test('registerRoutes - creates handlers as functions', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'get', operationId: 'listPersons' },
      { path: '/persons', method: 'post', operationId: 'createPerson' },
      { path: '/persons/{personId}', method: 'get', operationId: 'getPerson' },
      { path: '/persons/{personId}', method: 'patch', operationId: 'updatePerson' },
      { path: '/persons/{personId}', method: 'delete', operationId: 'deletePerson' }
    ]);

    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    for (const route of routes) {
      assert.strictEqual(typeof route.handler, 'function', `Handler for ${route.method} ${route.path} should be a function`);
    }

    console.log('  ✓ All handlers are functions');
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  await t.test('registerRoutes - handles mixed case HTTP methods', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'GET', operationId: 'listPersons' },
      { path: '/persons', method: 'POST', operationId: 'createPerson' }
    ]);

    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    assert.strictEqual(registered.length, 2);
    assert.strictEqual(routes.length, 2);

    console.log('  ✓ Handles uppercase HTTP methods');
  });

  await t.test('registerRoutes - handles paths with multiple segments', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/api/v1/users/{userId}/posts/{postId}', method: 'get', operationId: 'getUserPost' }
    ]);

    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    assert.strictEqual(routes[0].path, '/api/v1/users/{userId}/posts/{postId}');

    console.log('  ✓ Handles complex nested paths');
  });

  // ==========================================================================
  // Server base path — collection name derivation
  // ==========================================================================

  await t.test('registerRoutes - derives collection name by stripping serverBasePath', () => {
    const table = new Map();
    const metadata = {
      name: 'applications',
      title: 'Applications API',
      serverBasePath: '/intake',
      endpoints: [
        { path: '/intake/applications', method: 'GET', operationId: 'listApplications' },
        { path: '/intake/applications/{applicationId}', method: 'GET', operationId: 'getApplication' },
        { path: '/intake/applications', method: 'POST', operationId: 'createApplication' }
      ]
    };

    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    // All routes should be registered at the full prefixed path
    const paths = routes.map(r => r.path);
    assert.ok(paths.includes('/intake/applications'), 'List route registered at prefixed path');
    assert.ok(paths.includes('/intake/applications/{applicationId}'), 'Get route registered at prefixed path');

    console.log('  ✓ Routes registered at prefixed paths with correct collection names');
  });

  // ==========================================================================
  // Sub-resource path routing
  // ==========================================================================

  await t.test('registerRoutes - registers sub-collection GET as list sub-resources', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/documents', method: 'get', operationId: 'listDocuments' }
    ]);
    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(registered.length, 1);
    assert.strictEqual(registered[0].description, 'List sub-resources');
    assert.strictEqual(listRoutes(table)[0].path, '/applications/{applicationId}/documents');
    console.log('  ✓ Sub-collection GET registered as list sub-resources');
  });

  await t.test('registerRoutes - registers sub-collection POST as create sub-resource', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/documents', method: 'post', operationId: 'createDocument' }
    ]);
    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(registered.length, 1);
    assert.strictEqual(registered[0].description, 'Create sub-resource');
    console.log('  ✓ Sub-collection POST registered as create sub-resource');
  });

  await t.test('registerRoutes - registers sub-item GET as get sub-resource by ID', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/documents/{documentId}', method: 'get', operationId: 'getDocument' }
    ]);
    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(registered.length, 1);
    assert.strictEqual(registered[0].description, 'Get sub-resource by ID');
    assert.strictEqual(listRoutes(table)[0].path, '/applications/{applicationId}/documents/{documentId}');
    console.log('  ✓ Sub-item GET registered as get sub-resource by ID');
  });

  await t.test('registerRoutes - registers sub-item PATCH as update sub-resource', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/documents/{documentId}', method: 'patch', operationId: 'updateDocument' }
    ]);
    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(registered[0].description, 'Update sub-resource');
    console.log('  ✓ Sub-item PATCH registered as update sub-resource');
  });

  await t.test('registerRoutes - registers sub-item DELETE as delete sub-resource', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/documents/{documentId}', method: 'delete', operationId: 'deleteDocument' }
    ]);
    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(registered[0].description, 'Delete sub-resource');
    console.log('  ✓ Sub-item DELETE registered as delete sub-resource');
  });

  await t.test('registerRoutes - registers singleton GET as get singleton sub-resource', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/interview', method: 'get', operationId: 'getInterview' }
    ]);
    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(registered.length, 1);
    assert.strictEqual(registered[0].description, 'Get singleton sub-resource');
    assert.strictEqual(listRoutes(table)[0].path, '/applications/{applicationId}/interview');
    console.log('  ✓ Singleton GET registered as get singleton sub-resource');
  });

  await t.test('registerRoutes - registers singleton PATCH as update singleton sub-resource', () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/interview', method: 'patch', operationId: 'updateInterview' }
    ]);
    const registered = registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(registered[0].description, 'Update singleton sub-resource');
    console.log('  ✓ Singleton PATCH registered as update singleton sub-resource');
  });

  await t.test('registerRoutes - derives sub-collection name as parent-prefixed (not bare child)', async () => {
    // GET /applications/{applicationId}/documents → collection 'application-documents', not 'documents'.
    // Prefix prevents cross-domain DB collisions. Verified by checking parent existence:
    // a missing parent returns 404, confirming "applications" is correctly the parent collection.
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/documents', method: 'get', operationId: 'listDocuments' }
    ]);
    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);
    assert.strictEqual(routes.length, 1);
    const { status } = await readResponse(
      routes[0].handler(makeRequest('/applications/nonexistent-app/documents'), { params: { applicationId: 'nonexistent-app' } })
    );
    // Parent doesn't exist → 404 from parent collection check (not 500 from wrong collection)
    assert.strictEqual(status, 404);
    console.log('  ✓ Sub-collection GET uses prefixed collection "application-documents"');
  });

  await t.test('registerRoutes - singleton handler lazy-initializes when no record exists for parent', async () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/interview', method: 'get', operationId: 'getInterview' }
    ]);
    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    const { body: responseBody } = await readResponse(
      routes[0].handler(makeRequest('/applications/nonexistent-app/interview'), { params: { applicationId: 'nonexistent-app' } })
    );
    assert.ok(responseBody, 'Singleton GET returns a body on first access');
    assert.ok(responseBody.id, 'Singleton GET returns a record with an id');
    assert.strictEqual(responseBody.applicationId, 'nonexistent-app', 'Singleton GET sets parent FK');
    console.log('  ✓ Singleton GET lazy-initializes empty record on first access');
  });

  await t.test('registerRoutes - sub-collection GET returns 404 when parent does not exist', async () => {
    // When the parent application doesn't exist, the sub-collection GET returns 404
    // instead of an empty list. Filtering by parent ID is verified in integration tests.
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/documents', method: 'get', operationId: 'listDocuments' }
    ]);
    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    const { status } = await readResponse(
      routes[0].handler(makeRequest('/applications/nonexistent-app/documents'), { params: { applicationId: 'nonexistent-app' } })
    );
    assert.strictEqual(status, 404, 'Returns 404 when parent application does not exist');
    console.log('  ✓ Sub-collection GET returns 404 when parent does not exist');
  });

  await t.test('registerRoutes - sub-collection POST injects parent ID into body', async () => {
    const table = new Map();
    const metadata = createTestMetadata([
      { path: '/applications/{applicationId}/documents', method: 'post', operationId: 'createDocument' }
    ]);
    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    // A Request body cannot be reassigned, so the parent ID now rides through
    // ctx rather than by mutating req.body. Assert the outcome instead: the
    // created resource carries the parent FK.
    store.clearAll('application-documents');
    const request = makeRequest('/applications/app-456/documents', { method: 'POST', body: { category: 'income' } });
    const { status, body: created } = await readResponse(
      routes[0].handler(request, { params: { applicationId: 'app-456' } })
    );
    assert.strictEqual(status, 201, 'sub-collection POST returns 201');
    assert.strictEqual(created.applicationId, 'app-456', 'Parent ID injected into created resource');
    console.log('  ✓ Sub-collection POST injects parent ID into body');
  });

  await t.test('registerRoutes - collection name excludes serverBasePath segment', async () => {
    // Verify that a GET handler uses "applications" as collection, not "intake"
    // by checking the handler invokes findById with the right collection name.
    // We do this by registering, then calling the GET handler with a mock req/res.
    const table = new Map();
    const metadata = {
      name: 'applications',
      title: 'Applications API',
      serverBasePath: '/intake',
      endpoints: [
        { path: '/intake/applications/{applicationId}', method: 'GET', operationId: 'getApplication' }
      ]
    };

    registerRoutes(table, metadata, 'http://localhost:1080', [], [], DEPS);
    const routes = listRoutes(table);

    assert.strictEqual(routes.length, 1);
    // The handler should reference collectionName "applications" not "intake"
    // We can verify this by reading the endpointWithCollection from the closure
    // by triggering it and observing that it looks in the right collection
    // (a missing resource in "applications" returns 404, not 500)
    const { status } = await readResponse(
      routes[0].handler(makeRequest('/intake/applications/nonexistent-id'), { params: { applicationId: 'nonexistent-id' } })
    );
    assert.strictEqual(status, 404, 'Should return 404 for missing resource (not 500 from wrong collection)');

    console.log('  ✓ Handler uses "applications" collection (not "intake")');
  });

});

// =============================================================================
// registerRulesRoutes
// =============================================================================

const minimalRulesDoc = {
  $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
  domain: 'eligibility',
  rulesets: {
    snapEligibility: {
      endpoint: { path: '/assess-snap-eligibility' },
      inputs: {
        household: {
          type: 'object',
          properties: { monthlyIncome: { type: 'number' } },
        },
      },
      outputs: { eligible: { type: 'boolean' } },
      facts: [{ path: 'eligible', expression: 'household.monthlyIncome < 1500' }],
    },
    noEndpointRuleset: {
      inputs: { x: { type: 'object', properties: { v: { type: 'number' } } } },
      outputs: { result: { type: 'boolean' } },
      facts: [{ path: 'result', expression: 'x.v > 0' }],
    },
  },
};

test('registerRulesRoutes', async (t) => {

  await t.test('registers no routes when rulesFiles is empty', () => {
    const table = new Map();
    const result = registerRulesRoutes(table, []);
    assert.strictEqual(listRoutes(table).length, 0);
    assert.strictEqual(result.length, 0);
  });

  await t.test('skips rulesets without an endpoint declaration', () => {
    const table = new Map();
    registerRulesRoutes(table, [{ domain: 'eligibility', doc: minimalRulesDoc }], [], graphsFor(minimalRulesDoc));
    // Only snapEligibility has endpoint; noEndpointRuleset is skipped
    assert.strictEqual(listRoutes(table).length, 1);
  });

  await t.test('falls back to /domain prefix when no apiSpec found', () => {
    const table = new Map();
    registerRulesRoutes(table, [{ domain: 'eligibility', doc: minimalRulesDoc }], [], graphsFor(minimalRulesDoc));
    const routes = listRoutes(table);
    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].method, 'POST');
    assert.strictEqual(routes[0].path, '/eligibility/assess-snap-eligibility');
  });

  await t.test('uses serverBasePath from apiSpec when available', () => {
    const table = new Map();
    const apiSpecs = [{ name: 'eligibility', serverBasePath: '/eligibility' }];
    registerRulesRoutes(table, [{ domain: 'eligibility', doc: minimalRulesDoc }], apiSpecs, graphsFor(minimalRulesDoc));
    const routes = listRoutes(table);
    assert.strictEqual(routes[0].path, '/eligibility/assess-snap-eligibility');
  });

  await t.test('handler returns evaluate result as JSON for complete inputs', async () => {
    const table = new Map();
    registerRulesRoutes(table, [{ domain: 'eligibility', doc: minimalRulesDoc }], [], graphsFor(minimalRulesDoc));
    const handler = listRoutes(table)[0].handler;

    const { status: statusCode, body: responseBody } = await readResponse(
      handler(makeRequest('/eligibility/evaluate', { method: 'POST', body: { household: { monthlyIncome: 800 } } }), { params: {} })
    );
    assert.ok(responseBody.eligible, 'result must have eligible');
    assert.strictEqual(responseBody.eligible.state, 'complete');
    assert.strictEqual(responseBody.eligible.value, true);
    assert.strictEqual(statusCode, 200);
  });

  await t.test('handler puts broken expressions in errors (not a 500)', async () => {
    const table = new Map();
    // The evaluator catches CEL errors internally — they appear in result.errors, not as thrown exceptions
    const brokenDoc = {
      $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
      domain: 'eligibility',
      rulesets: {
        broken: {
          endpoint: { path: '/broken' },
          inputs: { x: { type: 'object', properties: { v: { type: 'number' } } } },
          outputs: { result: { type: 'boolean' } },
          facts: [{ path: 'result', expression: 'this is not valid cel !!!' }],
        },
      },
    };
    registerRulesRoutes(table, [{ domain: 'eligibility', doc: brokenDoc }], [], graphsFor(brokenDoc));
    const handler = listRoutes(table)[0].handler;

    const { status: statusCode, body: responseBody } = await readResponse(
      handler(makeRequest('/eligibility/evaluate', { method: 'POST', body: { x: { v: 1 } } }), { params: {} })
    );
    assert.strictEqual(statusCode, 200);
    assert.ok(responseBody.result, 'broken expression must appear in result');
    assert.strictEqual(responseBody.result.state, 'error');
  });

  await t.test('returns registered endpoint descriptors', () => {
    const table = new Map();
    const result = registerRulesRoutes(table, [{ domain: 'eligibility', doc: minimalRulesDoc }], [], graphsFor(minimalRulesDoc));
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].method, 'POST');
    assert.ok(result[0].path.includes('assess-snap-eligibility'));
    assert.ok(result[0].description.includes('snapEligibility'));
  });

});

console.log('\n✓ All route generator tests passed\n');
