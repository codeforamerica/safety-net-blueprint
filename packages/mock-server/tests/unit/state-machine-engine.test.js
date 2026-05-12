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
  applyEffects,
  applySteps
} from '../../src/state-machine-engine.js';
import { insertResource, clearAll } from '../../src/database-manager.js';

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

test('findTransition — finds transition with no to field (in-place action)', () => {
  const sm = {
    transitions: [
      { trigger: 'assign', from: ['pending', 'in_progress'], guards: [], effects: [] }
    ]
  };
  const { transition, error } = findTransition(sm, 'assign', { status: 'pending' });
  assert.ok(transition);
  assert.strictEqual(transition.to, undefined);
  assert.strictEqual(error, null);
});

test('findTransition — in-place action works from any listed state', () => {
  const sm = {
    transitions: [
      { trigger: 'assign', from: ['pending', 'in_progress', 'escalated'], guards: [], effects: [] }
    ]
  };
  for (const status of ['pending', 'in_progress', 'escalated']) {
    const { transition, error } = findTransition(sm, 'assign', { status });
    assert.ok(transition, `expected transition for status=${status}`);
    assert.strictEqual(error, null);
  }
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

// =============================================================================
// evaluateGuard — is_not_null
// =============================================================================

test('evaluateGuard — is_not_null passes when field has a value', () => {
  const guard = { field: 'assignedToId', operator: 'is_not_null' };
  const result = evaluateGuard(guard, { assignedToId: 'worker-1' }, {});
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.reason, null);
});

test('evaluateGuard — is_not_null fails when field is null', () => {
  const guard = { field: 'assignedToId', operator: 'is_not_null' };
  const result = evaluateGuard(guard, { assignedToId: null }, {});
  assert.strictEqual(result.pass, false);
  assert.ok(result.reason.includes('assignedToId'));
});

test('evaluateGuard — is_not_null fails when field is undefined', () => {
  const guard = { field: 'assignedToId', operator: 'is_not_null' };
  const result = evaluateGuard(guard, {}, {});
  assert.strictEqual(result.pass, false);
});

// =============================================================================
// evaluateGuard — not_equals
// =============================================================================

test('evaluateGuard — not_equals passes when values differ', () => {
  const guard = { field: 'status', operator: 'not_equals', value: 'cancelled' };
  const result = evaluateGuard(guard, { status: 'pending' }, {});
  assert.strictEqual(result.pass, true);
});

test('evaluateGuard — not_equals fails when values are equal', () => {
  const guard = { field: 'status', operator: 'not_equals', value: 'cancelled' };
  const result = evaluateGuard(guard, { status: 'cancelled' }, {});
  assert.strictEqual(result.pass, false);
  assert.ok(result.reason.includes('status'));
});

test('evaluateGuard — not_equals resolves $caller.id for comparison', () => {
  const guard = { field: 'assignedToId', operator: 'not_equals', value: '$caller.id' };
  const context = { caller: { id: 'worker-2' } };
  const result = evaluateGuard(guard, { assignedToId: 'worker-1' }, context);
  assert.strictEqual(result.pass, true);
});

// =============================================================================
// resolveValue — additional expressions
// =============================================================================

test('resolveValue — $request.field resolves from context', () => {
  const context = { request: { reason: 'urgent' } };
  assert.strictEqual(resolveValue('$request.reason', context), 'urgent');
});

test('resolveValue — $request.field returns null when missing', () => {
  assert.strictEqual(resolveValue('$request.missing', { request: {} }), null);
});

test('resolveValue — $this.field resolves from context.this', () => {
  const context = { this: { subject: 'app-123', data: { program: 'snap' } } };
  assert.strictEqual(resolveValue('$this.subject', context), 'app-123');
});

test('resolveValue — $this.nested.field resolves dot path', () => {
  const context = { this: { data: { program: 'snap' } } };
  assert.strictEqual(resolveValue('$this.data.program', context), 'snap');
});

test('resolveValue — $alias.field resolves from context.entities', () => {
  const context = { entities: { application: { id: 'app-1', status: 'submitted' } } };
  assert.strictEqual(resolveValue('$application.status', context), 'submitted');
});

test('resolveValue — bare $alias resolves whole entity from context.entities', () => {
  const entity = { id: 'q-1', name: 'snap-intake' };
  const context = { entities: { snapQueue: entity } };
  assert.deepStrictEqual(resolveValue('$snapQueue', context), entity);
});

test('resolveValue — $alias.field returns null when alias not in entities', () => {
  assert.strictEqual(resolveValue('$unknown.field', { entities: {} }), null);
});

// =============================================================================
// applySteps — set
// =============================================================================

test('applySteps — set step mutates resource field', () => {
  const resource = { status: 'pending', assignedToId: null };
  const context = { caller: { id: 'worker-1' }, object: resource, request: {}, now: '2025-01-01T00:00:00Z' };
  applySteps([{ set: { field: 'assignedToId', value: '$caller.id' } }], resource, context);
  assert.strictEqual(resource.assignedToId, 'worker-1');
});

test('applySteps — set step with literal value', () => {
  const resource = { status: 'pending' };
  applySteps([{ set: { field: 'status', value: 'active' } }], resource, {});
  assert.strictEqual(resource.status, 'active');
});

// =============================================================================
// applySteps — emit
// =============================================================================

test('applySteps — emit step queues pendingEvent with resolved data', () => {
  const resource = { id: 'app-1' };
  const context = { object: resource, request: {}, now: '2025-01-01T00:00:00Z' };
  const { pendingEvents } = applySteps([{
    emit: { event: 'submitted', data: { submittedAt: '$now', appId: '$object.id' } }
  }], resource, context);
  assert.strictEqual(pendingEvents.length, 1);
  assert.strictEqual(pendingEvents[0].action, 'submitted');
  assert.strictEqual(pendingEvents[0].data.submittedAt, '2025-01-01T00:00:00Z');
  assert.strictEqual(pendingEvents[0].data.appId, 'app-1');
});

// =============================================================================
// applySteps — evaluate
// =============================================================================

test('applySteps — evaluate step queues ruleId in pendingRuleEvaluations', () => {
  const { pendingRuleEvaluations } = applySteps([{ evaluate: 'assign-queue-rule' }], {}, {});
  assert.deepStrictEqual(pendingRuleEvaluations, [{ ruleId: 'assign-queue-rule' }]);
});

// =============================================================================
// applySteps — invoke POST (collection create)
// =============================================================================

test('applySteps — invoke POST to collection queues pendingCreate', () => {
  const context = { object: { id: 'app-1' }, request: {}, now: '2025-01-01T00:00:00Z' };
  const { pendingCreates } = applySteps([{
    invoke: { POST: 'intake/application-documents', body: { applicationId: '$object.id', category: 'income' } }
  }], {}, context);
  assert.strictEqual(pendingCreates.length, 1);
  assert.strictEqual(pendingCreates[0].entity, 'application-documents');
  assert.strictEqual(pendingCreates[0].data.applicationId, 'app-1');
  assert.strictEqual(pendingCreates[0].data.category, 'income');
});

// =============================================================================
// applySteps — invoke POST (operation trigger)
// =============================================================================

test('applySteps — invoke POST to operation path queues pendingOperation', () => {
  const context = { entities: { application: { id: 'app-99' } }, object: {}, request: {} };
  const { pendingOperations } = applySteps([{
    invoke: { POST: 'intake/applications/{application.id}/open' }
  }], {}, context);
  assert.strictEqual(pendingOperations.length, 1);
  assert.strictEqual(pendingOperations[0].path, 'intake/applications/app-99/open');
});

// =============================================================================
// applySteps — invoke PATCH ($push)
// =============================================================================

test('applySteps — invoke PATCH queues pendingAppend with resolved $push body', () => {
  const context = {
    entities: { member: { id: 'mem-1' } },
    this: { data: { verificationType: 'income', result: 'verified' } },
    object: {}, request: {}
  };
  const { pendingAppends } = applySteps([{
    invoke: {
      PATCH: 'intake/application-members/{member.id}',
      body: { verifications: { $push: { type: '$this.data.verificationType', status: '$this.data.result' } } }
    }
  }], {}, context);
  assert.strictEqual(pendingAppends.length, 1);
  assert.strictEqual(pendingAppends[0].path, 'intake/application-members/mem-1');
  assert.deepStrictEqual(pendingAppends[0].body.verifications.$push, { type: 'income', status: 'verified' });
});

// =============================================================================
// applySteps — when:
// =============================================================================

test('applySteps — when: false skips step', () => {
  const resource = { status: 'pending' };
  const context = { object: { isExpedited: false }, request: {} };
  applySteps([{
    when: { '==': [{ var: 'object.isExpedited' }, true] },
    set: { field: 'status', value: 'expedited' }
  }], resource, context);
  assert.strictEqual(resource.status, 'pending');
});

test('applySteps — when: true executes step', () => {
  const resource = { status: 'pending' };
  const context = { object: { isExpedited: true }, request: {} };
  applySteps([{
    when: { '==': [{ var: 'object.isExpedited' }, true] },
    set: { field: 'status', value: 'expedited' }
  }], resource, context);
  assert.strictEqual(resource.status, 'expedited');
});

test('applySteps — when: exposes $this fields', () => {
  const resource = { status: 'pending' };
  const context = { this: { data: { program: 'snap' } }, object: {}, request: {} };
  applySteps([{
    when: { '==': [{ var: 'this.data.program' }, 'snap'] },
    set: { field: 'status', value: 'snap-routed' }
  }], resource, context);
  assert.strictEqual(resource.status, 'snap-routed');
});

test('applySteps — when: exposes entity aliases', () => {
  const resource = { status: 'pending' };
  const context = { entities: { queue: { type: 'expedited' } }, object: {}, request: {} };
  applySteps([{
    when: { '==': [{ var: 'queue.type' }, 'expedited'] },
    set: { field: 'status', value: 'expedited' }
  }], resource, context);
  assert.strictEqual(resource.status, 'expedited');
});

// =============================================================================
// applySteps — forEach (field-value where)
// =============================================================================

test('applySteps — forEach runs then: once per matching record (field-value where)', () => {
  clearAll('application-members');
  insertResource('application-members', { id: 'mem-1', applicationId: 'app-1' });
  insertResource('application-members', { id: 'mem-2', applicationId: 'app-1' });
  insertResource('application-members', { id: 'mem-3', applicationId: 'app-2' });

  const created = [];
  const context = { object: { id: 'app-1' }, entities: {}, request: {} };
  const { pendingCreates } = applySteps([{
    forEach: {
      from: 'intake/application-members',
      where: { applicationId: '$object.id' },
      as: 'member',
      then: [{ invoke: { POST: 'data-exchange/service-calls', body: { memberId: '$member.id' } } }]
    }
  }], {}, context);

  assert.strictEqual(pendingCreates.length, 2);
  const memberIds = pendingCreates.map(c => c.data.memberId).sort();
  assert.deepStrictEqual(memberIds, ['mem-1', 'mem-2']);
});

test('applySteps — forEach skips non-matching records', () => {
  clearAll('application-members');
  insertResource('application-members', { id: 'mem-x', applicationId: 'app-99' });

  const context = { object: { id: 'app-1' }, entities: {}, request: {} };
  const { pendingCreates } = applySteps([{
    forEach: {
      from: 'intake/application-members',
      where: { applicationId: '$object.id' },
      as: 'member',
      then: [{ invoke: { POST: 'data-exchange/service-calls', body: { memberId: '$member.id' } } }]
    }
  }], {}, context);

  assert.strictEqual(pendingCreates.length, 0);
});

// =============================================================================
// applySteps — forEach (JSON Logic where)
// =============================================================================

test('applySteps — forEach with JSON Logic where filters records', () => {
  clearAll('application-members');
  insertResource('application-members', { id: 'mem-1', applicationId: 'app-1', citizenshipStatus: 'citizen' });
  insertResource('application-members', { id: 'mem-2', applicationId: 'app-1', citizenshipStatus: 'non-citizen' });

  const context = { object: { id: 'app-1' }, entities: {}, request: {} };
  const { pendingCreates } = applySteps([{
    forEach: {
      from: 'intake/application-members',
      where: { '==': [{ var: 'citizenshipStatus' }, 'non-citizen'] },
      as: 'member',
      then: [{ invoke: { POST: 'data-exchange/service-calls', body: { memberId: '$member.id' } } }]
    }
  }], {}, context);

  assert.strictEqual(pendingCreates.length, 1);
  assert.strictEqual(pendingCreates[0].data.memberId, 'mem-2');
});

// =============================================================================
// applySteps — nested forEach
// =============================================================================

test('applySteps — nested forEach iterates inner collection for each outer item', () => {
  clearAll('application-members');
  clearAll('service-types');
  insertResource('application-members', { id: 'mem-1', applicationId: 'app-1' });
  insertResource('application-members', { id: 'mem-2', applicationId: 'app-1' });
  insertResource('service-types', { id: 'svc-snap', name: 'snap' });
  insertResource('service-types', { id: 'svc-mcd', name: 'medicaid' });

  const context = { object: { id: 'app-1' }, entities: {}, request: {} };
  const { pendingCreates } = applySteps([{
    forEach: {
      from: 'intake/application-members',
      where: { applicationId: '$object.id' },
      as: 'member',
      then: [{
        forEach: {
          from: 'data-exchange/service-types',
          where: { '!=': [{ var: 'id' }, 'none'] },
          as: 'svcType',
          then: [{ invoke: { POST: 'data-exchange/service-calls', body: { memberId: '$member.id', serviceTypeId: '$svcType.id' } } }]
        }
      }]
    }
  }], {}, context);

  // 2 members × 2 service types = 4 creates
  assert.strictEqual(pendingCreates.length, 4);
});
