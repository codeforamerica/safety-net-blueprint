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
  applyCreateEffect,
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

test('resolveValue — $now returns context.now when provided', () => {
  const context = { now: '2025-01-15T10:00:00.000Z' };
  assert.strictEqual(resolveValue('$now', context), '2025-01-15T10:00:00.000Z');
});

test('resolveValue — $now falls back to current time when no context.now', () => {
  const before = new Date().toISOString();
  const result = resolveValue('$now', {});
  const after = new Date().toISOString();
  assert.ok(result >= before && result <= after);
});

test('resolveValue — $object.status resolves from context', () => {
  const context = { object: { id: 'task-1', status: 'pending' } };
  assert.strictEqual(resolveValue('$object.status', context), 'pending');
});

test('resolveValue — $object.id resolves from context', () => {
  const context = { object: { id: 'task-1', status: 'pending' } };
  assert.strictEqual(resolveValue('$object.id', context), 'task-1');
});

test('resolveValue — $object.missing returns null', () => {
  const context = { object: { id: 'task-1' } };
  assert.strictEqual(resolveValue('$object.missing', context), null);
});

test('resolveValue — $object.field with no context.object returns null', () => {
  assert.strictEqual(resolveValue('$object.id', {}), null);
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
// evaluateGuard — contains_any
// =============================================================================

test('evaluateGuard — contains_any passes when array contains one match', () => {
  const guard = { field: '$caller.roles', operator: 'contains_any', value: ['supervisor', 'state_admin'] };
  const context = { caller: { roles: ['supervisor'] } };
  const result = evaluateGuard(guard, {}, context);
  assert.strictEqual(result.pass, true);
});

test('evaluateGuard — contains_any fails when array has no match', () => {
  const guard = { field: '$caller.roles', operator: 'contains_any', value: ['supervisor', 'state_admin'] };
  const context = { caller: { roles: ['caseworker'] } };
  const result = evaluateGuard(guard, {}, context);
  assert.strictEqual(result.pass, false);
});

test('evaluateGuard — contains_any passes when multiple roles and one matches', () => {
  const guard = { field: '$caller.roles', operator: 'contains_any', value: ['supervisor'] };
  const context = { caller: { roles: ['caseworker', 'supervisor'] } };
  const result = evaluateGuard(guard, {}, context);
  assert.strictEqual(result.pass, true);
});

test('evaluateGuard — contains_any fails when caller has no roles', () => {
  const guard = { field: '$caller.roles', operator: 'contains_any', value: ['supervisor'] };
  const context = { caller: { roles: [] } };
  const result = evaluateGuard(guard, {}, context);
  assert.strictEqual(result.pass, false);
});

// =============================================================================
// evaluateGuard — contains_all
// =============================================================================

test('evaluateGuard — contains_all passes when array contains all values', () => {
  const guard = { field: '$caller.roles', operator: 'contains_all', value: ['caseworker', 'supervisor'] };
  const context = { caller: { roles: ['caseworker', 'supervisor'] } };
  const result = evaluateGuard(guard, {}, context);
  assert.strictEqual(result.pass, true);
});

test('evaluateGuard — contains_all fails when missing one value', () => {
  const guard = { field: '$caller.roles', operator: 'contains_all', value: ['caseworker', 'supervisor'] };
  const context = { caller: { roles: ['caseworker'] } };
  const result = evaluateGuard(guard, {}, context);
  assert.strictEqual(result.pass, false);
});

test('evaluateGuard — contains_all passes for single-value requirement', () => {
  const guard = { field: '$caller.roles', operator: 'contains_all', value: ['supervisor'] };
  const context = { caller: { roles: ['caseworker', 'supervisor'] } };
  const result = evaluateGuard(guard, {}, context);
  assert.strictEqual(result.pass, true);
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

test('evaluateGuards — any composition passes when at least one guard passes', () => {
  const guardsMap = {
    callerIsAssignedWorker: { field: 'assignedToId', operator: 'equals', value: '$caller.id' },
    callerIsSupervisor: { field: '$caller.role', operator: 'equals', value: 'supervisor' },
  };
  const resource = { assignedToId: 'worker-1' };
  const context = { caller: { id: 'worker-1', role: 'worker' } };
  const result = evaluateGuards([{ any: ['callerIsAssignedWorker', 'callerIsSupervisor'] }], guardsMap, resource, context);
  assert.strictEqual(result.pass, true);
});

test('evaluateGuards — any composition fails when no guards pass', () => {
  const guardsMap = {
    callerIsAssignedWorker: { field: 'assignedToId', operator: 'equals', value: '$caller.id' },
    callerIsSupervisor: { field: '$caller.role', operator: 'equals', value: 'supervisor' },
  };
  const resource = { assignedToId: 'worker-1' };
  const context = { caller: { id: 'worker-2', role: 'worker' } };
  const result = evaluateGuards([{ any: ['callerIsAssignedWorker', 'callerIsSupervisor'] }], guardsMap, resource, context);
  assert.strictEqual(result.pass, false);
});

test('evaluateGuards — all composition passes when every guard passes', () => {
  const guardsMap = {
    isAssigned: { field: 'assignedToId', operator: 'is_not_null' },
    isActive: { field: 'status', operator: 'equals', value: 'in_progress' },
  };
  const resource = { assignedToId: 'worker-1', status: 'in_progress' };
  const result = evaluateGuards([{ all: ['isAssigned', 'isActive'] }], guardsMap, resource, {});
  assert.strictEqual(result.pass, true);
});

test('evaluateGuards — all composition fails when any guard fails', () => {
  const guardsMap = {
    isUnassigned: { field: 'assignedToId', operator: 'is_null' },
    isActive: { field: 'status', operator: 'equals', value: 'in_progress' },
  };
  // isUnassigned fails because assignedToId is set
  const resource = { assignedToId: 'worker-1', status: 'in_progress' };
  const result = evaluateGuards([{ all: ['isUnassigned', 'isActive'] }], guardsMap, resource, {});
  assert.strictEqual(result.pass, false);
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

test('findTransition — matches when from is an array and status is in it', () => {
  const sm = {
    transitions: [
      { trigger: 'cancel', from: ['pending', 'in_progress', 'escalated'], to: 'cancelled', guards: [], effects: [] }
    ]
  };
  const { transition, error } = findTransition(sm, 'cancel', { status: 'in_progress' });
  assert.ok(transition);
  assert.strictEqual(error, null);
});

test('findTransition — returns error when from is an array and status is not in it', () => {
  const sm = {
    transitions: [
      { trigger: 'cancel', from: ['pending', 'in_progress', 'escalated'], to: 'cancelled', guards: [], effects: [] }
    ]
  };
  const { transition, error } = findTransition(sm, 'cancel', { status: 'completed' });
  assert.strictEqual(transition, null);
  assert.ok(error);
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
// applyCreateEffect
// =============================================================================

test('applyCreateEffect — resolves all field references', () => {
  const effect = {
    type: 'create',
    entity: 'task-audit-events',
    fields: {
      taskId: '$object.id',
      eventType: 'assigned',
      previousValue: '$object.status',
      newValue: 'in_progress',
      performedById: '$caller.id',
      occurredAt: '$now'
    }
  };
  const context = {
    caller: { id: 'worker-1' },
    object: { id: 'task-99', status: 'pending' },
    now: '2025-01-15T10:00:00.000Z'
  };
  const result = applyCreateEffect(effect, context);
  assert.strictEqual(result.entity, 'task-audit-events');
  assert.deepStrictEqual(result.data, {
    taskId: 'task-99',
    eventType: 'assigned',
    previousValue: 'pending',
    newValue: 'in_progress',
    performedById: 'worker-1',
    occurredAt: '2025-01-15T10:00:00.000Z'
  });
});

test('applyCreateEffect — handles null fields gracefully', () => {
  const effect = {
    type: 'create',
    entity: 'audit',
    fields: { taskId: '$object.id', note: null }
  };
  const context = { object: { id: 'task-1' } };
  const result = applyCreateEffect(effect, context);
  assert.strictEqual(result.data.taskId, 'task-1');
  assert.strictEqual(result.data.note, null);
});

test('applyCreateEffect — handles missing fields map', () => {
  const effect = { type: 'create', entity: 'audit' };
  const result = applyCreateEffect(effect, {});
  assert.strictEqual(result.entity, 'audit');
  assert.deepStrictEqual(result.data, {});
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
  const { pendingCreates } = applyEffects(effects, resource, context);
  assert.strictEqual(resource.assignedToId, 'worker-1');
  assert.strictEqual(resource.priority, 'high');
  assert.deepStrictEqual(pendingCreates, []);
});

test('applyEffects — returns pendingCreates for create effects', () => {
  const resource = { id: 'task-1', status: 'pending' };
  const context = {
    caller: { id: 'worker-1' },
    object: { id: 'task-1', status: 'pending' },
    now: '2025-01-15T10:00:00.000Z'
  };
  const effects = [
    { type: 'set', field: 'assignedToId', value: '$caller.id' },
    {
      type: 'create',
      entity: 'task-audit-events',
      fields: { taskId: '$object.id', eventType: 'assigned' }
    }
  ];
  const { pendingCreates } = applyEffects(effects, resource, context);
  assert.strictEqual(resource.assignedToId, 'worker-1');
  assert.strictEqual(pendingCreates.length, 1);
  assert.strictEqual(pendingCreates[0].entity, 'task-audit-events');
  assert.strictEqual(pendingCreates[0].data.taskId, 'task-1');
  assert.strictEqual(pendingCreates[0].data.eventType, 'assigned');
});

test('applyEffects — skips unknown effect types', () => {
  const resource = { status: 'pending' };
  const effects = [
    { type: 'unknown_type', field: 'status', value: 'active' }
  ];
  const { pendingCreates } = applyEffects(effects, resource, {});
  assert.strictEqual(resource.status, 'pending');
  assert.deepStrictEqual(pendingCreates, []);
});

test('applyEffects — handles null effects gracefully', () => {
  const resource = { status: 'pending' };
  const { pendingCreates } = applyEffects(null, resource, {});
  assert.strictEqual(resource.status, 'pending');
  assert.deepStrictEqual(pendingCreates, []);
});

test('applyEffects — handles empty effects array', () => {
  const resource = { status: 'pending' };
  const { pendingCreates, pendingRuleEvaluations } = applyEffects([], resource, {});
  assert.strictEqual(resource.status, 'pending');
  assert.deepStrictEqual(pendingCreates, []);
  assert.deepStrictEqual(pendingRuleEvaluations, []);
});

// =============================================================================
// applyEffects — evaluate-rules
// =============================================================================

test('applyEffects — collects evaluate-rules in pendingRuleEvaluations', () => {
  const resource = { status: 'pending' };
  const effects = [
    { type: 'evaluate-rules', ruleType: 'assignment' },
    { type: 'evaluate-rules', ruleType: 'priority' }
  ];
  const { pendingCreates, pendingRuleEvaluations } = applyEffects(effects, resource, {});
  assert.deepStrictEqual(pendingCreates, []);
  assert.deepStrictEqual(pendingRuleEvaluations, [
    { ruleType: 'assignment' },
    { ruleType: 'priority' }
  ]);
});

test('applyEffects — mixes set, create, and evaluate-rules effects', () => {
  const resource = { assignedToId: null };
  const context = { caller: { id: 'worker-1' }, object: { id: 'task-1' }, now: '2025-01-15T10:00:00.000Z' };
  const effects = [
    { type: 'set', field: 'assignedToId', value: '$caller.id' },
    { type: 'create', entity: 'audit', fields: { taskId: '$object.id' } },
    { type: 'evaluate-rules', ruleType: 'assignment' }
  ];
  const { pendingCreates, pendingRuleEvaluations } = applyEffects(effects, resource, context);
  assert.strictEqual(resource.assignedToId, 'worker-1');
  assert.strictEqual(pendingCreates.length, 1);
  assert.deepStrictEqual(pendingRuleEvaluations, [{ ruleType: 'assignment' }]);
});

test('applyEffects — returns empty pendingRuleEvaluations when no evaluate-rules effects', () => {
  const resource = { status: 'pending' };
  const effects = [
    { type: 'set', field: 'status', value: 'active' }
  ];
  const { pendingRuleEvaluations } = applyEffects(effects, resource, {});
  assert.deepStrictEqual(pendingRuleEvaluations, []);
});
