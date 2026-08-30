/**
 * Unit tests for the SLA engine
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { initializeSlaInfo, updateSlaInfo } from '../../src/sla-engine.js';

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
      completedWhen: { '===': [{ var: 'status' }, 'in_progress'] }
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
      autoAssignWhen: { '==': [{ var: 'application.isExpedited' }, true] }
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
      autoAssignWhen: { '==': [{ var: 'application.isExpedited' }, true] }
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
      pauseWhen: { '==': [{ var: 'application.pendingDocuments' }, true] }
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
      pauseWhen: { '==': [{ var: 'application.pendingDocuments' }, true] }
    }
  ];
  const resource = makeResource('in_progress');
  const resolvedEntities = { application: { id: 'app-1', pendingDocuments: false } };
  updateSlaInfo(resource, slaTypesWithPause, NOW, STATES, resolvedEntities);
  assert.strictEqual(resource.slaInfo[0].status, 'active');
});
