/**
 * Unit tests for executeTransition — operation.requestBody validation.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll, findById, findAll } from '../../src/database-manager.js';
import { executeTransition } from '../../src/state-machine-runner.js';

beforeEach(() => {
  clearAll('testresources');
  clearAll('events');
});

function makeStateMachine() {
  return {
    domain: 'test',
    context: null,
    rules: [],
    guards: [],
  };
}

function makeMachine(transitions) {
  return {
    object: 'Testresource',
    transitions,
    guards: [],
    rules: [],
  };
}

// =============================================================================
// operation.schema.request — schema validation
// =============================================================================

test('executeTransition — passes when request body matches schema', () => {
  insertResource('testresources', { id: 'res-1', status: 'open' });

  const machine = makeMachine([{
    id: 'close',
    transition: { from: 'open', to: 'closed' },
    guards: {},
    schema: {
      request: {
        type: 'object',
        required: ['reason'],
        properties: { reason: { type: 'string' } }
      }
    },
    steps: []
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-1',
    trigger: 'close',
    callerId: 'user-1',
    callerRoles: ['caseworker'],
    stateMachine: makeStateMachine(),
    machine,
    rules: [],
    requestBody: { reason: 'done' }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(findById('testresources', 'res-1').status, 'closed');
});

test('executeTransition — returns 422 when request body fails schema', () => {
  insertResource('testresources', { id: 'res-2', status: 'open' });

  const machine = makeMachine([{
    id: 'close',
    transition: { from: 'open', to: 'closed' },
    guards: {},
    schema: {
      request: {
        type: 'object',
        required: ['reason'],
        properties: { reason: { type: 'string' } }
      }
    },
    steps: []
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-2',
    trigger: 'close',
    callerId: 'user-1',
    callerRoles: ['caseworker'],
    stateMachine: makeStateMachine(),
    machine,
    rules: [],
    requestBody: {} // missing required 'reason'
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, 422);
  assert.ok(result.error.includes('validation'));
  assert.strictEqual(findById('testresources', 'res-2').status, 'open');
});

test('executeTransition — skips validation when no schema.request defined', () => {
  insertResource('testresources', { id: 'res-3', status: 'open' });

  const machine = makeMachine([{
    id: 'close',
    transition: { from: 'open', to: 'closed' },
    guards: {},
    steps: []
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-3',
    trigger: 'close',
    callerId: 'user-1',
    callerRoles: ['caseworker'],
    stateMachine: makeStateMachine(),
    machine,
    rules: [],
    requestBody: {}
  });

  assert.strictEqual(result.success, true);
});

// =============================================================================
// executeTransition — CEL condition guards (new format)
// =============================================================================

test('executeTransition — CEL condition guard passes, transition succeeds', () => {
  insertResource('testresources', { id: 'res-cel-1', status: 'pending', assignedToId: null });

  const machine = makeMachine([{
    id: 'claim',
    transition: { from: 'pending', to: 'in_progress' },
    guards: [{ actors: ['caseworker'], conditions: ['taskIsUnassigned'] }],
    steps: []
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-cel-1',
    trigger: 'claim',
    callerId: 'worker-1',
    callerRoles: ['caseworker'],
    stateMachine: { ...makeStateMachine(), guards: [{ id: 'taskIsUnassigned', condition: 'object.assignedToId == null' }] },
    machine,
    rules: []
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(findById('testresources', 'res-cel-1').status, 'in_progress');
});

test('executeTransition — CEL condition guard fails → 409, resource unchanged', () => {
  insertResource('testresources', { id: 'res-cel-2', status: 'pending', assignedToId: 'other-worker' });

  const machine = makeMachine([{
    id: 'claim',
    transition: { from: 'pending', to: 'in_progress' },
    guards: [{ actors: ['caseworker'], conditions: ['taskIsUnassigned'] }],
    steps: []
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-cel-2',
    trigger: 'claim',
    callerId: 'worker-1',
    callerRoles: ['caseworker'],
    stateMachine: { ...makeStateMachine(), guards: [{ id: 'taskIsUnassigned', condition: 'object.assignedToId == null' }] },
    machine,
    rules: []
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, 409);
  assert.ok(result.error.includes('taskIsUnassigned'));
  assert.strictEqual(findById('testresources', 'res-cel-2').status, 'pending');
});

test('executeTransition — caller.id CEL guard passes when IDs match', () => {
  insertResource('testresources', { id: 'res-cel-3', status: 'in_progress', assignedToId: 'worker-1' });

  const machine = makeMachine([{
    id: 'complete',
    transition: { from: 'in_progress', to: 'completed' },
    guards: [{ actors: ['caseworker'], conditions: ['callerIsAssignedWorker'] }],
    steps: []
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-cel-3',
    trigger: 'complete',
    callerId: 'worker-1',
    callerRoles: ['caseworker'],
    stateMachine: { ...makeStateMachine(), guards: [{ id: 'callerIsAssignedWorker', condition: 'object.assignedToId == caller.id' }] },
    machine,
    rules: []
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(findById('testresources', 'res-cel-3').status, 'completed');
});

test('executeTransition — caller.id CEL guard fails when different worker → 409', () => {
  insertResource('testresources', { id: 'res-cel-4', status: 'in_progress', assignedToId: 'worker-1' });

  const machine = makeMachine([{
    id: 'complete',
    transition: { from: 'in_progress', to: 'completed' },
    guards: [{ actors: ['caseworker'], conditions: ['callerIsAssignedWorker'] }],
    steps: []
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-cel-4',
    trigger: 'complete',
    callerId: 'worker-2',
    callerRoles: ['caseworker'],
    stateMachine: { ...makeStateMachine(), guards: [{ id: 'callerIsAssignedWorker', condition: 'object.assignedToId == caller.id' }] },
    machine,
    rules: []
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, 409);
  assert.strictEqual(findById('testresources', 'res-cel-4').status, 'in_progress');
});

// =============================================================================
// executeTransition — steps execution (new format)
// =============================================================================

test('executeTransition — set: step mutates field on transition', () => {
  insertResource('testresources', { id: 'res-steps-1', status: 'pending', assignedToId: null });

  const machine = makeMachine([{
    id: 'claim',
    transition: { from: 'pending', to: 'in_progress' },
    guards: [],
    steps: [{ set: { field: 'assignedToId', value: '$caller.id' } }]
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-steps-1',
    trigger: 'claim',
    callerId: 'worker-1',
    callerRoles: ['caseworker'],
    stateMachine: makeStateMachine(),
    machine,
    rules: []
  });

  assert.strictEqual(result.success, true);
  const updated = findById('testresources', 'res-steps-1');
  assert.strictEqual(updated.status, 'in_progress');
  assert.strictEqual(updated.assignedToId, 'worker-1');
});

test('executeTransition — emit: step stores event in database', () => {
  insertResource('testresources', { id: 'res-steps-2', status: 'pending' });

  const machine = makeMachine([{
    id: 'submit',
    transition: { from: 'pending', to: 'submitted' },
    guards: [],
    steps: [{ emit: { event: 'submitted', data: { resourceId: '$object.id' } } }]
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-steps-2',
    trigger: 'submit',
    callerId: 'user-1',
    callerRoles: ['caseworker'],
    stateMachine: makeStateMachine(),
    machine,
    rules: [],
    now: '2025-01-01T00:00:00Z'
  });

  assert.strictEqual(result.success, true);
  const { items: events } = findAll('events', {});
  const emitted = events.find(e => e.type && e.type.endsWith('.testresource.submitted'));
  assert.ok(emitted, 'submitted event should be stored in events collection');
  assert.strictEqual(emitted.subject, 'res-steps-2');
  assert.strictEqual(emitted.data.resourceId, 'res-steps-2');
});

test('executeTransition — if: step runs correct branch based on resource state', () => {
  insertResource('testresources', { id: 'res-steps-3', status: 'pending', isExpedited: false });

  const machine = makeMachine([{
    id: 'route',
    transition: { from: 'pending', to: 'routed' },
    guards: [],
    steps: [{
      if: '$object.isExpedited == true',
      then: [{ set: { field: 'priority', value: 'high' } }],
      else: [{ set: { field: 'priority', value: 'normal' } }]
    }]
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-steps-3',
    trigger: 'route',
    callerId: 'system',
    callerRoles: ['system'],
    stateMachine: makeStateMachine(),
    machine,
    rules: []
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(findById('testresources', 'res-steps-3').priority, 'normal');
});

test('executeTransition — if: true branch runs when condition met', () => {
  insertResource('testresources', { id: 'res-steps-4', status: 'pending', isExpedited: true });

  const machine = makeMachine([{
    id: 'route',
    transition: { from: 'pending', to: 'routed' },
    guards: [],
    steps: [{
      if: '$object.isExpedited == true',
      then: [{ set: { field: 'priority', value: 'high' } }],
      else: [{ set: { field: 'priority', value: 'normal' } }]
    }]
  }]);

  const result = executeTransition({
    resourceName: 'testresources',
    resourceId: 'res-steps-4',
    trigger: 'route',
    callerId: 'system',
    callerRoles: ['system'],
    stateMachine: makeStateMachine(),
    machine,
    rules: []
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(findById('testresources', 'res-steps-4').priority, 'high');
});
