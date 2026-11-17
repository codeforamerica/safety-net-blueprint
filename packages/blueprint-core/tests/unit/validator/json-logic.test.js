/**
 * Metric filters, SLA conditions and the where: of a context binding or a
 * forEach step are CEL. JSON Logic in one is refused, with the CEL to write
 * instead; a where: of field-value equality pairs is not JSON Logic (#413).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../../src/doc.js';
import { validate } from '../../../src/validate.js';

const doc = (type, file, content) => toDoc({
  path: `/set/domains/workflow/${file}`,
  relativePath: `domains/workflow/${file}`,
  type,
  content,
});

const refusals = (d) => validate([d]).results.flatMap((r) => r.errors).filter((e) => e.rule === 'json-logic-expression');

test('a JSON Logic metric filter is refused, with the CEL to write', () => {
  const [error, ...rest] = refusals(doc('metrics', 'workflow-metrics.yaml', {
    version: '1.0',
    domain: 'workflow',
    metrics: [{
      id: 'release_rate', name: 'Release rate', description: 'd', aggregate: 'ratio',
      source: { collection: 'events', filter: { '==': [{ var: 'type' }, 'workflow.task.released'] } },
      total: { collection: 'events', filter: 'type.contains("workflow.task.")' },
    }],
  }));
  assert.deepEqual(rest, []);
  assert.match(error.message, /^\/metrics\/0\/source\/filter is JSON Logic/);
  assert.match(error.message, /Write `type == "workflow.task.released"`\./);
  assert.equal(error.path, '/set/domains/workflow/workflow-metrics.yaml#/metrics/0/source/filter');
});

test('the CEL shown covers and, in, some and nested fields', () => {
  const [error] = refusals(doc('metrics', 'workflow-metrics.yaml', {
    version: '1.0',
    domain: 'workflow',
    metrics: [{
      id: 'm', name: 'm', description: 'd', aggregate: 'count',
      source: {
        collection: 'tasks',
        filter: { and: [
          { in: [{ var: 'status' }, ['pending', 'in_progress']] },
          { some: [{ var: 'slaInfo' }, { '==': [{ var: 'status' }, 'breached'] }] },
          { '!=': [{ var: 'data.reason' }, null] },
        ] },
      },
    }],
  }));
  assert.match(error.message,
    /Write `status in \["pending", "in_progress"\] && slaInfo\.exists\(x, x\.status == "breached"\) && data\.reason != null`\./);
});

test('an `in` testing a string says contains() is the CEL for a substring', () => {
  const [error] = refusals(doc('metrics', 'workflow-metrics.yaml', {
    version: '1.0',
    domain: 'workflow',
    metrics: [{ id: 'm', name: 'm', description: 'd', aggregate: 'count',
      source: { collection: 'events', filter: { in: ['workflow.task.', { var: 'type' }] } } }],
  }));
  assert.match(error.message, /Write `"workflow\.task\." in type`\..*write `text\.contains\(part\)`/);
});

test('a JSON Logic SLA condition is refused, with the CEL to write', () => {
  const [error] = refusals(doc('sla-types', 'workflow-sla-types.yaml', {
    version: '1.0',
    domain: 'workflow',
    slaTypes: [{ id: 'snap', name: 'SNAP', duration: { amount: 30, unit: 'days' },
      pauseWhen: { in: [{ var: 'status' }, ['awaiting_client', 'awaiting_verification']] } }],
  }));
  assert.match(error.message, /^\/slaTypes\/0\/pauseWhen is JSON Logic/);
  assert.match(error.message, /Write `status in \["awaiting_client", "awaiting_verification"\]`\./);
});

const machine = (where, context) => doc('state-machine', 'workflow-state-machine.yaml', {
  domain: 'workflow',
  machines: [{
    object: 'Task',
    states: { open: {} },
    initialState: 'open',
    procedures: [{
      id: 'notify',
      context,
      steps: [{ forEach: { from: 'intake/applications/members', where, as: 'member' }, do: [{ set: { field: 'status', value: 'open' } }] }],
    }],
  }],
});

test('a JSON Logic forEach where: is refused, naming the candidate record item', () => {
  const where = { and: [{ '==': [{ var: 'applicationId' }, { var: 'application.id' }] }, { '!=': [{ var: 'citizenshipStatus' }, 'citizen'] }] };
  const [error] = refusals(machine(where, [{ application: { from: 'intake/applications', where: { id: '$this.subject' } } }]));
  assert.match(error.message, /\/steps\/0\/forEach\/where is JSON Logic/);
  assert.match(error.message,
    /Write `item\.applicationId == application\.id && item\.citizenshipStatus != "citizen"`\. In a where:, `item` is the candidate record\./);
});

test('a JSON Logic context binding where: is refused', () => {
  const binding = { pendingCall: { from: 'data-exchange/service-calls', where: { '==': [{ var: 'status' }, { var: 'this.data.status' }] } } };
  const errors = refusals(machine('item.applicationId == object.id', [binding]));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /\/context\/0\/pendingCall\/where is JSON Logic.*Write `item\.status == this\.data\.status`/);
});

test('equality pairs and CEL strings in a where: are not refused', () => {
  assert.deepEqual(refusals(machine({ applicationId: '$object.id', in: 'person' }, [])), []);
  assert.deepEqual(refusals(machine('item.applicationId == object.id', [])), []);
});
