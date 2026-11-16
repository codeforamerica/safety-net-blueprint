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
      timers: [{ id: 'review_due', description: 'Reviews a case nobody has looked at.' }],
      on: [
        { type: 'case-management.review_due', steps: [] },
        { type: 'case-management.case.created', steps: [] },
      ],
    }],
  },
});

// Another domain, whose API writes nothing, so sends nothing, and whose machine
// reacts to a case-management event.
const noticesApi = toDoc({
  path: '/set/domains/notices/notices-openapi.yaml',
  relativePath: 'domains/notices/notices-openapi.yaml',
  type: 'openapi',
  content: {
    openapi: '3.1.0',
    info: { title: 'Notices', version: '1.0.0', 'x-domain': 'notices' },
    servers: [{ url: '/notices' }],
    paths: {
      '/notices': { get: { responses: ok('NoticeList') } },
      '/notices/{noticeId}': { parameters: [id('noticeId')], get: { responses: ok('Notice') } },
    },
    components: { schemas: { Notice: { type: 'object' }, NoticeList: { type: 'object' } } },
  },
});

const noticesMachine = toDoc({
  path: '/set/domains/notices/notices-state-machine.yaml',
  relativePath: 'domains/notices/notices-state-machine.yaml',
  type: 'state-machine',
  content: {
    $schema: 'state-machine-schema.yaml', version: '1.0', domain: 'notices',
    machines: [{
      object: 'Notice', states: [{ id: 'draft', slaClock: 'stopped' }], initialState: 'draft',
      on: [
        { type: 'case-management.case.transferred', steps: [] },
        { type: 'case-management.case.transferred', steps: [] },
      ],
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
      'case-management.case.transferred', 'case-management.review_due',
    ]);
  });

  test('has a channel for each timer its machine declares, carrying the timer service\'s callback', () => {
    const data = catalog.content.components.schemas.CaseManagementReviewDueEvent.schema.allOf[1].properties.data;
    assert.deepEqual(data, { $ref: 'https://blueprint.codeforamerica.org/base/schemas/events.yaml#/TimerCallbackEvent' });
    assert.match(catalog.content.components.messages.CaseManagementReviewDue.summary, /^Reviews a case nobody has looked at\. Sent by the timer service/);
  });

  test('carries the resource as a created event\'s data, and the declared schema as an emitted one\'s', () => {
    const data = (name) => catalog.content.components.schemas[name].schema.allOf[1].properties.data;
    assert.deepEqual(data('CaseManagementCaseCreatedEvent'), { $ref: './case-management-openapi.yaml#/components/schemas/Case' });
    assert.deepEqual(data('CaseManagementCaseTransferredEvent'), { type: 'object', required: ['county'] });
    assert.equal(catalog.content.components.messages.CaseManagementCaseTransferred.summary, 'The case moved county.');
  });

  test('labels each event\'s schema as OpenAPI 3.1, which its data is written in', () => {
    const format = 'application/vnd.oai.openapi;version=3.1.0';
    for (const schema of Object.values(catalog.content.components.schemas)) assert.equal(schema.schemaFormat, format);
    for (const message of Object.values(catalog.content.components.messages)) {
      assert.equal(message.payload.schemaFormat, format);
      assert.match(message.payload.schema.$ref, /^#\/components\/schemas\/\w+Event$/);
    }
  });

  test('leaves out an event log, whose records are events, and a call, which is no resource\'s', () => {
    const types = Object.keys(catalog.content.channels);
    assert.ok(!types.some((t) => t.includes('log_entry') || t.includes('priority')), types.join(', '));
  });
});

describe('the operations in a generated event catalog', () => {
  const catalogs = eventsAsyncapis([api, machine, noticesApi, noticesMachine]);
  const cases = catalogs.find((c) => c.relativePath.startsWith('domains/case-management/'));
  const notices = catalogs.find((c) => c.relativePath.startsWith('domains/notices/'));

  test('has a send operation for each event the API sends, on its channel, with its message', () => {
    assert.deepEqual(cases.content.operations.sendCaseManagementCaseTransferred, {
      action: 'send',
      channel: { $ref: '#/channels/case-management.case.transferred' },
      messages: [{ $ref: '#/channels/case-management.case.transferred/messages/CaseManagementCaseTransferred' }],
    });
  });

  test('has no send operation for a timer, which the timer service sends', () => {
    assert.ok(!('sendCaseManagementReviewDue' in cases.content.operations));
  });

  test('has a receive operation for each event its machines react to, on its own channel when the API sends it', () => {
    assert.equal(cases.content.operations.receiveCaseManagementReviewDue.action, 'receive');
    assert.deepEqual(cases.content.operations.receiveCaseManagementCaseCreated.channel, { $ref: '#/channels/case-management.case.created' });
  });

  test('lists another document\'s channel by reference, not a copy, for an event sent there', () => {
    assert.deepEqual(notices.content.channels['case-management.case.transferred'], {
      $ref: '../case-management/case-management-events-asyncapi.yaml#/channels/case-management.case.transferred',
    });
    assert.deepEqual(notices.content.operations, {
      receiveCaseManagementCaseTransferred: {
        action: 'receive',
        channel: { $ref: '#/channels/case-management.case.transferred' },
        messages: [{ $ref: '#/channels/case-management.case.transferred/messages/CaseManagementCaseTransferred' }],
      },
    });
  });

  test('is written for an API that sends nothing but whose machines receive, with no messages of its own', () => {
    assert.equal(notices.relativePath, 'domains/notices/notices-events-asyncapi.yaml');
    assert.equal(notices.content.components, undefined);
  });

  test('a channel listed by reference is not a hand-written copy, and its messages resolve through it', () => {
    const errors = validate([api, machine, noticesApi, noticesMachine, ...catalogs]).results
      .filter((r) => r.path?.includes('notices-events'))
      .flatMap((r) => r.errors);
    assert.deepEqual(errors.filter((e) => ['channel-generated', 'unresolved-fragment-ref'].includes(e.rule)), []);
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
