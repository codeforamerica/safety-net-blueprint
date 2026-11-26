/**
 * SLA type conditions and metric filters are CEL over one record, read as
 * `object` and `item`: the expression has to parse, read the record through
 * its variable, and read only fields of the resource it is about.
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
  .filter((e) => ['unknown-field-reference', 'bare-field-reference', 'cel-syntax'].includes(e.rule));

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

test('a metric filter reading a field the resource has is clean, has() and item variables included', () => {
  assert.deepEqual(findings(metric('item.status == "pending" && !has(item.id) && item.slaInfo.exists(entry, entry.status == "breached")')), []);
});

test('a metric filter reading a field the resource lacks names it', () => {
  const [error] = findings(metric('item.state == "pending"'));
  assert.equal(error.rule, 'unknown-field-reference');
  assert.match(error.message, /reads "item\.state", and state is not a field of the tasks resource/);
  assert.equal(error.path, 'metrics[m].source.filter');
});

test('a metric filter reading a field bare is refused, with the form to write', () => {
  const [error] = findings(metric('status == "pending"'));
  assert.equal(error.rule, 'bare-field-reference');
  assert.match(error.message, /reads "status" bare; the record is `item`\. Write `item\.status`, and `has\(item\.status\)`/);
});

test('an SLA condition reads its record as object', () => {
  assert.deepEqual(findings(slaType('object.status in ["awaiting_client"]')), []);
  const [bare] = findings(slaType('status in ["awaiting_client"]'));
  assert.match(bare.message, /Write `object\.status`/);
});

test('an SLA condition reading a field the resource lacks names it', () => {
  const [error] = findings(slaType('object.stage in ["awaiting_client"]'));
  assert.match(error.message, /reads "object\.stage", and stage is not a field of the tasks resource/);
  assert.equal(error.path, 'slaTypes[snap].pauseWhen');
});

test('a condition that is not CEL is reported', () => {
  const [error] = findings(slaType('status in ['));
  assert.equal(error.rule, 'cel-syntax');
  assert.equal(error.path, 'slaTypes[snap].pauseWhen');
});

test('an x-derived field reads its record as object, and this is refused', () => {
  const derived = (expr) => toDoc({
    path: '/set/domains/workflow/workflow-derived-openapi.yaml',
    relativePath: 'domains/workflow/workflow-derived-openapi.yaml',
    type: 'openapi',
    content: {
      openapi: '3.1.0',
      info: { title: 'Derived', version: '1', 'x-domain': 'workflow' },
      paths: {},
      components: { schemas: { Widget: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string', 'x-derived': expr } } } } },
    },
  });
  assert.deepEqual(findings(derived('object.id')), []);
  const [error] = findings(derived('this.id'));
  assert.equal(error.rule, 'bare-field-reference');
  assert.match(error.message, /reads "this" bare; the record is `object`/);
});
