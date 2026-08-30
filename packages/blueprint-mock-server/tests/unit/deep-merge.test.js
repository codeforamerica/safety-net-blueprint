/**
 * Unit tests for deepMerge.
 *
 * Issue #341: readOnlyFields (default ['id', 'createdAt']) must apply only at
 * the top level of the merge. At nested levels, `id` is the FK on an embedded
 * expanded reference (per x-relationship.style: expand in the resolver) and
 * MUST be writable; stripping it silently breaks PATCH end-to-end for any
 * caller that updates a relationship.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { deepMerge } from '../../src/deep-merge.js';

// =============================================================================
// Top-level readOnly preservation (regression guards)
// =============================================================================

test('deepMerge — top-level id is preserved when source attempts to change it', () => {
  const target = { id: 'original', name: 'Task A' };
  const source = { id: 'attacker-supplied', name: 'Task B' };
  const result = deepMerge(target, source);
  assert.strictEqual(result.id, 'original');
  assert.strictEqual(result.name, 'Task B');
});

test('deepMerge — top-level createdAt is preserved when source attempts to change it', () => {
  const target = { id: 't1', createdAt: '2024-01-01T00:00:00Z', status: 'pending' };
  const source = { createdAt: '2026-06-02T00:00:00Z', status: 'in_progress' };
  const result = deepMerge(target, source);
  assert.strictEqual(result.createdAt, '2024-01-01T00:00:00Z');
  assert.strictEqual(result.status, 'in_progress');
});

// =============================================================================
// Nested id MUST be writable (the issue #341 bug)
// =============================================================================

test('deepMerge — nested id is written through (issue #341)', () => {
  // Reproduces the assignedTo expansion case: Task.assignedTo is the expanded
  // User subset { id, firstName, lastName, username }. The id is the FK and
  // MUST be writable on PATCH.
  const target = {
    id: 'task-1',
    name: 'Review application',
    assignedTo: null,
  };
  const source = {
    assignedTo: {
      id: 'user-jdoe',
      firstName: 'Jane',
      lastName: 'Doe',
      username: 'jdoe',
    },
  };
  const result = deepMerge(target, source);

  assert.strictEqual(result.id, 'task-1', 'top-level id stays');
  assert.deepStrictEqual(result.assignedTo, {
    id: 'user-jdoe',
    firstName: 'Jane',
    lastName: 'Doe',
    username: 'jdoe',
  });
});

test('deepMerge — nested createdAt is written through (issue #341)', () => {
  // Same principle for createdAt: if it appears on a nested embedded reference,
  // it is not the parent resource's own createdAt and should not be protected.
  const target = {
    id: 'task-1',
    createdAt: '2024-01-01T00:00:00Z',
    metadata: { createdAt: 'old-nested-value' },
  };
  const source = {
    metadata: { createdAt: 'new-nested-value' },
  };
  const result = deepMerge(target, source);

  assert.strictEqual(result.createdAt, '2024-01-01T00:00:00Z', 'top-level createdAt protected');
  assert.strictEqual(result.metadata.createdAt, 'new-nested-value');
});

test('deepMerge — id is writable at depth 2+', () => {
  const target = {
    id: 'app-1',
    primaryApplicant: {
      id: 'member-old',
      person: { id: 'person-old', name: 'Old Name' },
    },
  };
  const source = {
    primaryApplicant: {
      id: 'member-new',
      person: { id: 'person-new', name: 'New Name' },
    },
  };
  const result = deepMerge(target, source);

  assert.strictEqual(result.id, 'app-1');
  assert.strictEqual(result.primaryApplicant.id, 'member-new');
  assert.strictEqual(result.primaryApplicant.person.id, 'person-new');
  assert.strictEqual(result.primaryApplicant.person.name, 'New Name');
});

// =============================================================================
// Other deepMerge semantics (regression guards around the fix)
// =============================================================================

test('deepMerge — nested non-id property merges normally', () => {
  const target = { profile: { firstName: 'Jane', lastName: 'Doe' } };
  const source = { profile: { lastName: 'Smith' } };
  const result = deepMerge(target, source);
  assert.deepStrictEqual(result.profile, { firstName: 'Jane', lastName: 'Smith' });
});

test('deepMerge — explicit null in source overwrites target', () => {
  const target = { id: 't1', assignedTo: { id: 'u1', firstName: 'Jane' } };
  const source = { assignedTo: null };
  const result = deepMerge(target, source);
  assert.strictEqual(result.assignedTo, null);
});

test('deepMerge — undefined in source is skipped', () => {
  const target = { name: 'original' };
  const source = { name: undefined };
  const result = deepMerge(target, source);
  assert.strictEqual(result.name, 'original');
});

test('deepMerge — arrays are replaced, not merged', () => {
  const target = { tags: ['a', 'b', 'c'] };
  const source = { tags: ['x'] };
  const result = deepMerge(target, source);
  assert.deepStrictEqual(result.tags, ['x']);
});

test('deepMerge — custom readOnlyFields apply only at top level', () => {
  const target = {
    version: 1,
    nested: { version: 1 },
  };
  const source = {
    version: 99,
    nested: { version: 99 },
  };
  const result = deepMerge(target, source, ['version']);
  assert.strictEqual(result.version, 1, 'top-level version protected');
  assert.strictEqual(result.nested.version, 99, 'nested version is writable');
});
