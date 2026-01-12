/**
 * Unit tests for route generator
 * Tests path conversion, endpoint detection, and route registration
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { registerRoutes, registerAllRoutes } from '../../src/route-generator.js';

// Mock Express app to capture registered routes
function createMockApp() {
  const routes = [];
  const app = {
    get: (path, handler) => routes.push({ method: 'GET', path, handler }),
    post: (path, handler) => routes.push({ method: 'POST', path, handler }),
    patch: (path, handler) => routes.push({ method: 'PATCH', path, handler }),
    delete: (path, handler) => routes.push({ method: 'DELETE', path, handler }),
    put: (path, handler) => routes.push({ method: 'PUT', path, handler }),
    getRoutes: () => routes,
    clear: () => routes.length = 0
  };
  return app;
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
  // Path Format Conversion (OpenAPI to Express)
  // ==========================================================================

  await t.test('registerRoutes - converts OpenAPI path params to Express format', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'get', operationId: 'getPerson' }
    ]);

    registerRoutes(app, metadata, 'http://localhost:1080');
    const routes = app.getRoutes();

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].path, '/persons/:personId');
    console.log('  ✓ Converts {personId} to :personId');
  });

  await t.test('registerRoutes - handles multiple path parameters', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/orgs/{orgId}/users/{userId}', method: 'get', operationId: 'getOrgUser' }
    ]);

    registerRoutes(app, metadata, 'http://localhost:1080');
    const routes = app.getRoutes();

    assert.strictEqual(routes[0].path, '/orgs/:orgId/users/:userId');
    console.log('  ✓ Converts multiple path parameters');
  });

  await t.test('registerRoutes - preserves paths without parameters', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/health', method: 'get', operationId: 'healthCheck' }
    ]);

    // Note: This will be treated as a collection endpoint and get a list handler
    registerRoutes(app, metadata, 'http://localhost:1080');
    const routes = app.getRoutes();

    assert.strictEqual(routes[0].path, '/health');
    console.log('  ✓ Preserves paths without parameters');
  });

  // ==========================================================================
  // Collection vs Item Endpoint Detection
  // ==========================================================================

  await t.test('registerRoutes - assigns list handler to collection GET', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'get', operationId: 'listPersons' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');

    assert.strictEqual(registered[0].description, 'List/search resources');
    console.log('  ✓ Assigns list handler to collection GET');
  });

  await t.test('registerRoutes - assigns get handler to item GET', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'get', operationId: 'getPerson' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');

    assert.strictEqual(registered[0].description, 'Get resource by ID');
    console.log('  ✓ Assigns get handler to item GET');
  });

  await t.test('registerRoutes - assigns create handler to collection POST', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'post', operationId: 'createPerson' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');

    assert.strictEqual(registered[0].description, 'Create resource');
    console.log('  ✓ Assigns create handler to collection POST');
  });

  await t.test('registerRoutes - assigns update handler to item PATCH', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'patch', operationId: 'updatePerson' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');

    assert.strictEqual(registered[0].description, 'Update resource');
    console.log('  ✓ Assigns update handler to item PATCH');
  });

  await t.test('registerRoutes - assigns delete handler to item DELETE', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'delete', operationId: 'deletePerson' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');

    assert.strictEqual(registered[0].description, 'Delete resource');
    console.log('  ✓ Assigns delete handler to item DELETE');
  });

  // ==========================================================================
  // Unsupported Endpoint Handling
  // ==========================================================================

  await t.test('registerRoutes - skips unsupported endpoints (POST to item)', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons/{personId}', method: 'post', operationId: 'postToItem' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');

    assert.strictEqual(registered.length, 0, 'Should not register unsupported endpoint');
    assert.strictEqual(app.getRoutes().length, 0);
    console.log('  ✓ Skips POST to item endpoint (unsupported)');
  });

  await t.test('registerRoutes - skips unsupported endpoints (PATCH to collection)', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'patch', operationId: 'patchCollection' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');

    assert.strictEqual(registered.length, 0, 'Should not register unsupported endpoint');
    console.log('  ✓ Skips PATCH to collection endpoint (unsupported)');
  });

  await t.test('registerRoutes - skips unsupported endpoints (DELETE to collection)', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'delete', operationId: 'deleteCollection' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');

    assert.strictEqual(registered.length, 0, 'Should not register unsupported endpoint');
    console.log('  ✓ Skips DELETE to collection endpoint (unsupported)');
  });

  // ==========================================================================
  // Full API Registration
  // ==========================================================================

  await t.test('registerRoutes - registers full CRUD API', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'get', operationId: 'listPersons' },
      { path: '/persons', method: 'post', operationId: 'createPerson' },
      { path: '/persons/{personId}', method: 'get', operationId: 'getPerson' },
      { path: '/persons/{personId}', method: 'patch', operationId: 'updatePerson' },
      { path: '/persons/{personId}', method: 'delete', operationId: 'deletePerson' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');
    const routes = app.getRoutes();

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
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'get', operationId: 'listPersons' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');

    assert.strictEqual(registered.length, 1);
    assert.strictEqual(registered[0].method, 'GET');
    assert.strictEqual(registered[0].path, '/persons');
    assert.strictEqual(registered[0].expressPath, '/persons');
    assert.strictEqual(registered[0].operationId, 'listPersons');
    assert.ok(registered[0].description);

    console.log('  ✓ Returns registered endpoint info with all properties');
  });

  // ==========================================================================
  // registerAllRoutes
  // ==========================================================================

  await t.test('registerAllRoutes - registers multiple APIs', () => {
    const app = createMockApp();
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

    const allEndpoints = registerAllRoutes(app, apiSpecs, 'http://localhost:1080');
    const routes = app.getRoutes();

    assert.strictEqual(routes.length, 4, 'Should register all 4 endpoints');
    assert.strictEqual(allEndpoints.length, 2, 'Should return info for 2 APIs');
    assert.strictEqual(allEndpoints[0].apiName, 'test-api');
    assert.strictEqual(allEndpoints[1].apiName, 'households-api');

    console.log('  ✓ Registers multiple APIs');
  });

  await t.test('registerAllRoutes - returns grouped endpoint info', () => {
    const app = createMockApp();
    const apiSpecs = [
      createTestMetadata([
        { path: '/persons', method: 'get', operationId: 'listPersons' }
      ])
    ];

    const allEndpoints = registerAllRoutes(app, apiSpecs, 'http://localhost:1080');

    assert.ok(Array.isArray(allEndpoints));
    assert.strictEqual(allEndpoints[0].apiName, 'test-api');
    assert.strictEqual(allEndpoints[0].title, 'Test API');
    assert.ok(Array.isArray(allEndpoints[0].endpoints));

    console.log('  ✓ Returns grouped endpoint info by API');
  });

  await t.test('registerAllRoutes - handles empty specs array', () => {
    const app = createMockApp();

    const allEndpoints = registerAllRoutes(app, [], 'http://localhost:1080');

    assert.strictEqual(allEndpoints.length, 0);
    assert.strictEqual(app.getRoutes().length, 0);

    console.log('  ✓ Handles empty specs array');
  });

  // ==========================================================================
  // Handler Assignment
  // ==========================================================================

  await t.test('registerRoutes - creates handlers as functions', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'get', operationId: 'listPersons' },
      { path: '/persons', method: 'post', operationId: 'createPerson' },
      { path: '/persons/{personId}', method: 'get', operationId: 'getPerson' },
      { path: '/persons/{personId}', method: 'patch', operationId: 'updatePerson' },
      { path: '/persons/{personId}', method: 'delete', operationId: 'deletePerson' }
    ]);

    registerRoutes(app, metadata, 'http://localhost:1080');
    const routes = app.getRoutes();

    for (const route of routes) {
      assert.strictEqual(typeof route.handler, 'function', `Handler for ${route.method} ${route.path} should be a function`);
    }

    console.log('  ✓ All handlers are functions');
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  await t.test('registerRoutes - handles mixed case HTTP methods', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/persons', method: 'GET', operationId: 'listPersons' },
      { path: '/persons', method: 'POST', operationId: 'createPerson' }
    ]);

    const registered = registerRoutes(app, metadata, 'http://localhost:1080');
    const routes = app.getRoutes();

    assert.strictEqual(registered.length, 2);
    assert.strictEqual(routes.length, 2);

    console.log('  ✓ Handles uppercase HTTP methods');
  });

  await t.test('registerRoutes - handles paths with multiple segments', () => {
    const app = createMockApp();
    const metadata = createTestMetadata([
      { path: '/api/v1/users/{userId}/posts/{postId}', method: 'get', operationId: 'getUserPost' }
    ]);

    registerRoutes(app, metadata, 'http://localhost:1080');
    const routes = app.getRoutes();

    assert.strictEqual(routes[0].path, '/api/v1/users/:userId/posts/:postId');

    console.log('  ✓ Handles complex nested paths');
  });

});

console.log('\n✓ All route generator tests passed\n');
