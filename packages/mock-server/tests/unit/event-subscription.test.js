/**
 * Unit tests for event-subscription — machine onEvent evaluation.
 * Tests event type matching, context resolution, guards, and transitions.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll, findAll, findById } from '../../src/database-manager.js';
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
  clearAll('applications');
  const APP_ID = 'app-guard-pass';
  insertResource('applications', { id: APP_ID, status: 'submitted', isUrgent: true });

  const machine = {
    object: 'Application',
    guards: [{ id: 'isUrgent', field: 'isUrgent', operator: 'equals', value: true }],
    triggers: {
      onEvent: [{
        name: 'intake.application.submitted',
        guards: { conditions: ['isUrgent'] },
        then: [{ set: { field: 'priority', value: 'high' } }]
      }]
    }
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries);
  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    // guard passes — no transition: so no DB write, but steps ran on empty resource
    // (steps on non-transition onEvent don't persist — this just verifies no crash)
    done();
  });
});

test('machine onEvent — skipped when guards fail', (t, done) => {
  clearAll('applications');
  const APP_ID = 'app-guard-fail';
  insertResource('applications', { id: APP_ID, status: 'submitted', isUrgent: false });

  let stepRan = false;

  const machine = {
    object: 'Application',
    guards: [{ id: 'isUrgent', field: 'isUrgent', operator: 'equals', value: true }],
    triggers: {
      onEvent: [{
        name: 'intake.application.submitted',
        guards: { conditions: ['isUrgent'] },
        then: [{ set: { field: 'priority', value: 'high' } }]
      }]
    }
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries);
  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    // guard fails — resource unchanged
    const app = findById('applications', APP_ID);
    assert.strictEqual(app.priority, undefined);
    done();
  });
});

// =============================================================================
// Machine onEvent — transition
// =============================================================================

test('machine onEvent — applies transition and persists resource mutations', (t, done) => {
  clearAll('applications');
  const APP_ID = 'app-transition-1';
  insertResource('applications', { id: APP_ID, status: 'submitted' });

  const machine = {
    object: 'Application',
    events: [{
      name: 'intake.application.submitted',
      transition: { from: 'submitted', to: 'under_review' },
      steps: [{ set: { field: 'reviewedAt', value: '$now' } }]
    }]
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries);
  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    const app = findById('applications', APP_ID);
    assert.strictEqual(app.status, 'under_review');
    assert.ok(app.reviewedAt, 'reviewedAt was set');
    done();
  });
});

test('machine onEvent — skipped when resource not found', (t, done) => {
  clearAll('applications');

  const machine = {
    object: 'Application',
    events: [{
      name: 'intake.application.submitted',
      transition: { from: 'submitted', to: 'under_review' },
      steps: []
    }],
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries);

  // No crash when subject doesn't exist
  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.intake.application.submitted',
    'nonexistent-id'
  ));

  setImmediate(() => done());
});

test('machine onEvent — skipped when resource in wrong from state', (t, done) => {
  clearAll('applications');
  const APP_ID = 'app-wrong-state';
  insertResource('applications', { id: APP_ID, status: 'under_review' });

  const machine = {
    object: 'Application',
    events: [{
      name: 'intake.application.submitted',
      transition: { from: 'submitted', to: 'under_review' },
      steps: [{ set: { field: 'flag', value: 'set' } }]
    }],
  };

  const smEntries = [{
    domain: 'intake',
    machine,
    stateMachine: { domain: 'intake', context: null, rules: [], guards: [] }
  }];

  registerEventSubscriptions(smEntries);
  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    const app = findById('applications', APP_ID);
    assert.strictEqual(app.status, 'under_review');
    assert.strictEqual(app.flag, undefined);
    done();
  });
});
