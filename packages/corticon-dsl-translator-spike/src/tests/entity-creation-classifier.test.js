import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../sources/corticon/project.js';
import { classifyConstructors } from '../sources/corticon/classify/constructor-classifier.js';

test('classifies DC Medicaid\'s real Household.newUnique[...] entity-creation action', () => {
  const project = loadProject('fixtures/corticon/government/dc-medicaid-chip');
  const results = classifyConstructors(project).filter((r) => r.ruleId.includes('Create Household'));
  assert.equal(results.length, 1);
  assert.equal(results[0].entityType, 'Household');
});

test('classifies DC Medicaid\'s real members += Person association mutation despite no NEW term at all', () => {
  const project = loadProject('fixtures/corticon/government/dc-medicaid-chip');
  const results = classifyConstructors(project).filter((r) => r.ruleId.includes('Group Members'));
  assert.equal(results.length, 1);
  assert.equal(results[0].entityType, 'Person');
});

test('classifies DC Medicaid\'s real Person.cohort += Cohort.newUnique[...] (both new and add at once)', () => {
  const project = loadProject('fixtures/corticon/government/dc-medicaid-chip');
  const results = classifyConstructors(project).filter((r) => r.ruleId.includes('MAGI Eligibility Groups') && !r.ruleId.includes('Non-MAGI'));
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.entityType === 'Cohort'));
});

test('a rulesheet with only ordinary attribute assignments contributes nothing', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/mortgage');
  const results = classifyConstructors(project).filter((r) => r.ruleId.includes('Select_Credit.ers'));
  assert.deepEqual(results, []);
});
