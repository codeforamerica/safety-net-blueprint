/**
 * Unit tests for update handler utilities
 * Tests deepEqual, buildChanges, and onUpdate trigger behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { deepEqual, buildChanges, createUpdateHandler } from '../../src/handlers/update-handler.js';
import { insertResource, clearAll, findById } from '../../src/database-manager.js';

// =============================================================================
// deepEqual
// =============================================================================

test('deepEqual — identical scalars are equal', () => {
  assert.ok(deepEqual(1, 1));
  assert.ok(deepEqual('snap', 'snap'));
  assert.ok(deepEqual(true, true));
  assert.ok(deepEqual(null, null));
});

test('deepEqual — different scalars are not equal', () => {
  assert.ok(!deepEqual(1, 2));
  assert.ok(!deepEqual('snap', 'medicaid'));
  assert.ok(!deepEqual(true, false));
  assert.ok(!deepEqual(null, 0));
});

test('deepEqual — identical arrays are equal', () => {
  assert.ok(deepEqual(['snap', 'medicaid'], ['snap', 'medicaid']));
  assert.ok(deepEqual([], []));
});

test('deepEqual — arrays with different elements are not equal', () => {
  assert.ok(!deepEqual(['snap'], ['medicaid']));
  assert.ok(!deepEqual(['snap', 'medicaid'], ['snap']));
  assert.ok(!deepEqual([], ['snap']));
});

test('deepEqual — array order matters', () => {
  assert.ok(!deepEqual(['snap', 'medicaid'], ['medicaid', 'snap']));
});

test('deepEqual — identical objects are equal', () => {
  assert.ok(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }));
  assert.ok(deepEqual({}, {}));
});

test('deepEqual — objects with different values are not equal', () => {
  assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
  assert.ok(!deepEqual({ a: 1 }, { b: 1 }));
  assert.ok(!deepEqual({ a: 1, b: 2 }, { a: 1 }));
});

test('deepEqual — nested structures', () => {
  assert.ok(deepEqual({ tags: ['snap'], meta: { county: 'alameda' } }, { tags: ['snap'], meta: { county: 'alameda' } }));
  assert.ok(!deepEqual({ tags: ['snap'] }, { tags: ['medicaid'] }));
});

// =============================================================================
// buildChanges
// =============================================================================

test('buildChanges — reports changed scalar fields', () => {
  const before = { id: '1', createdAt: 'x', updatedAt: 'y', priority: 'normal', status: 'pending' };
  const after  = { id: '1', createdAt: 'x', updatedAt: 'z', priority: 'expedited', status: 'pending' };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'priority', before: 'normal', after: 'expedited' });
});

test('buildChanges — excludes id, createdAt, updatedAt', () => {
  const before = { id: '1', createdAt: 'x', updatedAt: 'y', name: 'old' };
  const after  = { id: '2', createdAt: 'a', updatedAt: 'b', name: 'new' };
  const changes = buildChanges(before, after);
  const fields = changes.map(c => c.field);
  assert.ok(!fields.includes('id'));
  assert.ok(!fields.includes('createdAt'));
  assert.ok(!fields.includes('updatedAt'));
  assert.ok(fields.includes('name'));
});

test('buildChanges — unchanged arrays are not reported', () => {
  const before = { id: '1', updatedAt: 'y', programs: ['snap', 'medicaid'] };
  const after  = { id: '1', updatedAt: 'z', programs: ['snap', 'medicaid'] };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 0);
});

test('buildChanges — changed arrays are reported with full before/after', () => {
  const before = { id: '1', updatedAt: 'y', programs: ['snap'] };
  const after  = { id: '1', updatedAt: 'z', programs: ['snap', 'medicaid'] };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'programs', before: ['snap'], after: ['snap', 'medicaid'] });
});

test('buildChanges — unchanged objects are not reported', () => {
  const before = { id: '1', updatedAt: 'y', address: { city: 'Oakland', state: 'CA' } };
  const after  = { id: '1', updatedAt: 'z', address: { city: 'Oakland', state: 'CA' } };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 0);
});

test('buildChanges — captures rule-driven mutations not in the original PATCH', () => {
  // Simulates: PATCH sets isExpedited=true, onUpdate rule re-scores priority to "expedited"
  const before = { id: '1', updatedAt: 'y', isExpedited: false, priority: 'normal' };
  const after  = { id: '1', updatedAt: 'z', isExpedited: true,  priority: 'expedited' };
  const changes = buildChanges(before, after);
  const fields = changes.map(c => c.field).sort();
  assert.deepStrictEqual(fields, ['isExpedited', 'priority']);
});

test('buildChanges — field added after update is reported (before is null)', () => {
  const before = { id: '1', updatedAt: 'y' };
  const after  = { id: '1', updatedAt: 'z', queueId: 'snap-intake' };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'queueId', before: null, after: 'snap-intake' });
});

test('buildChanges — empty when nothing changed (excluding system fields)', () => {
  const before = { id: '1', createdAt: 'x', updatedAt: 'y', status: 'pending' };
  const after  = { id: '1', createdAt: 'x', updatedAt: 'z', status: 'pending' };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 0);
});

// =============================================================================
// createUpdateHandler — onUpdate trigger
// =============================================================================

function makeReqRes(params, body, headers = {}) {
  const req = { params, body, headers, path: '/testresources' };
  const res = {
    _code: 200,
    _data: null,
    status(code) { this._code = code; return this; },
    json(data) { this._data = data; return this; },
    header() { return this; }
  };
  return { req, res };
}

const apiMetadata = { serverBasePath: '/test' };
const endpoint = { collectionName: 'testresources', path: '/testresources/{id}', requestSchema: null };

test('createUpdateHandler — onUpdate fires when watched field is patched', () => {
  clearAll('testresources');
  insertResource('testresources', { id: 'res-1', isExpedited: false, priority: 'normal' });

  const machine = {
    object: 'testresource',
    triggers: {
      onUpdate: {
        fields: ['isExpedited'],
        steps: [{ set: { field: 'priority', value: 'expedited' } }]
      }
    }
  };

  const handler = createUpdateHandler(apiMetadata, endpoint, null, [], machine);
  const { req, res } = makeReqRes({ id: 'res-1' }, { isExpedited: true });
  handler(req, res);

  assert.strictEqual(res._code, 200);
  const saved = findById('testresources', 'res-1');
  assert.strictEqual(saved.priority, 'expedited');
});

test('createUpdateHandler — onUpdate does not fire when non-watched field is patched', () => {
  clearAll('testresources');
  insertResource('testresources', { id: 'res-2', isExpedited: false, priority: 'normal', notes: '' });

  const machine = {
    object: 'testresource',
    triggers: {
      onUpdate: {
        fields: ['isExpedited'],
        steps: [{ set: { field: 'priority', value: 'expedited' } }]
      }
    }
  };

  const handler = createUpdateHandler(apiMetadata, endpoint, null, [], machine);
  const { req, res } = makeReqRes({ id: 'res-2' }, { notes: 'updated' });
  handler(req, res);

  assert.strictEqual(res._code, 200);
  const saved = findById('testresources', 'res-2');
  assert.strictEqual(saved.priority, 'normal'); // onUpdate did not fire
});

test('createUpdateHandler — onUpdate fires for all fields when no watchedFields defined', () => {
  clearAll('testresources');
  insertResource('testresources', { id: 'res-3', notes: '', priority: 'normal' });

  const machine = {
    object: 'testresource',
    triggers: {
      onUpdate: {
        // no fields: — fires on any patch
        steps: [{ set: { field: 'priority', value: 'high' } }]
      }
    }
  };

  const handler = createUpdateHandler(apiMetadata, endpoint, null, [], machine);
  const { req, res } = makeReqRes({ id: 'res-3' }, { notes: 'anything' });
  handler(req, res);

  const saved = findById('testresources', 'res-3');
  assert.strictEqual(saved.priority, 'high');
});
