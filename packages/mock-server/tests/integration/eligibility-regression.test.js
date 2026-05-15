/**
 * Eligibility Domain State Machine Regression Tests
 *
 * Covers the Determination and Decision lifecycle: creation via event injection,
 * direct transitions, guard enforcement, and the cross-domain flows that
 * complete a Determination.
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
const EVENT_PREFIX = 'org.codeforamerica.safety-net-blueprint.';

let serverStartedByTests = false;
let totalPassed = 0;
let totalFailed = 0;

// ---------------------------------------------------------------------------
// HTTP helpers
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

async function injectEvent(type, data = {}, subject = 'sub-test-1') {
  return fetch(`${BASE_URL}/platform/events`, {
    method: 'POST',
    body: {
      specversion: '1.0',
      type: EVENT_PREFIX + type,
      source: '/test',
      subject,
      data
    }
  });
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
// Shared constants
// ---------------------------------------------------------------------------

const SYSTEM = caller('system-1', 'system');
const CASEWORKER = caller('worker-1', 'caseworker');

const DETERMINATIONS = '/eligibility/determinations';
const SERVICE_CALLS = '/data-exchange/service-calls';

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

async function testQueryEndpoints() {
  section('Eligibility — query endpoints');

  await test('GET /eligibility/determinations returns 200', async () => {
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.items), 'items should be an array');
  });

  await test('GET /eligibility/determinations/{id}/decisions returns 200', async () => {
    const appId = `app-qe-${Date.now()}`;
    await injectEvent('intake.application.submitted', { programs: ['snap'] }, appId);
    const { items: dets } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId}`)).json();
    assert.ok(dets.length > 0, 'Determination should exist for query test');
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${dets[0].id}/decisions`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.items), 'items should be an array');
  });
}

// ---------------------------------------------------------------------------
// Determination — created by intake.application.submitted event
// ---------------------------------------------------------------------------

async function testDeterminationCreation() {
  section('Determination — created on intake.application.submitted');

  const appId = `app-elig-${Date.now()}`;

  await test('intake.application.submitted → Determination created with status in_progress', async () => {
    await injectEvent('intake.application.submitted', { programs: ['snap'] }, appId);

    const res = await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId}`);
    assert.strictEqual(res.status, 200);
    const { items } = await res.json();
    assert.ok(items.length > 0, 'Determination should be created');
    assert.strictEqual(items[0].status, 'in_progress');
    assert.strictEqual(items[0].applicationId, appId);
  });

  await test('intake.application.submitted → one Decision created per program', async () => {
    const appId2 = `app-elig-${Date.now()}-2`;
    await injectEvent('intake.application.submitted', { programs: ['snap'] }, appId2);

    const { items: dets } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId2}`)).json();
    assert.ok(dets.length > 0, 'Determination should exist');
    const detId = dets[0].id;

    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions`);
    assert.strictEqual(res.status, 200);
    const { items: decisions } = await res.json();
    assert.ok(decisions.length > 0, 'at least one Decision should be created');
    const snapDecision = decisions.find(d => d.program === 'snap');
    assert.ok(snapDecision, 'SNAP Decision should be created');
    assert.strictEqual(snapDecision.status, 'pending');
  });

  await test('Medicaid submission creates a Medicaid Decision', async () => {
    const appId3 = `app-elig-${Date.now()}-3`;
    await injectEvent('intake.application.submitted', { programs: ['medicaid'] }, appId3);

    const { items: dets } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId3}`)).json();
    assert.ok(dets.length > 0, 'Determination should exist');
    const detId = dets[0].id;

    const { items: decisions } = await (await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions`)).json();
    const medicaidDecision = decisions.find(d => d.program === 'medicaid');
    assert.ok(medicaidDecision, 'Medicaid Decision should be created');
    assert.strictEqual(medicaidDecision.status, 'pending');
  });
}

// ---------------------------------------------------------------------------
// Determination — direct transitions
// ---------------------------------------------------------------------------

async function testDeterminationTransitions() {
  section('Determination — transitions');

  async function createDetermination(programs = ['snap']) {
    const appId = `app-det-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await injectEvent('intake.application.submitted', { programs }, appId);
    const { items } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId}`)).json();
    assert.ok(items.length > 0, 'Determination should exist');
    return items[0];
  }

  await test('flag-expedited (in_progress, no state change) — sets expeditedFlagged', async () => {
    const det = await createDetermination(['snap']);
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/flag-expedited`, {
      method: 'POST', headers: SYSTEM,
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'in_progress');
    assert.strictEqual(data.expeditedFlagged, true);
  });

  await test('flag-expedited by caseworker → 403 FORBIDDEN (system only)', async () => {
    const det = await createDetermination(['snap']);
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/flag-expedited`, {
      method: 'POST', headers: CASEWORKER,
    });
    assert.strictEqual(res.status, 403);
  });

  await test('complete (in_progress → completed) — sets completedAt', async () => {
    const det = await createDetermination(['snap']);
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/complete`, {
      method: 'POST', headers: SYSTEM,
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'completed');
    assert.ok(data.completedAt, 'completedAt should be set');
  });

  await test('complete by caseworker → 403 FORBIDDEN (system only)', async () => {
    const det = await createDetermination(['snap']);
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/complete`, {
      method: 'POST', headers: CASEWORKER,
    });
    assert.strictEqual(res.status, 403);
  });

  await test('complete already-completed → 409 CONFLICT', async () => {
    const det = await createDetermination(['snap']);
    await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/complete`, { method: 'POST', headers: SYSTEM });
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/complete`, { method: 'POST', headers: SYSTEM });
    assert.strictEqual(res.status, 409);
  });

  await test('withdraw (in_progress → withdrawn) — sets withdrawnAt', async () => {
    const det = await createDetermination(['snap']);
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/withdraw`, {
      method: 'POST', headers: SYSTEM,
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'withdrawn');
    assert.ok(data.withdrawnAt, 'withdrawnAt should be set');
  });
}

// ---------------------------------------------------------------------------
// Decision — direct transitions
// ---------------------------------------------------------------------------

async function testDecisionTransitions() {
  section('Decision — transitions');

  async function createDecision(program = 'snap') {
    const appId = `app-dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await injectEvent('intake.application.submitted', { programs: [program] }, appId);
    const { items: dets } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId}`)).json();
    assert.ok(dets.length > 0, 'Determination should exist');
    const detId = dets[0].id;
    const { items: decisions } = await (await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions`)).json();
    assert.ok(decisions.length > 0, 'Decision should exist');
    return { decision: decisions[0], detId };
  }

  await test('approve (pending → approved) — sets decidedAt and path', async () => {
    const { decision, detId } = await createDecision('snap');
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions/${decision.id}/approve`, {
      method: 'POST', headers: SYSTEM,
      body: { path: 'auto' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'approved');
    assert.strictEqual(data.path, 'auto');
    assert.ok(data.decidedAt, 'decidedAt should be set');
  });

  await test('approve by caseworker → 403 FORBIDDEN (system only)', async () => {
    const { decision, detId } = await createDecision('snap');
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions/${decision.id}/approve`, {
      method: 'POST', headers: CASEWORKER,
      body: { path: 'auto' },
    });
    assert.strictEqual(res.status, 403);
  });

  await test('approve without path → 422 (requestBody validation)', async () => {
    const { decision, detId } = await createDecision('snap');
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions/${decision.id}/approve`, {
      method: 'POST', headers: SYSTEM,
      body: {},
    });
    assert.strictEqual(res.status, 422);
  });

  await test('deny (pending → denied) — sets decidedAt, path, and denialReasonCode', async () => {
    const { decision, detId } = await createDecision('snap');
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions/${decision.id}/deny`, {
      method: 'POST', headers: SYSTEM,
      body: { path: 'auto', denialReasonCode: 'EXCEEDS_INCOME' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'denied');
    assert.strictEqual(data.denialReasonCode, 'EXCEEDS_INCOME');
    assert.ok(data.decidedAt, 'decidedAt should be set');
  });

  await test('deny without denialReasonCode → 422 (requestBody validation)', async () => {
    const { decision, detId } = await createDecision('snap');
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions/${decision.id}/deny`, {
      method: 'POST', headers: SYSTEM,
      body: { path: 'auto' },
    });
    assert.strictEqual(res.status, 422);
  });

  await test('mark-ineligible (pending → ineligible) — sets denialReasonCode', async () => {
    const { decision, detId } = await createDecision('snap');
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions/${decision.id}/mark-ineligible`, {
      method: 'POST', headers: SYSTEM,
      body: { path: 'auto', denialReasonCode: 'CITIZENSHIP_BAR' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'ineligible');
    assert.strictEqual(data.denialReasonCode, 'CITIZENSHIP_BAR');
  });

  await test('approve already-approved → 409 CONFLICT', async () => {
    const { decision, detId } = await createDecision('snap');
    await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions/${decision.id}/approve`, {
      method: 'POST', headers: SYSTEM, body: { path: 'auto' },
    });
    const res = await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions/${decision.id}/approve`, {
      method: 'POST', headers: SYSTEM, body: { path: 'auto' },
    });
    assert.strictEqual(res.status, 409);
  });
}

// ---------------------------------------------------------------------------
// Medicaid — Decision created; service call chain requires engine enhancement
// ---------------------------------------------------------------------------

async function testMedicaidServiceCalls() {
  section('Medicaid — Decision created on submission');

  // Note: the initiateMedicaidDataExchange procedure runs when eligibility.decision.created
  // fires. The mock server's procedure runner does not currently emit `created` events for
  // resources created inside procedures, so that event never fires and service calls are not
  // automatically created. That chain is a known gap; testing Decision creation here.

  await test('Medicaid submission creates a Medicaid Decision in pending state', async () => {
    const appId = `app-med-${Date.now()}`;
    await injectEvent('intake.application.submitted', { programs: ['medicaid'] }, appId);

    const { items: dets } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId}`)).json();
    assert.ok(dets.length > 0, 'Determination should exist');
    const detId = dets[0].id;
    const { items: decisions } = await (await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions`)).json();
    const decision = decisions.find(d => d.program === 'medicaid');
    assert.ok(decision, 'Medicaid Decision should exist');
    assert.strictEqual(decision.status, 'pending');
  });

  await test('SNAP submission does not create data-exchange service calls', async () => {
    const appId = `app-snap-sc-${Date.now()}`;
    await injectEvent('intake.application.submitted', { programs: ['snap'] }, appId);

    const { items: dets } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId}`)).json();
    const detId = dets[0].id;
    const { items: decisions } = await (await fetch(`${BASE_URL}${DETERMINATIONS}/${detId}/decisions`)).json();
    const decision = decisions[0];

    const { items: calls } = await (await fetch(`${BASE_URL}${SERVICE_CALLS}?limit=100`)).json();
    const decisionCalls = calls.filter(c => c.decisionId === decision.id);
    assert.strictEqual(decisionCalls.length, 0, 'SNAP Decision should not create data-exchange service calls');
  });
}

// ---------------------------------------------------------------------------
// Determination completes when all Decisions are resolved
// ---------------------------------------------------------------------------

async function testDeterminationCompletion() {
  section('Determination — completes when all Decisions resolved');

  await test('eligibility.application.decision_completed with no pending Decisions → Determination completes', async () => {
    const appId = `app-comp-${Date.now()}`;
    await injectEvent('intake.application.submitted', { programs: ['snap'] }, appId);

    const { items: dets } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId}`)).json();
    const det = dets[0];
    const { items: decisions } = await (await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/decisions`)).json();
    const decision = decisions[0];

    // Approve the only Decision — this emits decision_completed
    await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/decisions/${decision.id}/approve`, {
      method: 'POST', headers: SYSTEM, body: { path: 'auto' },
    });

    // decision_completed subscription checks for pending Decisions; finding none, completes the Determination
    const updated = await (await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}`)).json();
    assert.strictEqual(updated.status, 'completed', 'Determination should complete when all Decisions are resolved');
    assert.ok(updated.completedAt, 'completedAt should be set');
  });

  await test('second Decision still pending — Determination stays in_progress', async () => {
    const appId = `app-partial-${Date.now()}`;
    await injectEvent('intake.application.submitted', { programs: ['snap', 'medicaid'] }, appId);

    const { items: dets } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId}`)).json();
    const det = dets[0];
    const { items: decisions } = await (await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/decisions`)).json();
    assert.ok(decisions.length >= 2, 'should have at least 2 Decisions');

    // Approve only the SNAP Decision
    const snapDecision = decisions.find(d => d.program === 'snap');
    assert.ok(snapDecision, 'SNAP Decision should exist');
    await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}/decisions/${snapDecision.id}/approve`, {
      method: 'POST', headers: SYSTEM, body: { path: 'auto' },
    });

    // Medicaid Decision still pending — Determination should not complete
    const updated = await (await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}`)).json();
    assert.strictEqual(updated.status, 'in_progress', 'Determination should remain in_progress while a Decision is pending');
  });
}

// ---------------------------------------------------------------------------
// Application withdrawn → Determination withdrawn
// ---------------------------------------------------------------------------

async function testWithdrawal() {
  section('Determination — withdrawn on application.withdrawn');

  await test('intake.application.withdrawn → Determination withdrawn', async () => {
    const appId = `app-with-${Date.now()}`;
    await injectEvent('intake.application.submitted', { programs: ['snap'] }, appId);

    const { items: dets } = await (await fetch(`${BASE_URL}${DETERMINATIONS}?applicationId=${appId}`)).json();
    const det = dets[0];

    await injectEvent('intake.application.withdrawn', {}, appId);

    const updated = await (await fetch(`${BASE_URL}${DETERMINATIONS}/${det.id}`)).json();
    assert.strictEqual(updated.status, 'withdrawn', 'Determination should be withdrawn');
    assert.ok(updated.withdrawnAt, 'withdrawnAt should be set');
  });

  await test('intake.application.withdrawn for unknown applicationId — no error', async () => {
    const res = await injectEvent('intake.application.withdrawn', {}, 'nonexistent-app-id');
    assert.ok(res.status < 500, 'should not throw a server error for unknown application');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Eligibility Domain Regression Tests\n');
  console.log('='.repeat(60));

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
    await testQueryEndpoints();
    await testDeterminationCreation();
    await testDeterminationTransitions();
    await testDecisionTransitions();
    await testMedicaidServiceCalls();
    await testDeterminationCompletion();
    await testWithdrawal();
  } finally {
    if (serverStartedByTests) await stopServer();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);

  if (totalFailed > 0) {
    console.log('\n❌ Eligibility regression tests FAILED\n');
    process.exit(1);
  } else {
    console.log('\n✓ All eligibility regression tests passed\n');
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
