/**
 * Every operation a set has, and finding one by what names it.
 *
 * OpenAPI and AsyncAPI make an id unique only within its document, so two APIs
 * may declare the same one. A bare id finds an operation when one API has it;
 * `$apis.<api>.<id>` finds it when several do.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { extract } from '../../src/index.js';
import { validateCrossArtifact } from '../../src/validator/state-machine-validator.js';

const ok = { 200: { description: 'OK' } };
const api = (domain, paths, name = domain) => toDoc({
  path: `/set/domains/${domain}/${name}-openapi.yaml`,
  relativePath: `domains/${domain}/${name}-openapi.yaml`,
  type: 'openapi',
  content: { openapi: '3.1.0', info: { title: name, version: '1', 'x-domain': domain }, servers: [{ url: `/${domain}` }], paths },
});

const intake = api('intake', {
  '/applications': { get: { operationId: 'listApplications', responses: ok } },
  '/applications/{applicationId}': { parameters: [{ name: 'applicationId', in: 'path', required: true, schema: { type: 'string' } }], patch: { operationId: 'updateApplication', responses: ok } },
  '/search': { get: { operationId: 'search', responses: ok } },
});
const workflow = api('workflow', {
  '/tasks': { get: { operationId: 'listTasks', responses: ok } },
  '/search': { get: { operationId: 'search', responses: ok } },
});
const events = toDoc({
  path: '/set/domains/workflow/workflow-events-asyncapi.yaml',
  relativePath: 'domains/workflow/workflow-events-asyncapi.yaml',
  type: 'asyncapi',
  content: {
    asyncapi: '3.0.0', info: { title: 'e', version: '1', 'x-domain': 'workflow' },
    channels: { 'intake.application.submitted': { $ref: '../intake/intake-events-asyncapi.yaml#/channels/intake.application.submitted' } },
    operations: { receiveIntakeApplicationSubmitted: { action: 'receive', channel: { $ref: '#/channels/intake.application.submitted' } } },
  },
});

describe('extract(docs, \'operations\')', () => {
  const operations = extract([intake, workflow, events], 'operations');

  test('has each OpenAPI and AsyncAPI operation, under the API it belongs to', () => {
    assert.deepEqual(operations.find('listTasks').operation,
      { id: 'listTasks', api: 'workflow', file: 'domains/workflow/workflow-openapi.yaml', kind: 'openapi', method: 'GET', path: '/tasks' });
    assert.deepEqual(operations.find('receiveIntakeApplicationSubmitted').operation,
      { id: 'receiveIntakeApplicationSubmitted', api: 'workflow', file: 'domains/workflow/workflow-events-asyncapi.yaml', kind: 'asyncapi', action: 'receive', event: 'intake.application.submitted' });
  });

  test('a bare id two APIs declare is ambiguous, and qualifying it by API finds one', () => {
    const bare = operations.find('search');
    assert.equal(bare.operation, undefined);
    assert.deepEqual(bare.candidates.map((o) => o.api), ['intake', 'workflow']);
    assert.equal(operations.find('$apis.workflow.search').operation.file, 'domains/workflow/workflow-openapi.yaml');
  });

  test('an API\'s events document is under the same name as its OpenAPI document', () => {
    assert.equal(operations.find('$apis.workflow.receiveIntakeApplicationSubmitted').operation.kind, 'asyncapi');
    assert.equal(operations.find('$apis.intake.receiveIntakeApplicationSubmitted').operation, undefined);
  });

  test('a document named looks only there, and beside it for the rest of its API', () => {
    assert.equal(operations.find('search', { file: 'domains/intake/intake-openapi.yaml' }).operation.api, 'intake');
    assert.equal(operations.find('receiveIntakeApplicationSubmitted', { file: 'domains/workflow/workflow-openapi.yaml' }).operation.kind, 'asyncapi');
  });

  test('nothing has an id no document declares', () => {
    assert.deepEqual(operations.find('nope').candidates, []);
  });

  test('includes what resolve will generate, on a set not yet resolved', () => {
    const machine = toDoc({
      path: '/set/domains/workflow/workflow-state-machine.yaml',
      relativePath: 'domains/workflow/workflow-state-machine.yaml',
      type: 'state-machine',
      content: {
        domain: 'workflow',
        machines: [{
          object: 'Task', states: [{ id: 'open' }], initialState: 'open',
          on: [{ type: 'intake.application.updated', steps: [] }],
        }],
      },
    });
    const returns = (name) => ({ 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } } });
    const tasks = api('workflow', {
      '/tasks': { get: { operationId: 'listTasks', responses: returns('TaskList') }, post: { operationId: 'createTask', responses: returns('Task') } },
      '/tasks/{taskId}': { parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }], get: { operationId: 'getTask', responses: returns('Task') } },
    });
    tasks.content.components = { schemas: { Task: { type: 'object' }, TaskList: { type: 'object' } } };
    const generated = extract([intake, tasks, machine], 'operations');
    assert.equal(generated.find('sendWorkflowTaskCreated').operation?.kind, 'asyncapi');
  });

  test('an id on two operations in one document is reported', () => {
    const twice = api('intake', {
      '/a': { get: { operationId: 'getThing', responses: ok } },
      '/b': { get: { operationId: 'getThing', responses: ok } },
    });
    assert.deepEqual(extract([twice], 'operations').repeated.map((o) => o.path), ['/b']);
  });
});

describe('a state machine\'s call to an operation', () => {
  const operations = extract([intake, workflow, events], 'operations');
  const machine = (operationId) => ({
    domain: 'workflow',
    // No object, so nothing but the call is checked against the set.
    machines: [{ states: [{ id: 'open' }], initialState: 'open', actions: [{ id: 'go', steps: [{ call: { operationId } }] }] }],
  });
  const rules = (operationId) => validateCrossArtifact('m.yaml', machine(operationId), new Map(), new Map(), {}, operations)
    .filter((e) => e.rule.endsWith('-operation'));

  test('naming an id one API has is fine', () => {
    assert.deepEqual(rules('listTasks'), []);
  });

  test('naming an id two APIs have is an error naming the qualified forms', () => {
    const [error] = rules('search');
    assert.equal(error.rule, 'ambiguous-operation');
    assert.match(error.message, /write \$apis\.intake\.search or \$apis\.workflow\.search/);
  });

  test('qualifying it by API is fine', () => {
    assert.deepEqual(rules('$apis.intake.search'), []);
  });

  test('naming an id nothing has, or an API that hasn\'t it, is an error', () => {
    assert.deepEqual(rules('nope').map((e) => e.rule), ['unknown-operation']);
    assert.deepEqual(rules('$apis.intake.listTasks').map((e) => e.rule), ['unknown-operation']);
  });
});

describe('two OpenAPI documents declaring one route', () => {
  test('is a route-collision error on the second, naming the first', async () => {
    const { validate } = await import('../../src/validate.js');
    const adapter = (name) => toDoc({
      path: `/set/domains/eligibility/${name}-openapi.yaml`,
      relativePath: `domains/eligibility/${name}-openapi.yaml`,
      type: 'openapi',
      content: {
        openapi: '3.1.0', info: { title: name, version: '1', 'x-domain': 'eligibility' },
        servers: [{ url: 'http://localhost:9090' }],
        paths: { '/evaluate/determination': { post: { operationId: `evaluate${name.length}`, responses: ok } } },
      },
    });
    const errors = validate([adapter('eligibility-adapter'), adapter('other-adapter')]).results
      .flatMap((r) => r.errors).filter((e) => e.rule === 'route-collision');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /POST \/evaluate\/determination is also declared by domains\/eligibility\/eligibility-adapter-openapi\.yaml/);
  });
});

describe('a state machine call by path', () => {
  const machine = (call) => toDoc({
    path: '/set/domains/intake/intake-state-machine.yaml',
    relativePath: 'domains/intake/intake-state-machine.yaml',
    type: 'state-machine',
    content: { domain: 'intake', machines: [{ object: 'Application', states: [{ id: 'draft' }], initialState: 'draft', actions: [{ id: 'go', steps: [{ call }] }] }] },
  });
  const warned = async (call) => {
    const { validate } = await import('../../src/validate.js');
    return validate([machine(call)]).results.flatMap((r) => r.warnings).filter((w) => w.rule === 'call-by-path-across-domains');
  };

  test('into its own domain is the machine\'s own write, and not warned about', async () => {
    assert.deepEqual(await warned({ PATCH: 'intake/applications/$object.id' }), []);
  });

  test('into another domain is warned about, naming the operationId form', async () => {
    const [warning] = await warned({ POST: 'eligibility/determinations' });
    assert.match(warning.message, /call by path into eligibility, so it skips that API and routing\. Call the operation by its operationId/);
  });

  test('by operationId is not', async () => {
    assert.deepEqual(await warned({ operationId: 'createDetermination' }), []);
  });
});
