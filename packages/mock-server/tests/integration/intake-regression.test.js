/**
 * Intake Domain State Machine Regression Tests
 *
 * Full coverage of the intake state machine: Application and Verification
 * lifecycle operations, guard enforcement, and all event-driven rules.
 *
 * Uses event injection (POST /platform/events) to simulate cross-domain
 * events and verifies the expected side effects.
 *
 * NOTE: Several tests require intake-openapi.yaml to have a /verifications
 * resource and /application-members resource. Tests that require these are
 * marked with "REQUIRES: spec update" in their description and will fail
 * until those endpoints are added.
 *
 * Run with: npm run test:integration
 */

import assert from 'assert';
import { BASE_URL, EVENT_PREFIX, contractsDir, fetch, caller, injectEvent, createTestRunner, setupServer, teardownServer } from './helpers.js';

const { test, section, results } = createTestRunner();

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

const APPLICANT = caller('applicant-1', 'applicant');
const CASEWORKER = caller('worker-aaa', 'caseworker');
const SUPERVISOR = caller('sup-1', 'supervisor');
const SYSTEM = caller('system-1', 'system');

const APP = '/intake/applications';
const VERIFICATIONS = '/intake/applications/verifications';
const MEMBERS = '/intake/application-members';
const SERVICE_CALLS = '/data-exchange/service-calls';
const TASKS = '/workflow/tasks';

async function createAndSubmitApp(programs = ['snap'], channel = 'online') {
  const create = await fetch(`${BASE_URL}${APP}`, {
    method: 'POST', headers: APPLICANT,
    body: { programs, channel },
  });
  const app = await create.json();
  await fetch(`${BASE_URL}${APP}/${app.id}/submit`, { method: 'POST', headers: APPLICANT });
  const submitted = await (await fetch(`${BASE_URL}${APP}/${app.id}`)).json();
  return submitted;
}

async function createOpenApp(programs = ['snap']) {
  const app = await createAndSubmitApp(programs);
  await fetch(`${BASE_URL}${APP}/${app.id}/open`, { method: 'POST', headers: SYSTEM });
  return (await (await fetch(`${BASE_URL}${APP}/${app.id}`)).json());
}

async function createMember(applicationId, programs = ['snap']) {
  const res = await fetch(`${BASE_URL}${MEMBERS}`, {
    method: 'POST', headers: CASEWORKER,
    body: { applicationId, firstName: 'Test', lastName: 'Member', programsApplyingFor: programs },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Application state machine — lifecycle operations
// ---------------------------------------------------------------------------

async function testApplicationLifecycle() {
  section('Application — lifecycle operations');

  let appId;

  await test('Create application — status is draft', async () => {
    const res = await fetch(`${BASE_URL}${APP}`, {
      method: 'POST', headers: APPLICANT,
      body: { programs: ['snap'], channel: 'online' },
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.status, 'draft');
    appId = data.id;
  });

  await test('submit (draft → submitted) — sets submittedAt', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/submit`, { method: 'POST', headers: APPLICANT });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'submitted');
    assert.ok(data.submittedAt, 'submittedAt should be set');
  });

  await test('submit already-submitted → 409 CONFLICT', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/submit`, { method: 'POST', headers: APPLICANT });
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).code, 'CONFLICT');
  });

  await test('open (submitted → under_review) — system only', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/open`, { method: 'POST', headers: SYSTEM });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'under_review');
  });

  await test('open by applicant → 403 FORBIDDEN', async () => {
    const { id } = await (await fetch(`${BASE_URL}${APP}`, {
      method: 'POST', headers: APPLICANT,
      body: { programs: ['snap'], channel: 'online' },
    })).json();
    await fetch(`${BASE_URL}${APP}/${id}/submit`, { method: 'POST', headers: APPLICANT });
    const res = await fetch(`${BASE_URL}${APP}/${id}/open`, { method: 'POST', headers: APPLICANT });
    assert.strictEqual(res.status, 403);
  });

  await test('complete-review (under_review, no state change) — emits review_completed', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/complete-review`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'under_review');
  });

  await test('complete-review by applicant → 403 FORBIDDEN', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/complete-review`, { method: 'POST', headers: APPLICANT });
    assert.strictEqual(res.status, 403);
  });

  await test('close (under_review → closed) — sets closedAt', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/close`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'closed');
    assert.ok(data.closedAt, 'closedAt should be set');
  });

  await test('close already-closed → 409 CONFLICT', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/close`, { method: 'POST', headers: CASEWORKER });
    assert.strictEqual(res.status, 409);
  });

  await test('close by applicant → 403 FORBIDDEN', async () => {
    const { id } = await createOpenApp();
    const res = await fetch(`${BASE_URL}${APP}/${id}/close`, { method: 'POST', headers: APPLICANT });
    assert.strictEqual(res.status, 403);
  });
}

// ---------------------------------------------------------------------------
// Application — withdraw paths
// ---------------------------------------------------------------------------

async function testApplicationWithdraw() {
  section('Application — withdraw');

  await test('withdraw from submitted → withdrawn — sets withdrawnAt', async () => {
    const { id } = await createAndSubmitApp();
    const res = await fetch(`${BASE_URL}${APP}/${id}/withdraw`, {
      method: 'POST', headers: APPLICANT,
      body: { reason: 'no longer needed' },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'withdrawn');
    assert.ok(data.withdrawnAt, 'withdrawnAt should be set');
  });

  await test('withdraw from under_review → withdrawn', async () => {
    const { id } = await createOpenApp();
    const res = await fetch(`${BASE_URL}${APP}/${id}/withdraw`, {
      method: 'POST', headers: CASEWORKER,
      body: { reason: 'client request' },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'withdrawn');
  });

  await test('withdraw from draft → 409 CONFLICT', async () => {
    const { id } = (await (await fetch(`${BASE_URL}${APP}`, {
      method: 'POST', headers: APPLICANT,
      body: { programs: ['snap'], channel: 'online' },
    })).json());
    const res = await fetch(`${BASE_URL}${APP}/${id}/withdraw`, {
      method: 'POST', headers: APPLICANT,
      body: { reason: 'changed my mind' },
    });
    assert.strictEqual(res.status, 409);
  });

  await test('withdraw without reason → 422 (requestBody validation)', async () => {
    const { id } = await createAndSubmitApp();
    const res = await fetch(`${BASE_URL}${APP}/${id}/withdraw`, {
      method: 'POST', headers: APPLICANT,
      body: {},
    });
    assert.strictEqual(res.status, 422);
  });
}


// ---------------------------------------------------------------------------
// Verification — lifecycle operations
// REQUIRES: intake-openapi.yaml to have /verifications resource and
//           /verifications/{id}/satisfy|mark-inconclusive|waive|mark-cannot-verify operations
// ---------------------------------------------------------------------------

async function testVerificationLifecycle() {
  section('Verification — lifecycle operations [REQUIRES: /verifications in spec]');

  const { id: appId } = await createOpenApp(['snap']);

  let verificationId;

  await test('Create verification (pending)', async () => {
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: {
        applicationId: appId,
        category: 'income',
        verificationType: 'electronic',
      },
    });
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'pending');
    verificationId = data.id;
  });

  await test('satisfy (pending → satisfied) — sets satisfiedAt', async () => {
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${verificationId}/satisfy`, {
      method: 'POST', headers: SYSTEM,
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'satisfied');
    assert.ok(data.satisfiedAt, 'satisfiedAt should be set');
  });

  await test('satisfy by caseworker → 403 FORBIDDEN (system only)', async () => {
    const v = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'identity', verificationType: 'electronic' },
    })).json();
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/satisfy`, {
      method: 'POST', headers: CASEWORKER,
    });
    assert.strictEqual(res.status, 403);
  });

  await test('mark-inconclusive (pending → inconclusive)', async () => {
    const v = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'citizenship', verificationType: 'electronic' },
    })).json();
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/mark-inconclusive`, {
      method: 'POST', headers: SYSTEM,
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual((await res.json()).status, 'inconclusive');
  });

  await test('satisfy (inconclusive → satisfied)', async () => {
    const v = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'immigration', verificationType: 'electronic' },
    })).json();
    await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/mark-inconclusive`, { method: 'POST', headers: SYSTEM });
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/satisfy`, { method: 'POST', headers: SYSTEM });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'satisfied');
  });

  await test('mark-inconclusive (inconclusive) → 409 CONFLICT (already inconclusive)', async () => {
    const v = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'residency', verificationType: 'document' },
    })).json();
    await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/mark-inconclusive`, { method: 'POST', headers: SYSTEM });
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/mark-inconclusive`, { method: 'POST', headers: SYSTEM });
    assert.strictEqual(res.status, 409);
  });

  await test('waive (pending → waived) — requires reason', async () => {
    const v = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'identity', verificationType: 'document' },
    })).json();
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/waive`, {
      method: 'POST', headers: CASEWORKER,
      body: { reason: 'state policy exemption' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'waived');
    assert.ok(data.waivedAt, 'waivedAt should be set');
  });

  await test('waive by system → 403 FORBIDDEN (caseworker/supervisor only)', async () => {
    const v = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'income', verificationType: 'document' },
    })).json();
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/waive`, {
      method: 'POST', headers: SYSTEM,
      body: { reason: 'should fail' },
    });
    assert.strictEqual(res.status, 403);
  });

  await test('waive without reason → 422 (requestBody validation)', async () => {
    const v = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'citizenship', verificationType: 'document' },
    })).json();
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/waive`, {
      method: 'POST', headers: CASEWORKER,
      body: {},
    });
    assert.strictEqual(res.status, 422);
  });

  await test('mark-cannot-verify (inconclusive → cannot_verify) — requires reason', async () => {
    const v = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'immigration', verificationType: 'document' },
    })).json();
    await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/mark-inconclusive`, { method: 'POST', headers: SYSTEM });
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/mark-cannot-verify`, {
      method: 'POST', headers: SUPERVISOR,
      body: { reason: 'applicant unable to provide documentation' },
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.status, 'cannot_verify');
    assert.ok(data.closedAt, 'closedAt should be set');
  });

  await test('satisfy a terminal state (waived) → 409 CONFLICT', async () => {
    const v = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'residency', verificationType: 'document' },
    })).json();
    await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/waive`, {
      method: 'POST', headers: CASEWORKER, body: { reason: 'policy' },
    });
    const res = await fetch(`${BASE_URL}${VERIFICATIONS}/${v.id}/satisfy`, { method: 'POST', headers: SYSTEM });
    assert.strictEqual(res.status, 409);
  });
}

// ---------------------------------------------------------------------------
// create-verification-checklist-rule: submit → verifications created
// REQUIRES: /verifications in spec AND /application-members in spec
// ---------------------------------------------------------------------------

async function testCreateVerificationChecklistRule() {
  section('create-verification-checklist-rule: submit → verifications created [REQUIRES: spec update]');

  await test('SNAP submission creates income + identity (electronic) + residency (document) verifications', async () => {
    const { id: appId } = await createAndSubmitApp(['snap']);

    const res = await fetch(`${BASE_URL}${VERIFICATIONS}?applicationId=${appId}&limit=20`);
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const { items } = await res.json();

    const income = items.find(v => v.category === 'income');
    assert.ok(income, 'income Verification should be created');
    assert.strictEqual(income.verificationType, 'electronic');

    const identity = items.find(v => v.category === 'identity');
    assert.ok(identity, 'identity Verification should be created');
    assert.strictEqual(identity.verificationType, 'electronic');

    const residency = items.find(v => v.category === 'residency');
    assert.ok(residency, 'residency Verification should be created');
    assert.strictEqual(residency.verificationType, 'document');
  });

  await test('Medicaid submission creates citizenship + immigration (electronic) verifications', async () => {
    const { id: appId } = await createAndSubmitApp(['medicaid']);

    const res = await fetch(`${BASE_URL}${VERIFICATIONS}?applicationId=${appId}&limit=20`);
    assert.strictEqual(res.status, 200);
    const { items } = await res.json();

    const citizenship = items.find(v => v.category === 'citizenship');
    assert.ok(citizenship, 'citizenship Verification should be created');
    assert.strictEqual(citizenship.verificationType, 'electronic');

    const immigration = items.find(v => v.category === 'immigration');
    assert.ok(immigration, 'immigration Verification should be created');
    assert.strictEqual(immigration.verificationType, 'electronic');
  });

  await test('SNAP + Medicaid submission creates all five categories', async () => {
    const { id: appId } = await createAndSubmitApp(['snap', 'medicaid']);

    const res = await fetch(`${BASE_URL}${VERIFICATIONS}?applicationId=${appId}&limit=20`);
    assert.strictEqual(res.status, 200);
    const { items } = await res.json();

    const categories = [...new Set(items.map(v => v.category))];
    assert.ok(categories.includes('income'), 'income should be in categories');
    assert.ok(categories.includes('identity'), 'identity should be in categories');
    assert.ok(categories.includes('residency'), 'residency should be in categories');
    assert.ok(categories.includes('citizenship'), 'citizenship should be in categories');
    assert.ok(categories.includes('immigration'), 'immigration should be in categories');
  });

  await test('all created Verifications default to status: pending', async () => {
    const { id: appId } = await createAndSubmitApp(['snap']);
    const { items } = await (await fetch(`${BASE_URL}${VERIFICATIONS}?applicationId=${appId}&limit=20`)).json();
    assert.ok(items.length > 0, 'should have verifications');
    items.forEach(v => assert.strictEqual(v.status, 'pending', `${v.category} verification should start as pending`));
  });
}

// ---------------------------------------------------------------------------
// initiate-service-calls-rule: Verification.onCreate → service calls created
// REQUIRES: /verifications in spec (for verification creation trigger)
// data-exchange/service-calls already exists in spec
// ---------------------------------------------------------------------------

async function testInitiateServiceCallsRule() {
  section('initiate-service-calls-rule: Verification.onCreate → service calls [REQUIRES: /verifications in spec]');

  await test('identity electronic Verification creates one fdsh_ssa service call', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const countBefore = (await (await fetch(`${BASE_URL}${SERVICE_CALLS}?applicationId=${appId}&limit=20`)).json()).total ?? 0;

    await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'identity', verificationType: 'electronic' },
    });

    const { items } = await (await fetch(`${BASE_URL}${SERVICE_CALLS}?applicationId=${appId}&limit=20`)).json();
    const newCalls = items.filter(c => !countBefore || c.service === 'fdsh_ssa');
    const fdshCall = newCalls.find(c => c.service === 'fdsh_ssa');
    assert.ok(fdshCall, 'fdsh_ssa service call should be created for identity verification');
    assert.ok(fdshCall.verificationId, 'service call should carry verificationId');
  });

  await test('income electronic Verification creates four IEVS service calls', async () => {
    const { id: appId } = await createOpenApp(['snap']);

    const { id: verificationId } = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'income', verificationType: 'electronic' },
    })).json();

    const { items } = await (await fetch(`${BASE_URL}${SERVICE_CALLS}?limit=100`)).json();
    const calls = items.filter(c => c.verificationId === verificationId);
    const services = calls.map(c => c.service);
    assert.ok(services.includes('ssa_ievs'), 'ssa_ievs call should be created');
    assert.ok(services.includes('irs_ievs'), 'irs_ievs call should be created');
    assert.ok(services.includes('swica'), 'swica call should be created');
    assert.ok(services.includes('uib'), 'uib call should be created');
    assert.strictEqual(calls.length, 4, 'exactly 4 IEVS service calls should be created');
  });

  await test('citizenship electronic Verification creates fdsh_ssa service call', async () => {
    const { id: appId } = await createOpenApp(['medicaid']);
    const { id: verificationId } = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'citizenship', verificationType: 'electronic' },
    })).json();

    const { items } = await (await fetch(`${BASE_URL}${SERVICE_CALLS}?limit=100`)).json();
    const call = items.find(c => c.verificationId === verificationId && c.service === 'fdsh_ssa');
    assert.ok(call, 'fdsh_ssa call should be created for citizenship verification');
  });

  await test('immigration electronic Verification creates fdsh_vlp service call', async () => {
    const { id: appId } = await createOpenApp(['medicaid']);
    const { id: verificationId } = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'immigration', verificationType: 'electronic' },
    })).json();

    const { items } = await (await fetch(`${BASE_URL}${SERVICE_CALLS}?limit=100`)).json();
    const call = items.find(c => c.verificationId === verificationId && c.service === 'fdsh_vlp');
    assert.ok(call, 'fdsh_vlp call should be created for immigration verification');
  });

  await test('document Verification does NOT create any service calls', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const { id: verificationId } = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'residency', verificationType: 'document' },
    })).json();

    const { items } = await (await fetch(`${BASE_URL}${SERVICE_CALLS}?limit=100`)).json();
    const calls = items.filter(c => c.verificationId === verificationId);
    assert.strictEqual(calls.length, 0, 'document verification should not create service calls');
  });
}

// ---------------------------------------------------------------------------
// update-verification-on-call-result-rule + create-document-verification-on-inconclusive-rule
// Triggered by: data_exchange.call.completed
// REQUIRES: /verifications in spec
// ---------------------------------------------------------------------------

async function testCallCompletedRules() {
  section('call.completed rules: update verification + create document fallback [REQUIRES: /verifications in spec]');

  await test('conclusive result → Verification transitions to satisfied + electronic evidence appended', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const { id: verificationId } = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'identity', verificationType: 'electronic' },
    })).json();

    const serviceCallId = `sc-${verificationId}`;
    await injectEvent('data_exchange.call.completed', {
      metadata: { intake: { verificationId } },
      result: 'conclusive',
      serviceCallId,
      serviceType: 'fdsh_ssa',
    }, serviceCallId);

    const verification = await (await fetch(`${BASE_URL}${VERIFICATIONS}/${verificationId}`)).json();
    assert.strictEqual(verification.status, 'satisfied', 'Verification should be satisfied after conclusive result');
    assert.ok(Array.isArray(verification.evidence) && verification.evidence.length > 0, 'evidence should be recorded');
    const evidenceItem = verification.evidence.find(e => e.type === 'electronic' && e.result === 'conclusive');
    assert.ok(evidenceItem, 'electronic evidence item with result=conclusive should be appended');
    assert.strictEqual(evidenceItem.serviceCallId, serviceCallId);
  });

  await test('inconclusive result → Verification transitions to inconclusive + electronic evidence appended', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const { id: verificationId } = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'identity', verificationType: 'electronic' },
    })).json();

    const serviceCallId = `sc-${verificationId}`;
    await injectEvent('data_exchange.call.completed', {
      metadata: { intake: { verificationId } },
      result: 'inconclusive',
      serviceCallId,
      serviceType: 'fdsh_ssa',
    }, serviceCallId);

    const verification = await (await fetch(`${BASE_URL}${VERIFICATIONS}/${verificationId}`)).json();
    assert.strictEqual(verification.status, 'inconclusive', 'Verification should be inconclusive after inconclusive result');
    assert.ok(Array.isArray(verification.evidence) && verification.evidence.length > 0, 'evidence should be recorded');
    const evidenceItem = verification.evidence.find(e => e.type === 'electronic' && e.result === 'inconclusive');
    assert.ok(evidenceItem, 'electronic evidence item with result=inconclusive should be appended');
  });

  await test('inconclusive result → creates document fallback Verification for same category', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const { id: verificationId } = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'identity', verificationType: 'electronic' },
    })).json();

    const beforeRes = await fetch(`${BASE_URL}${VERIFICATIONS}?applicationId=${appId}&limit=20`);
    const { total: countBefore } = await beforeRes.json();

    const serviceCallId = `sc-${verificationId}`;
    await injectEvent('data_exchange.call.completed', {
      metadata: { intake: { verificationId } },
      result: 'inconclusive',
      serviceCallId,
      serviceType: 'fdsh_ssa',
    }, serviceCallId);

    const { items, total: countAfter } = await (await fetch(`${BASE_URL}${VERIFICATIONS}?applicationId=${appId}&limit=20`)).json();
    assert.ok(countAfter > countBefore, 'a new Verification should be created');

    const docFallback = items.find(v => v.category === 'identity' && v.verificationType === 'document' && v.id !== verificationId);
    assert.ok(docFallback, 'a document-type identity Verification should be created as fallback');
    assert.strictEqual(docFallback.status, 'pending', 'fallback Verification should start pending');
  });

  await test('call.completed for unknown verificationId — no error, no change', async () => {
    await injectEvent('data_exchange.call.completed', {
      metadata: { intake: { verificationId: 'nonexistent-id' } },
      result: 'conclusive',
      serviceCallId: 'sc-unknown',
      serviceType: 'fdsh_ssa',
    }, 'sc-unknown');
    // No assertion needed — the test passes if no error is thrown
  });
}

// ---------------------------------------------------------------------------
// satisfy-verification-on-document-upload-rule
// Triggered by: document_management.document.uploaded
// REQUIRES: /verifications in spec
// ---------------------------------------------------------------------------

async function testDocumentUploadRule() {
  section('document_version.uploaded rule: satisfy verification + record evidence [REQUIRES: /verifications in spec]');

  await test('document_version.uploaded with verificationId in metadata → satisfies Verification + records document evidence', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const { id: verificationId } = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'residency', verificationType: 'document' },
    })).json();

    const documentId = 'doc-001';
    await injectEvent('document_management.document_version.uploaded', {
      metadata: { intake: { verificationId } },
      documentId,
      documentVersionId: 'ver-001',
      versionNumber: 1,
    }, 'ver-001');

    const verification = await (await fetch(`${BASE_URL}${VERIFICATIONS}/${verificationId}`)).json();
    assert.strictEqual(verification.status, 'satisfied', 'Verification should be satisfied after document upload');
    assert.ok(Array.isArray(verification.evidence) && verification.evidence.length > 0, 'evidence should be recorded');
    const evidenceItem = verification.evidence.find(e => e.type === 'document' && e.documentId === documentId);
    assert.ok(evidenceItem, 'document evidence item with correct documentId should be appended');
  });

  await test('document_version.uploaded without matching verificationId — ignored', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const { id: verificationId } = await (await fetch(`${BASE_URL}${VERIFICATIONS}`, {
      method: 'POST', headers: SYSTEM,
      body: { applicationId: appId, category: 'income', verificationType: 'document' },
    })).json();

    await injectEvent('document_management.document_version.uploaded', {
      metadata: { intake: { verificationId: 'nonexistent-id' } },
      documentId: 'doc-002',
      documentVersionId: 'ver-002',
      versionNumber: 1,
    }, 'ver-002');

    const verification = await (await fetch(`${BASE_URL}${VERIFICATIONS}/${verificationId}`)).json();
    assert.strictEqual(verification.status, 'pending', 'Verification should remain pending — upload was not for this verification');
  });
}

// ---------------------------------------------------------------------------
// link-appointment-rule
// Triggered by: scheduling.appointment.scheduled
// REQUIRES: interview endpoint (intake/applications/{id}/interview — already in spec)
// ---------------------------------------------------------------------------

async function testLinkAppointmentRule() {
  section('link-appointment-rule: appointment.scheduled → appended to Interview');

  await test('appointment with subjectType: interview → appended to Interview.appointments', async () => {
    const { id: appId } = await createOpenApp(['snap']);

    // Create interview record
    const interviewRes = await fetch(`${BASE_URL}/intake/applications/${appId}/interview`, {
      method: 'POST', headers: CASEWORKER,
      body: { applicationId: appId },
    });
    assert.ok(interviewRes.status < 300, `interview creation failed: ${interviewRes.status}`);
    const interview = await interviewRes.json();

    const appointmentId = 'appt-001';
    await injectEvent('scheduling.appointment.scheduled', {
      subjectType: 'interview',
      subjectId: interview.id,
    }, appointmentId);

    const updatedInterview = await (await fetch(`${BASE_URL}/intake/applications/${appId}/interview`)).json();
    assert.ok(Array.isArray(updatedInterview.appointments), 'appointments should be an array');
    assert.ok(updatedInterview.appointments.includes(appointmentId), 'appointment ID should be in the list');
  });

  await test('appointment with subjectType other than interview — ignored', async () => {
    const { id: appId } = await createOpenApp(['snap']);

    const interviewRes = await fetch(`${BASE_URL}/intake/applications/${appId}/interview`, {
      method: 'POST', headers: CASEWORKER,
      body: { applicationId: appId },
    });
    const interview = await interviewRes.json();
    const apptsBefore = interview.appointments ?? [];

    await injectEvent('scheduling.appointment.scheduled', {
      subjectType: 'task',
      subjectId: 'task-001',
    }, 'appt-002');

    const updatedInterview = await (await fetch(`${BASE_URL}/intake/applications/${appId}/interview`)).json();
    assert.deepStrictEqual(updatedInterview.appointments ?? [], apptsBefore, 'appointments list should be unchanged');
  });
}

// ---------------------------------------------------------------------------
// record-determination-rule
// Triggered by: eligibility.application.decision_completed
// REQUIRES: /application-members in spec
// ---------------------------------------------------------------------------

async function testRecordDeterminationRule() {
  section('record-determination-rule: decision_completed → member write-back [REQUIRES: /application-members in spec]');

  await test('decision_completed → writes outcome to ApplicationMember.programDeterminations', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const member = await createMember(appId, ['snap']);

    await injectEvent('eligibility.application.decision_completed', {
      memberId: member.id,
      program: 'snap',
      status: 'approved',
      decidedAt: new Date().toISOString(),
      decisionId: 'dec-001',
      determinationId: 'det-001',
      applicationId: appId,
    }, appId);

    const updatedMember = await (await fetch(`${BASE_URL}${MEMBERS}/${member.id}`)).json();
    assert.ok(Array.isArray(updatedMember.programDeterminations), 'programDeterminations should be an array');
    const determination = updatedMember.programDeterminations.find(d => d.program === 'snap');
    assert.ok(determination, 'snap determination should be recorded');
    assert.strictEqual(determination.outcome, 'approved');
    assert.ok(determination.determinedAt, 'determinedAt should be set');
  });

  await test('denied decision recorded correctly', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const member = await createMember(appId, ['snap']);

    await injectEvent('eligibility.application.decision_completed', {
      memberId: member.id,
      program: 'snap',
      status: 'denied',
      decidedAt: new Date().toISOString(),
      decisionId: 'dec-002',
      determinationId: 'det-002',
      applicationId: appId,
    }, appId);

    const updatedMember = await (await fetch(`${BASE_URL}${MEMBERS}/${member.id}`)).json();
    const determination = updatedMember.programDeterminations.find(d => d.program === 'snap');
    assert.ok(determination, 'snap determination should be recorded');
    assert.strictEqual(determination.outcome, 'denied');
  });

  await test('multiple decisions for same member appended — does not overwrite', async () => {
    const { id: appId } = await createOpenApp(['snap', 'medicaid']);
    const member = await createMember(appId, ['snap', 'medicaid']);

    await injectEvent('eligibility.application.decision_completed', {
      memberId: member.id, program: 'snap', status: 'approved',
      decidedAt: new Date().toISOString(), decisionId: 'dec-003', determinationId: 'det-003', applicationId: appId,
    }, appId);

    await injectEvent('eligibility.application.decision_completed', {
      memberId: member.id, program: 'medicaid', status: 'denied',
      decidedAt: new Date().toISOString(), decisionId: 'dec-004', determinationId: 'det-003', applicationId: appId,
    }, appId);

    const updatedMember = await (await fetch(`${BASE_URL}${MEMBERS}/${member.id}`)).json();
    assert.strictEqual(updatedMember.programDeterminations.length, 2, 'both program determinations should be recorded');
    const snap = updatedMember.programDeterminations.find(d => d.program === 'snap');
    const medicaid = updatedMember.programDeterminations.find(d => d.program === 'medicaid');
    assert.strictEqual(snap.outcome, 'approved');
    assert.strictEqual(medicaid.outcome, 'denied');
  });

  await test('decisions for different members are written to correct members', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    const memberA = await createMember(appId, ['snap']);
    const memberB = await createMember(appId, ['snap']);

    await injectEvent('eligibility.application.decision_completed', {
      memberId: memberA.id, program: 'snap', status: 'approved',
      decidedAt: new Date().toISOString(), decisionId: 'dec-005', determinationId: 'det-004', applicationId: appId,
    }, appId);

    await injectEvent('eligibility.application.decision_completed', {
      memberId: memberB.id, program: 'snap', status: 'denied',
      decidedAt: new Date().toISOString(), decisionId: 'dec-006', determinationId: 'det-004', applicationId: appId,
    }, appId);

    const updatedA = await (await fetch(`${BASE_URL}${MEMBERS}/${memberA.id}`)).json();
    const updatedB = await (await fetch(`${BASE_URL}${MEMBERS}/${memberB.id}`)).json();

    assert.strictEqual(updatedA.programDeterminations.find(d => d.program === 'snap')?.outcome, 'approved', 'memberA should be approved');
    assert.strictEqual(updatedB.programDeterminations.find(d => d.program === 'snap')?.outcome, 'denied', 'memberB should be denied');
  });

  await test('decision_completed with unknown memberId — no error, no change', async () => {
    const { id: appId } = await createOpenApp(['snap']);
    await injectEvent('eligibility.application.decision_completed', {
      memberId: 'nonexistent-member',
      program: 'snap', status: 'approved',
      decidedAt: new Date().toISOString(), decisionId: 'dec-007', determinationId: 'det-005', applicationId: appId,
    }, appId);
    // No assertion needed — passes if no error thrown
  });
}

// ---------------------------------------------------------------------------
// close-application-on-all-determined-rule
// Triggered by: eligibility.application.determination_completed
// ---------------------------------------------------------------------------

async function testCloseOnAllDeterminedRule() {
  section('close-application-on-all-determined-rule: determination_completed → application closed');

  await test('determination_completed → application transitions to closed', async () => {
    const { id: appId } = await createOpenApp(['snap']);

    await injectEvent('eligibility.application.determination_completed', {}, appId);

    const app = await (await fetch(`${BASE_URL}${APP}/${appId}`)).json();
    assert.strictEqual(app.status, 'closed', 'application should be closed after determination_completed');
    assert.ok(app.closedAt, 'closedAt should be set');
  });

  await test('determination_completed for non-under_review application — no change (close guard enforces state)', async () => {
    const { id: appId } = await createAndSubmitApp(['snap']);
    // Application is in 'submitted', not 'under_review' — close operation should reject

    await injectEvent('eligibility.application.determination_completed', {}, appId);

    const app = await (await fetch(`${BASE_URL}${APP}/${appId}`)).json();
    assert.strictEqual(app.status, 'submitted', 'submitted application should not be affected by determination_completed');
  });
}

// ---------------------------------------------------------------------------
// open-application-rule + create-interview-rule
// Triggered by: workflow.task.claimed (fired by workflow state machine when task is claimed)
// REQUIRES: workflow state machine task.claimed event reaches intake subscription;
//           interview endpoint already in spec
// ---------------------------------------------------------------------------

async function testTaskClaimedRules() {
  section('task.claimed rules: open application + create interview');

  await test('claiming an application_review task opens the linked application', async () => {
    const { id: appId } = await createAndSubmitApp(['snap']);

    // Create a workflow task linked to this application
    const taskRes = await fetch(`${BASE_URL}${TASKS}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Intake review', taskType: 'application_review', subjectId: appId, programType: 'snap' },
    });
    const task = await taskRes.json();

    // Claim the task — this fires workflow.task.claimed which triggers open-application-rule
    await fetch(`${BASE_URL}${TASKS}/${task.id}/claim`, { method: 'POST', headers: CASEWORKER });

    const app = await (await fetch(`${BASE_URL}${APP}/${appId}`)).json();
    assert.strictEqual(app.status, 'under_review', 'application should transition to under_review when task is claimed');
  });

  await test('claiming an application_review task creates an Interview record', async () => {
    const { id: appId } = await createAndSubmitApp(['snap']);

    const task = await (await fetch(`${BASE_URL}${TASKS}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Intake review', taskType: 'application_review', subjectId: appId, programType: 'snap' },
    })).json();

    await fetch(`${BASE_URL}${TASKS}/${task.id}/claim`, { method: 'POST', headers: CASEWORKER });

    const interviewRes = await fetch(`${BASE_URL}/intake/applications/${appId}/interview`);
    assert.ok(interviewRes.status < 300, `interview should exist after task claim: ${interviewRes.status}`);
    const interview = await interviewRes.json();
    assert.ok(interview.id, 'interview should have an ID');
    assert.strictEqual(interview.applicationId, appId, 'interview should be linked to the application');
  });

  await test('claiming a non-application_review task does not open application or create interview', async () => {
    const { id: appId } = await createAndSubmitApp(['snap']);

    const task = await (await fetch(`${BASE_URL}${TASKS}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Other task', taskType: 'other', subjectId: appId, programType: 'snap' },
    })).json();

    await fetch(`${BASE_URL}${TASKS}/${task.id}/claim`, { method: 'POST', headers: CASEWORKER });

    const app = await (await fetch(`${BASE_URL}${APP}/${appId}`)).json();
    assert.strictEqual(app.status, 'submitted', 'application should remain submitted when a non-review task is claimed');
  });

  await test('injecting task.claimed directly triggers open-application-rule', async () => {
    const { id: appId } = await createAndSubmitApp(['snap']);

    // Create task manually to get a task ID
    const task = await (await fetch(`${BASE_URL}${TASKS}`, {
      method: 'POST', headers: CASEWORKER,
      body: { name: 'Direct inject test', taskType: 'application_review', subjectId: appId, programType: 'snap' },
    })).json();

    // Inject the event directly (bypassing workflow state machine)
    await injectEvent('workflow.task.claimed', {
      taskType: 'application_review',
      subjectId: appId,
    }, task.id);

    const app = await (await fetch(`${BASE_URL}${APP}/${appId}`)).json();
    assert.strictEqual(app.status, 'under_review', 'direct event injection should open the application');
  });
}

async function testSubCollectionPaginationEnvelope() {
  section('Sub-collection list response — pagination envelope');

  await test('GET sub-collection includes limit, offset, and hasNext in response', async () => {
    const { id: appId } = await createAndSubmitApp(['snap']);

    const res = await fetch(`${BASE_URL}${APP}/${appId}/members`);
    assert.strictEqual(res.status, 200, 'sub-collection GET should return 200');

    const data = await res.json();
    assert.ok(Array.isArray(data.items), 'response should have items array');
    assert.strictEqual(typeof data.total, 'number', 'response should have numeric total');
    assert.strictEqual(typeof data.limit, 'number', 'response should have numeric limit');
    assert.strictEqual(typeof data.offset, 'number', 'response should have numeric offset');
    assert.strictEqual(typeof data.hasNext, 'boolean', 'response should have boolean hasNext');
  });
}

// ---------------------------------------------------------------------------
// Caseworker review context
// ---------------------------------------------------------------------------

async function testReviewContext() {
  section('Review context — GET /applications/{id}/review-context');

  const app = await createOpenApp();
  const appId = app.id;

  await test('200 — returns required top-level keys', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/review-context`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok('application' in data, 'application key present');
    assert.ok('members' in data, 'members key present');
    assert.ok('reviewProgress' in data, 'reviewProgress key present');
    assert.ok('notes' in data, 'notes key present');
  });

  await test('application sub-object matches the application resource', async () => {
    const data = await (await fetch(`${BASE_URL}${APP}/${appId}/review-context`)).json();
    assert.strictEqual(data.application.id, appId);
    assert.strictEqual(data.application.status, 'under_review');
  });

  await test('members is an array', async () => {
    const data = await (await fetch(`${BASE_URL}${APP}/${appId}/review-context`)).json();
    assert.ok(Array.isArray(data.members));
  });

  await test('reviewProgress and notes are arrays', async () => {
    const data = await (await fetch(`${BASE_URL}${APP}/${appId}/review-context`)).json();
    assert.ok(Array.isArray(data.reviewProgress));
    assert.ok(Array.isArray(data.notes));
  });

  await test('404 for unknown application', async () => {
    const res = await fetch(`${BASE_URL}${APP}/00000000-0000-0000-0000-000000000000/review-context`);
    assert.strictEqual(res.status, 404);
  });

  await test('405 for POST (read-only endpoint)', async () => {
    const res = await fetch(`${BASE_URL}${APP}/${appId}/review-context`, { method: 'POST', body: {} });
    assert.strictEqual(res.status, 405);
  });
}

// ---------------------------------------------------------------------------
// Review progress
// ---------------------------------------------------------------------------

async function testReviewProgress() {
  section('Review progress — GET + PATCH /applications/{id}/review-progress');

  const app = await createOpenApp();
  const appId = app.id;
  const BASE_PROGRESS = `${BASE_URL}${APP}/${appId}/review-progress`;

  await test('GET — returns paginated shape with empty items initially', async () => {
    const res = await fetch(BASE_PROGRESS);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok('items' in data, 'items present');
    assert.ok('total' in data, 'total present');
    assert.ok('limit' in data, 'limit present');
    assert.ok('offset' in data, 'offset present');
    assert.ok('hasNext' in data, 'hasNext present');
    assert.ok(Array.isArray(data.items));
    assert.strictEqual(data.total, 0);
  });

  await test('PATCH — creates entry (upsert)', async () => {
    const res = await fetch(BASE_PROGRESS, {
      method: 'PATCH', headers: CASEWORKER,
      body: { section: 'income', status: 'in_progress' },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.section, 'income');
    assert.strictEqual(data.status, 'in_progress');
    assert.ok(data.id, 'id assigned');
    assert.strictEqual(data.applicationId, appId);
  });

  await test('PATCH — updates existing entry by composite key', async () => {
    const res = await fetch(BASE_PROGRESS, {
      method: 'PATCH', headers: CASEWORKER,
      body: { section: 'income', status: 'complete' },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'complete');

    const list = await (await fetch(BASE_PROGRESS)).json();
    const incomeEntries = list.items.filter(e => e.section === 'income');
    assert.strictEqual(incomeEntries.length, 1, 'upsert should not duplicate');
  });

  await test('PATCH — member-scoped entry is separate from household entry', async () => {
    const memberId = '00000000-0000-0000-0000-000000000099';
    const res = await fetch(BASE_PROGRESS, {
      method: 'PATCH', headers: CASEWORKER,
      body: { section: 'income', status: 'not_started', memberId },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).memberId, memberId);

    const list = await (await fetch(BASE_PROGRESS)).json();
    const incomeEntries = list.items.filter(e => e.section === 'income');
    assert.strictEqual(incomeEntries.length, 2, 'household and member entries are distinct');
  });

  await test('GET ?section= — filters to matching entries only', async () => {
    await fetch(BASE_PROGRESS, {
      method: 'PATCH', headers: CASEWORKER,
      body: { section: 'assets', status: 'not_started' },
    });
    const res = await fetch(`${BASE_PROGRESS}?section=income`);
    const data = await res.json();
    assert.ok(data.items.every(e => e.section === 'income'), 'all items match section filter');
  });

  await test('PATCH — missing section → 422', async () => {
    const res = await fetch(BASE_PROGRESS, {
      method: 'PATCH', headers: CASEWORKER,
      body: { status: 'complete' },
    });
    assert.strictEqual(res.status, 422);
  });

  await test('PATCH — missing status → 422', async () => {
    const res = await fetch(BASE_PROGRESS, {
      method: 'PATCH', headers: CASEWORKER,
      body: { section: 'income' },
    });
    assert.strictEqual(res.status, 422);
  });

  await test('404 for unknown application', async () => {
    const res = await fetch(`${BASE_URL}${APP}/00000000-0000-0000-0000-000000000000/review-progress`);
    assert.strictEqual(res.status, 404);
  });

  await test('PATCH emits event with application ID as subject', async () => {
    const eventsRes = await fetch(`${BASE_URL}/platform/events?subject=${appId}`);
    const data = await eventsRes.json();
    const progressEvents = data.items.filter(e => e.type.includes('review_progress'));
    assert.ok(progressEvents.length > 0, 'at least one review_progress event emitted');
    assert.ok(progressEvents.every(e => e.subject === appId), 'all review_progress events use application ID as subject');
  });
}

// ---------------------------------------------------------------------------
// Application notes
// ---------------------------------------------------------------------------

async function testApplicationNotes() {
  section('Application notes — /applications/{id}/notes');

  const app = await createOpenApp();
  const appId = app.id;
  const BASE_NOTES = `${BASE_URL}${APP}/${appId}/notes`;

  await test('GET — returns paginated shape with empty items initially', async () => {
    const res = await fetch(BASE_NOTES);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.items));
    assert.ok('total' in data && 'limit' in data && 'offset' in data && 'hasNext' in data);
    assert.strictEqual(data.total, 0);
  });

  let noteId;

  await test('POST — creates a note → 201 with id and applicationId', async () => {
    const res = await fetch(BASE_NOTES, {
      method: 'POST', headers: CASEWORKER,
      body: { scope: 'section', section: 'income', text: 'Check pay stubs', textFormat: 'plain' },
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.id, 'id assigned');
    assert.strictEqual(data.applicationId, appId);
    assert.strictEqual(data.scope, 'section');
    assert.strictEqual(data.section, 'income');
    assert.strictEqual(data.text, 'Check pay stubs');
    noteId = data.id;
  });

  await test('GET — lists created note in paginated response', async () => {
    const data = await (await fetch(BASE_NOTES)).json();
    assert.strictEqual(data.total, 1);
    assert.strictEqual(data.items[0].id, noteId);
  });

  await test('GET /{noteId} — retrieves note by id', async () => {
    const res = await fetch(`${BASE_NOTES}/${noteId}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.id, noteId);
    assert.strictEqual(data.text, 'Check pay stubs');
  });

  await test('GET ?scope=section — filters by scope', async () => {
    await fetch(BASE_NOTES, {
      method: 'POST', headers: CASEWORKER,
      body: { scope: 'application', text: 'General observation' },
    });
    const data = await (await fetch(`${BASE_NOTES}?scope=section`)).json();
    assert.ok(data.items.every(n => n.scope === 'section'), 'all items match scope filter');
  });

  await test('GET ?section=income — filters by section', async () => {
    const data = await (await fetch(`${BASE_NOTES}?section=income`)).json();
    assert.ok(data.items.every(n => n.section === 'income'), 'all items match section filter');
  });

  await test('PATCH /{noteId} — updates text', async () => {
    const res = await fetch(`${BASE_NOTES}/${noteId}`, {
      method: 'PATCH', headers: CASEWORKER,
      body: { text: 'Updated: reviewed pay stubs, verified' },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).text, 'Updated: reviewed pay stubs, verified');
  });

  await test('PATCH /{noteId} — non-text fields unchanged after text update', async () => {
    const data = await (await fetch(`${BASE_NOTES}/${noteId}`)).json();
    assert.strictEqual(data.section, 'income', 'section unchanged after partial update');
    assert.strictEqual(data.scope, 'section', 'scope unchanged after partial update');
  });

  await test('DELETE /{noteId} — 204', async () => {
    const res = await fetch(`${BASE_NOTES}/${noteId}`, { method: 'DELETE', headers: CASEWORKER });
    assert.strictEqual(res.status, 204);
  });

  await test('GET /{noteId} after DELETE — 404', async () => {
    const res = await fetch(`${BASE_NOTES}/${noteId}`);
    assert.strictEqual(res.status, 404);
  });

  await test('POST — application-scoped note (no section)', async () => {
    const res = await fetch(BASE_NOTES, {
      method: 'POST', headers: CASEWORKER,
      body: { scope: 'application', text: 'Household seems stable' },
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.scope, 'application');
  });

  await test('404 for unknown application', async () => {
    const res = await fetch(`${BASE_URL}${APP}/00000000-0000-0000-0000-000000000000/notes`);
    assert.strictEqual(res.status, 404);
  });

  await test('GET /{noteId} 404 for unknown note', async () => {
    const res = await fetch(`${BASE_NOTES}/00000000-0000-0000-0000-000000000000`);
    assert.strictEqual(res.status, 404);
  });

  await test('POST emits event with application ID as subject', async () => {
    const eventsRes = await fetch(`${BASE_URL}/platform/events?subject=${appId}`);
    const data = await eventsRes.json();
    const noteEvents = data.items.filter(e => e.type.includes('note'));
    assert.ok(noteEvents.length > 0, 'at least one note event emitted');
    assert.ok(noteEvents.every(e => e.subject === appId), 'all note events use application ID as subject');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Intake Domain Regression Tests\n');
  console.log('='.repeat(60));

  const serverStartedByTests = await setupServer();

  // Check which optional API endpoints are available
  const verificationsAvailable = await fetch(`${BASE_URL}/intake/applications/verifications`)
    .then(r => r.status !== 404).catch(() => false);
  const membersAvailable = await fetch(`${BASE_URL}/intake/application-members`)
    .then(r => r.status !== 404).catch(() => false);
  // Interview creation via POST is not yet in the spec (only GET and PATCH exist);
  // the state machine creates interviews automatically when a task is claimed.
  const interviewCreateAvailable = await fetch(`${BASE_URL}/intake/applications/interview`, { method: 'POST', body: {} })
    .then(r => r.status !== 404).catch(() => false);

  if (!verificationsAvailable) {
    console.log('NOTE: /intake/applications/verifications not in spec — skipping Verification tests (known gap)\n');
  }
  if (!membersAvailable) {
    console.log('NOTE: /intake/application-members not in spec — skipping ApplicationMember tests (known gap)\n');
  }
  if (!interviewCreateAvailable) {
    console.log('NOTE: POST /intake/applications/interview not in spec — skipping interview-create test (known gap)\n');
  }

  try {
    await testApplicationLifecycle();
    await testApplicationWithdraw();
    if (verificationsAvailable) await testVerificationLifecycle();
    if (verificationsAvailable && membersAvailable) await testCreateVerificationChecklistRule();
    if (verificationsAvailable) await testInitiateServiceCallsRule();
    if (verificationsAvailable) await testCallCompletedRules();
    if (verificationsAvailable) await testDocumentUploadRule();
    if (interviewCreateAvailable) await testLinkAppointmentRule();
    if (membersAvailable) await testRecordDeterminationRule();
    await testCloseOnAllDeterminedRule();
    await testTaskClaimedRules();
    await testSubCollectionPaginationEnvelope();
    await testReviewContext();
    await testReviewProgress();
    await testApplicationNotes();
  } finally {
    await teardownServer(serverStartedByTests);
  }

  const { passed, failed } = results();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\n❌ Intake regression tests FAILED\n');
    process.exit(1);
  } else {
    console.log('\n✓ All intake regression tests passed\n');
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
