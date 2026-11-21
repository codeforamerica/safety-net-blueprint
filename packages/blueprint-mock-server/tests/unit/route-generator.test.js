/**
 * Unit tests for route generator
 * Tests path conversion, endpoint detection, and route registration
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { makeRequest, readResponse } from '../helpers/fetch.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';
import { createInstance } from '../../src/instance.js';

// A store of this file's own, rather than one shared through a module-level
// singleton. In memory because these cases do not need a database — and
// because a fresh one per file is isolation they did not have before.
const store = createMemoryStore();

const DEPS = { store, instance: createInstance({ store }) };
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { generate, load, extract } from '@codeforamerica/blueprint-core';
import { registerRoutes, registerAllRoutes, registerRulesRoutes } from '../../src/route-generator.js';
import { apiSpecsFromDocs } from '../../src/spec-loader.js';

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

/** The rules entry core reports for a document — what the mock serves from. */
function rulesEntry(rulesDoc) {
  const dir = mkdtempSync(join(tmpdir(), 'rules-entry-'));
  try {
    const path = join(dir, `${rulesDoc.domain}-rules.yaml`);
    writeFileSync(path, yaml.dump(rulesDoc));
    return extract([load({ path, relativePath: basename(path) })], 'rules');
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

/** An operation answering with the named schema. */
const op = (operationId, schema, status = 200) => ({
  operationId,
  responses: { [status]: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } },
});

/**
 * An API as the server loads it — through core's model of its document, which
 * is what says whether a path is a collection, an item or a singleton.
 *
 * @param {object} paths - OpenAPI paths, relative to the server
 * @param {{ domain?: string }} [options]
 */
function loadedApi(paths, { domain = 'intake' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'route-generator-'));
  try {
    const path = join(dir, `${domain}-openapi.yaml`);
    writeFileSync(path, yaml.dump({
      openapi: '3.1.0',
      info: { title: domain, version: '1', 'x-domain': domain },
      servers: [{ url: `http://localhost:1080/${domain}` }],
      paths,
    }));
    return apiSpecsFromDocs([load({ path, relativePath: basename(path) })])[0];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Intake's applications, with nested documents and an interview singleton. */
const intakeApi = () => loadedApi({
  '/applications': { get: op('listApplications', 'ApplicationList'), post: op('createApplication', 'Application', 201) },
  '/applications/{applicationId}': { get: op('getApplication', 'Application') },
  '/applications/{applicationId}/documents': { get: op('listDocuments', 'DocumentList'), post: op('createDocument', 'Document', 201) },
  '/applications/{applicationId}/documents/{documentId}': {
    get: op('getDocument', 'Document'), patch: op('updateDocument', 'Document'), delete: { operationId: 'deleteDocument', responses: { 204: {} } },
  },
  '/applications/{applicationId}/interview': { get: op('getInterview', 'Interview'), patch: op('updateInterview', 'Interview') },
});

/** What registerRoutes said it registered at a method and path. */
const described = (registered, method, path) => registered.find((e) => e.method === method && e.path === path)?.description;

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

    const allEndpoints = registerAllRoutes(table, apiSpecs, 'http://localhost:1080', [], [], [], DEPS);
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

    const allEndpoints = registerAllRoutes(table, apiSpecs, 'http://localhost:1080', [], [], [], DEPS);

    assert.ok(Array.isArray(allEndpoints));
    assert.strictEqual(allEndpoints[0].apiName, 'test-api');
    assert.strictEqual(allEndpoints[0].title, 'Test API');
    assert.ok(Array.isArray(allEndpoints[0].endpoints));

    console.log('  ✓ Returns grouped endpoint info by API');
  });

  await t.test('registerAllRoutes - handles empty specs array', () => {
    const table = new Map();

    const allEndpoints = registerAllRoutes(table, [], 'http://localhost:1080', [], [], [], DEPS);

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

  // What each path is comes from core's model of the document: a nested
  // collection, its items and a singleton are told apart by the document's
  // structure, never by how the last word is spelled.
  await t.test('registerRoutes - registers a nested collection\'s GET and POST as list and create sub-resource', () => {
    const table = new Map();
    const registered = registerRoutes(table, intakeApi(), 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(described(registered, 'GET', '/intake/applications/{applicationId}/documents'), 'List sub-resources');
    assert.strictEqual(described(registered, 'POST', '/intake/applications/{applicationId}/documents'), 'Create sub-resource');
  });

  await t.test('registerRoutes - registers a nested item\'s GET, PATCH and DELETE as sub-resource handlers', () => {
    const table = new Map();
    const registered = registerRoutes(table, intakeApi(), 'http://localhost:1080', [], [], DEPS);
    const item = '/intake/applications/{applicationId}/documents/{documentId}';
    assert.strictEqual(described(registered, 'GET', item), 'Get sub-resource by ID');
    assert.strictEqual(described(registered, 'PATCH', item), 'Update sub-resource');
    assert.strictEqual(described(registered, 'DELETE', item), 'Delete sub-resource');
  });

  await t.test('registerRoutes - registers a singleton\'s GET and PATCH as singleton sub-resource handlers', () => {
    const table = new Map();
    const registered = registerRoutes(table, intakeApi(), 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(described(registered, 'GET', '/intake/applications/{applicationId}/interview'), 'Get singleton sub-resource');
    assert.strictEqual(described(registered, 'PATCH', '/intake/applications/{applicationId}/interview'), 'Update singleton sub-resource');
  });

  // An irregular plural is a nested collection like any other: created,
  // listed, read and updated.
  await t.test('registerRoutes - a nested collection named people or children is served like any other', async () => {
    const table = new Map();
    const api = loadedApi({
      '/households': { get: op('listHouseholds', 'HouseholdList'), post: op('createHousehold', 'Household', 201) },
      '/households/{householdId}': { get: op('getHousehold', 'Household') },
      '/households/{householdId}/people': { get: op('listPeople', 'PersonList'), post: op('addPerson', 'Person', 201) },
      '/households/{householdId}/people/{personId}': { get: op('getPerson', 'Person'), patch: op('updatePerson', 'Person') },
      '/households/{householdId}/children': { get: op('listChildren', 'ChildList'), post: op('addChild', 'Child', 201) },
      '/households/{householdId}/children/{childId}': { get: op('getChild', 'Child') },
    }, { domain: 'census' });
    const registered = registerRoutes(table, api, 'http://localhost:1080', [], [], DEPS);
    assert.strictEqual(described(registered, 'POST', '/census/households/{householdId}/people'), 'Create sub-resource');
    assert.strictEqual(described(registered, 'GET', '/census/households/{householdId}/people'), 'List sub-resources');
    assert.strictEqual(described(registered, 'POST', '/census/households/{householdId}/children'), 'Create sub-resource');

    const handle = (method, key, path, params, body) => table.get(`${method} ${key}`).handler(
      makeRequest(path, { method, ...(body ? { body } : {}) }), { params });
    store.insertResource('census/households', { id: 'h1' });
    const created = await readResponse(handle('POST', '/census/households/{householdId}/people', '/census/households/h1/people', { householdId: 'h1' }, { name: 'Ana' }));
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.householdId, 'h1');
    const listed = await readResponse(handle('GET', '/census/households/{householdId}/people', '/census/households/h1/people', { householdId: 'h1' }));
    assert.deepStrictEqual(listed.body.items.map((p) => p.id), [created.body.id]);
    const item = '/census/households/{householdId}/people/{personId}';
    const read = await readResponse(handle('GET', item, `/census/households/h1/people/${created.body.id}`, { householdId: 'h1', personId: created.body.id }));
    assert.strictEqual(read.body.name, 'Ana');
    const updated = await readResponse(handle('PATCH', item, `/census/households/h1/people/${created.body.id}`, { householdId: 'h1', personId: created.body.id }, { name: 'Ana B' }));
    assert.strictEqual(updated.status, 200);
    assert.strictEqual(store.findById('census/households/people', created.body.id).name, 'Ana B');
  });

  await t.test('registerRoutes - a nested collection is kept under its domain and path', async () => {
    // GET /applications/{applicationId}/documents → collection 'intake/applications/documents'.
    // Verified by checking parent existence: a missing parent returns 404,
    // confirming 'intake/applications' is the parent collection.
    const table = new Map();
    registerRoutes(table, intakeApi(), 'http://localhost:1080', [], [], DEPS);
    const { status, body } = await readResponse(table.get('GET /intake/applications/{applicationId}/documents').handler(
      makeRequest('/intake/applications/nonexistent-app/documents'), { params: { applicationId: 'nonexistent-app' } }));
    // Parent doesn't exist → 404 from parent collection check (not 500 from wrong collection)
    assert.strictEqual(status, 404);
    assert.strictEqual(body.message, 'Application not found');
  });

  await t.test('registerRoutes - singleton handler lazy-initializes when no record exists for parent', async () => {
    const table = new Map();
    registerRoutes(table, intakeApi(), 'http://localhost:1080', [], [], DEPS);

    const { body: responseBody } = await readResponse(table.get('GET /intake/applications/{applicationId}/interview').handler(
      makeRequest('/intake/applications/nonexistent-app/interview'), { params: { applicationId: 'nonexistent-app' } }));
    assert.ok(responseBody, 'Singleton GET returns a body on first access');
    assert.ok(responseBody.id, 'Singleton GET returns a record with an id');
    assert.strictEqual(responseBody.applicationId, 'nonexistent-app', 'Singleton GET sets parent FK');
  });

  await t.test('registerRoutes - sub-collection GET searches with q, as a top-level list does', async () => {
    // A nested list declares `q` like any other, and the handler used to drop
    // it, answering every search with the whole list.
    const table = new Map();
    registerRoutes(table, intakeApi(), 'http://localhost:1080', [], [], DEPS);
    store.clearAll('intake/applications');
    store.clearAll('intake/applications/documents');
    store.insertResource('intake/applications', { id: 'app-q' });
    store.insertResource('intake/applications/documents', { id: 'd1', applicationId: 'app-q', category: 'income', receivedAt: '2026-10-01T09:00:00.000Z' });
    store.insertResource('intake/applications/documents', { id: 'd2', applicationId: 'app-q', category: 'identity', receivedAt: '2026-10-01T10:00:00.000Z' });

    const list = async (q) => (await readResponse(table.get('GET /intake/applications/{applicationId}/documents').handler(
      makeRequest(`/intake/applications/app-q/documents?q=${encodeURIComponent(q)}`), { params: { applicationId: 'app-q' } }
    ))).body;

    assert.deepStrictEqual((await list('category:income')).items.map(d => d.id), ['d1']);
    const since = await list('receivedAt:>=2026-10-01T09:30:00.000Z');
    assert.deepStrictEqual(since.items.map(d => d.id), ['d2']);
    assert.strictEqual(since.total, 1, 'total counts the matches, not every record under the parent');
  });

  await t.test('registerRoutes - sub-collection POST injects parent ID into body', async () => {
    const table = new Map();
    registerRoutes(table, intakeApi(), 'http://localhost:1080', [], [], DEPS);

    // A Request body cannot be reassigned, so the parent ID now rides through
    // ctx rather than by mutating req.body. Assert the outcome instead: the
    // created resource carries the parent FK.
    store.clearAll('intake/applications/documents');
    // The parent has to exist: nothing is created under one that isn't there.
    if (!store.findById('intake/applications', 'app-456')) store.insertResource('intake/applications', { id: 'app-456' });
    const request = makeRequest('/intake/applications/app-456/documents', { method: 'POST', body: { category: 'income' } });
    const { status, body: created } = await readResponse(table.get('POST /intake/applications/{applicationId}/documents').handler(
      request, { params: { applicationId: 'app-456' } }));
    assert.strictEqual(status, 201, 'sub-collection POST returns 201');
    assert.strictEqual(created.applicationId, 'app-456', 'Parent ID injected into created resource');
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
    grossIncome: {
      endpoint: { path: '/assess-gross-income' },
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

  await t.test('serves every ruleset, at /{domain} and the path it declares', () => {
    const table = new Map();
    registerRulesRoutes(table, rulesEntry(minimalRulesDoc), [], graphsFor(minimalRulesDoc));
    assert.deepStrictEqual(listRoutes(table).map((r) => `${r.method} ${r.path}`), [
      'POST /eligibility/assess-snap-eligibility',
      'POST /eligibility/assess-gross-income',
    ]);
  });

  await t.test('handler returns evaluate result as JSON for complete inputs', async () => {
    const table = new Map();
    registerRulesRoutes(table, rulesEntry(minimalRulesDoc), [], graphsFor(minimalRulesDoc));
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
    registerRulesRoutes(table, rulesEntry(brokenDoc), [], graphsFor(brokenDoc));
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
    const result = registerRulesRoutes(table, rulesEntry(minimalRulesDoc), [], graphsFor(minimalRulesDoc));
    assert.strictEqual(result.length, 2, 'both rulesets: one at its declared path, one at the default');
    assert.strictEqual(result[0].method, 'POST');
    assert.ok(result[0].path.includes('assess-snap-eligibility'));
    assert.ok(result[0].description.includes('snapEligibility'));
  });

});

console.log('\n✓ All route generator tests passed\n');
