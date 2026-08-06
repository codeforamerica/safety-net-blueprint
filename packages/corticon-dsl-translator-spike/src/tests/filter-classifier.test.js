import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../sources/corticon/corticon/project.js';
import { classifyFilters } from '../sources/corticon/classify/filter-classifier.js';

test('classifies Mortgage\'s real Select_Credit.ers filters, resolving the canonical path each one reads', () => {
  const project = loadProject('fixtures/mortgage');
  const results = classifyFilters(project).filter((r) => r.rulesheet === 'Select_Credit.ers');
  assert.equal(results.length, 2);
  assert.deepEqual(results[0].paths, ['CreditLiability.accountType']);
  assert.equal(results[0].expression, "liability.accountType = 'CreditLine'");
  assert.deepEqual(results[1].paths, ['CreditLiability.lastActivityDate']);
});

test('a rulesheet with no real filters contributes nothing', () => {
  const project = loadProject('fixtures/dc-medicaid-chip');
  const results = classifyFilters(project).filter((r) => r.rulesheet.includes('Create Household'));
  assert.deepEqual(results, []);
});

test('surfaces IRR\'s real filter even though it resolves no attribute path -- same term-tree gap expression-patterns.test.js documents for ->sortedBy', () => {
  const project = loadProject('fixtures/irr');
  const results = classifyFilters(project).filter((r) => r.rulesheet === 'initial values.ers');
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].paths, []);
});
