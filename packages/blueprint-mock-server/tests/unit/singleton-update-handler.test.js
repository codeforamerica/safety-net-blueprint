/**
 * Unit tests for createSingletonUpdateHandler event emission.
 * Verifies that singleton sub-resource PATCH emits a full resource snapshot
 * on create (upsert) and a field-level diff on update — matching the behavior
 * of the collection create/update handlers.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMemoryStore } from '../../src/stores/memory-store.js';

// A store of this file's own, rather than one shared through a module-level
// singleton. In memory because these cases do not need a database — and
// because a fresh one per file is isolation they did not have before.
const store = createMemoryStore();
import { registerRoutes } from '../../src/route-generator.js';
import { makeRequest, readResponse } from '../helpers/fetch.js';

// ---------------------------------------------------------------------------
// Minimal test infrastructure
// ---------------------------------------------------------------------------

/**
 * Read a route table back in registration order.
 *
 * `registerRoutes` populates a table rather than an Express app (#448 step 2);
 * these cases drive the handler through the adapter, as the server does.
 */
function listRoutes(table) {
  return [...table].map(([key, entry]) => ({
    method: key.slice(0, key.indexOf(' ')),
    path: key.slice(key.indexOf(' ') + 1),
    handler: entry.handler,
  }));
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

/**
 * Call a registered route the way the dispatcher does.
 *
 * @returns {Promise<{ _code: number, _data: unknown }>} named to match the
 *   assertions these cases already make.
 */
async function callRoute(route, params, body, headers = {}) {
  const request = makeRequest(`/${Object.values(params).join('/')}`, { method: 'PATCH', body, headers });
  const { status, body: data } = await readResponse(route.handler(request, { params }));
  return { _code: status, _data: data };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('singleton PATCH — create (upsert): emits .created with full resource snapshot', async () => {
  store.clearAll('household-info');
  store.clearAll('events');

  const table = new Map();
  const metadata = createSingletonMetadata('/test/applications/{applicationId}/household-info');
  registerRoutes(table, metadata, 'http://localhost:1080', [], [], { store: store });
  const route = listRoutes(table).find(r => r.method === 'PATCH');

  const res = await callRoute(route,
    { applicationId: 'app-1' },
    { size: 3, housingCosts: 1200 }
  );

  assert.strictEqual(res._code, 200);
  assert.ok(res._data.id, 'response has an id');
  assert.strictEqual(res._data.size, 3);

  const { items: events } = store.findAll('events', {});
  assert.strictEqual(events.length, 1);
  const event = events[0];
  assert.ok(event.type.endsWith('.created'), `event type should end with .created, got ${event.type}`);
  // Created event carries full snapshot, not a changes array
  assert.strictEqual(event.data.size, 3);
  assert.strictEqual(event.data.housingCosts, 1200);
  assert.ok(event.data.id, 'snapshot includes id');
});

test('singleton PATCH — update: emits .updated with changes diff', async () => {
  store.clearAll('household-info');
  store.clearAll('events');

  // Pre-seed an existing record
  store.insertResource('household-info', {
    id: 'hh-1',
    applicationId: 'app-2',
    size: 3,
    housingCosts: 1200,
  });

  const table = new Map();
  const metadata = createSingletonMetadata('/test/applications/{applicationId}/household-info');
  registerRoutes(table, metadata, 'http://localhost:1080', [], [], { store: store });
  const route = listRoutes(table).find(r => r.method === 'PATCH');

  const res = await callRoute(route,
    { applicationId: 'app-2' },
    { size: 4 }
  );

  assert.strictEqual(res._code, 200);
  assert.strictEqual(res._data.size, 4);

  const { items: events } = store.findAll('events', {});
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

test('singleton PATCH — update with no meaningful change: emits .updated with empty changes', async () => {
  store.clearAll('household-info');
  store.clearAll('events');

  store.insertResource('household-info', {
    id: 'hh-3',
    applicationId: 'app-3',
    size: 3,
  });

  const table = new Map();
  const metadata = createSingletonMetadata('/test/applications/{applicationId}/household-info');
  registerRoutes(table, metadata, 'http://localhost:1080', [], [], { store: store });
  const route = listRoutes(table).find(r => r.method === 'PATCH');

  const res = await callRoute(route,
    { applicationId: 'app-3' },
    { size: 3 }  // same value
  );

  assert.strictEqual(res._code, 200);

  const { items: events } = store.findAll('events', {});
  assert.strictEqual(events.length, 1);
  const event = events[0];
  assert.ok(event.type.endsWith('.updated'));
  assert.deepStrictEqual(event.data.changes, []);
});
