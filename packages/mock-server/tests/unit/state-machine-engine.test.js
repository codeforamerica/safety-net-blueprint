/**
 * Unit tests for the state machine engine
 * Tests guard evaluation, transition lookup, value resolution, and effect application
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  resolveValue,
  evaluateGuard,
  evaluateGuards,
  findTransition,
  applySetEffect,
  applyEffects
} from '../../src/state-machine-engine.js';

// =============================================================================
// resolveValue
// =============================================================================

test('resolveValue — literal string', () => {
  assert.strictEqual(resolveValue('hello', {}), 'hello');
});

test('resolveValue — literal number', () => {
  assert.strictEqual(resolveValue(42, {}), 42);
});

test('resolveValue — null returns null', () => {
  assert.strictEqual(resolveValue(null, {}), null);
});

test('resolveValue — undefined returns null', () => {
  assert.strictEqual(resolveValue(undefined, {}), null);
});

test('resolveValue — $caller.id resolves from context', () => {
  const context = { caller: { id: 'worker-1' } };
  assert.strictEqual(resolveValue('$caller.id', context), 'worker-1');
});

test('resolveValue — $caller.name resolves from context', () => {
  const context = { caller: { id: 'worker-1', name: 'Alice' } };
  assert.strictEqual(resolveValue('$caller.name', context), 'Alice');
});

test('resolveValue — $caller.missing returns null', () => {
  const context = { caller: { id: 'worker-1' } };
  assert.strictEqual(resolveValue('$caller.missing', context), null);
});

test('resolveValue — $caller.id with no caller returns null', () => {
  assert.strictEqual(resolveValue('$caller.id', {}), null);
});

// =============================================================================
// evaluateGuard — is_null
// =============================================================================

test('evaluateGuard — is_null passes when field is null', () => {
  const guard = { field: 'assignedToId', operator: 'is_null' };
  const result = evaluateGuard(guard, { assignedToId: null }, {});
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.reason, null);
});

test('evaluateGuard — is_null passes when field is undefined', () => {
  const guard = { field: 'assignedToId', operator: 'is_null' };
  const result = evaluateGuard(guard, {}, {});
  assert.strictEqual(result.pass, true);
});

test('evaluateGuard — is_null fails when field has value', () => {
  const guard = { field: 'assignedToId', operator: 'is_null' };
  const result = evaluateGuard(guard, { assignedToId: 'worker-1' }, {});
  assert.strictEqual(result.pass, false);
  assert.ok(result.reason.includes('assignedToId'));
});

// =============================================================================
// evaluateGuard — equals
// =============================================================================

test('evaluateGuard — equals passes with matching literal', () => {
  const guard = { field: 'status', operator: 'equals', value: 'active' };
  const result = evaluateGuard(guard, { status: 'active' }, {});
  assert.strictEqual(result.pass, true);
});

test('evaluateGuard — equals fails with non-matching literal', () => {
  const guard = { field: 'status', operator: 'equals', value: 'active' };
  const result = evaluateGuard(guard, { status: 'inactive' }, {});
  assert.strictEqual(result.pass, false);
});

test('evaluateGuard — equals resolves $caller.id', () => {
  const guard = { field: 'assignedToId', operator: 'equals', value: '$caller.id' };
  const context = { caller: { id: 'worker-1' } };
  const result = evaluateGuard(guard, { assignedToId: 'worker-1' }, context);
  assert.strictEqual(result.pass, true);
});

test('evaluateGuard — equals with $caller.id fails when different', () => {
  const guard = { field: 'assignedToId', operator: 'equals', value: '$caller.id' };
  const context = { caller: { id: 'worker-2' } };
  const result = evaluateGuard(guard, { assignedToId: 'worker-1' }, context);
  assert.strictEqual(result.pass, false);
});

// =============================================================================
// evaluateGuard — unknown operator
// =============================================================================

test('evaluateGuard — unknown operator passes (forward-compatible)', () => {
  const guard = { field: 'x', operator: 'future_op' };
  const result = evaluateGuard(guard, { x: 1 }, {});
  assert.strictEqual(result.pass, true);
});

// =============================================================================
// evaluateGuards
// =============================================================================

test('evaluateGuards — empty list passes', () => {
  const result = evaluateGuards([], {}, {}, {});
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.failedGuard, null);
});

test('evaluateGuards — null list passes', () => {
  const result = evaluateGuards(null, {}, {}, {});
  assert.strictEqual(result.pass, true);
});

test('evaluateGuards — all guards pass', () => {
  const guardsMap = {
    taskIsUnassigned: { field: 'assignedToId', operator: 'is_null' }
  };
  const resource = { assignedToId: null };
  const result = evaluateGuards(['taskIsUnassigned'], guardsMap, resource, {});
  assert.strictEqual(result.pass, true);
});

test('evaluateGuards — stops at first failure', () => {
  const guardsMap = {
    isNull: { field: 'assignedToId', operator: 'is_null' },
    isActive: { field: 'status', operator: 'equals', value: 'active' }
  };
  const resource = { assignedToId: 'worker-1', status: 'active' };
  const result = evaluateGuards(['isNull', 'isActive'], guardsMap, resource, {});
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.failedGuard, 'isNull');
});

test('evaluateGuards — skips unknown guard names', () => {
  const guardsMap = {};
  const result = evaluateGuards(['nonExistent'], guardsMap, {}, {});
  assert.strictEqual(result.pass, true);
});

// =============================================================================
// findTransition
// =============================================================================

const sampleStateMachine = {
  transitions: [
    { trigger: 'claim', from: 'pending', to: 'in_progress' },
    { trigger: 'complete', from: 'in_progress', to: 'completed' },
    { trigger: 'release', from: 'in_progress', to: 'pending' }
  ]
};

test('findTransition — finds matching transition', () => {
  const { transition, error } = findTransition(sampleStateMachine, 'claim', { status: 'pending' });
  assert.ok(transition);
  assert.strictEqual(transition.to, 'in_progress');
  assert.strictEqual(error, null);
});

test('findTransition — returns error for wrong status', () => {
  const { transition, error } = findTransition(sampleStateMachine, 'claim', { status: 'in_progress' });
  assert.strictEqual(transition, null);
  assert.ok(error.includes('Cannot claim'));
  assert.ok(error.includes('in_progress'));
});

test('findTransition — returns error for unknown trigger', () => {
  const { transition, error } = findTransition(sampleStateMachine, 'unknown', { status: 'pending' });
  assert.strictEqual(transition, null);
  assert.ok(error.includes('Unknown trigger'));
});

// =============================================================================
// applySetEffect
// =============================================================================

test('applySetEffect — sets literal value', () => {
  const resource = { status: 'pending' };
  applySetEffect({ field: 'status', value: 'active' }, resource, {});
  assert.strictEqual(resource.status, 'active');
});

test('applySetEffect — sets $caller.id', () => {
  const resource = { assignedToId: null };
  const context = { caller: { id: 'worker-1' } };
  applySetEffect({ field: 'assignedToId', value: '$caller.id' }, resource, context);
  assert.strictEqual(resource.assignedToId, 'worker-1');
});

test('applySetEffect — sets null', () => {
  const resource = { assignedToId: 'worker-1' };
  applySetEffect({ field: 'assignedToId', value: null }, resource, {});
  assert.strictEqual(resource.assignedToId, null);
});

// =============================================================================
// applyEffects
// =============================================================================

test('applyEffects — applies multiple set effects', () => {
  const resource = { assignedToId: null, priority: 'low' };
  const context = { caller: { id: 'worker-1' } };
  const effects = [
    { type: 'set', field: 'assignedToId', value: '$caller.id' },
    { type: 'set', field: 'priority', value: 'high' }
  ];
  applyEffects(effects, resource, context);
  assert.strictEqual(resource.assignedToId, 'worker-1');
  assert.strictEqual(resource.priority, 'high');
});

test('applyEffects — skips unknown effect types', () => {
  const resource = { status: 'pending' };
  const effects = [
    { type: 'unknown_type', field: 'status', value: 'active' }
  ];
  applyEffects(effects, resource, {});
  assert.strictEqual(resource.status, 'pending');
});

test('applyEffects — handles null effects gracefully', () => {
  const resource = { status: 'pending' };
  applyEffects(null, resource, {});
  assert.strictEqual(resource.status, 'pending');
});

test('applyEffects — handles empty effects array', () => {
  const resource = { status: 'pending' };
  applyEffects([], resource, {});
  assert.strictEqual(resource.status, 'pending');
});
