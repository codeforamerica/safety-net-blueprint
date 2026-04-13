/**
 * Unit tests for update handler utilities
 * Tests deepEqual and buildChanges — the building blocks for the updated event's changes array.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { deepEqual, buildChanges } from '../../src/handlers/update-handler.js';

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
