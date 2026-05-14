/**
 * Unit tests for multi-level context resolution (domain → machine → trigger/operation).
 * Verifies that resolveContextLayers chains levels correctly and that inner scope
 * wins on name conflict.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll } from '../../src/database-manager.js';
import { resolveContextLayers } from '../../src/handlers/procedure-runner.js';
import { createUpdateHandler } from '../../src/handlers/update-handler.js';
import { createCreateHandler } from '../../src/handlers/create-handler.js';

// =============================================================================
// resolveContextLayers — unit
// =============================================================================

function makeBase() {
  return { caller: { id: 'system', roles: [] }, object: {}, request: {}, now: '2025-01-01T00:00:00Z' };
}

test('resolveContextLayers — resolves domain-level binding', () => {
  clearAll('queues');
  insertResource('queues', { id: 'q-snap', name: 'snap-intake' });

  const domainContext = [{ snapQueue: { from: 'workflow/queues', where: { name: 'snap-intake' } } }];
  const entities = resolveContextLayers([domainContext, null, null], {}, makeBase());

  assert.ok(entities);
  assert.strictEqual(entities.snapQueue.id, 'q-snap');
});

test('resolveContextLayers — resolves machine-level binding', () => {
  clearAll('queues');
  insertResource('queues', { id: 'q-gen', name: 'general-intake' });

  const machineContext = [{ generalQueue: { from: 'workflow/queues', where: { name: 'general-intake' } } }];
  const entities = resolveContextLayers([null, machineContext, null], {}, makeBase());

  assert.ok(entities);
  assert.strictEqual(entities.generalQueue.id, 'q-gen');
});

test('resolveContextLayers — resolves trigger-level binding', () => {
  clearAll('applications');
  insertResource('applications', { id: 'app-1', status: 'submitted' });

  const triggerContext = [{ application: { from: 'intake/applications', where: { id: 'app-1' } } }];
  const entities = resolveContextLayers([null, null, triggerContext], {}, makeBase());

  assert.ok(entities);
  assert.strictEqual(entities.application.id, 'app-1');
});

test('resolveContextLayers — chains all three levels, inner bindings reference outer', () => {
  clearAll('applications');
  clearAll('queues');
  insertResource('applications', { id: 'app-1', queueName: 'snap-intake' });
  insertResource('queues', { id: 'q-snap', name: 'snap-intake' });

  const domainContext = [{ application: { from: 'intake/applications', where: { id: 'app-1' } } }];
  const machineContext = [{ targetQueue: { from: 'workflow/queues', where: { name: '$application.queueName' } } }];

  const entities = resolveContextLayers([domainContext, machineContext, null], {}, makeBase());

  assert.ok(entities);
  assert.strictEqual(entities.application.id, 'app-1');
  assert.strictEqual(entities.targetQueue.id, 'q-snap');
});

test('resolveContextLayers — inner scope wins on name conflict', () => {
  clearAll('queues');
  insertResource('queues', { id: 'q-domain', name: 'domain-queue' });
  insertResource('queues', { id: 'q-machine', name: 'machine-queue' });

  const domainContext = [{ queue: { from: 'workflow/queues', where: { name: 'domain-queue' } } }];
  const machineContext = [{ queue: { from: 'workflow/queues', where: { name: 'machine-queue' } } }];

  const entities = resolveContextLayers([domainContext, machineContext, null], {}, makeBase());

  assert.ok(entities);
  assert.strictEqual(entities.queue.id, 'q-machine'); // machine wins
});

test('resolveContextLayers — binding that finds no record resolves to null', () => {
  clearAll('queues');
  const domainContext = [{ missing: { from: 'workflow/queues', where: { name: 'nonexistent' } } }];
  const result = resolveContextLayers([domainContext, null, null], {}, makeBase());
  assert.ok(result !== null);
  assert.strictEqual(result.missing, null);
});

test('resolveContextLayers — all null/empty layers returns empty entities', () => {
  const result = resolveContextLayers([null, null, null], {}, makeBase());
  assert.deepStrictEqual(result, {});
});

// =============================================================================
// Integration: machine-level context available in onCreate steps
// =============================================================================

test('createCreateHandler — machine-level context available in onCreate steps:', () => {
  clearAll('testresources');
  clearAll('queues');
  insertResource('queues', { id: 'q-snap', name: 'snap-intake' });

  const apiMetadata = { serverBasePath: '/test' };
  const endpoint = { collectionName: 'testresources', path: '/testresources', requestSchema: null };

  const machine = {
    object: 'Testresource',
    context: [{ snapQueue: { from: 'workflow/queues', where: { name: 'snap-intake' } } }],
    triggers: {
      onCreate: {
        steps: [{ set: { field: 'queueId', value: '$snapQueue.id' } }]
      }
    }
  };

  const handler = createCreateHandler(apiMetadata, endpoint, 'http://localhost:1080', null, [], machine);
  const req = { body: { name: 'test' }, headers: { 'x-caller-id': 'sys', 'x-caller-roles': 'system' }, path: '/testresources' };
  const res = { _code: 200, _data: null, status(c) { this._code = c; return this; }, json(d) { this._data = d; return this; }, header() { return this; } };

  handler(req, res);

  assert.strictEqual(res._code, 201);
  assert.strictEqual(res._data.queueId, 'q-snap');
});

// =============================================================================
// Integration: machine-level context available in onUpdate steps
// =============================================================================

test('createUpdateHandler — machine-level context available in onUpdate steps:', () => {
  clearAll('testresources');
  clearAll('queues');
  insertResource('queues', { id: 'q-snap', name: 'snap-intake' });
  insertResource('testresources', { id: 'res-ctx-1', isExpedited: false, queueId: null });

  const apiMetadata = { serverBasePath: '/test' };
  const endpoint = { collectionName: 'testresources', path: '/testresources/{id}', requestSchema: null };

  const machine = {
    object: 'Testresource',
    context: [{ snapQueue: { from: 'workflow/queues', where: { name: 'snap-intake' } } }],
    triggers: {
      onUpdate: {
        fields: ['isExpedited'],
        steps: [{ set: { field: 'queueId', value: '$snapQueue.id' } }]
      }
    }
  };

  const handler = createUpdateHandler(apiMetadata, endpoint, null, [], machine);
  const req = { params: { id: 'res-ctx-1' }, body: { isExpedited: true }, headers: {}, path: '/testresources' };
  const res = { _code: 200, _data: null, status(c) { this._code = c; return this; }, json(d) { this._data = d; return this; }, header() { return this; } };

  handler(req, res);

  assert.ok(res._data, 'expected a response body');
  assert.strictEqual(res._data.queueId, 'q-snap');
});
