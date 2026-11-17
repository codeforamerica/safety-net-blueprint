/**
 * Unit tests for the SLA engine
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { initializeSlaInfo, updateSlaInfo, earliestDeadline } from '../../src/sla-engine.js';

// =============================================================================
// Helpers
// =============================================================================

const NOW = '2024-01-01T12:00:00.000Z';
const FUTURE_DEADLINE = '2024-01-10T12:00:00.000Z';

function makeResource(status, extraSlaFields = {}) {
  return {
    id: 'task-1',
    status,
    slaInfo: [
      {
        slaTypeCode: 'test_sla',
        status: 'active',
        clockStartedAt: '2024-01-01T00:00:00.000Z',
        deadline: FUTURE_DEADLINE,
        _pausedSince: null,
        _accumulatedPausedMs: 0,
        ...extraSlaFields
      }
    ]
  };
}

const SLA_TYPES = [
  {
    id: 'test_sla',
    duration: { amount: 9, unit: 'days' }
  }
];

const STATES = {
  pending:    { slaClock: 'running' },
  in_progress: { slaClock: 'running' },
  completed:  { slaClock: 'stopped' },
  cancelled:  { slaClock: 'stopped' },
  awaiting_client: { slaClock: 'paused' }
};

// =============================================================================
// updateSlaInfo — slaClock: stopped states
// =============================================================================

test('updateSlaInfo — marks SLA completed when transitioning to completed (slaClock: stopped)', () => {
  const resource = makeResource('completed');
  updateSlaInfo(resource, SLA_TYPES, NOW, STATES);
  assert.strictEqual(resource.slaInfo[0].status, 'completed');
  assert.strictEqual(resource.slaInfo[0]._pausedSince, null);
});

test('updateSlaInfo — marks SLA completed when transitioning to cancelled (slaClock: stopped)', () => {
  const resource = makeResource('cancelled');
  updateSlaInfo(resource, SLA_TYPES, NOW, STATES);
  assert.strictEqual(resource.slaInfo[0].status, 'completed');
  assert.strictEqual(resource.slaInfo[0]._pausedSince, null);
});

test('updateSlaInfo — does not mark SLA completed for running states (pending, in_progress)', () => {
  for (const status of ['pending', 'in_progress']) {
    const resource = makeResource(status);
    updateSlaInfo(resource, SLA_TYPES, NOW, STATES);
    assert.strictEqual(resource.slaInfo[0].status, 'active', `expected active for status=${status}`);
  }
});

test('updateSlaInfo — works without states param (backwards compatible, no crash)', () => {
  const resource = makeResource('cancelled');
  // No states passed — cancelled should not stop the clock (no slaClock info available)
  assert.doesNotThrow(() => updateSlaInfo(resource, SLA_TYPES, NOW));
  // SLA stays active since engine has no state config to consult
  assert.strictEqual(resource.slaInfo[0].status, 'active');
});

test('updateSlaInfo — completedWhen override takes precedence over slaClock', () => {
  const slaTypesWithOverride = [
    {
      id: 'test_sla',
      duration: { amount: 9, unit: 'days' },
      completedWhen: 'status == "in_progress"'
    }
  ];
  // in_progress has slaClock: running, but completedWhen says done
  const resource = makeResource('in_progress');
  updateSlaInfo(resource, slaTypesWithOverride, NOW, STATES);
  assert.strictEqual(resource.slaInfo[0].status, 'completed');
});

test('updateSlaInfo — skips already-terminal SLA entries', () => {
  const resource = makeResource('cancelled', { status: 'breached' });
  updateSlaInfo(resource, SLA_TYPES, NOW, STATES);
  // Should remain breached, not flip to completed
  assert.strictEqual(resource.slaInfo[0].status, 'breached');
});

test('updateSlaInfo — handles resource with no slaInfo gracefully', () => {
  const resource = { id: 'task-1', status: 'cancelled', slaInfo: [] };
  assert.doesNotThrow(() => updateSlaInfo(resource, SLA_TYPES, NOW, STATES));
});

// =============================================================================
// resolvedEntities — context enrichment in SLA conditions
// =============================================================================

test('initializeSlaInfo — autoAssignWhen can reference resolved entity field', () => {
  // initializeSlaInfo imported at top of file
  const slaTypes = [
    {
      id: 'snap_expedited',
      duration: { amount: 7, unit: 'days' },
      autoAssignWhen: 'application.isExpedited == true'
    }
  ];
  const resource = { id: 'task-1', subjectId: 'app-1', slaInfo: [] };
  const resolvedEntities = { application: { id: 'app-1', isExpedited: true } };
  initializeSlaInfo(resource, slaTypes, NOW, resolvedEntities);
  assert.strictEqual(resource.slaInfo.length, 1);
  assert.strictEqual(resource.slaInfo[0].slaTypeCode, 'snap_expedited');
});

test('initializeSlaInfo — autoAssignWhen does not fire when resolved entity field is false', () => {
  // initializeSlaInfo imported at top of file
  const slaTypes = [
    {
      id: 'snap_expedited',
      duration: { amount: 7, unit: 'days' },
      autoAssignWhen: 'application.isExpedited == true'
    }
  ];
  const resource = { id: 'task-1', subjectId: 'app-1', slaInfo: [] };
  const resolvedEntities = { application: { id: 'app-1', isExpedited: false } };
  initializeSlaInfo(resource, slaTypes, NOW, resolvedEntities);
  assert.strictEqual(resource.slaInfo.length, 0);
});

test('updateSlaInfo — pauseWhen can reference resolved entity field', () => {
  const slaTypesWithPause = [
    {
      id: 'test_sla',
      duration: { amount: 9, unit: 'days' },
      pauseWhen: 'application.pendingDocuments == true'
    }
  ];
  const resource = makeResource('in_progress');
  const resolvedEntities = { application: { id: 'app-1', pendingDocuments: true } };
  updateSlaInfo(resource, slaTypesWithPause, NOW, STATES, resolvedEntities);
  assert.strictEqual(resource.slaInfo[0].status, 'paused');
});

test('updateSlaInfo — pauseWhen does not fire when resolved entity field is false', () => {
  const slaTypesWithPause = [
    {
      id: 'test_sla',
      duration: { amount: 9, unit: 'days' },
      pauseWhen: 'application.pendingDocuments == true'
    }
  ];
  const resource = makeResource('in_progress');
  const resolvedEntities = { application: { id: 'app-1', pendingDocuments: false } };
  updateSlaInfo(resource, slaTypesWithPause, NOW, STATES, resolvedEntities);
  assert.strictEqual(resource.slaInfo[0].status, 'active');
});

// =============================================================================
// Conditions are CEL over the resource's fields
// =============================================================================

test('updateSlaInfo — a CEL pauseWhen pauses the clock while it holds, and only then', () => {
  const slaTypes = [{ id: 'test_sla', duration: { amount: 9, unit: 'days' }, pauseWhen: 'status in ["awaiting_client", "awaiting_verification"]' }];
  const waiting = makeResource('awaiting_verification');
  updateSlaInfo(waiting, slaTypes, NOW, STATES);
  assert.strictEqual(waiting.slaInfo[0].status, 'paused');

  const working = makeResource('in_progress');
  updateSlaInfo(working, slaTypes, NOW, STATES);
  assert.strictEqual(working.slaInfo[0].status, 'active');
});

test('initializeSlaInfo — a CEL autoAssignWhen reads a list field of the resource', () => {
  const slaTypes = [{ id: 'snap_standard', duration: { amount: 30, unit: 'days' }, autoAssignWhen: '"snap" in programsAppliedFor' }];
  const snap = { id: 'app-1', programsAppliedFor: ['snap', 'medicaid'], slaInfo: [] };
  const medicaid = { id: 'app-2', programsAppliedFor: ['medicaid'], slaInfo: [] };
  initializeSlaInfo(snap, slaTypes, NOW);
  initializeSlaInfo(medicaid, slaTypes, NOW);
  assert.deepStrictEqual(snap.slaInfo.map((e) => e.slaTypeCode), ['snap_standard']);
  assert.deepStrictEqual(medicaid.slaInfo, []);
});

test('initializeSlaInfo — a condition reading a field the resource lacks does not hold', () => {
  const slaTypes = [{ id: 'snap_standard', duration: { amount: 30, unit: 'days' }, autoAssignWhen: '"snap" in programsAppliedFor' }];
  const resource = { id: 'app-1', slaInfo: [] };
  initializeSlaInfo(resource, slaTypes, NOW);
  assert.deepStrictEqual(resource.slaInfo, []);
});

test('initializeSlaInfo — a JSON Logic condition is not evaluated, so it never holds', () => {
  const slaTypes = [{ id: 'snap_standard', duration: { amount: 30, unit: 'days' }, autoAssignWhen: { in: ['snap', { var: 'programsAppliedFor' }] } }];
  const resource = { id: 'app-1', programsAppliedFor: ['snap'], slaInfo: [] };
  initializeSlaInfo(resource, slaTypes, NOW);
  assert.deepStrictEqual(resource.slaInfo, []);
});

test('slaDeadline is the earliest deadline still running, and null while none is', () => {
  const entry = (status, deadline) => ({ slaTypeCode: 't', status, clockStartedAt: '2026-01-01T00:00:00.000Z', deadline });
  assert.strictEqual(earliestDeadline([
    entry('active', '2026-02-01T00:00:00.000Z'),
    entry('warning', '2026-01-15T00:00:00.000Z'),
    entry('completed', '2026-01-02T00:00:00.000Z'),
    entry('breached', '2026-01-03T00:00:00.000Z'),
  ]), '2026-01-15T00:00:00.000Z');
  assert.strictEqual(earliestDeadline([entry('paused', '2026-01-15T00:00:00.000Z')]), null, 'a paused clock is not running');
  assert.strictEqual(earliestDeadline([]), null);
  assert.strictEqual(earliestDeadline(undefined), null);
});
