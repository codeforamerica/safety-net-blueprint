/**
 * An Arazzo scenario is checked for a sound shape, and for steps that call
 * operations the set has and carry forward only what earlier steps produced.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { validateArazzo } from '../../src/validator/arazzo-validator.js';

const scenario = (steps) => toDoc({
  path: '/s/scenarios/s.arazzo.yaml',
  relativePath: 'scenarios/s.arazzo.yaml',
  type: 'arazzo',
  content: { arazzo: '1.0.1', info: { title: 'S', version: '1', 'x-domain': 'demo' }, sourceDescriptions: [{ name: 'api', url: 'api.yaml' }], workflows: [{ workflowId: 'w', steps }] },
});
const rules = (errors) => errors.map((e) => e.rule);

test('a step calling an operation the set does not have', () => {
  const errors = validateArazzo(scenario([{ stepId: 'a', operationId: 'nope' }]), new Set(['createThing']));
  assert.deepEqual(rules(errors), ['unknown-operation']);
});

test('a step carrying forward from a step that is not earlier', () => {
  const errors = validateArazzo(scenario([
    { stepId: 'a', operationId: 'createThing', parameters: [{ name: 'id', in: 'path', value: '$steps.b.outputs.id' }] },
    { stepId: 'b', operationId: 'createThing' },
  ]), new Set(['createThing']));
  assert.deepEqual(rules(errors), ['unknown-step']);
});

test('a step naming two targets, and a repeated stepId', () => {
  const errors = validateArazzo(scenario([
    { stepId: 'a', operationId: 'createThing', workflowId: 'other' },
    { stepId: 'a', operationId: 'createThing' },
  ]), new Set(['createThing']));
  assert.deepEqual(rules(errors), ['arazzo-shape', 'arazzo-shape']);
});

test('a sound scenario', () => {
  assert.deepEqual(validateArazzo(scenario([{ stepId: 'a', operationId: 'createThing' }]), new Set(['createThing'])), []);
});
