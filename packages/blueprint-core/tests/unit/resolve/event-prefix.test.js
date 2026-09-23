/**
 * Unit tests for resolve/event-prefix.js
 *
 * Three document types name event types, each differently, and a prefix
 * applied to one and not another silently breaks the link between publisher
 * and subscriber — so each is covered here. Ported from the CLI's
 * injectEventPrefixIn* tests, restated against the pass API.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { prefixEventTypes } from '../../../src/resolve/event-prefix.js';
import { doc, only } from '../../helpers/docs.js';

const PREFIX = 'org.example.';

const stateMachine = (content) =>
  doc(content, { relativePath: 'domains/test/test-state-machine.yaml', type: 'state-machine' });
const asyncApi = (content) =>
  doc(content, { relativePath: 'domains/test/test-asyncapi.yaml', type: 'asyncapi' });
const annotations = (content) =>
  doc(content, { relativePath: 'domains/test/test-annotations.yaml', type: 'annotations' });

describe('prefixEventTypes — state machines', () => {
  test('prefixes event handler types and emit steps', () => {
    const result = prefixEventTypes([stateMachine({
      machines: [{
        object: 'Widget',
        events: [{ type: 'test.widget.submitted', steps: [] }],
        actions: [{ id: 'submit', steps: [{ emit: { type: 'test.widget.submitted', data: {} } }] }],
      }],
    })], PREFIX);

    const machine = only(result).machines[0];
    assert.equal(machine.events[0].type, 'org.example.test.widget.submitted');
    assert.equal(machine.actions[0].steps[0].emit.type, 'org.example.test.widget.submitted');
  });

  test('reaches emit steps nested in branch bodies', () => {
    const result = prefixEventTypes([stateMachine({
      machines: [{
        object: 'Widget',
        actions: [{
          id: 'route',
          steps: [{
            if: '$object.isExpedited == true',
            then: [{ emit: { type: 'test.widget.expedited' } }],
            else: [{ emit: { type: 'test.widget.standard' } }],
          }],
        }],
      }],
    })], PREFIX);

    const step = only(result).machines[0].actions[0].steps[0];
    assert.equal(step.then[0].emit.type, 'org.example.test.widget.expedited');
    assert.equal(step.else[0].emit.type, 'org.example.test.widget.standard');
  });

  test('reaches emit steps inside a when: branch map', () => {
    const result = prefixEventTypes([stateMachine({
      machines: [{
        object: 'Widget',
        actions: [{
          id: 'dispatch',
          steps: [{
            match: '$object.status',
            when: {
              approved: [{ emit: { type: 'test.widget.approved' } }],
              denied: [{ emit: { type: 'test.widget.denied' } }],
            },
          }],
        }],
      }],
    })], PREFIX);

    const step = only(result).machines[0].actions[0].steps[0];
    assert.equal(step.when.approved[0].emit.type, 'org.example.test.widget.approved');
    assert.equal(step.when.denied[0].emit.type, 'org.example.test.widget.denied');
  });

  test('prefixes the handler type but not an action id', () => {
    // Only `events` holders name an event type; an action id is an identifier.
    const result = prefixEventTypes([stateMachine({
      machines: [{ object: 'Widget', actions: [{ id: 'submit', type: 'not-an-event', steps: [] }] }],
    })], PREFIX);

    assert.equal(only(result).machines[0].actions[0].type, 'not-an-event');
  });

  test('does not add sections the document never declared', () => {
    // Mapping over `?? []` would write `procedures: []` into resolved output.
    const result = prefixEventTypes([stateMachine({
      machines: [{ object: 'Widget', events: [{ type: 'test.widget.submitted', steps: [] }] }],
    })], PREFIX);

    const machine = only(result).machines[0];
    assert.equal('procedures' in machine, false);
    assert.equal('actions' in machine, false);
  });

  test('passes a document with no machines through unchanged', () => {
    const content = { domain: 'test', context: null };
    const result = prefixEventTypes([stateMachine(content)], PREFIX);
    assert.deepEqual(only(result), content);
  });

  test('does not mutate the original content', () => {
    const content = {
      machines: [{ object: 'Widget', actions: [{ id: 'submit', steps: [{ emit: { type: 'test.widget.submitted' } }] }] }],
    };
    prefixEventTypes([stateMachine(content)], PREFIX);
    assert.equal(content.machines[0].actions[0].steps[0].emit.type, 'test.widget.submitted');
  });
});

describe('prefixEventTypes — AsyncAPI', () => {
  test('prefixes channel keys, addresses and message names', () => {
    const result = prefixEventTypes([asyncApi({
      channels: { 'test.widget.submitted': { address: 'test.widget.submitted', messages: {} } },
      components: { messages: { WidgetSubmitted: { name: 'test.widget.submitted' } }, schemas: {} },
    })], PREFIX);

    const content = only(result);
    assert.ok('org.example.test.widget.submitted' in content.channels);
    assert.equal(content.channels['org.example.test.widget.submitted'].address, 'org.example.test.widget.submitted');
    assert.equal(content.components.messages.WidgetSubmitted.name, 'org.example.test.widget.submitted');
  });

  test('prefixes the discriminating type const in an event envelope', () => {
    // A subscriber matches on this; leaving it would have the payload claim an
    // unprefixed type while its channel says otherwise.
    const result = prefixEventTypes([asyncApi({
      channels: { 'test.widget.submitted': {} },
      components: {
        schemas: {
          WidgetSubmittedPayload: {
            allOf: [
              { $ref: '#/components/schemas/Envelope' },
              { properties: { type: { const: 'test.widget.submitted' } } },
            ],
          },
        },
      },
    })], PREFIX);

    const parts = only(result).components.schemas.WidgetSubmittedPayload.allOf;
    assert.equal(parts[1].properties.type.const, 'org.example.test.widget.submitted');
  });

  test('passes a document with no channels through unchanged', () => {
    const content = { asyncapi: '3.0.0', info: { title: 'Test', version: '1.0.0' } };
    const result = prefixEventTypes([asyncApi(content)], PREFIX);
    assert.deepEqual(only(result), content);
  });

  test('does not mutate the original content', () => {
    const content = { channels: { 'test.widget.submitted': { address: 'test.widget.submitted' } } };
    prefixEventTypes([asyncApi(content)], PREFIX);
    assert.ok('test.widget.submitted' in content.channels);
  });
});

describe('prefixEventTypes — annotations', () => {
  test('prefixes the keys of the events section', () => {
    const result = prefixEventTypes([annotations({
      events: {
        'intake.application.submitted': { programs: ['snap'] },
        'intake.application.closed': { programs: ['snap'] },
      },
    })], PREFIX);

    const events = only(result).events;
    assert.ok('org.example.intake.application.submitted' in events);
    assert.ok('org.example.intake.application.closed' in events);
    assert.equal('intake.application.submitted' in events, false);
  });

  test('passes a document with no events section through unchanged', () => {
    const content = { schema: { 'application.id': { programs: ['snap'] } } };
    const result = prefixEventTypes([annotations(content)], PREFIX);
    assert.deepEqual(only(result), content);
  });

  test('does not mutate the original content', () => {
    const content = { events: { 'intake.application.submitted': { programs: ['snap'] } } };
    prefixEventTypes([annotations(content)], PREFIX);
    assert.ok('intake.application.submitted' in content.events);
  });
});

describe('prefixEventTypes — pass contract', () => {
  test('no prefix configured is a no-op', () => {
    const input = [stateMachine({ machines: [{ events: [{ type: 'test.widget.submitted', steps: [] }] }] })];
    const result = prefixEventTypes(input, null);

    assert.equal(result.docs, input);
    assert.deepEqual(result.applied, []);
  });

  test('leaves document types that name no event types alone', () => {
    const openapi = doc({ openapi: '3.1.0', paths: {} }, { relativePath: 'domains/test/test-openapi.yaml' });
    const result = prefixEventTypes([openapi], PREFIX);

    assert.equal(result.docs[0], openapi);
    assert.deepEqual(result.applied, []);
  });

  test('reports each document it prefixed', () => {
    const result = prefixEventTypes([
      stateMachine({ machines: [{ events: [{ type: 'a.b', steps: [] }] }] }),
      asyncApi({ channels: { 'a.b': {} } }),
    ], PREFIX);

    assert.equal(result.applied.length, 2);
    assert.ok(result.applied.every((line) => line.includes('org.example.')));
  });
});
