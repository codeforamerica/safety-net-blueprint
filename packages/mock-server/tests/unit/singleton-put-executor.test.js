/**
 * Unit tests for executeSingletonPut — the state machine PUT step executor.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { insertResource, findAll, clearAll } from '../../src/database-manager.js';
import { executeSingletonPut } from '../../src/singleton-put-executor.js';

function teardown() {
  clearAll('applications');
  clearAll('household-infos');
  clearAll('application-members');
  clearAll('application-verifications');
  clearAll('member-incomes');
  clearAll('member-expenses');
  clearAll('member-assets');
  clearAll('member-employment-records');
  clearAll('member-health-coverages');
  clearAll('eligibility-snapshots');
  clearAll('events');
}

// =============================================================================
// executeSingletonPut
// =============================================================================

test('executeSingletonPut — returns null for unregistered sub-resource', () => {
  const result = executeSingletonPut('intake/applications/app-1/unknown-resource');
  assert.strictEqual(result, null);
});

test('executeSingletonPut — returns null when path has fewer than 4 segments', () => {
  const result = executeSingletonPut('intake/eligibility-snapshot');
  assert.strictEqual(result, null);
});

test('executeSingletonPut — returns null when assembler returns null (application not found)', () => {
  const result = executeSingletonPut('intake/applications/nonexistent-app/eligibility-snapshot');
  assert.strictEqual(result, null);
});

test('executeSingletonPut — creates record in eligibility-snapshots when none exists', () => {
  const appId = 'exec-app-create';
  insertResource('applications', { id: appId, status: 'submitted' });

  const result = executeSingletonPut(`intake/applications/${appId}/eligibility-snapshot`, {
    now: '2025-06-01T00:00:00.000Z',
  });

  assert.ok(result, 'should return assembled record');
  assert.ok(result.id, 'result should have an id');
  assert.strictEqual(result.applicationId, appId);
  assert.strictEqual(result.createdAt, '2025-06-01T00:00:00.000Z');

  const { items } = findAll('eligibility-snapshots', { applicationId: appId });
  assert.strictEqual(items.length, 1);

  teardown();
});

test('executeSingletonPut — replaces existing record, preserving original id and createdAt', () => {
  const appId = 'exec-app-replace';
  insertResource('applications', { id: appId, status: 'submitted' });

  // First PUT — creates
  const first = executeSingletonPut(`intake/applications/${appId}/eligibility-snapshot`, {
    now: '2025-06-01T00:00:00.000Z',
  });
  const originalId = first.id;
  const originalCreatedAt = first.createdAt;

  // Second PUT — replaces
  const second = executeSingletonPut(`intake/applications/${appId}/eligibility-snapshot`, {
    now: '2025-06-02T00:00:00.000Z',
  });

  assert.strictEqual(second.id, originalId, 'id should be preserved on replace');
  assert.strictEqual(second.createdAt, originalCreatedAt, 'createdAt should be preserved on replace');
  assert.strictEqual(second.updatedAt, '2025-06-02T00:00:00.000Z', 'updatedAt should be refreshed');

  const { items } = findAll('eligibility-snapshots', { applicationId: appId });
  assert.strictEqual(items.length, 1, 'should still be only one record after replace');

  teardown();
});

test('executeSingletonPut — stored record has correct parentField (applicationId)', () => {
  const appId = 'exec-app-parentfield';
  insertResource('applications', { id: appId, status: 'submitted' });

  executeSingletonPut(`intake/applications/${appId}/eligibility-snapshot`);

  const { items } = findAll('eligibility-snapshots', { applicationId: appId });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].applicationId, appId);

  teardown();
});

test('executeSingletonPut — assembles member data from DB into snapshot', () => {
  const appId = 'exec-app-members';
  insertResource('applications', { id: appId, status: 'submitted' });
  insertResource('application-members', { id: 'mem-exec-1', applicationId: appId, firstName: 'Alice' });
  insertResource('member-incomes', { id: 'inc-exec-1', memberId: 'mem-exec-1', type: 'employed', amount: 2000 });

  const result = executeSingletonPut(`intake/applications/${appId}/eligibility-snapshot`);

  assert.strictEqual(result.members.length, 1);
  assert.strictEqual(result.members[0].memberId, 'mem-exec-1');
  assert.strictEqual(result.members[0].memberSnapshot.income.length, 1);

  teardown();
});
