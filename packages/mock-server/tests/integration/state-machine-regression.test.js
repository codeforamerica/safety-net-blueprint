/**
 * State Machine Regression Tests
 *
 * Verifies that the workflow and intake state machines behave as specified:
 * correct state transitions, guard enforcement, and in-place operations.
 *
 * These tests serve as a regression suite for vocabulary or schema refactors —
 * if a rename changes behavior, these will catch it.
 *
 * Run with: npm run test:integration
 */

import http from 'http';
import { URL } from 'url';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { startMockServer, stopServer, isServerRunning } from '../../scripts/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '..', '..', '..', 'contracts');
const BASE_URL = 'http://localhost:1080';

let serverStartedByTests = false;
let totalPassed = 0;
let totalFailed = 0;

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers }
    };

    if (options.body) {
      const bodyStr = JSON.stringify(options.body);
      requestOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(requestOptions, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        json: async () => JSON.parse(data),
        text: async () => data,
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function caller(id, roles) {
  return { 'X-Caller-Id': id, 'X-Caller-Roles': Array.isArray(roles) ? roles.join(',') : roles };
}

// ---------------------------------------------------------------------------
// Test runner helpers
// ---------------------------------------------------------------------------

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    totalPassed++;
  } catch (err) {
    console.log(`  ✗ ${label}`);
    console.log(`      ${err.message}`);
    totalFailed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(title);
  console.log('─'.repeat(60));
}

// ---------------------------------------------------------------------------
// Workflow: Task state machine
// ---------------------------------------------------------------------------

async function testWorkflowStateMachine() {
  section('Workflow — Task state machine');

  const TASK = '/workflow/tasks';
  const CASEWORKER = caller('worker-aaa', 'caseworker');
  const OTHER_WORKER = caller('worker-bbb', 'caseworker');
  const SUPERVISOR = caller('sup-1', 'supervisor');
  const SYSTEM = caller('system-1', 'system');

  // ── Core lifecycle ────────────────────────────────────────────────────────

  let taskId;
  await test('Create task — status is pending', async () => {
    const res = await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST',
      headers: CASEWORKER,
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

  await test('claim again (already in_progress) → 409 CONFLICT', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/claim`, { method: 'POST', headers: OTHER_WORKER });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.code, 'CONFLICT');
  });

  await test('complete by wrong worker (callerIsAssignedWorker guard) → 409', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/complete`, {
      method: 'POST',
      headers: OTHER_WORKER,
      body: { outcome: 'approved' },
    });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.code, 'CONFLICT');
  });

  await test('await-client (in_progress → awaiting_client)', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/await-client`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'awaiting_client');
    assert.ok(data.blockedAt, 'blockedAt should be set');
  });

  await test('resume (awaiting_client → in_progress) — clears blockedAt', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/resume`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'in_progress');
    assert.strictEqual(data.blockedAt, null);
  });

  await test('await-verification (in_progress → awaiting_verification)', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/await-verification`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'awaiting_verification');
  });

  await test('system-resume (awaiting_verification → in_progress)', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/system-resume`, { method: 'POST', headers: SYSTEM });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'in_progress');
  });

  await test('system-resume by caseworker → 403 FORBIDDEN', async () => {
    // Put back into awaiting_verification first
    await fetch(`${BASE_URL}${TASK}/${taskId}/await-verification`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/system-resume`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'FORBIDDEN');
    // Clean up — resume via system so next tests can proceed
    await fetch(`${BASE_URL}${TASK}/${taskId}/system-resume`, { method: 'POST', headers: SYSTEM });
  });

  await test('submit-for-review (in_progress → pending_review)', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'pending_review');
  });

  await test('return-to-worker (pending_review → in_progress, supervisor)', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/return-to-worker`, { method: 'POST', headers: SUPERVISOR });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'in_progress');
  });

  await test('return-to-worker by caseworker → 403 FORBIDDEN', async () => {
    await fetch(`${BASE_URL}${TASK}/${taskId}/submit-for-review`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/return-to-worker`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 403);
    // Restore
    await fetch(`${BASE_URL}${TASK}/${taskId}/return-to-worker`, { method: 'POST', headers: SUPERVISOR });
  });

  await test('complete (in_progress → completed) — sets completedAt', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/complete`, {
      method: 'POST',
      headers: CASEWORKER,
      body: { outcome: 'approved' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'completed');
    assert.ok(data.completedAt, 'completedAt should be set');
    assert.strictEqual(data.outcome, 'approved');
  });

  await test('claim on completed task → 409 CONFLICT', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${taskId}/claim`, { method: 'POST', headers: OTHER_WORKER });
    assert.strictEqual(res.status, 409);
  });

  // ── Release path ─────────────────────────────────────────────────────────

  let task2Id;
  await test('release (in_progress → pending) — clears assignedToId', async () => {
    const create = await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Release test task', programType: 'snap' },
    });
    const created = await create.json();
    task2Id = created.id;
    await fetch(`${BASE_URL}${TASK}/${task2Id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${task2Id}/release`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'pending');
    assert.strictEqual(data.assignedToId, null);
  });

  // ── Escalation path ───────────────────────────────────────────────────────

  let task3Id;
  await test('supervisor escalate from pending → escalated', async () => {
    const create = await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Escalation test task', programType: 'snap' },
    });
    const created = await create.json();
    task3Id = created.id;
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/escalate`, { method: 'POST', headers: SUPERVISOR });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'escalated');
    assert.ok(data.escalatedAt, 'escalatedAt should be set');
  });

  await test('caseworker cannot escalate from pending → 403 FORBIDDEN', async () => {
    const create = await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Escalation guard test', programType: 'snap' },
    });
    const { id } = await create.json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/escalate`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 403);
  });

  await test('caseworker can escalate from in_progress', async () => {
    const create = await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Escalate from in_progress', programType: 'snap' },
    });
    const { id } = await create.json();
    await fetch(`${BASE_URL}${TASK}/${id}/claim`, { method: 'POST', headers: CASEWORKER });
    const res = await fetch(`${BASE_URL}${TASK}/${id}/escalate`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'escalated');
  });

  await test('de-escalate (escalated → pending, supervisor)', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/de-escalate`, { method: 'POST', headers: SUPERVISOR });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'pending');
  });

  // ── Cancel / reopen path ─────────────────────────────────────────────────

  await test('cancel (pending → cancelled, supervisor)', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/cancel`, { method: 'POST', headers: SUPERVISOR });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'cancelled');
    assert.ok(data.cancelledAt, 'cancelledAt should be set');
  });

  await test('caseworker cannot cancel → 403 FORBIDDEN', async () => {
    const create = await fetch(`${BASE_URL}${TASK}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Cancel guard test', programType: 'snap' },
    });
    const { id } = await create.json();
    const res = await fetch(`${BASE_URL}${TASK}/${id}/cancel`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 403);
  });

  await test('reopen (cancelled → pending, supervisor) — clears cancelledAt', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/reopen`, { method: 'POST', headers: SUPERVISOR });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'pending');
    assert.strictEqual(data.cancelledAt, null);
  });

  // ── In-place operations (no state change) ─────────────────────────────────

  await test('assign (supervisor) — updates assignedToId, no state change', async () => {
    const before = await (await fetch(`${BASE_URL}${TASK}/${task3Id}`)).json();
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/assign`, {
      method: 'POST', headers: SUPERVISOR,
      body: { assignedToId: 'worker-bbb' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, before.status, 'status should not change');
    assert.strictEqual(data.assignedToId, 'worker-bbb');
  });

  await test('assign by caseworker → 403 FORBIDDEN', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/assign`, {
      method: 'POST', headers: CASEWORKER,
      body: { assignedToId: 'worker-bbb' },
    });
    assert.strictEqual(res.status, 403);
  });

  await test('set-priority (supervisor) — updates priority, no state change', async () => {
    const before = await (await fetch(`${BASE_URL}${TASK}/${task3Id}`)).json();
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/set-priority`, {
      method: 'POST', headers: SUPERVISOR,
      body: { priority: 'high' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, before.status, 'status should not change');
    assert.strictEqual(data.priority, 'high');
  });

  await test('set-priority by caseworker → 403 FORBIDDEN', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/set-priority`, {
      method: 'POST', headers: CASEWORKER,
      body: { priority: 'high' },
    });
    assert.strictEqual(res.status, 403);
  });

  // ── Missing X-Caller-Id ───────────────────────────────────────────────────

  await test('transition without X-Caller-Id → 400 BAD_REQUEST', async () => {
    const res = await fetch(`${BASE_URL}${TASK}/${task3Id}/claim`, { method: 'POST' });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.code, 'BAD_REQUEST');
  });
}

// ---------------------------------------------------------------------------
// Intake: Application state machine
// ---------------------------------------------------------------------------

async function testIntakeStateMachine() {
  section('Intake — Application state machine');

  const APP = '/intake/applications';
  const APPLICANT = caller('applicant-1', 'applicant');
  const CASEWORKER = caller('worker-aaa', 'caseworker');
  const SUPERVISOR = caller('sup-1', 'supervisor');
  const SYSTEM = caller('system-1', 'system');

  // ── Core lifecycle ────────────────────────────────────────────────────────

  let appId;
  await test('Create application — status is draft', async () => {
    const res = await fetch(`${BASE_URL}${APP}`, {
      method: 'POST',
      headers: APPLICANT,
      body: { programs: ['snap'], channel: 'online' },
    });
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'draft');
    appId = data.id;
  });

  await test('submit (draft → submitted) — sets submittedAt', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/submit`, { method: 'POST', headers: APPLICANT });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'submitted');
    assert.ok(data.submittedAt, 'submittedAt should be set');
  });

  await test('submit already-submitted application → 409 CONFLICT', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/submit`, { method: 'POST', headers: APPLICANT });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.code, 'CONFLICT');
  });

  await test('open (submitted → under_review, system only)', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/open`, { method: 'POST', headers: SYSTEM });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'under_review');
  });

  await test('applicant cannot open → 403 FORBIDDEN', async () => {
    const create = await fetch(`${BASE_URL}${APP}`, {
      method: 'POST', headers: APPLICANT,
      body: { programs: ['snap'], channel: 'online' },
    });
    const { id } = await create.json();
    await fetch(`${BASE_URL}${APP}/${id}/submit`, { method: 'POST', headers: APPLICANT });
    const res = await fetch(`${BASE_URL}${APP}/${id}/open`, { method: 'POST', headers: APPLICANT });
    assert.strictEqual(res.status, 403);
  });

  await test('complete-review (under_review, no state change)', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/complete-review`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'under_review', 'status should remain under_review');
  });

  await test('close (under_review → closed) — sets closedAt', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/close`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'closed');
    assert.ok(data.closedAt, 'closedAt should be set');
  });

  await test('close already-closed application → 409 CONFLICT', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/close`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 409);
  });

  // ── Withdraw paths ────────────────────────────────────────────────────────

  await test('withdraw from submitted → withdrawn', async () => {
    const create = await fetch(`${BASE_URL}${APP}`, {
      method: 'POST', headers: APPLICANT,
      body: { programs: ['snap'], channel: 'online' },
    });
    const { id } = await create.json();
    await fetch(`${BASE_URL}${APP}/${id}/submit`, { method: 'POST', headers: APPLICANT });
    const res = await fetch(`${BASE_URL}${APP}/${id}/withdraw`, {
      method: 'POST', headers: APPLICANT,
      body: { reason: 'no longer needed' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'withdrawn');
    assert.ok(data.withdrawnAt, 'withdrawnAt should be set');
  });

  await test('withdraw from under_review → withdrawn', async () => {
    const create = await fetch(`${BASE_URL}${APP}`, {
      method: 'POST', headers: APPLICANT,
      body: { programs: ['snap'], channel: 'online' },
    });
    const { id } = await create.json();
    await fetch(`${BASE_URL}${APP}/${id}/submit`, { method: 'POST', headers: APPLICANT });
    await fetch(`${BASE_URL}${APP}/${id}/open`, { method: 'POST', headers: SYSTEM });
    const res = await fetch(`${BASE_URL}${APP}/${id}/withdraw`, {
      method: 'POST', headers: CASEWORKER,
      body: { reason: 'client request' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'withdrawn');
  });

  await test('withdraw from draft → 409 CONFLICT (not a valid from-state)', async () => {
    const create = await fetch(`${BASE_URL}${APP}`, {
      method: 'POST', headers: APPLICANT,
      body: { programs: ['snap'], channel: 'online' },
    });
    const { id } = await create.json();
    const res = await fetch(`${BASE_URL}${APP}/${id}/withdraw`, {
      method: 'POST', headers: APPLICANT,
      body: { reason: 'changed my mind' },
    });
    assert.strictEqual(res.status, 409);
  });

  // ── In-place operations ───────────────────────────────────────────────────

  await test('flag-expedited (submitted, no state change) — sets isExpedited', async () => {
    const create = await fetch(`${BASE_URL}${APP}`, {
      method: 'POST', headers: APPLICANT,
      body: { programs: ['snap'], channel: 'online' },
    });
    const { id } = await create.json();
    await fetch(`${BASE_URL}${APP}/${id}/submit`, { method: 'POST', headers: APPLICANT });
    const res = await fetch(`${BASE_URL}${APP}/${id}/flag-expedited`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'submitted', 'status should remain submitted');
    assert.strictEqual(data.isExpedited, true);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('State Machine Regression Tests\n');
  console.log('='.repeat(60));

  // Start server if not already running
  const isRunning = await isServerRunning().catch(() => false);
  if (!isRunning) {
    console.log('Starting mock server...');
    await startMockServer([contractsDir]);
    serverStartedByTests = true;
    await new Promise(res => setTimeout(res, 1500));
    console.log('Mock server started\n');
  } else {
    console.log('Using existing mock server\n');
  }

  try {
    await testWorkflowStateMachine();
    await testIntakeStateMachine();
  } finally {
    if (serverStartedByTests) await stopServer();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);

  if (totalFailed > 0) {
    console.log('\n❌ State machine regression tests FAILED\n');
    process.exit(1);
  } else {
    console.log('\n✓ All state machine regression tests passed\n');
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
