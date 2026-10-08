/**
 * Unit tests for event-subscription — machine onEvent evaluation.
 * Tests event type matching, context resolution, guards, and transitions.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMemoryStore } from '../../src/stores/memory-store.js';

// A store of this file's own, rather than one shared through a module-level
// singleton. In memory because these cases do not need a database — and
// because a fresh one per file is isolation they did not have before.
const store = createMemoryStore();
import { registerEventSubscriptions } from '../../src/event-subscription.js';
import { eventBus } from '../../src/event-bus.js';

// Each test registers subscriptions; remove all listeners between tests to prevent accumulation
beforeEach(() => eventBus.removeAllListeners('domain-event'));

function makeEvent(type, subject, data = null) {
  return {
    specversion: '1.0',
    id: 'test-event-' + Math.random(),
    type,
    source: '/intake',
    subject,
    time: new Date().toISOString(),
    data
  };
}


// =============================================================================
// Machine onEvent — guards
// =============================================================================

test('machine onEvent — runs when guards pass', (t, done) => {
  store.clearAll('applications');
  const APP_ID = 'app-guard-pass';
  store.insertResource('applications', { id: APP_ID, status: 'submitted', isUrgent: true });

  const machine = {
    object: 'Application',
    guards: [{ id: 'isUrgent', condition: 'object.isUrgent == true' }],
    events: [{
      type: 'intake.application.submitted',
      transition: { from: 'submitted' },
      guards: { conditions: ['isUrgent'] },
      steps: [{ set: { field: 'priority', value: 'high' } }]
    }]
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries, [], [], store);
  eventBus.emit('domain-event', makeEvent(
    'intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    const app = store.findById('applications', APP_ID);
    assert.strictEqual(app.priority, 'high', 'the step should have run and persisted');
    done();
  });
});

test('machine onEvent — skipped when guards fail', (t, done) => {
  store.clearAll('applications');
  const APP_ID = 'app-guard-fail';
  store.insertResource('applications', { id: APP_ID, status: 'submitted', isUrgent: false });

  let stepRan = false;

  const machine = {
    object: 'Application',
    guards: [{ id: 'isUrgent', condition: 'object.isUrgent == true' }],
    events: [{
      type: 'intake.application.submitted',
      transition: { from: 'submitted' },
      guards: { conditions: ['isUrgent'] },
      steps: [{ set: { field: 'priority', value: 'high' } }]
    }]
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries, [], [], store);
  eventBus.emit('domain-event', makeEvent(
    'intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    // guard fails — resource unchanged
    const app = store.findById('applications', APP_ID);
    assert.strictEqual(app.priority, undefined);
    done();
  });
});

// =============================================================================
// Machine onEvent — transition
// =============================================================================

test('machine onEvent — applies transition and persists resource mutations', (t, done) => {
  store.clearAll('applications');
  const APP_ID = 'app-transition-1';
  store.insertResource('applications', { id: APP_ID, status: 'submitted' });

  const machine = {
    object: 'Application',
    events: [{
      type: 'intake.application.submitted',
      transition: { from: 'submitted', to: 'under_review' },
      steps: [{ set: { field: 'reviewedAt', value: '$now' } }]
    }]
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries, [], [], store);
  eventBus.emit('domain-event', makeEvent(
    'intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    const app = store.findById('applications', APP_ID);
    assert.strictEqual(app.status, 'under_review');
    assert.ok(app.reviewedAt, 'reviewedAt was set');
    done();
  });
});

test('machine onEvent — skipped when resource not found', (t, done) => {
  store.clearAll('applications');

  const machine = {
    object: 'Application',
    events: [{
      type: 'intake.application.submitted',
      transition: { from: 'submitted', to: 'under_review' },
      steps: []
    }],
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries, [], [], store);

  // No crash when subject doesn't exist
  eventBus.emit('domain-event', makeEvent(
    'intake.application.submitted',
    'nonexistent-id'
  ));

  setImmediate(() => done());
});

test('machine onEvent — skipped when resource in wrong from state', (t, done) => {
  store.clearAll('applications');
  const APP_ID = 'app-wrong-state';
  store.insertResource('applications', { id: APP_ID, status: 'under_review' });

  const machine = {
    object: 'Application',
    events: [{
      type: 'intake.application.submitted',
      transition: { from: 'submitted', to: 'under_review' },
      steps: [{ set: { field: 'flag', value: 'set' } }]
    }],
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries, [], [], store);
  eventBus.emit('domain-event', makeEvent(
    'intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    const app = store.findById('applications', APP_ID);
    assert.strictEqual(app.status, 'under_review');
    assert.strictEqual(app.flag, undefined);
    done();
  });
});

// =============================================================================
// Machine onEvent — emitting
// =============================================================================

test('machine onEvent — an emit: step reaches the event log', (t, done) => {
  // This path threw for every subscription that emits: emitEventEnvelope takes
  // the store as its second argument and this call site omitted it, so the
  // envelope could not be recorded. The failure is caught and logged, so the
  // triggering transition still succeeded and the emitted event simply never
  // appeared — which is the hardest kind of missing to notice.
  store.clearAll('applications');
  store.clearAll('events');
  const APP_ID = 'app-emitting';
  store.insertResource('applications', { id: APP_ID, status: 'submitted' });

  const machine = {
    object: 'Application',
    events: [{
      type: 'intake.review_reminder',
      transition: { from: 'submitted' },
      steps: [{ emit: { type: 'intake.application.review-reminder' } }],
    }],
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] },
  }];

  registerEventSubscriptions(smEntries, [], [], store);
  eventBus.emit('domain-event', makeEvent('intake.review_reminder', APP_ID));

  setImmediate(() => {
    const { items } = store.findAll('events', { type: 'intake.application.review-reminder' }, { limit: null });
    assert.equal(items.length, 1, 'the emitted event should be in the log');
    assert.equal(items[0].subject, APP_ID, 'and should name the resource it was about');
    done();
  });
});
