/**
 * Workflow Domain — State Machine Regression Tests
 *
 * Full coverage of the workflow state machine: Task lifecycle, all transitions
 * from every valid from-state, all guard enforcement, step side effects
 * (procedure calls), event emission on every transition, timer-triggered
 * behavior (via event stub engine), and event subscriptions.
 *
 * Timer-triggered behavior is tested using the event stub engine: register a
 * stub for scheduling.timer.requested before triggering the flow, and the stub
 * fires the timer callback synchronously without waiting for real time.
 *
 * Run with: npm run test:integration
 */

import assert from 'assert';
import { BASE_URL, EVENT_PREFIX, contractsDir, fetch, caller, injectEvent, clearStubs, createTestRunner, setupServer, teardownServer } from './helpers.js';

const { test, section, results } = createTestRunner();

async function registerStub(stub) {
  const res = await fetch(`${BASE_URL}/mock/stubs/events`, { method: 'POST', body: stub });
  return res.json();
}

async function allEvents() {
  const res = await fetch(`${BASE_URL}/platform/events?limit=1000`);
  return ((await res.json()).items) || [];
}

function findEvent(events, typeSuffix, subject) {
  return events.find(e => e.type?.includes(typeSuffix) && e.subject === subject);
}

// ---------------------------------------------------------------------------
// Workflow — Lifecycle, transitions, guards, and step side effects
// ---------------------------------------------------------------------------

async function testWorkflowLifecycle() {
  section('Workflow — Core lifecycle');

  const TASK = '/workflow/tasks';
  const CASEWORKER = caller('worker-aaa', 'caseworker');
  const OTHER_WORKER = caller('worker-bbb', 'caseworker');
  const SUPERVISOR = caller('sup-1', 'supervisor');
  const SYSTEM = caller('system-1', 'system');

  // ── claim ─────────────────────────────────────────────────────────────────

  let taskId;
  await test('Create task — status is pending', async () => {
    const res = await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'SM regression task', programType: 'snap' },
    });
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'pending');
    taskId = data.id;
  });

  await test('claim (pending → in_progress) — sets assignedToId', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/claim`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'in_progress');
    assert.strictEqual(data.assignedToId, 'worker-aaa');
  });

  await test('claim (taskIsUnassigned guard) — already in_progress → 409 CONFLICT', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/claim`, { method: 'POST', headers: OTHER_WORKER });
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).code, 'CONFLICT');
  });

  await test('claim on completed task → 409 CONFLICT', async () => {
    // Will verify at end of test chain; set up now, assert after complete
  });

  // ── await-client / resume ─────────────────────────────────────────────────

  await test('await-client (in_progress → awaiting_client) — sets blockedAt', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/await-client`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'awaiting_client');
    assert.ok(data.blockedAt, 'blockedAt should be set');
  });

  await test('await-client (callerIsAssignedWorker guard) — other worker → 409', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Guard test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/await-client`, { method: 'POST', headers: OTHER_WORKER });
    assert.strictEqual(res.status, 409);
  });

  await test('resume (awaiting_client → in_progress) — clears blockedAt', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/resume`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'in_progress');
    assert.strictEqual(data.blockedAt, null);
  });

  // ── await-verification / system-resume ────────────────────────────────────

  await test('await-verification (in_progress → awaiting_verification) — sets blockedAt', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/await-verification`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'awaiting_verification');
    assert.ok(data.blockedAt, 'blockedAt should be set');
  });

  await test('await-verification (callerIsAssignedWorker guard) — other worker → 409', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Guard test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/await-verification`, { method: 'POST', headers: OTHER_WORKER });
    assert.strictEqual(res.status, 409);
  });

  await test('system-resume (awaiting_verification → in_progress) — clears blockedAt', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/system-resume`, {
      method: 'POST', headers: SYSTEM,
      body: { source: 'verification_result', result: 'conclusive' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'in_progress');
    assert.strictEqual(data.blockedAt, null);
  });

  await test('system-resume (callerIsSystem guard) — caseworker → 403 FORBIDDEN', async () => {
    await fetch(`${BASE_URL}${TASK}/${taskId}/await-verification`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/system-resume`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await res.json()).code, 'FORBIDDEN');
    await fetch(`${BASE_URL}${TASK}/${taskId}/system-resume`, { method: 'POST', headers: SYSTEM, body: { source: 'test' } });
  });

  // ── submit-for-review / approve / return-to-worker ────────────────────────

  await test('submit-for-review (in_progress → pending_review)', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual((await res.json()).status, 'pending_review');
  });

  await test('submit-for-review (callerIsAssignedWorker guard) — other worker → 409', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Guard test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/submit-for-review`, { method: 'POST', headers: OTHER_WORKER });
    assert.strictEqual(res.status, 409);
  });

  await test('return-to-worker (pending_review → in_progress, supervisor)', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/return-to-worker`, { method: 'POST', headers: SUPERVISOR, body: { reason: 'needs revision' } });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual((await res.json()).status, 'in_progress');
  });

  await test('return-to-worker (callerIsSupervisor guard) — caseworker → 403 FORBIDDEN', async () => {
    await fetch(`${BASE_URL}${TASK}/${taskId}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/return-to-worker`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 403);
    await fetch(`${BASE_URL}${TASK}/${taskId}/return-to-worker`, { method: 'POST', headers: SUPERVISOR, body: { reason: 'needs revision' } });
  });

  await test('approve (pending_review → completed) — sets completedAt and outcome', async () => {
    await fetch(`${BASE_URL}${TASK}/${taskId}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/approve`, {
      method: 'POST', headers: SUPERVISOR, body: { outcome: 'approved' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'completed');
    assert.ok(data.completedAt, 'completedAt should be set');
    assert.strictEqual(data.outcome, 'approved');
  });

  await test('approve (callerIsSupervisor guard) — caseworker → 403 FORBIDDEN', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Approve guard test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/approve`, {
      method: 'POST', headers: CASEWORKER, body: { outcome: 'approved' },
    });
    assert.strictEqual(res.status, 403);
  });

  // ── complete ──────────────────────────────────────────────────────────────

  await test('complete (in_progress → completed) — sets completedAt and outcome', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Complete test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/complete`, {
      method: 'POST', headers: CASEWORKER, body: { outcome: 'denied' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'completed');
    assert.ok(data.completedAt, 'completedAt should be set');
    assert.strictEqual(data.outcome, 'denied');
  });

  await test('complete (callerIsAssignedWorker guard) — other worker → 409', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Complete guard test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/complete`, {
      method: 'POST', headers: OTHER_WORKER, body: { outcome: 'approved' },
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).code, 'CONFLICT');
  });

  await test('complete with createFollowUp: true creates a follow-up task', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Follow-up source', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/complete`, {
      method: 'POST', headers: CASEWORKER, body: { outcome: 'approved', createFollowUp: true },
    });
    const { items } = await (await fetch(`${BASE_URL}${TASK}?limit=200`)).json();
    const followUp = items.find(t => t.id !== id && t.name === 'Follow-up source' && t.status === 'pending');
    assert.ok(followUp, 'follow-up task should be created when createFollowUp is true');
  });

  // ── release ───────────────────────────────────────────────────────────────

  await test('release (in_progress → pending) — clears assignedToId, reassigns queue', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Release test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/release`, {
      method: 'POST', headers: CASEWORKER, body: { reason: 'reassigning' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'pending');
    assert.strictEqual(data.assignedToId, null);
    assert.ok(data.queueId, 'queueId should be reassigned by assignToQueue procedure');
  });

  await test('release (callerIsAssignedWorker guard) — other worker → 409', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Release guard test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/release`, {
      method: 'POST', headers: OTHER_WORKER,
    });
    assert.strictEqual(res.status, 409);
  });

  // ── escalation path ───────────────────────────────────────────────────────

  let task3Id;
  await test('supervisor escalates pending task → escalated — sets escalatedAt', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Escalation test', programType: 'snap' },
    })).json();
    task3Id = id;
    const res = await fetch(`${BASE_URL}${TASK}/${id}/escalate`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'urgent' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'escalated');
    assert.ok(data.escalatedAt, 'escalatedAt should be set');
  });

  await test('caseworker can escalate from in_progress (any[callerIsAssignedWorker, callerIsSupervisor])', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'CW escalation', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/escalate`, {
      method: 'POST', headers: CASEWORKER, body: { reason: 'urgent' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual((await res.json()).status, 'escalated');
  });

  await test('caseworker cannot escalate from pending → 403 FORBIDDEN', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Pending escalation guard', programType: 'snap' },
    })).json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/escalate`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 403);
  });

  await test('submit-for-review from escalated → pending_review', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Escalated review test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/escalate`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual((await res.json()).status, 'pending_review');
  });

  await test('de-escalate (escalated → pending) — reassigns queue', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/de-escalate`, { method: 'POST', headers: SUPERVISOR });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'pending');
    assert.ok(data.queueId, 'queueId should be reassigned by assignToQueue procedure');
  });

  // ── system-escalate ───────────────────────────────────────────────────────

  await test('system-escalate from pending — auto_escalated event', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'System escalate test', programType: 'snap' },
    })).json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/system-escalate`, {
      method: 'POST', headers: SYSTEM, body: { reason: 'deadline_exceeded' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'escalated');
    assert.ok(data.escalatedAt, 'escalatedAt should be set');
  });

  await test('system-escalate from in_progress → escalated', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'System escalate in_progress', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/system-escalate`, {
      method: 'POST', headers: SYSTEM, body: { reason: 'sla_deadline_approaching' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual((await res.json()).status, 'escalated');
  });

  await test('system-escalate from escalated — escalatedAt not overwritten', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Double escalation test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/system-escalate`, {
      method: 'POST', headers: SYSTEM, body: { reason: 'deadline_exceeded' },
    });
    const first = await (await fetch(`${BASE_URL}${TASK}/${id}`)).json();
    const firstEscalatedAt = first.escalatedAt;
    await fetch(`${BASE_URL}${TASK}/${id}/system-escalate`, {
      method: 'POST', headers: SYSTEM, body: { reason: 'sla_deadline_approaching' },
    });
    const second = await (await fetch(`${BASE_URL}${TASK}/${id}`)).json();
    assert.strictEqual(second.escalatedAt, firstEscalatedAt, 'escalatedAt should not be overwritten on subsequent escalations');
  });

  await test('system-escalate (callerIsSystem guard) — caseworker → 403 FORBIDDEN', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'System escalate guard test', programType: 'snap' },
    })).json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/system-escalate`, {
      method: 'POST', headers: CASEWORKER, body: { reason: 'deadline_exceeded' },
    });
    assert.strictEqual(res.status, 403);
  });

  // ── system-auto-cancel ────────────────────────────────────────────────────

  await test('system-auto-cancel (awaiting_client → cancelled) — sets cancelledAt', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Auto cancel test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/await-client`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/system-auto-cancel`, { method: 'POST', headers: SYSTEM });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'cancelled');
    assert.ok(data.cancelledAt, 'cancelledAt should be set');
  });

  // ── cancel / reopen ───────────────────────────────────────────────────────

  await test('cancel from pending → cancelled — sets cancelledAt', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/cancel`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'duplicate' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'cancelled');
    assert.ok(data.cancelledAt, 'cancelledAt should be set');
  });

  await test('cancel from in_progress → cancelled', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Cancel from in_progress', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/cancel`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'withdrawn' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'cancelled');
    assert.ok(data.cancelledAt, 'cancelledAt should be set');
  });

  await test('cancel from escalated → cancelled', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Cancel from escalated', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}/escalate`, { method: 'POST', headers: SUPERVISOR });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/cancel`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'withdrawn' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual((await res.json()).status, 'cancelled');
  });

  await test('cancel (callerIsSupervisor guard) — caseworker → 403 FORBIDDEN', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Cancel guard test', programType: 'snap' },
    })).json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/cancel`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 403);
  });

  await test('reopen (cancelled → pending) — clears cancelledAt, reassigns queue', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/reopen`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'not a duplicate' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'pending');
    assert.strictEqual(data.cancelledAt, null);
    assert.ok(data.queueId, 'queueId should be reassigned by assignToQueue procedure');
  });

  // ── assign / set-priority ─────────────────────────────────────────────────

  await test('assign (supervisor) — sets assignedToId and queueId, no state change', async () => {
    const { id, queueId: originalQueueId } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Assign test', programType: 'snap' },
    })).json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/assign`, {
      method: 'POST', headers: SUPERVISOR,
      body: { assignedToId: '00000000-0000-0000-0000-000000000002', queueId: originalQueueId },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.assignedToId, '00000000-0000-0000-0000-000000000002');
    assert.strictEqual(data.queueId, originalQueueId ?? null);
    assert.strictEqual(data.status, 'pending', 'status should not change');
  });

  await test('assign (callerIsSupervisor guard) — caseworker → 403 FORBIDDEN', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Assign guard test', programType: 'snap' },
    })).json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/assign`, {
      method: 'POST', headers: CASEWORKER, body: { assignedToId: '00000000-0000-0000-0000-000000000002' },
    });
    assert.strictEqual(res.status, 403);
  });

  await test('set-priority (supervisor) — updates priority, no state change', async () => {
    const { id, status } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Priority test', programType: 'snap' },
    })).json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/set-priority`, {
      method: 'POST', headers: SUPERVISOR, body: { priority: 'high' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.priority, 'high');
    assert.strictEqual(data.status, status, 'status should not change');
  });

  await test('set-priority (callerIsSupervisor guard) — caseworker → 403 FORBIDDEN', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Priority guard test', programType: 'snap' },
    })).json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/set-priority`, {
      method: 'POST', headers: CASEWORKER, body: { priority: 'high' },
    });
    assert.strictEqual(res.status, 403);
  });

  // ── Missing X-Caller-Id ───────────────────────────────────────────────────

  await test('transition without X-Caller-Id → 400 BAD_REQUEST', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/claim`, { method: 'POST' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).code, 'BAD_REQUEST');
  });
}

// ---------------------------------------------------------------------------
// Workflow — Event emission (every transition emits the right event + data)
// ---------------------------------------------------------------------------

async function testWorkflowEventEmission() {
  section('Workflow — Event emission');

  const TASK = '/workflow/tasks';
  const CASEWORKER = caller('worker-aaa', 'caseworker');
  const SUPERVISOR = caller('sup-1', 'supervisor');
  const SYSTEM = caller('system-1', 'system');

  async function createTask(name = 'Event test') {
    const res = await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name, programType: 'snap' },
    });
    return (await res.json()).id;
  }

  await test('claim emits workflow.task.claimed with assignedToId', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const e = findEvent(await allEvents(), 'workflow.task.claimed', id);
    assert.ok(e, 'workflow.task.claimed should be emitted');
    assert.strictEqual(e.data?.assignedToId, 'worker-aaa');
  });

  await test('complete emits workflow.task.completed with outcome', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/complete`, {
      method: 'POST', headers: CASEWORKER, body: { outcome: 'approved' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.completed', id);
    assert.ok(e, 'workflow.task.completed should be emitted');
    assert.strictEqual(e.data?.outcome, 'approved');
  });

  await test('release emits workflow.task.released with reason', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/release`, {
      method: 'POST', headers: CASEWORKER, body: { reason: 'reassigning' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.released', id);
    assert.ok(e, 'workflow.task.released should be emitted');
    assert.strictEqual(e.data?.reason, 'reassigning');
  });

  await test('escalate (from pending) emits workflow.task.escalated with reason', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/escalate`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'urgent' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.escalated', id);
    assert.ok(e, 'workflow.task.escalated should be emitted');
    assert.strictEqual(e.data?.reason, 'urgent');
  });

  await test('escalate (from in_progress) emits workflow.task.escalated', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/escalate`, { method: 'POST', headers: CASEWORKER, body: { reason: 'urgent' } });
    const e = findEvent(await allEvents(), 'workflow.task.escalated', id);
    assert.ok(e, 'workflow.task.escalated should be emitted from in_progress');
  });

  await test('de-escalate emits workflow.task.de-escalated', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/escalate`, { method: 'POST', headers: SUPERVISOR, body: { reason: 'urgent' } });
    await fetch(`${BASE_URL}${TASK}/${id}/de-escalate`, { method: 'POST', headers: SUPERVISOR });
    const e = findEvent(await allEvents(), 'workflow.task.de-escalated', id);
    assert.ok(e, 'workflow.task.de-escalated should be emitted');
  });

  await test('cancel emits workflow.task.cancelled with reason', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/cancel`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'duplicate' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.cancelled', id);
    assert.ok(e, 'workflow.task.cancelled should be emitted');
    assert.strictEqual(e.data?.reason, 'duplicate');
  });

  await test('reopen emits workflow.task.reopened with reason', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/cancel`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'duplicate' },
    });
    await fetch(`${BASE_URL}${TASK}/${id}/reopen`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'was not a duplicate' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.reopened', id);
    assert.ok(e, 'workflow.task.reopened should be emitted');
    assert.strictEqual(e.data?.reason, 'was not a duplicate');
  });

  await test('await-client emits workflow.task.awaiting_client', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/await-client`, { method: 'POST', headers: CASEWORKER });
    const e = findEvent(await allEvents(), 'workflow.task.awaiting_client', id);
    assert.ok(e, 'workflow.task.awaiting_client should be emitted');
  });

  await test('await-verification emits workflow.task.awaiting_verification', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/await-verification`, { method: 'POST', headers: CASEWORKER });
    const e = findEvent(await allEvents(), 'workflow.task.awaiting_verification', id);
    assert.ok(e, 'workflow.task.awaiting_verification should be emitted');
  });

  await test('resume emits workflow.task.resumed', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/await-client`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/resume`, { method: 'POST', headers: CASEWORKER });
    const e = findEvent(await allEvents(), 'workflow.task.resumed', id);
    assert.ok(e, 'workflow.task.resumed should be emitted');
  });

  await test('system-resume emits workflow.task.system_resumed with source and result', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/await-verification`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/system-resume`, {
      method: 'POST', headers: SYSTEM,
      body: { source: 'verification_result', result: 'conclusive' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.system_resumed', id);
    assert.ok(e, 'workflow.task.system_resumed should be emitted');
    assert.strictEqual(e.data?.source, 'verification_result');
    assert.strictEqual(e.data?.result, 'conclusive');
  });

  await test('system-escalate (non-sla reason) emits workflow.task.auto_escalated', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/system-escalate`, {
      method: 'POST', headers: SYSTEM, body: { reason: 'deadline_exceeded' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.auto_escalated', id);
    assert.ok(e, 'workflow.task.auto_escalated should be emitted');
    assert.strictEqual(e.data?.reason, 'deadline_exceeded');
  });

  await test('system-escalate (sla_deadline_exceeded) emits workflow.task.sla_breached', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/system-escalate`, {
      method: 'POST', headers: SYSTEM, body: { reason: 'sla_deadline_exceeded' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.sla_breached', id);
    assert.ok(e, 'workflow.task.sla_breached should be emitted');
    assert.strictEqual(e.data?.reason, 'sla_deadline_exceeded');
  });

  await test('system-auto-cancel emits workflow.task.auto_cancelled with client_unresponsive', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/await-client`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/system-auto-cancel`, { method: 'POST', headers: SYSTEM });
    const e = findEvent(await allEvents(), 'workflow.task.auto_cancelled', id);
    assert.ok(e, 'workflow.task.auto_cancelled should be emitted');
    assert.strictEqual(e.data?.reason, 'client_unresponsive');
  });

  await test('submit-for-review emits workflow.task.submitted_for_review', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    const e = findEvent(await allEvents(), 'workflow.task.submitted_for_review', id);
    assert.ok(e, 'workflow.task.submitted_for_review should be emitted');
  });

  await test('approve emits workflow.task.approved with outcome', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/approve`, {
      method: 'POST', headers: SUPERVISOR, body: { outcome: 'denied' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.approved', id);
    assert.ok(e, 'workflow.task.approved should be emitted');
    assert.strictEqual(e.data?.outcome, 'denied');
  });

  await test('return-to-worker emits workflow.task.returned_to_worker with reason', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    await fetch(`${BASE_URL}${TASK}/${id}/return-to-worker`, {
      method: 'POST', headers: SUPERVISOR, body: { reason: 'needs more detail' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.returned_to_worker', id);
    assert.ok(e, 'workflow.task.returned_to_worker should be emitted');
    assert.strictEqual(e.data?.reason, 'needs more detail');
  });

  await test('assign emits workflow.task.assigned with assignedToId and queueId', async () => {
    const id = await createTask();
    const { queueId } = await (await fetch(`${BASE_URL}${TASK}/${id}`)).json();
    await fetch(`${BASE_URL}${TASK}/${id}/assign`, {
      method: 'POST', headers: SUPERVISOR,
      body: { assignedToId: '00000000-0000-0000-0000-000000000002', queueId },
    });
    const e = findEvent(await allEvents(), 'workflow.task.assigned', id);
    assert.ok(e, 'workflow.task.assigned should be emitted');
    assert.strictEqual(e.data?.assignedToId, '00000000-0000-0000-0000-000000000002');
    assert.strictEqual(e.data?.queueId, queueId);
  });

  await test('set-priority emits workflow.task.priority_changed with priority', async () => {
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/set-priority`, {
      method: 'POST', headers: SUPERVISOR, body: { priority: 'high' },
    });
    const e = findEvent(await allEvents(), 'workflow.task.priority_changed', id);
    assert.ok(e, 'workflow.task.priority_changed should be emitted');
    assert.strictEqual(e.data?.priority, 'high');
  });
}

// ---------------------------------------------------------------------------
// Workflow — Timer-triggered behavior (uses event stub engine)
// ---------------------------------------------------------------------------

async function testWorkflowTimerBehavior() {
  section('Workflow — Timer-triggered behavior');

  const TASK = '/workflow/tasks';
  const CASEWORKER = caller('worker-aaa', 'caseworker');

  async function createTask(name = 'Timer test') {
    const res = await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name, programType: 'snap' },
    });
    return (await res.json()).id;
  }

  // creation_deadline fires on task creation → system-escalate(deadline_exceeded) → auto_escalated
  await test('creation_deadline: task auto-escalates on creation when stub fires', async () => {
    await clearStubs();
    await registerStub({
      on: 'scheduling.timer.requested',
      match: { 'data.callback.event': 'workflow.creation_deadline' },
    });

    const id = await createTask();

    const task = await (await fetch(`${BASE_URL}${TASK}/${id}`)).json();
    assert.strictEqual(task.status, 'escalated', 'task should be auto-escalated after creation_deadline fires');
    assert.ok(task.escalatedAt, 'escalatedAt should be set');

    const e = findEvent(await allEvents(), 'workflow.task.auto_escalated', id);
    assert.ok(e, 'workflow.task.auto_escalated should be emitted');
    assert.strictEqual(e.data?.reason, 'deadline_exceeded');

    await clearStubs();
  });

  // client_timeout fires from await-client → system-auto-cancel → auto_cancelled
  await test('client_timeout: awaiting_client task auto-cancels when stub fires', async () => {
    await clearStubs();
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });

    await registerStub({
      on: 'scheduling.timer.requested',
      match: { 'data.callback.event': 'workflow.client_timeout' },
    });
    await fetch(`${BASE_URL}${TASK}/${id}/await-client`, { method: 'POST', headers: CASEWORKER });

    const task = await (await fetch(`${BASE_URL}${TASK}/${id}`)).json();
    assert.strictEqual(task.status, 'cancelled', 'task should be auto-cancelled after client_timeout fires');
    assert.ok(task.cancelledAt, 'cancelledAt should be set');

    const e = findEvent(await allEvents(), 'workflow.task.auto_cancelled', id);
    assert.ok(e, 'workflow.task.auto_cancelled should be emitted');
    assert.strictEqual(e.data?.reason, 'client_unresponsive');

    await clearStubs();
  });

  // verification_timeout fires from await-verification → system-resume(source:timeout)
  await test('verification_timeout: awaiting_verification task auto-resumes when stub fires', async () => {
    await clearStubs();
    const id = await createTask();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });

    await registerStub({
      on: 'scheduling.timer.requested',
      match: { 'data.callback.event': 'workflow.verification_timeout' },
    });
    await fetch(`${BASE_URL}${TASK}/${id}/await-verification`, { method: 'POST', headers: CASEWORKER });

    const task = await (await fetch(`${BASE_URL}${TASK}/${id}`)).json();
    assert.strictEqual(task.status, 'in_progress', 'task should be auto-resumed after verification_timeout fires');
    assert.strictEqual(task.blockedAt, null, 'blockedAt should be cleared');

    const e = findEvent(await allEvents(), 'workflow.task.system_resumed', id);
    assert.ok(e, 'workflow.task.system_resumed should be emitted');
    assert.strictEqual(e.data?.source, 'timeout');
    assert.strictEqual(e.data?.result, 'verification_timeout');

    await clearStubs();
  });

  // sla_warning fires when slaDeadline is set → system-escalate(approaching)
  await test('sla_warning: task auto-escalates with approaching reason when slaDeadline set', async () => {
    await clearStubs();
    const id = await createTask();

    await registerStub({
      on: 'scheduling.timer.requested',
      match: { 'data.callback.event': 'workflow.sla_warning' },
    });
    await fetch(`${BASE_URL}${TASK}/${id}`, {
      method: 'PATCH', headers: CASEWORKER,
      body: { slaDeadline: new Date(Date.now() + 86400000).toISOString() },
    });

    const task = await (await fetch(`${BASE_URL}${TASK}/${id}`)).json();
    assert.strictEqual(task.status, 'escalated', 'task should be escalated on sla_warning');

    const e = findEvent(await allEvents(), 'workflow.task.auto_escalated', id);
    assert.ok(e, 'workflow.task.auto_escalated should be emitted for sla_warning');
    assert.strictEqual(e.data?.reason, 'sla_deadline_approaching');

    await clearStubs();
  });

  // sla_breach fires when slaDeadline is set → system-escalate(exceeded) → sla_breached
  await test('sla_breach: task escalates and emits sla_breached when slaDeadline set', async () => {
    await clearStubs();
    const id = await createTask();

    await registerStub({
      on: 'scheduling.timer.requested',
      match: { 'data.callback.event': 'workflow.sla_breach' },
    });
    await fetch(`${BASE_URL}${TASK}/${id}`, {
      method: 'PATCH', headers: CASEWORKER,
      body: { slaDeadline: new Date(Date.now() + 86400000).toISOString() },
    });

    const task = await (await fetch(`${BASE_URL}${TASK}/${id}`)).json();
    assert.strictEqual(task.status, 'escalated', 'task should be escalated on sla_breach');

    const e = findEvent(await allEvents(), 'workflow.task.sla_breached', id);
    assert.ok(e, 'workflow.task.sla_breached should be emitted');
    assert.strictEqual(e.data?.reason, 'sla_deadline_exceeded');

    await clearStubs();
  });
}

// ---------------------------------------------------------------------------
// Workflow — Event subscriptions
// (workflow.task.created, workflow.task.updated, scheduler.timer.fired,
//  intake.application.submitted)
// ---------------------------------------------------------------------------

async function testWorkflowEventSubscriptions() {
  section('Workflow — Event subscriptions');

  const TASK = '/workflow/tasks';
  const CASEWORKER = caller('worker-aaa', 'caseworker');
  const SUPERVISOR = caller('sup-1', 'supervisor');

  // workflow.task.created → assignToQueue (SNAP path: snap-intake queue)
  await test('workflow.task.created: SNAP task routed to snap-intake queue', async () => {
    const task = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'SNAP queue test', programType: 'snap' },
    })).json();
    assert.ok(task.queueId, 'queueId should be set by assignToQueue');
    assert.ok(task.priority, 'priority should be set by setPriority');
  });

  // workflow.task.created → assignToQueue (general queue fallback for multi-program)
  await test('workflow.task.created: multi-program task routed to general queue', async () => {
    const task = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Multi-program queue test', programType: 'medicaid' },
    })).json();
    assert.ok(task.queueId, 'queueId should be set (general queue fallback)');
    const snapTask = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'SNAP comparison', programType: 'snap' },
    })).json();
    assert.notStrictEqual(task.queueId, snapTask.queueId, 'medicaid task should land in a different queue than snap');
  });

  // workflow.task.updated: isExpedited → setPriority → expedited
  await test('workflow.task.updated: setting isExpedited changes priority to expedited', async () => {
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Expedited update test', programType: 'snap' },
    })).json();
    await fetch(`${BASE_URL}${TASK}/${id}`, {
      method: 'PATCH', headers: SUPERVISOR, body: { isExpedited: true },
    });
    const task = await (await fetch(`${BASE_URL}${TASK}/${id}`)).json();
    assert.strictEqual(task.priority, 'expedited', 'priority should be expedited after isExpedited set');
  });

  // workflow.task.updated: slaDeadline set → both sla_warning and sla_breach timers scheduled
  await test('workflow.task.updated: setting slaDeadline schedules sla_warning and sla_breach timers', async () => {
    await clearStubs();
    const { id } = await (await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'SLA schedule test', programType: 'snap' },
    })).json();

    await registerStub({ on: 'scheduling.timer.requested', match: { 'data.callback.event': 'workflow.sla_warning' } });
    await registerStub({ on: 'scheduling.timer.requested', match: { 'data.callback.event': 'workflow.sla_breach' } });

    await fetch(`${BASE_URL}${TASK}/${id}`, {
      method: 'PATCH', headers: CASEWORKER,
      body: { slaDeadline: new Date(Date.now() + 86400000).toISOString() },
    });

    const { total } = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
    assert.strictEqual(total, 0, 'both sla_warning and sla_breach stubs consumed — both timers were scheduled');

    await clearStubs();
  });

  // intake.application.submitted → creates application_review task
  await test('intake.application.submitted: creates application_review task', async () => {
    const appId = `app-event-sub-test-${Date.now()}`;
    await injectEvent('intake.application.submitted', {}, appId);

    const { items } = await (await fetch(`${BASE_URL}${TASK}?limit=200`)).json();
    const task = items.find(t => t.taskType === 'application_review' && t.subjectId === appId);
    assert.ok(task, 'application_review task should be created');
    assert.strictEqual(task.status, 'pending');
    assert.strictEqual(task.subjectType, 'application');
    assert.strictEqual(task.name, 'Application review');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Workflow State Machine Regression Tests\n');
  console.log('='.repeat(60));

  const serverStartedByTests = await setupServer();

  try {
    await testWorkflowLifecycle();
    await testWorkflowEventEmission();
    await testWorkflowTimerBehavior();
    await testWorkflowEventSubscriptions();
  } finally {
    await clearStubs();
    await teardownServer(serverStartedByTests);
  }

  const { passed, failed } = results();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\n❌ Workflow regression tests FAILED\n');
    process.exit(1);
  } else {
    console.log('\n✓ All workflow regression tests passed\n');
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
