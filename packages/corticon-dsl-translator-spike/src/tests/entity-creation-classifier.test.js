import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../ingest/project.js';
import { classifyEntityCreation } from '../classify/entity-creation-classifier.js';

test('classifies DC Medicaid\'s real Household.newUnique[...] as kind "new"', () => {
  const project = loadProject('fixtures/dc-medicaid-chip');
  const results = classifyEntityCreation(project).filter((r) => r.rulesheet.includes('Create Household'));
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'new');
  assert.equal(results[0].entityType, 'Household');
});

test('classifies DC Medicaid\'s real members += Person association mutation as kind "add", despite no NEW term at all', () => {
  const project = loadProject('fixtures/dc-medicaid-chip');
  const results = classifyEntityCreation(project).filter((r) => r.rulesheet.includes('Group Members'));
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'add');
  assert.equal(results[0].entityType, 'Person');
});

test('classifies DC Medicaid\'s real Person.cohort += Cohort.newUnique[...] (both new and add at once) as kind "new"', () => {
  const project = loadProject('fixtures/dc-medicaid-chip');
  const results = classifyEntityCreation(project).filter((r) => r.rulesheet.includes('MAGI Eligibility Groups') && !r.rulesheet.includes('Non-MAGI'));
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.kind === 'new' && r.entityType === 'Cohort'));
});

test('a rulesheet with only ordinary attribute assignments contributes nothing', () => {
  const project = loadProject('fixtures/mortgage');
  const results = classifyEntityCreation(project).filter((r) => r.rulesheet === 'Select_Credit.ers');
  assert.deepEqual(results, []);
});
