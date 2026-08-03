import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../ingest/project.js';
import { classifyServiceCallouts } from '../classify/service-callout-classifier.js';

test('classifies the real service call-out in corticon.js-samples\' ServiceCallOut/RESTCall/Fetch.erf', () => {
  const project = loadProject('fixtures/servicecallout');
  const results = classifyServiceCallouts(project);
  assert.equal(results.length, 1);
  assert.equal(results[0].node, 'fetch');
  assert.deepEqual(results[0].connector, { className: 'FetchServiceCallout.js', serviceName: 'fetchURL' });
});

test('classifies this fixture\'s own VerifyIncome call-out in top-level-flow.erf, alongside its other ordinary rulesheet-invoking nodes', () => {
  const project = loadProject('fixtures/all-patterns');
  const results = classifyServiceCallouts(project).filter((r) => r.ruleflow === 'top-level-flow.erf');
  assert.equal(results.length, 1);
  assert.equal(results[0].node, 'VerifyIncome');
  assert.deepEqual(results[0].connector, { className: 'VerifyIncomeServiceCallout.js', serviceName: 'verifyIncome' });
});

test('a project with no connectorList contributes nothing', () => {
  const project = loadProject('fixtures/irr');
  assert.deepEqual(classifyServiceCallouts(project), []);
});
