/**
 * Two contracts — or two places in one — claiming one route are a validation
 * error, whichever kinds of contract they are.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { duplicateRoutes } from '../../src/validator/route-validator.js';

const ok = (schema) => ({ responses: { 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } } });

const intake = (paths) => toDoc({
  path: '/s/domains/intake/intake-openapi.yaml',
  relativePath: 'domains/intake/intake-openapi.yaml',
  type: 'openapi',
  content: {
    openapi: '3.1.0',
    info: { title: 'Intake', version: '1.0.0', 'x-domain': 'intake' },
    servers: [{ url: 'http://localhost:1080/intake' }],
    paths: { '/applications/{applicationId}': { get: ok('Application') }, ...paths },
  },
});

const rules = (rulesets) => toDoc({
  path: '/s/domains/intake/intake-rules.yaml',
  relativePath: 'domains/intake/intake-rules.yaml',
  type: 'rules',
  content: { domain: 'intake', rulesets },
});

const ruleset = (path) => ({ endpoint: { path }, inputs: {}, outputs: {}, facts: [{ path: 'a', expression: 'true' }] });

const messages = (errors) => [...errors.values()].flat().map((e) => e.message);

describe('duplicate routes', () => {
  test('a ruleset on a path an OpenAPI document already has', () => {
    const errors = duplicateRoutes([intake({ '/applications/check': { post: ok('Application') } }), rules({ check: ruleset('/applications/check') })]);
    assert.match(messages(errors)[0], /POST \/intake\/applications\/check is claimed by domains\/intake\/intake-openapi\.yaml and the intake ruleset "check"/);
    assert.equal(errors.size, 2, 'reported on both documents');
  });

  test('two rulesets in the same file on one path', () => {
    const errors = duplicateRoutes([intake({}), rules({ one: ruleset('/evaluate'), two: ruleset('/evaluate') })]);
    assert.match(messages(errors)[0], /the intake ruleset "one" .* and the intake ruleset "two"/);
  });

  test('a composition on an action\'s path, with the parameter named differently', () => {
    const machine = toDoc({
      path: '/s/domains/intake/intake-state-machine.yaml',
      relativePath: 'domains/intake/intake-state-machine.yaml',
      type: 'state-machine',
      content: { domain: 'intake', machines: [{ object: 'Application', states: [{ id: 'draft' }], initialState: 'draft', actions: [{ id: 'review', steps: [] }] }] },
    });
    const compositions = toDoc({
      path: '/s/domains/intake/intake-compositions.yaml',
      relativePath: 'domains/intake/intake-compositions.yaml',
      type: 'compositions',
      content: { domain: 'intake', compositions: { review: { resource: 'applications', endpoint: { path: '/applications/{id}/review', methods: ['post'] } } } },
    });
    const errors = duplicateRoutes([intake({}), machine, compositions]);
    assert.match(messages(errors)[0], /POST \/intake\/applications\/\{applicationId\}\/review is claimed by the intake state machine's "review" action .* and the intake composition "review"/);
  });

  test('one path with different methods is two routes', () => {
    const errors = duplicateRoutes([intake({ '/applications/check': { get: ok('Application') } }), rules({ check: ruleset('/applications/check') })]);
    assert.equal(errors.size, 0);
  });

  test('a generated operation is counted once, from the contract it came from', () => {
    const generated = { post: { ...ok('Application'), 'x-relationship': { type: 'ruleset', domain: 'intake', id: 'check' } } };
    const errors = duplicateRoutes([intake({ '/applications/check': generated }), rules({ check: ruleset('/applications/check') })]);
    assert.equal(errors.size, 0);
  });
});
