import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../sources/corticon/project.js';
import { classifyGuards } from '../sources/corticon/classify/guard-classifier.js';

test('classifies Mortgage\'s real Select_Credit.ers filters', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/mortgage');
  const results = classifyGuards(project).filter((r) => r.ruleId.includes('Select_Credit.ers'));
  assert.equal(results.length, 2);
  assert.equal(results[0].expression, "liability.accountType = 'CreditLine'");
});

test('a rulesheet with no real filters contributes nothing', () => {
  const project = loadProject('fixtures/corticon/government/dc-medicaid-chip');
  const results = classifyGuards(project).filter((r) => r.ruleId.includes('Create Household'));
  assert.deepEqual(results, []);
});

test('surfaces IRR\'s real filter even though it resolves no attribute path -- same term-tree gap expression-patterns.test.js documents for ->sortedBy', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/irr');
  const results = classifyGuards(project).filter((r) => r.ruleId.includes('initial values.ers'));
  assert.equal(results.length, 1);
  assert.ok(results[0].expression.length > 0);
});
