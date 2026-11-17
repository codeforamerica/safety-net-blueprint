/**
 * SLA type conditions and metric filters are CEL over a record's fields: the
 * expression has to parse, and the fields it reads have to be fields of the
 * resource it is about.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../../src/doc.js';
import { validate } from '../../../src/validate.js';

/** A workflow API with a Task resource. */
const api = toDoc({
  path: '/set/domains/workflow/workflow-openapi.yaml',
  relativePath: 'domains/workflow/workflow-openapi.yaml',
  type: 'openapi',
  content: {
    openapi: '3.1.0',
    info: { title: 'Workflow', version: '1', 'x-domain': 'workflow' },
    servers: [{ url: 'http://localhost:1080/workflow' }],
    paths: {
      '/tasks': { get: { operationId: 'listTasks', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskList' } } } } } } },
      '/tasks/{taskId}': {
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'getTask', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } } } },
      },
    },
    components: {
      schemas: {
        Task: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, slaInfo: { type: 'array', items: { type: 'object' } } } },
        TaskList: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } },
      },
    },
  },
});

const findings = (d) => validate([api, d]).results
  .flatMap((r) => r.errors)
  .filter((e) => e.rule === 'unknown-field-reference' || e.rule === 'cel-syntax');

const metric = (filter) => toDoc({
  path: '/set/domains/workflow/workflow-metrics.yaml',
  relativePath: 'domains/workflow/workflow-metrics.yaml',
  type: 'metrics',
  content: { version: '1.0', domain: 'workflow', metrics: [{ id: 'm', name: 'm', description: 'd', aggregate: 'count', source: { collection: 'tasks', filter } }] },
});

const slaType = (pauseWhen) => toDoc({
  path: '/set/domains/workflow/workflow-sla-types.yaml',
  relativePath: 'domains/workflow/workflow-sla-types.yaml',
  type: 'sla-types',
  content: { version: '1.0', domain: 'workflow', slaTypes: [{ id: 'snap', name: 'SNAP', duration: { amount: 30, unit: 'days' }, pauseWhen }] },
});

test('a metric filter reading a field the resource has is clean, item variables included', () => {
  assert.deepEqual(findings(metric('status == "pending" && slaInfo.exists(entry, entry.status == "breached")')), []);
});

test('a metric filter reading a field the resource lacks names it', () => {
  const [error] = findings(metric('state == "pending"'));
  assert.equal(error.rule, 'unknown-field-reference');
  assert.match(error.message, /reads "state", which is not a field of the tasks resource/);
  assert.equal(error.path, 'metrics[m].source.filter');
});

test('an SLA condition reading a field the resource lacks names it', () => {
  const [error] = findings(slaType('stage in ["awaiting_client"]'));
  assert.match(error.message, /reads "stage", which is not a field of the tasks resource/);
  assert.equal(error.path, 'slaTypes[snap].pauseWhen');
});

test('a condition that is not CEL is reported', () => {
  const [error] = findings(slaType('status in ['));
  assert.equal(error.rule, 'cel-syntax');
  assert.equal(error.path, 'slaTypes[snap].pauseWhen');
});
