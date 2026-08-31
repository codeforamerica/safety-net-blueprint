import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../sources/corticon/project.js';
import { classifyCalls } from '../sources/corticon/classify/call-classifier.js';

test('classifies the real service call-out in corticon.js-samples\' ServiceCallOut/RESTCall/Fetch.erf', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/servicecallout');
  const results = classifyCalls(project);
  assert.equal(results.length, 1);
  assert.equal(results[0].node, 'fetch');
  assert.deepEqual(results[0].connector, { className: 'FetchServiceCallout.js', serviceName: 'fetchURL' });
});

test('classifies this fixture\'s own VerifyIncome call-out in service-callout.erf', () => {
  const project = loadProject('fixtures/corticon/synthetic/all-patterns');
  const results = classifyCalls(project).filter((r) => r.ruleId === 'service-callout.erf');
  assert.equal(results.length, 1);
  assert.equal(results[0].node, 'VerifyIncome');
  assert.deepEqual(results[0].connector, { className: 'VerifyIncomeServiceCallout.js', serviceName: 'verifyIncome' });
});

test('a project with no connectorList contributes nothing', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/irr');
  assert.deepEqual(classifyCalls(project), []);
});
