/**
 * Resolve documents every event an API's resources and their state machines
 * send, in an AsyncAPI document it generates beside the API.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { eventsAsyncapis } from '../../src/generate.js';
import { validate } from '../../src/validate.js';

const ok = (name, status = 200) => ({ [status]: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } } });
const id = (name) => ({ name, in: 'path', required: true, schema: { type: 'string' } });

const api = toDoc({
  path: '/set/domains/case-management/case-management-openapi.yaml',
  relativePath: 'domains/case-management/case-management-openapi.yaml',
  type: 'openapi',
  content: {
    openapi: '3.1.0',
    info: { title: 'Cases', version: '1.0.0', 'x-domain': 'case-management' },
    servers: [{ url: '/case-management' }],
    paths: {
      '/cases': { get: { responses: ok('CaseList') }, post: { responses: ok('Case', 201) } },
      '/cases/{caseId}': { parameters: [id('caseId')], get: { responses: ok('Case') }, patch: { responses: ok('Case') }, delete: { responses: { 204: {} } } },
      '/log': { get: { responses: ok('LogList') }, post: { responses: ok('LogEntry', 201) } },
      '/evaluate/priority': { post: { responses: ok('Priority') } },
    },
    components: {
      schemas: {
        Case: { type: 'object' }, CaseList: { type: 'object' }, LogList: { type: 'object' }, Priority: { type: 'object' },
        LogEntry: { $ref: 'https://blueprint.codeforamerica.org/base/schemas/events.yaml#/$defs/Event' },
      },
    },
  },
});

const machine = toDoc({
  path: '/set/domains/case-management/case-management-state-machine.yaml',
  relativePath: 'domains/case-management/case-management-state-machine.yaml',
  type: 'state-machine',
  content: {
    $schema: 'state-machine-schema.yaml', version: '1.0', domain: 'case-management',
    machines: [{
      object: 'Case', states: [{ id: 'open', slaClock: 'stopped' }], initialState: 'open',
      emits: [{ id: 'transferred', description: 'The case moved county.', schema: { type: 'object', required: ['county'] } }],
    }],
  },
});

describe('the generated event catalog', () => {
  const [catalog] = eventsAsyncapis([api, machine]);

  test('is written beside the API it documents', () => {
    assert.equal(catalog.relativePath, 'domains/case-management/case-management-events-asyncapi.yaml');
    assert.equal(catalog.type, 'asyncapi');
  });

  test('has each resource\'s writes and its machine\'s emits, named domain.resource.event', () => {
    assert.deepEqual(Object.keys(catalog.content.channels), [
      'case-management.case.created', 'case-management.case.updated', 'case-management.case.deleted',
      'case-management.case.transferred',
    ]);
  });

  test('carries the resource as a created event\'s data, and the declared schema as an emitted one\'s', () => {
    const data = (name) => catalog.content.components.schemas[name].allOf[1].properties.data;
    assert.deepEqual(data('CaseManagementCaseCreatedEvent'), { $ref: './case-management-openapi.yaml#/components/schemas/Case' });
    assert.deepEqual(data('CaseManagementCaseTransferredEvent'), { type: 'object', required: ['county'] });
    assert.equal(catalog.content.components.messages.CaseManagementCaseTransferred.summary, 'The case moved county.');
  });

  test('leaves out an event log, whose records are events, and a call, which is no resource\'s', () => {
    const types = Object.keys(catalog.content.channels);
    assert.ok(!types.some((t) => t.includes('log_entry') || t.includes('priority')), types.join(', '));
  });
});

describe('validation of events', () => {
  const findings = (docs) => validate(docs).results.flatMap((r) => [...r.errors, ...r.warnings]);

  test('a hand-written channel for a generated event is an error', () => {
    const handWritten = toDoc({
      path: '/set/domains/case-management/case-management-asyncapi.yaml',
      relativePath: 'domains/case-management/case-management-asyncapi.yaml',
      type: 'asyncapi',
      content: { asyncapi: '3.0.0', info: { title: 'C', version: '1', 'x-domain': 'case-management' }, channels: { 'case-management.case.created': { address: 'case-management.case.created' } } },
    });
    const [error] = findings([api, machine, handWritten]).filter((f) => f.rule === 'channel-generated');
    assert.match(error.message, /"case-management.case.created" is generated into domains\/case-management\/case-management-events-asyncapi.yaml/);
  });

  test('x-events is warned about as ignored', () => {
    const withXEvents = toDoc({ ...api, content: { ...api.content, 'x-events': {} } });
    assert.equal(findings([withXEvents]).filter((f) => f.rule === 'x-events-ignored').length, 1);
  });
});
