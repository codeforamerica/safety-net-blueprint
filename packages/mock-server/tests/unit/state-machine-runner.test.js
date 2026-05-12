/**
 * Unit tests for executeTransition — operation.requestBody validation.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll, findById } from '../../src/database-manager.js';
import { executeTransition } from '../../src/state-machine-runner.js';

beforeEach(() => {
  clearAll('testresources');
});

function makeStateMachine() {
  return {
    domain: 'test',
    context: null,
    rules: [],
    guards: [],
  };
}

function makeMachine(operations) {
  return {
    object: 'Testresource',
    operations,
    guards: [],
    rules: [],
  };
}

// =============================================================================
// operation.requestBody — schema validation
// =============================================================================

test('executeTransition — passes when requestBody matches schema', () => {
  insertResource('testresources', { id: 'res-1', status: 'open' });

  const machine = makeMachine([{
    name: 'close',
    transition: { from: 'open', to: 'closed' },
    guards: {},
    requestBody: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: { type: 'string' }
      }
    },
    then: []
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

test('executeTransition — returns 422 when requestBody fails schema', () => {
  insertResource('testresources', { id: 'res-2', status: 'open' });

  const machine = makeMachine([{
    name: 'close',
    transition: { from: 'open', to: 'closed' },
    guards: {},
    requestBody: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: { type: 'string' }
      }
    },
    then: []
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
  // Resource unchanged
  assert.strictEqual(findById('testresources', 'res-2').status, 'open');
});

test('executeTransition — skips validation when no requestBody schema defined', () => {
  insertResource('testresources', { id: 'res-3', status: 'open' });

  const machine = makeMachine([{
    name: 'close',
    transition: { from: 'open', to: 'closed' },
    guards: {},
    then: []
    // no requestBody
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
