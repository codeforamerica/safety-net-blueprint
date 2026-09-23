/**
 * Unit tests for event-validator.js
 *
 * Two rules, each with a positive and a negative case:
 *   emit-type-undeclared        emit.type must be a channel in the machine's eventsSpec
 *   subscription-type-undeclared  onEvent.type must be a channel somewhere
 *
 * Plus the timer callback exemption, which has to survive a state putting its
 * whole event vocabulary behind a bus namespace.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvents } from '../../../src/validator/event-validator.js';

/**
 * A state-machine Doc, with `model()` as a method the way `load` builds it.
 *
 * @param {object} content - Document content
 * @returns {object}
 */
function stateMachineDoc(content) {
  return {
    path: '/contracts/domains/intake/intake-state-machine.yaml',
    relativePath: 'domains/intake/intake-state-machine.yaml',
    type: 'state-machine',
    content,
    model() { return { machines: this.content.machines ?? [] }; },
  };
}

/**
 * @param {string[]} types - Declared channel names
 * @param {string} [spec] - The eventsSpec they belong to
 * @returns {{ bySpec: Map<string, Set<string>>, all: Set<string> }}
 */
function channels(types, spec = 'intake-asyncapi.yaml') {
  return { bySpec: new Map([[spec, new Set(types)]]), all: new Set(types) };
}

describe('validateEvents', () => {
  test('emit of a declared channel produces no error', () => {
    const doc = stateMachineDoc({
      domain: 'intake',
      eventsSpec: 'intake-asyncapi.yaml',
      machines: [{ actions: [{ steps: [{ emit: { type: 'intake.application.submitted' } }] }] }],
    });

    assert.deepEqual(validateEvents(doc, channels(['intake.application.submitted'])), []);
  });

  test('emit of an undeclared channel is an error', () => {
    const doc = stateMachineDoc({
      domain: 'intake',
      eventsSpec: 'intake-asyncapi.yaml',
      machines: [{ actions: [{ steps: [{ emit: { type: 'intake.application.lost' } }] }] }],
    });

    const errors = validateEvents(doc, channels(['intake.application.submitted']));
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rule, 'emit-type-undeclared');
  });

  test('subscription to an undeclared channel is an error', () => {
    const doc = stateMachineDoc({
      domain: 'intake',
      machines: [{ events: [{ type: 'billing.invoice.paid', steps: [] }] }],
    });

    const errors = validateEvents(doc, channels(['intake.application.submitted']));
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rule, 'subscription-type-undeclared');
  });

  // -------------------------------------------------------------------------
  // Timer callbacks
  //
  // A callback is deliberately absent from every AsyncAPI catalog: the timer
  // declaration and TimerCallbackEvent already state it, so a channel would be
  // a second source of truth. The exemption is what keeps it from being
  // reported as undeclared.
  // -------------------------------------------------------------------------

  test('a timer callback needs no channel', () => {
    const doc = stateMachineDoc({
      domain: 'intake',
      machines: [{
        timers: [{ id: 'review_reminder' }],
        events: [{ type: 'intake.review_reminder', steps: [] }],
      }],
    });

    assert.deepEqual(validateEvents(doc, channels([])), []);
  });

  test('a timer callback behind a bus namespace still needs no channel', () => {
    // x-event-type-prefix rewrites the subscription but not `domain` or the
    // timer id, so the exemption has to match through the prefix.
    const doc = stateMachineDoc({
      domain: 'intake',
      machines: [{
        timers: [{ id: 'review_reminder' }],
        events: [{ type: 'ca.intake.review_reminder', steps: [] }],
      }],
    });

    assert.deepEqual(validateEvents(doc, channels([])), []);
  });

  test('the exemption is anchored on the separator', () => {
    // "xintake.review_reminder" is a different event, not a namespaced one.
    const doc = stateMachineDoc({
      domain: 'intake',
      machines: [{
        timers: [{ id: 'review_reminder' }],
        events: [{ type: 'xintake.review_reminder', steps: [] }],
      }],
    });

    const errors = validateEvents(doc, channels([]));
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rule, 'subscription-type-undeclared');
  });

  test('a subscription matching no declared timer is still checked', () => {
    const doc = stateMachineDoc({
      domain: 'intake',
      machines: [{
        timers: [{ id: 'review_reminder' }],
        events: [{ type: 'ca.intake.other_reminder', steps: [] }],
      }],
    });

    const errors = validateEvents(doc, channels([]));
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rule, 'subscription-type-undeclared');
  });
});
