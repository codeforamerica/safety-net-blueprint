/**
 * Unit tests for multi-level context resolution (domain → machine → trigger/operation).
 * Verifies that resolveContextLayers chains levels correctly and that inner scope
 * wins on name conflict.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMemoryStore } from '../../src/stores/memory-store.js';
import { createInstance } from '../../src/instance.js';

// A store of this file's own, rather than one shared through a module-level
// singleton. In memory because these cases do not need a database — and
// because a fresh one per file is isolation they did not have before.
const store = createMemoryStore();

// Handlers take their store as a parameter. These cases seed and assert through
// the shim's module-level exports, so they pass that same store.
const DEPS = { store, instance: createInstance({ store }) };
import { resolveContextLayers } from '../../src/handlers/procedure-runner.js';
import { createCreateHandler } from '../../src/handlers/create-handler.js';
import { makeRequest, readResponse } from '../helpers/fetch.js';

// =============================================================================
// resolveContextLayers — unit
// =============================================================================

function makeBase() {
  return { caller: { id: 'system', roles: [] }, object: {}, request: {}, now: '2025-01-01T00:00:00Z' };
}

test('resolveContextLayers — resolves domain-level binding', () => {
  store.clearAll('queues');
  store.insertResource('queues', { id: 'q-snap', name: 'snap-intake' });

  const domainContext = [{ snapQueue: { from: 'workflow/queues', where: { name: 'snap-intake' } } }];
  const entities = resolveContextLayers([domainContext, null, null], {}, makeBase(), store);

  assert.ok(entities);
  assert.strictEqual(entities.snapQueue.id, 'q-snap');
});

test('resolveContextLayers — resolves machine-level binding', () => {
  store.clearAll('queues');
  store.insertResource('queues', { id: 'q-gen', name: 'general-intake' });

  const machineContext = [{ generalQueue: { from: 'workflow/queues', where: { name: 'general-intake' } } }];
  const entities = resolveContextLayers([null, machineContext, null], {}, makeBase(), store);

  assert.ok(entities);
  assert.strictEqual(entities.generalQueue.id, 'q-gen');
});

test('resolveContextLayers — resolves trigger-level binding', () => {
  store.clearAll('applications');
  store.insertResource('applications', { id: 'app-1', status: 'submitted' });

  const triggerContext = [{ application: { from: 'intake/applications', where: { id: 'app-1' } } }];
  const entities = resolveContextLayers([null, null, triggerContext], {}, makeBase(), store);

  assert.ok(entities);
  assert.strictEqual(entities.application.id, 'app-1');
});

test('resolveContextLayers — chains all three levels, inner bindings reference outer', () => {
  store.clearAll('applications');
  store.clearAll('queues');
  store.insertResource('applications', { id: 'app-1', queueName: 'snap-intake' });
  store.insertResource('queues', { id: 'q-snap', name: 'snap-intake' });

  const domainContext = [{ application: { from: 'intake/applications', where: { id: 'app-1' } } }];
  const machineContext = [{ targetQueue: { from: 'workflow/queues', where: { name: '$application.queueName' } } }];

  const entities = resolveContextLayers([domainContext, machineContext, null], {}, makeBase(), store);

  assert.ok(entities);
  assert.strictEqual(entities.application.id, 'app-1');
  assert.strictEqual(entities.targetQueue.id, 'q-snap');
});

test('resolveContextLayers — inner scope wins on name conflict', () => {
  store.clearAll('queues');
  store.insertResource('queues', { id: 'q-domain', name: 'domain-queue' });
  store.insertResource('queues', { id: 'q-machine', name: 'machine-queue' });

  const domainContext = [{ queue: { from: 'workflow/queues', where: { name: 'domain-queue' } } }];
  const machineContext = [{ queue: { from: 'workflow/queues', where: { name: 'machine-queue' } } }];

  const entities = resolveContextLayers([domainContext, machineContext, null], {}, makeBase(), store);

  assert.ok(entities);
  assert.strictEqual(entities.queue.id, 'q-machine'); // machine wins
});

test('resolveContextLayers — binding that finds no record resolves to null', () => {
  store.clearAll('queues');
  const domainContext = [{ missing: { from: 'workflow/queues', where: { name: 'nonexistent' } } }];
  const result = resolveContextLayers([domainContext, null, null], {}, makeBase(), store);
  assert.ok(result !== null);
  assert.strictEqual(result.missing, null);
});

test('resolveContextLayers — all null/empty layers returns empty entities', () => {
  const result = resolveContextLayers([null, null, null], {}, makeBase(), store);
  assert.deepStrictEqual(result, {});
});

// =============================================================================
// createCreateHandler — auto-emitted event subject and auth context (#364, #365)
// =============================================================================

test('createCreateHandler — emitted event subject is the created resource id, not the parent id', async () => {
  store.clearAll('testitems');
  store.clearAll('events');

  const apiMetadata = { serverBasePath: '/test' };
  const endpoint = { collectionName: 'testitems', path: '/testitems', requestSchema: null, resource: { name: 'TestItem', eventName: 'test_item' } };

  const handler = createCreateHandler(apiMetadata, endpoint, 'http://localhost:1080', null, [], null, DEPS);

  // Simulate a sub-resource POST where applicationId is injected as enrichmentData
  const parentId = 'parent-uuid-001';
  const request = makeRequest('/testitems', {
    method: 'POST',
    body: { name: 'child-record' },
    headers: { 'x-caller-id': 'user-1', 'x-caller-roles': 'technician' },
  });

  const { status, body: created } = await readResponse(
    handler(request, { params: {}, enrichmentData: { applicationId: parentId } })
  );

  assert.strictEqual(status, 201);
  const createdId = created.id;
  assert.ok(createdId, 'created resource must have an id');
  assert.notStrictEqual(createdId, parentId, 'created resource id must not equal the parent id');

  const { items } = store.findAll('events', {});
  const createdEvent = items.find(e => e.type === 'test.test_item.created');
  assert.ok(createdEvent, 'must have emitted a created event');
  assert.strictEqual(createdEvent.subject, createdId, 'event subject must be the child resource id, not the parent id');
});

test('createCreateHandler — emitted event includes authid and authtype from caller headers', async () => {
  store.clearAll('testitems');
  store.clearAll('events');

  const apiMetadata = { serverBasePath: '/test' };
  const endpoint = { collectionName: 'testitems', path: '/testitems', requestSchema: null, resource: { name: 'TestItem', eventName: 'test_item' } };

  const handler = createCreateHandler(apiMetadata, endpoint, 'http://localhost:1080', null, [], null, DEPS);

  const request = makeRequest('/testitems', {
    method: 'POST',
    body: { name: 'child-record' },
    headers: { 'x-caller-id': 'caseworker-42', 'x-caller-roles': 'technician,supervisor' },
  });

  await readResponse(handler(request, { params: {} }));

  const { items } = store.findAll('events', {});
  const createdEvent = items.find(e => e.type === 'test.test_item.created');
  assert.ok(createdEvent, 'must have emitted a created event');
  assert.strictEqual(createdEvent.authid, 'caseworker-42');
  assert.strictEqual(createdEvent.authtype, 'user');
});

test('createCreateHandler — emitted event leaves out authid and authtype when no caller headers, and starts a trace', async () => {
  store.clearAll('testitems');
  store.clearAll('events');

  const apiMetadata = { serverBasePath: '/test' };
  const endpoint = { collectionName: 'testitems', path: '/testitems', requestSchema: null, resource: { name: 'TestItem', eventName: 'test_item' } };

  const handler = createCreateHandler(apiMetadata, endpoint, 'http://localhost:1080', null, [], null, DEPS);

  const request = makeRequest('/testitems', { method: 'POST', body: { name: 'child-record' } });

  await readResponse(handler(request, { params: {} }));

  const { items } = store.findAll('events', {});
  const createdEvent = items.find(e => e.type === 'test.test_item.created');
  assert.ok(createdEvent, 'must have emitted a created event');
  assert.ok(!('authid' in createdEvent), 'no caller, no authid');
  assert.ok(!('authtype' in createdEvent), 'no caller, no authtype');
  assert.match(createdEvent.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/, 'a request with no trace starts one');
});
