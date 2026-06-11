/**
 * Unit tests for the EligibilitySnapshot assembly function.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll } from '../../src/database-manager.js';
import { assembleEligibilitySnapshot } from '../../src/handlers/eligibility-snapshot-handler.js';

function setup(appId) {
  insertResource('applications', { id: appId, status: 'submitted', programs: ['snap', 'medicaid'] });
}

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
}

// =============================================================================
// assembleEligibilitySnapshot
// =============================================================================

test('assembleEligibilitySnapshot — returns null for unknown applicationId', () => {
  assert.strictEqual(assembleEligibilitySnapshot('nonexistent-id'), null);
});

test('assembleEligibilitySnapshot — returns required top-level fields', () => {
  const appId = 'test-app-snapshot-fields';
  setup(appId);

  const result = assembleEligibilitySnapshot(appId);

  assert.ok(result, 'result should not be null');
  assert.ok('householdSnapshot' in result, 'should have householdSnapshot');
  assert.ok(Array.isArray(result.members), 'members should be an array');
  assert.ok(typeof result.refreshedAt === 'string', 'refreshedAt should be an ISO timestamp');

  teardown();
});

test('assembleEligibilitySnapshot — householdSnapshot is empty object when no household-info exists', () => {
  const appId = 'test-app-no-household';
  setup(appId);

  const result = assembleEligibilitySnapshot(appId);

  assert.deepStrictEqual(result.householdSnapshot, {});

  teardown();
});

test('assembleEligibilitySnapshot — householdSnapshot includes household-info fields', () => {
  const appId = 'test-app-with-household';
  setup(appId);
  insertResource('household-infos', {
    id: 'hh-1',
    applicationId: appId,
    size: 3,
    monthlyIncome: 2500,
    shelterExpenses: 900,
  });

  const result = assembleEligibilitySnapshot(appId);

  assert.strictEqual(result.householdSnapshot.size, 3);
  assert.strictEqual(result.householdSnapshot.monthlyIncome, 2500);
  assert.strictEqual(result.householdSnapshot.applicationId, appId);

  teardown();
});

test('assembleEligibilitySnapshot — members array has one entry per application-member', () => {
  const appId = 'test-app-members';
  setup(appId);
  insertResource('application-members', {
    id: 'mem-1', applicationId: appId, firstName: 'Jane', lastName: 'Doe', programs: ['snap'],
  });
  insertResource('application-members', {
    id: 'mem-2', applicationId: appId, firstName: 'Bob', lastName: 'Doe', programs: ['snap'],
  });

  const result = assembleEligibilitySnapshot(appId);

  assert.strictEqual(result.members.length, 2);

  teardown();
});

test('assembleEligibilitySnapshot — each member entry has memberId, memberSnapshot, verificationSummary', () => {
  const appId = 'test-app-member-shape';
  setup(appId);
  insertResource('application-members', {
    id: 'mem-shape-1', applicationId: appId, firstName: 'Alice', programs: ['medicaid'],
  });

  const result = assembleEligibilitySnapshot(appId);
  const member = result.members[0];

  assert.strictEqual(member.memberId, 'mem-shape-1');
  assert.ok(typeof member.memberSnapshot === 'object', 'memberSnapshot should be an object');
  assert.ok(Array.isArray(member.verificationSummary), 'verificationSummary should be an array');

  teardown();
});

test('assembleEligibilitySnapshot — memberSnapshot includes income sub-resources', () => {
  const appId = 'test-app-income';
  setup(appId);
  const memberId = 'mem-income-1';
  insertResource('application-members', {
    id: memberId, applicationId: appId, firstName: 'Earner', programs: ['snap'],
  });
  insertResource('member-incomes', {
    id: 'inc-1', memberId, type: 'employed', amount: 1500, frequency: 'monthly',
  });
  insertResource('member-incomes', {
    id: 'inc-2', memberId, type: 'self_employed', amount: 300, frequency: 'monthly',
  });

  const result = assembleEligibilitySnapshot(appId);
  const memberEntry = result.members.find(m => m.memberId === memberId);

  assert.ok(memberEntry, 'member entry should exist');
  assert.strictEqual(memberEntry.memberSnapshot.income.length, 2);
  assert.ok(memberEntry.memberSnapshot.income.some(i => i.type === 'employed'));

  teardown();
});

test('assembleEligibilitySnapshot — verificationSummary only includes verifications scoped to that member', () => {
  const appId = 'test-app-verifications';
  setup(appId);
  const mem1 = 'mem-verif-1';
  const mem2 = 'mem-verif-2';
  insertResource('application-members', { id: mem1, applicationId: appId, programs: ['snap'] });
  insertResource('application-members', { id: mem2, applicationId: appId, programs: ['medicaid'] });
  insertResource('application-verifications', {
    id: 'verif-1', applicationId: appId, sourceId: mem1, sourceType: 'member', category: 'income',
  });
  insertResource('application-verifications', {
    id: 'verif-2', applicationId: appId, sourceId: mem2, sourceType: 'member', category: 'citizenship',
  });

  const result = assembleEligibilitySnapshot(appId);
  const m1 = result.members.find(m => m.memberId === mem1);
  const m2 = result.members.find(m => m.memberId === mem2);

  assert.strictEqual(m1.verificationSummary.length, 1);
  assert.strictEqual(m1.verificationSummary[0].sourceId, mem1);
  assert.strictEqual(m2.verificationSummary.length, 1);
  assert.strictEqual(m2.verificationSummary[0].sourceId, mem2);

  teardown();
});

test('assembleEligibilitySnapshot — memberSnapshot includes expenses, assets, employment, healthCoverage arrays', () => {
  const appId = 'test-app-sub-resources';
  setup(appId);
  const memberId = 'mem-sub-1';
  insertResource('application-members', { id: memberId, applicationId: appId, programs: ['snap'] });
  insertResource('member-expenses', { id: 'exp-1', memberId, type: 'shelter', amount: 800 });
  insertResource('member-assets', { id: 'ast-1', memberId, type: 'checking', amount: 500 });
  insertResource('member-employment-records', { id: 'emp-1', memberId, employerName: 'Acme' });
  insertResource('member-health-coverages', { id: 'hc-1', memberId, coverageType: 'employer' });

  const result = assembleEligibilitySnapshot(appId);
  const m = result.members[0].memberSnapshot;

  assert.strictEqual(m.expenses.length, 1);
  assert.strictEqual(m.assets.length, 1);
  assert.strictEqual(m.employment.length, 1);
  assert.strictEqual(m.healthCoverage.length, 1);

  teardown();
});
