/**
 * An Arazzo scenario is checked for a sound shape, and for steps that call
 * operations the set has and carry forward only what earlier steps produced.
 */

import { test, describe } from 'node:test';
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

const sections = (workflows) => toDoc({
  path: '/s/scenarios/s.arazzo.yaml',
  relativePath: 'scenarios/s.arazzo.yaml',
  type: 'arazzo',
  content: { arazzo: '1.0.1', info: { title: 'S', version: '1', 'x-domain': 'demo' }, sourceDescriptions: [{ name: 'api', url: 'api.yaml' }], workflows },
});

test('a workflow reads what one it depends on produced, and nothing else', () => {
  const first = { workflowId: 'first', steps: [{ stepId: 'a', operationId: 'createThing', outputs: { id: '$response.body#/id' } }], outputs: { id: '$steps.a.outputs.id' } };
  const reading = (value, dependsOn) => ({ workflowId: 'second', dependsOn, steps: [{ stepId: 'b', operationId: 'createThing', parameters: [{ name: 'id', in: 'path', value }] }] });
  const ops = new Set(['createThing']);
  assert.deepEqual(rules(validateArazzo(sections([first, reading('$workflows.first.outputs.id', ['first'])]), ops)), []);
  assert.deepEqual(rules(validateArazzo(sections([first, reading('$workflows.first.outputs.id', [])]), ops)), ['unknown-workflow']);
  assert.deepEqual(rules(validateArazzo(sections([first, reading('$workflows.first.outputs.name', ['first'])]), ops)), ['unknown-workflow']);
  assert.deepEqual(rules(validateArazzo(sections([first, reading('x', ['nope'])]), ops)), ['unknown-workflow']);
  assert.deepEqual(rules(validateArazzo(sections([{ ...first, outputs: { id: '$steps.z.outputs.id' } }]), ops)), ['unknown-step']);
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

test('a step names only actors info.x-actors lists, and each is listed once with an id and a name', () => {
  const withActors = (actors, steps) => {
    const doc = scenario(steps);
    doc.content.info['x-actors'] = actors;
    return doc;
  };
  const ops = new Set(['createThing']);
  const caseworker = { id: 'caseworker', name: 'The caseworker', description: 'Reviews the application.' };
  const server = { id: 'server', name: 'The server' };
  assert.deepEqual(rules(validateArazzo(withActors([caseworker, server], [
    { stepId: 'a', 'x-actors': ['caseworker', 'server'], operationId: 'createThing' },
    { stepId: 'b', operationId: 'createThing' },
  ]), ops)), []);
  assert.deepEqual(rules(validateArazzo(withActors([caseworker], [{ stepId: 'a', 'x-actors': ['assistant'], operationId: 'createThing' }]), ops)), ['unknown-actor']);
  assert.deepEqual(rules(validateArazzo(scenario([{ stepId: 'a', 'x-actors': ['caseworker'], operationId: 'createThing' }]), ops)), ['unknown-actor']);
  assert.deepEqual(rules(validateArazzo(withActors([caseworker], [{ stepId: 'a', 'x-actors': 'caseworker', operationId: 'createThing' }]), ops)), ['arazzo-shape']);
  assert.deepEqual(rules(validateArazzo(withActors([caseworker, caseworker, { id: 'x' }], []), ops).filter((e) => e.path.includes('x-actors'))), ['arazzo-shape', 'arazzo-shape']);
});

test('a sound scenario', () => {
  assert.deepEqual(validateArazzo(scenario([{ stepId: 'a', operationId: 'createThing' }]), new Set(['createThing'])), []);
});

describe('an Arazzo document naming more than one source', () => {
  const twoSources = (operationId) => ({
    type: 'arazzo', path: '/s/scenarios/s.arazzo.yaml', relativePath: 'scenarios/s.arazzo.yaml',
    content: {
      arazzo: '1.0.1', info: { title: 'S', version: '1' },
      sourceDescriptions: [
        { name: 'api', url: '../domains/demo/demo-openapi.yaml', type: 'openapi' },
        { name: 'mock', url: 'https://blueprint.codeforamerica.org/mock/mock-openapi.yaml', type: 'openapi' },
      ],
      workflows: [{ workflowId: 'w', steps: [{ stepId: 'a', operationId }] }],
    },
  });
  const rules = (operationId) => validateArazzo(twoSources(operationId), new Set(['createThing'])).map((e) => e.rule);

  test('needs each operation qualified by its source', () => {
    assert.deepEqual(rules('createThing'), ['arazzo-shape']);
    assert.deepEqual(rules('$sourceDescriptions.api.createThing'), []);
  });

  test('checks an operation in the set, and leaves one outside it to where it is served', () => {
    assert.deepEqual(rules('$sourceDescriptions.api.createThang'), ['unknown-operation']);
    assert.deepEqual(rules('$sourceDescriptions.mock.registerEventStub'), []);
    assert.deepEqual(rules('$sourceDescriptions.nope.createThing'), ['arazzo-shape']);
  });
});
