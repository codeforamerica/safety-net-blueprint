/**
 * Every event is `domain.resource.event`, and a machine's steps name its own
 * events by id.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { snakeCase, eventType, expandEmits } from '../../src/event-names.js';
import { toDoc } from '../../src/doc.js';
import { validate } from '../../src/validate.js';
import { buildApiModel } from '../../src/openapi/model.js';

describe('event names', () => {
  test('the resource is its schema name in snake_case; the domain is as declared', () => {
    assert.equal(snakeCase('ApplicationMember'), 'application_member');
    assert.equal(snakeCase('ExternalServiceCall'), 'external_service_call');
    assert.equal(eventType('case-management', 'Case', 'created'), 'case-management.case.created');
  });

  test('a short-named emit gets its full type, at any depth', () => {
    const machine = {
      object: 'TranscriptEntry',
      actions: [{ id: 'a', steps: [{ emit: 'paused' }, { if: 'x', then: [{ emit: { event: 'closed', data: { at: '$now' } } }] }] }],
      on: [{ type: 'other.thing.happened', steps: [{ emit: 'noted' }] }],
    };
    const out = expandEmits(machine, 'communication');
    assert.deepEqual(out.actions[0].steps[0].emit, { event: 'paused', type: 'communication.transcript_entry.paused' });
    assert.deepEqual(out.actions[0].steps[1].then[0].emit, { event: 'closed', data: { at: '$now' }, type: 'communication.transcript_entry.closed' });
    assert.equal(out.on[0].steps[0].emit.type, 'communication.transcript_entry.noted');
  });

  test('a machine with nothing to expand comes back as it was', () => {
    const machine = { object: 'Timer', procedures: [{ id: 'p', steps: [{ emit: { type: 'platform.timer.requested' } }] }] };
    assert.equal(expandEmits(machine, 'platform'), machine);
  });
});

describe('a machine\'s emits', () => {
  const roles = toDoc({
    path: '/set/base/schemas/enums.yaml', relativePath: 'base/schemas/enums.yaml', type: 'schema',
    content: { $defs: { RoleType: { type: 'string', enum: ['system'] } } },
  });
  const machineDoc = (machine) => toDoc({
    path: '/set/domains/demo/demo-state-machine.yaml', relativePath: 'domains/demo/demo-state-machine.yaml', type: 'state-machine',
    content: { $schema: 'state-machine-schema.yaml', version: '1.0', domain: 'demo', machines: [{ object: 'Widget', states: [{ id: 'a', slaClock: 'stopped' }], initialState: 'a', ...machine }] },
  });
  const errorsOf = (doc, rule) => validate([roles, doc]).results.flatMap((r) => r.errors).filter((e) => e.rule === rule);

  test('a step may send only an event the machine declares', () => {
    const doc = machineDoc({ emits: [{ id: 'shipped' }], actions: [{ id: 'ship', steps: [{ emit: 'shiped' }] }] });
    const [error] = errorsOf(doc, 'undeclared-emit');
    assert.match(error.message, /emit "shiped" is not an event the Widget machine declares under emits \(declared: shipped\)/);
  });

  test('a declared event sent by id is clean', () => {
    const doc = machineDoc({ emits: [{ id: 'shipped', schema: { type: 'object' } }], actions: [{ id: 'ship', steps: [{ emit: 'shipped' }] }] });
    assert.deepEqual(errorsOf(doc, 'undeclared-emit'), []);
    assert.deepEqual(errorsOf(doc, 'schema-conformance'), []);
  });

  test('a step inside a call\'s catch is checked too', () => {
    const doc = machineDoc({ emits: [{ id: 'shipped' }], actions: [{ id: 'ship', steps: [{ call: { operationId: 'x' }, catch: { do: [{ emit: 'shiped' }] } }] }] });
    assert.equal(errorsOf(doc, 'undeclared-emit').length, 1);
  });

  describe('the data a step sends, against the event\'s schema', () => {
    const schema = { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string' }, note: { type: 'string' } } };
    const sending = (data) => machineDoc({ emits: [{ id: 'held', schema }], actions: [{ id: 'hold', steps: [{ emit: { event: 'held', data } }] }] });

    test('data that fits the schema is clean', () => {
      assert.deepEqual(errorsOf(sending({ reason: '$request.reason', note: '$request.note' }), 'emit-data'), []);
    });

    test('a property the schema requires and the step doesn\'t send is an error', () => {
      const [error] = errorsOf(sending({ note: '$request.note' }), 'emit-data');
      assert.match(error.message, /emit "held" doesn't send reason, which its schema requires/);
    });

    test('a property the schema doesn\'t declare, when it allows no others, is an error', () => {
      const [error] = errorsOf(sending({ reason: 'x', mood: 'x' }), 'emit-data');
      assert.match(error.message, /emit "held" sends mood, which its schema doesn't declare/);
    });

    test('data on an event that declares no schema is an error', () => {
      const doc = machineDoc({ emits: [{ id: 'held' }], actions: [{ id: 'hold', steps: [{ emit: { event: 'held', data: { reason: 'x' } } }] }] });
      const [error] = errorsOf(doc, 'emit-data');
      assert.match(error.message, /emit "held" sends data \(reason\), but the event declares no schema/);
    });
  });

  test('`events:` is reported as renamed to `on:`', () => {
    const [error] = errorsOf(machineDoc({ events: [] }), 'renamed-key');
    assert.match(error.message, /`events:` is now `on:`/);
  });
});

describe('the API model names a resource', () => {
  test('by the schema it returns when changed, where a read answers with a wrapper', () => {
    const ok = (name) => ({ 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } } });
    const model = buildApiModel({
      paths: { '/progress/{section}': { get: { responses: ok('ProgressList') }, patch: { responses: ok('Progress') } } },
    });
    assert.equal(model.resources[0].name, 'Progress');
    assert.equal(model.resources[0].eventName, 'progress');
  });

  test('a collection listed and added to with no item endpoint is a resource, named for what its create returns', () => {
    const ok = (name, status) => ({ [status]: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } } });
    const model = buildApiModel({
      paths: {
        '/tags': { get: { responses: ok('TagList', 200) }, post: { responses: ok('Tag', 201) } },
        '/evaluate/priority': { post: { responses: ok('Priority', 200) } },
      },
    });
    assert.deepEqual(model.resources.map((r) => [r.name, r.path('collection'), r.path('item')]), [['Tag', '/tags', null]]);
  });
});
