/**
 * Unit tests for collection-utils — deriveCollectionName and mergeByPrecedence.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { deriveCollectionName, mergeByPrecedence } from '../../src/collection-utils.js';

// =============================================================================
// mergeByPrecedence
// =============================================================================

test('mergeByPrecedence — machine item overrides domain item with same id', () => {
  const domain = [{ id: 'guard-a', field: 'status', operator: 'equals', value: 'pending' }];
  const machine = [{ id: 'guard-a', field: 'status', operator: 'equals', value: 'open' }];
  const merged = mergeByPrecedence(domain, machine);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].value, 'open');
});

test('mergeByPrecedence — domain items not in machine are preserved', () => {
  const domain = [
    { id: 'guard-a', operator: 'is_null' },
    { id: 'guard-b', operator: 'equals', value: 'active' }
  ];
  const machine = [{ id: 'guard-a', operator: 'is_not_null' }];
  const merged = mergeByPrecedence(domain, machine);
  assert.strictEqual(merged.length, 2);
  const ids = merged.map(g => g.id).sort();
  assert.deepStrictEqual(ids, ['guard-a', 'guard-b']);
  assert.strictEqual(merged.find(g => g.id === 'guard-a').operator, 'is_not_null');
});

test('mergeByPrecedence — machine-only items are included', () => {
  const domain = [{ id: 'rule-a', conditions: [] }];
  const machine = [{ id: 'rule-b', conditions: [] }];
  const merged = mergeByPrecedence(domain, machine);
  assert.strictEqual(merged.length, 2);
  assert.ok(merged.some(r => r.id === 'rule-a'));
  assert.ok(merged.some(r => r.id === 'rule-b'));
});

test('mergeByPrecedence — empty domain returns machine items', () => {
  const machine = [{ id: 'rule-x', conditions: [] }];
  const merged = mergeByPrecedence([], machine);
  assert.deepStrictEqual(merged, machine);
});

test('mergeByPrecedence — empty machine returns domain items', () => {
  const domain = [{ id: 'rule-x', conditions: [] }];
  const merged = mergeByPrecedence(domain, []);
  assert.deepStrictEqual(merged, domain);
});

test('mergeByPrecedence — both empty returns empty', () => {
  assert.deepStrictEqual(mergeByPrecedence([], []), []);
});

test('mergeByPrecedence — null/undefined inputs handled gracefully', () => {
  const items = [{ id: 'x' }];
  assert.deepStrictEqual(mergeByPrecedence(null, items), items);
  assert.deepStrictEqual(mergeByPrecedence(items, null), items);
  assert.deepStrictEqual(mergeByPrecedence(undefined, undefined), []);
});

test('mergeByPrecedence — preserves declaration order (domain first, then machine-only)', () => {
  const domain = [{ id: 'a' }, { id: 'b' }];
  const machine = [{ id: 'c' }, { id: 'a', overridden: true }];
  const merged = mergeByPrecedence(domain, machine);
  // Map iteration order: a (overridden), b, c
  assert.strictEqual(merged[0].id, 'a');
  assert.strictEqual(merged[0].overridden, true);
  assert.strictEqual(merged[1].id, 'b');
  assert.strictEqual(merged[2].id, 'c');
});

// =============================================================================
// deriveCollectionName
// =============================================================================

test('deriveCollectionName — top-level plural collection', () => {
  assert.strictEqual(deriveCollectionName('/applications', '/intake'), 'applications');
});

test('deriveCollectionName — sub-collection prefixed with parent singular', () => {
  assert.strictEqual(deriveCollectionName('/applications/{id}/documents', '/intake'), 'application-documents');
});

test('deriveCollectionName — singleton sub-resource pluralized', () => {
  assert.strictEqual(deriveCollectionName('/applications/{id}/interview', '/intake'), 'interviews');
});

test('deriveCollectionName — entity path without leading slash', () => {
  assert.strictEqual(deriveCollectionName('intake/applications/documents', 'intake'), 'application-documents');
});
