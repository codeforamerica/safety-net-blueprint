/**
 * Unit tests for the timer stub engine — onTimer trigger behavior.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  registerTimerStub,
  listTimerStubs,
  removeTimerStub,
  clearTimerStubs,
  fireNextTimer,
  fireWithNow
} from '../../src/timer-stub-engine.js';
import { insertResource, clearAll, findById } from '../../src/database-manager.js';

beforeEach(() => {
  clearTimerStubs();
  clearAll('timertasks');
});

// Minimal state machine entry for tests
function makeSmEntry(onTimer, guards = []) {
  return [{
    domain: 'test',
    machine: {
      object: 'Timertask',
      triggers: { onTimer },
      guards,
    },
    stateMachine: { domain: 'test', rules: [], guards }
  }];
}

// =============================================================================
// registerTimerStub / listTimerStubs / removeTimerStub / clearTimerStubs
// =============================================================================

test('registerTimerStub — assigns an id and stores the stub', () => {
  const stub = registerTimerStub({ now: '2025-06-01T00:00:00Z' });
  assert.ok(stub.id.startsWith('timer-'));
  assert.strictEqual(stub.now, '2025-06-01T00:00:00Z');
  assert.strictEqual(listTimerStubs().length, 1);
});

test('registerTimerStub — accepts relative offset +72h', () => {
  const stub = registerTimerStub({ now: '+72h' });
  assert.ok(stub.id.startsWith('timer-'));
  assert.strictEqual(stub.now, '+72h');
});

test('registerTimerStub — accepts relative offset +7d', () => {
  const stub = registerTimerStub({ now: '+7d' });
  assert.strictEqual(stub.now, '+7d');
});

test('registerTimerStub — accepts negative offset -48h', () => {
  const stub = registerTimerStub({ now: '-48h' });
  assert.strictEqual(stub.now, '-48h');
});

test('registerTimerStub — rejects missing now', () => {
  assert.throws(() => registerTimerStub({}), /requires "now"/);
});

test('registerTimerStub — rejects invalid value', () => {
  assert.throws(() => registerTimerStub({ now: 'not-a-date' }), /valid ISO/);
});

test('removeTimerStub — removes by id', () => {
  const stub = registerTimerStub({ now: '2025-06-01T00:00:00Z' });
  assert.strictEqual(removeTimerStub(stub.id), true);
  assert.strictEqual(listTimerStubs().length, 0);
});

test('removeTimerStub — returns false for unknown id', () => {
  assert.strictEqual(removeTimerStub('nonexistent'), false);
});

test('clearTimerStubs — empties the queue', () => {
  registerTimerStub({ now: '2025-06-01T00:00:00Z' });
  registerTimerStub({ now: '2025-06-02T00:00:00Z' });
  clearTimerStubs();
  assert.strictEqual(listTimerStubs().length, 0);
});

// =============================================================================
// fireNextTimer — no stubs
// =============================================================================

test('fireNextTimer — returns null when no stubs queued', () => {
  const result = fireNextTimer([]);
  assert.strictEqual(result, null);
});

// =============================================================================
// fireWithNow — inline fire without queue
// =============================================================================

test('fireWithNow — fires with absolute ISO timestamp', () => {
  insertResource('timertasks', {
    id: 'task-inline-1',
    status: 'open',
    createdAt: '2025-01-01T00:00:00Z'
  });

  const smEntries = makeSmEntry([{
    after: '24h',
    relativeTo: 'createdAt',
    transition: { from: 'open', to: 'expired' },
    then: []
  }]);

  const result = fireWithNow('2025-01-02T12:00:00Z', smEntries);

  assert.ok(result.fired);
  assert.strictEqual(result.transitioned.length, 1);
  assert.strictEqual(findById('timertasks', 'task-inline-1').status, 'expired');
});

test('fireWithNow — fires with relative offset that covers the deadline', () => {
  // Resource created "now"; deadline is createdAt + 72h.
  // fireWithNow("+72h") sets now = current + 72h, so deadline is met.
  insertResource('timertasks', {
    id: 'task-inline-2',
    status: 'open',
    createdAt: new Date().toISOString()
  });

  const smEntries = makeSmEntry([{
    after: '72h',
    relativeTo: 'createdAt',
    transition: { from: 'open', to: 'expired' },
    then: []
  }]);

  const result = fireWithNow('+72h', smEntries);

  assert.ok(result.fired);
  assert.strictEqual(result.transitioned.length, 1);
  assert.strictEqual(findById('timertasks', 'task-inline-2').status, 'expired');
});

test('fireWithNow — does not fire with offset shorter than deadline', () => {
  insertResource('timertasks', {
    id: 'task-inline-3',
    status: 'open',
    createdAt: new Date().toISOString()
  });

  const smEntries = makeSmEntry([{
    after: '72h',
    relativeTo: 'createdAt',
    transition: { from: 'open', to: 'expired' },
    then: []
  }]);

  const result = fireWithNow('+24h', smEntries);

  assert.strictEqual(result.transitioned.length, 0);
  assert.strictEqual(findById('timertasks', 'task-inline-3').status, 'open');
});

test('fireWithNow — does not consume from the queue', () => {
  registerTimerStub({ now: '2025-06-01T00:00:00Z' });
  fireWithNow('2025-01-01T00:00:00Z', []);
  assert.strictEqual(listTimerStubs().length, 1);
});

// =============================================================================
// fireNextTimer — transitions resource when deadline has passed
// =============================================================================

test('fireNextTimer — transitions resource status when deadline has passed', () => {
  insertResource('timertasks', {
    id: 'task-1',
    status: 'open',
    createdAt: '2025-01-01T00:00:00Z'
  });

  const smEntries = makeSmEntry([{
    after: '24h',
    relativeTo: 'createdAt',
    transition: { from: 'open', to: 'expired' },
    then: []
  }]);

  registerTimerStub({ now: '2025-01-02T12:00:00Z' }); // 36h after createdAt
  const result = fireNextTimer(smEntries);

  assert.ok(result.fired);
  assert.strictEqual(result.transitioned.length, 1);
  assert.strictEqual(result.transitioned[0].to, 'expired');

  const saved = findById('timertasks', 'task-1');
  assert.strictEqual(saved.status, 'expired');
});

test('fireNextTimer — resolves relative offset stub at fire time', () => {
  insertResource('timertasks', {
    id: 'task-rel-1',
    status: 'open',
    createdAt: new Date().toISOString()
  });

  const smEntries = makeSmEntry([{
    after: '24h',
    relativeTo: 'createdAt',
    transition: { from: 'open', to: 'expired' },
    then: []
  }]);

  registerTimerStub({ now: '+24h' });
  const result = fireNextTimer(smEntries);

  assert.ok(result.fired);
  assert.strictEqual(result.transitioned.length, 1);
});

test('fireNextTimer — does not transition when deadline has not passed', () => {
  insertResource('timertasks', {
    id: 'task-2',
    status: 'open',
    createdAt: '2025-01-01T00:00:00Z'
  });

  const smEntries = makeSmEntry([{
    after: '72h',
    relativeTo: 'createdAt',
    transition: { from: 'open', to: 'expired' },
    then: []
  }]);

  registerTimerStub({ now: '2025-01-01T12:00:00Z' }); // only 12h after createdAt
  const result = fireNextTimer(smEntries);

  assert.ok(result.fired);
  assert.strictEqual(result.transitioned.length, 0);

  const saved = findById('timertasks', 'task-2');
  assert.strictEqual(saved.status, 'open');
});

// =============================================================================
// fireNextTimer — from constraint respected
// =============================================================================

test('fireNextTimer — skips resource in wrong status (from constraint)', () => {
  insertResource('timertasks', {
    id: 'task-3',
    status: 'closed',
    createdAt: '2025-01-01T00:00:00Z'
  });

  const smEntries = makeSmEntry([{
    after: '24h',
    relativeTo: 'createdAt',
    transition: { from: 'open', to: 'expired' },
    then: []
  }]);

  registerTimerStub({ now: '2025-01-02T12:00:00Z' });
  const result = fireNextTimer(smEntries);

  assert.strictEqual(result.transitioned.length, 0);
  const saved = findById('timertasks', 'task-3');
  assert.strictEqual(saved.status, 'closed');
});

// =============================================================================
// fireNextTimer — guards evaluated
// =============================================================================

test('fireNextTimer — fires when guards pass', () => {
  insertResource('timertasks', {
    id: 'task-guard-pass',
    status: 'open',
    isEligible: true,
    createdAt: '2025-01-01T00:00:00Z'
  });

  const smEntries = makeSmEntry(
    [{
      after: '24h',
      relativeTo: 'createdAt',
      transition: { from: 'open', to: 'expired' },
      guards: { conditions: ['isEligible'] },
      then: []
    }],
    [{ id: 'isEligible', field: 'isEligible', operator: 'equals', value: true }]
  );

  registerTimerStub({ now: '2025-01-02T12:00:00Z' });
  const result = fireNextTimer(smEntries);

  assert.strictEqual(result.transitioned.length, 1);
  assert.strictEqual(findById('timertasks', 'task-guard-pass').status, 'expired');
});

test('fireNextTimer — skips resource when guards fail', () => {
  insertResource('timertasks', {
    id: 'task-guard-fail',
    status: 'open',
    isEligible: false,
    createdAt: '2025-01-01T00:00:00Z'
  });

  const smEntries = makeSmEntry(
    [{
      after: '24h',
      relativeTo: 'createdAt',
      transition: { from: 'open', to: 'expired' },
      guards: { conditions: ['isEligible'] },
      then: []
    }],
    [{ id: 'isEligible', field: 'isEligible', operator: 'equals', value: true }]
  );

  registerTimerStub({ now: '2025-01-02T12:00:00Z' });
  const result = fireNextTimer(smEntries);

  assert.strictEqual(result.transitioned.length, 0);
  assert.strictEqual(findById('timertasks', 'task-guard-fail').status, 'open');
});

// =============================================================================
// fireNextTimer — then: steps executed
// =============================================================================

test('fireNextTimer — then: set step runs on transition', () => {
  insertResource('timertasks', {
    id: 'task-4',
    status: 'open',
    priority: 'normal',
    createdAt: '2025-01-01T00:00:00Z'
  });

  const smEntries = makeSmEntry([{
    after: '24h',
    relativeTo: 'createdAt',
    transition: { from: 'open', to: 'expired' },
    then: [{ set: { field: 'priority', value: 'overdue' } }]
  }]);

  registerTimerStub({ now: '2025-01-02T12:00:00Z' });
  fireNextTimer(smEntries);

  const saved = findById('timertasks', 'task-4');
  assert.strictEqual(saved.status, 'expired');
  assert.strictEqual(saved.priority, 'overdue');
});

// =============================================================================
// fireNextTimer — FIFO order
// =============================================================================

test('fireNextTimer — processes stubs in FIFO order', () => {
  insertResource('timertasks', {
    id: 'task-5',
    status: 'open',
    createdAt: '2025-01-01T00:00:00Z'
  });

  const smEntries = makeSmEntry([{
    after: '24h',
    relativeTo: 'createdAt',
    transition: { from: 'open', to: 'expired' },
    then: []
  }]);

  registerTimerStub({ now: '2025-01-01T06:00:00Z' }); // too early — first
  registerTimerStub({ now: '2025-01-03T00:00:00Z' }); // past deadline — second

  // First fire: too early, no transition
  const first = fireNextTimer(smEntries);
  assert.strictEqual(first.transitioned.length, 0);

  // Second fire: past deadline, transitions
  const second = fireNextTimer(smEntries);
  assert.strictEqual(second.transitioned.length, 1);
});
