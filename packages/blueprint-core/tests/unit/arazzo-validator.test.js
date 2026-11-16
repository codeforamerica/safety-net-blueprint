/**
 * An Arazzo scenario is checked for a sound shape, and for steps that call
 * operations the set has and carry forward only what earlier steps produced.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { validateArazzo } from '../../src/validator/arazzo-validator.js';
import { readOperations } from '../../src/operations.js';

/** The set's operations: an API at `relativePath` declaring each id, as a POST. */
const operationsIn = (ids, relativePath = 'scenarios/api-openapi.yaml') => readOperations([toDoc({
  path: `/s/${relativePath}`, relativePath, type: 'openapi',
  content: {
    openapi: '3.1.0', info: { title: 'A', version: '1', 'x-domain': 'demo' },
    paths: Object.fromEntries(ids.map((id) => [`/${id}`, { post: { operationId: id, responses: { 200: {} } } }])),
  },
})]);

const scenario = (steps) => toDoc({
  path: '/s/scenarios/s.arazzo.yaml',
  relativePath: 'scenarios/s.arazzo.yaml',
  type: 'arazzo',
  content: { arazzo: '1.0.1', info: { title: 'S', version: '1', 'x-domain': 'demo' }, sourceDescriptions: [{ name: 'api', url: 'api-openapi.yaml' }], workflows: [{ workflowId: 'w', steps }] },
});
const rules = (errors) => errors.map((e) => e.rule);

test('a step calling an operation the set does not have', () => {
  const errors = validateArazzo(scenario([{ stepId: 'a', operationId: 'nope' }]), operationsIn(['createThing']));
  assert.deepEqual(rules(errors), ['unknown-operation']);
});

const sections = (workflows) => toDoc({
  path: '/s/scenarios/s.arazzo.yaml',
  relativePath: 'scenarios/s.arazzo.yaml',
  type: 'arazzo',
  content: { arazzo: '1.0.1', info: { title: 'S', version: '1', 'x-domain': 'demo' }, sourceDescriptions: [{ name: 'api', url: 'api-openapi.yaml' }], workflows },
});

test('a workflow reads what one it depends on produced, and nothing else', () => {
  const first = { workflowId: 'first', steps: [{ stepId: 'a', operationId: 'createThing', outputs: { id: '$response.body#/id' } }], outputs: { id: '$steps.a.outputs.id' } };
  const reading = (value, dependsOn) => ({ workflowId: 'second', dependsOn, steps: [{ stepId: 'b', operationId: 'createThing', parameters: [{ name: 'id', in: 'path', value }] }] });
  const ops = operationsIn(['createThing']);
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
  ]), operationsIn(['createThing']));
  assert.deepEqual(rules(errors), ['unknown-step']);
});

test('a step naming two targets, and a repeated stepId', () => {
  const errors = validateArazzo(scenario([
    { stepId: 'a', operationId: 'createThing', workflowId: 'other' },
    { stepId: 'a', operationId: 'createThing' },
  ]), operationsIn(['createThing']));
  assert.deepEqual(rules(errors), ['arazzo-shape', 'arazzo-shape']);
});

test('a step names only actors info.x-actors lists, and each is listed once with an id and a name', () => {
  const withActors = (actors, steps) => {
    const doc = scenario(steps);
    doc.content.info['x-actors'] = actors;
    return doc;
  };
  const ops = operationsIn(['createThing']);
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
  assert.deepEqual(validateArazzo(scenario([{ stepId: 'a', operationId: 'createThing' }]), operationsIn(['createThing'])), []);
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
  const operations = operationsIn(['createThing'], 'domains/demo/demo-openapi.yaml');
  const rules = (operationId) => validateArazzo(twoSources(operationId), operations).map((e) => e.rule);

  test('needs each operation qualified by its source', () => {
    assert.deepEqual(rules('createThing'), ['arazzo-shape']);
    assert.deepEqual(rules('$sourceDescriptions.api.createThing'), []);
  });

  test('checks an operation in the set, and leaves one outside it to where it is served', () => {
    assert.deepEqual(rules('$sourceDescriptions.api.createThang'), ['unknown-operation']);
    assert.deepEqual(rules('$sourceDescriptions.mock.registerEventStub'), []);
    assert.deepEqual(rules('$sourceDescriptions.nope.createThing'), ['arazzo-shape']);
  });

  test('looks for the operation in its source\'s document, not anywhere in the set', () => {
    const elsewhere = operationsIn(['createThing'], 'domains/other/other-openapi.yaml');
    const [error] = validateArazzo(twoSources('$sourceDescriptions.api.createThing'), elsewhere);
    assert.equal(error.rule, 'unknown-operation');
    assert.match(error.message, /doesn't declare; domains\/other\/other-openapi.yaml does/);
  });
});

describe('a step that runs a workflow', () => {
  const scenario = (workflowId, type = 'arazzo') => ({
    type: 'arazzo', path: '/s/scenarios/s.arazzo.yaml', relativePath: 'scenarios/s.arazzo.yaml',
    content: {
      arazzo: '1.1.0', info: { title: 'S', version: '1' },
      sourceDescriptions: [{ name: 'shared', url: 'shared.arazzo.yaml', type }],
      workflows: [
        { workflowId: 'w', steps: [{ stepId: 'a', workflowId }] },
        { workflowId: 'here', steps: [{ stepId: 'b', workflowId: 'w' }] },
      ],
    },
  });
  const shared = { type: 'arazzo', relativePath: 'scenarios/shared.arazzo.yaml', content: { workflows: [{ workflowId: 'connect' }] } };
  const rules = (workflowId, type, docs = [shared]) => validateArazzo(scenario(workflowId, type), null, docs).map((e) => e.rule);

  test('names one this document declares, or one in another Arazzo document by its source', () => {
    assert.deepEqual(rules('here'), []);
    assert.deepEqual(rules('nowhere'), ['unknown-workflow']);
    assert.deepEqual(rules('$sourceDescriptions.shared.connect'), []);
    assert.deepEqual(rules('$sourceDescriptions.shared.reconnect'), ['unknown-workflow']);
    assert.deepEqual(rules('$sourceDescriptions.shared.connect', 'arazzo', []), ['unknown-workflow']);
    assert.deepEqual(rules('$sourceDescriptions.shared.connect', 'openapi'), ['arazzo-shape']);
    assert.deepEqual(rules('$sourceDescriptions.nope.connect'), ['arazzo-shape']);
  });
});
