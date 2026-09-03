/**
 * Unit tests for createSingletonUpdateHandler event emission.
 * Verifies that singleton sub-resource PATCH emits a full resource snapshot
 * on create (upsert) and a field-level diff on update — matching the behavior
 * of the collection create/update handlers.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll, findAll } from '../../src/database-manager.js';
import { registerRoutes } from '../../src/route-generator.js';

// ---------------------------------------------------------------------------
// Minimal test infrastructure
// ---------------------------------------------------------------------------

function createMockApp() {
  const routes = [];
  return {
    get: (path, handler) => routes.push({ method: 'GET', path, handler }),
    post: (path, handler) => routes.push({ method: 'POST', path, handler }),
    patch: (path, handler) => routes.push({ method: 'PATCH', path, handler }),
    put: (path, handler) => routes.push({ method: 'PUT', path, handler }),
    delete: (path, handler) => routes.push({ method: 'DELETE', path, handler }),
    getRoutes: () => routes,
  };
}

function createSingletonMetadata(path, method = 'patch') {
  return {
    name: 'test',
    title: 'Test API',
    serverBasePath: '/test',
    endpoints: [
      { path, method: method.toUpperCase(), operationId: 'updateHouseholdInfo' }
    ]
  };
}

function makeReqRes(params, body, headers = {}) {
  const req = { params, body, headers, path: Object.values(params).join('/') };
  const res = {
    _code: 200,
    _data: null,
    status(code) { this._code = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('singleton PATCH — create (upsert): emits .created with full resource snapshot', () => {
  clearAll('household-info');
  clearAll('events');

  const app = createMockApp();
  const metadata = createSingletonMetadata('/test/applications/{applicationId}/household-info');
  registerRoutes(app, metadata, 'http://localhost:1080');
  const route = app.getRoutes().find(r => r.method === 'PATCH');

  const { req, res } = makeReqRes(
    { applicationId: 'app-1' },
    { size: 3, housingCosts: 1200 }
  );
  route.handler(req, res);

  assert.strictEqual(res._code, 200);
  assert.ok(res._data.id, 'response has an id');
  assert.strictEqual(res._data.size, 3);

  const { items: events } = findAll('events', {});
  assert.strictEqual(events.length, 1);
  const event = events[0];
  assert.ok(event.type.endsWith('.created'), `event type should end with .created, got ${event.type}`);
  // Created event carries full snapshot, not a changes array
  assert.strictEqual(event.data.size, 3);
  assert.strictEqual(event.data.housingCosts, 1200);
  assert.ok(event.data.id, 'snapshot includes id');
});

test('singleton PATCH — update: emits .updated with changes diff', () => {
  clearAll('household-info');
  clearAll('events');

  // Pre-seed an existing record
  insertResource('household-info', {
    id: 'hh-1',
    applicationId: 'app-2',
    size: 3,
    housingCosts: 1200,
  });

  const app = createMockApp();
  const metadata = createSingletonMetadata('/test/applications/{applicationId}/household-info');
  registerRoutes(app, metadata, 'http://localhost:1080');
  const route = app.getRoutes().find(r => r.method === 'PATCH');

  const { req, res } = makeReqRes(
    { applicationId: 'app-2' },
    { size: 4 }
  );
  route.handler(req, res);

  assert.strictEqual(res._code, 200);
  assert.strictEqual(res._data.size, 4);

  const { items: events } = findAll('events', {});
  assert.strictEqual(events.length, 1);
  const event = events[0];
  assert.ok(event.type.endsWith('.updated'), `event type should end with .updated, got ${event.type}`);
  assert.ok(Array.isArray(event.data.changes), 'updated event has changes array');
  const sizeChange = event.data.changes.find(c => c.field === 'size');
  assert.ok(sizeChange, 'size field change present');
  assert.strictEqual(sizeChange.before, 3);
  assert.strictEqual(sizeChange.after, 4);
  // Unchanged field not in changes
  assert.ok(!event.data.changes.find(c => c.field === 'housingCosts'), 'unchanged field not in changes');
});

test('singleton PATCH — update with no meaningful change: emits .updated with empty changes', () => {
  clearAll('household-info');
  clearAll('events');

  insertResource('household-info', {
    id: 'hh-3',
    applicationId: 'app-3',
    size: 3,
  });

  const app = createMockApp();
  const metadata = createSingletonMetadata('/test/applications/{applicationId}/household-info');
  registerRoutes(app, metadata, 'http://localhost:1080');
  const route = app.getRoutes().find(r => r.method === 'PATCH');

  const { req, res } = makeReqRes(
    { applicationId: 'app-3' },
    { size: 3 }  // same value
  );
  route.handler(req, res);

  assert.strictEqual(res._code, 200);

  const { items: events } = findAll('events', {});
  assert.strictEqual(events.length, 1);
  const event = events[0];
  assert.ok(event.type.endsWith('.updated'));
  assert.deepStrictEqual(event.data.changes, []);
});
