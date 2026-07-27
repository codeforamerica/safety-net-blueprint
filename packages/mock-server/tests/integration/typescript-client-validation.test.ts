/**
 * TypeScript client Zod validation sweep.
 *
 * These tests use the generated TypeScript SDK — which has zod response
 * validation built in — to exercise the mock server across all APIs. Any
 * response that doesn't match the resolved spec schema causes the SDK call
 * to throw, making schema/mock mismatches impossible to miss.
 *
 * Run with: npm run test:integration
 * (clients:generate runs automatically as a pre-step)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient as createIntakeClient } from './generated/intake/client/index.js';
import {
  createApplication,
  createApplicationMember,
  createIncome,
  listIncome,
  getIncome,
  getApplicationReview,
  getApplicationReviewIncomeSection,
} from './generated/intake/sdk.gen.js';
import { createClient as createUsersClient } from './generated/users/client/index.js';
import { listUsers, createUser, getUser } from './generated/users/sdk.gen.js';
import { createClient as createWorkflowClient } from './generated/workflow/client/index.js';
import { listQueues, getQueue, listTasks, createTask, getTask } from './generated/workflow/sdk.gen.js';
import { createClient as createCaseManagementClient } from './generated/case-management/client/index.js';
import { listCases, createCase, getCase } from './generated/case-management/sdk.gen.js';
import { createClient as createClientManagementClient } from './generated/client-management/client/index.js';
import { listPersons, createPerson, getPerson } from './generated/client-management/sdk.gen.js';
import { createClient as createSchedulingClient } from './generated/scheduling/client/index.js';
import { listAppointments, createAppointment, getAppointment } from './generated/scheduling/sdk.gen.js';
import { createClient as createDocumentManagementClient } from './generated/document-management/client/index.js';
import { listDocuments, listDocumentTypes } from './generated/document-management/sdk.gen.js';
import { createClient as createEligibilityClient } from './generated/eligibility/client/index.js';
import { listDeterminations, listDecisions } from './generated/eligibility/sdk.gen.js';
import { createClient as createPlatformClient } from './generated/platform/client/index.js';
import { listPolicies } from './generated/platform/sdk.gen.js';
import { createClient as createDataExchangeClient } from './generated/data-exchange/client/index.js';
import { listServices } from './generated/data-exchange/sdk.gen.js';
import { setupServer, teardownServer } from './helpers.js';

// Clients for each API
const intakeClient = createIntakeClient({ baseURL: 'http://localhost:1080/intake' });
const usersClient = createUsersClient({ baseURL: 'http://localhost:1080/identity-access' });
const workflowClient = createWorkflowClient({ baseURL: 'http://localhost:1080/workflow' });
const caseManagementClient = createCaseManagementClient({ baseURL: 'http://localhost:1080/case-management' });
const clientManagementClient = createClientManagementClient({ baseURL: 'http://localhost:1080' });
const schedulingClient = createSchedulingClient({ baseURL: 'http://localhost:1080/scheduling' });
const documentManagementClient = createDocumentManagementClient({ baseURL: 'http://localhost:1080/document-management' });
const eligibilityClient = createEligibilityClient({ baseURL: 'http://localhost:1080/eligibility' });
const platformClient = createPlatformClient({ baseURL: 'http://localhost:1080/platform' });
const dataExchangeClient = createDataExchangeClient({ baseURL: 'http://localhost:1080/data-exchange' });

// IDs generated during test setup — shared across tests in the suite.
let applicationId: string;
let memberId: string;
let incomeId: string;

describe('Client-side schema validation — income flow', () => {
  let serverStartedByTests = false;

  before(async () => {
    serverStartedByTests = await setupServer();
  });

  after(async () => {
    await teardownServer(serverStartedByTests);
  });

  it('creates an application', async () => {
    const res = await createApplication({
      client: intakeClient,
      body: {
        programsAppliedFor: ['snap'],
        channel: 'online',
      },
    });
    assert.equal(res.status, 201);
    applicationId = (res.data as { id: string }).id;
    assert.ok(applicationId, 'application id should be present');
  });

  it('creates a household member', async () => {
    const res = await createApplicationMember({
      client: intakeClient,
      path: { applicationId },
      body: {
        roles: ['primary_applicant'],
      },
    });
    assert.equal(res.status, 201);
    memberId = (res.data as { id: string }).id;
    assert.ok(memberId, 'member id should be present');
  });

  it('creates an income record', async () => {
    const res = await createIncome({
      client: intakeClient,
      path: { applicationId },
      body: {
        memberId,
        type: 'employed',
        amount: 3000,
        frequency: 'monthly',
      },
    });
    assert.equal(res.status, 201);
    incomeId = (res.data as { id: string }).id;
    assert.ok(incomeId, 'income id should be present');
  });

  it('lists incomes — zod validates each record matches the schema', async () => {
    // This is the Leo reproduction. The SDK call parses the response through
    // zod automatically (validator: true in the hey-api config). If the mock
    // returns a shape that doesn't match the resolved spec — e.g. an expanded
    // member object instead of memberId + links, or null on a non-nullable field —
    // this call throws a ZodError and the test fails.
    const res = await listIncome({
      client: intakeClient,
      path: { applicationId },
    });
    assert.equal(res.status, 200);
    const list = res.data as { items: unknown[]; total: number };
    assert.ok(Array.isArray(list.items), 'items should be an array');
    assert.ok(list.items.length > 0, 'should have at least one income record');
  });

  it('gets a single income — zod validates the record matches the schema', async () => {
    const res = await getIncome({
      client: intakeClient,
      path: { applicationId, incomeId },
    });
    assert.equal(res.status, 200);
    const income = res.data as { id: string; memberId: string };
    assert.equal(income.id, incomeId);
    assert.equal(income.memberId, memberId, 'memberId should be the FK uuid, not an expanded object');
  });
});

describe('Client-side schema validation — application review composition', () => {
  let serverStartedByTests = false;

  before(async () => {
    serverStartedByTests = await setupServer();
    // Create the full setup needed for composition endpoints.
    const appRes = await createApplication({ client: intakeClient, body: { programsAppliedFor: ['snap'], channel: 'online' } });
    applicationId = (appRes.data as { id: string }).id;

    const memberRes = await createApplicationMember({ client: intakeClient, path: { applicationId }, body: { roles: ['primary_applicant'] } });
    memberId = (memberRes.data as { id: string }).id;

    // Create three income records (mirrors Leslie's three seeded incomes in the steel thread).
    await createIncome({ client: intakeClient, path: { applicationId }, body: { memberId, type: 'employed', amount: 3000, frequency: 'monthly' } });
    await createIncome({ client: intakeClient, path: { applicationId }, body: { memberId, type: 'self_employed', amount: 1500, frequency: 'monthly' } });
    await createIncome({ client: intakeClient, path: { applicationId }, body: { memberId, type: 'unearned', amount: 500, frequency: 'monthly' } });
  });

  after(async () => {
    await teardownServer(serverStartedByTests);
  });

  it('gets the application review index — returns sections and no errors', async () => {
    const res = await getApplicationReview({ client: intakeClient, path: { applicationId } });
    assert.equal(res.status, 200);
    const review = res.data as Record<string, unknown>;
    assert.ok(review, 'review response should be present');
  });

  it('gets the income section — each income has memberId as a UUID, not an expanded member object', async () => {
    // This is the composition-layer reproduction of Leo's bug. The application review
    // income section composition projects [id, memberId, type, amount, frequency].
    // With a global x-relationship.style: expand overlay (as Colorado uses), the
    // resolved spec renames memberId → member: $ref: ApplicationMember.
    // The mock must return the correct shape for whichever style is configured.
    // With the blueprint default (links-only), memberId should be a UUID string.
    const res = await getApplicationReviewIncomeSection({ client: intakeClient, path: { applicationId } });
    assert.equal(res.status, 200);
    const section = res.data as { items: Record<string, unknown>[] };
    assert.ok(Array.isArray(section.items), 'income section should have items array');
    assert.ok(section.items.length >= 3, 'should have all three income records');

    for (const income of section.items) {
      // Guard against the expand bug: memberId must be a string UUID, not an object.
      assert.equal(typeof income.memberId, 'string', `income ${income.id}: memberId should be a string UUID`);
      assert.ok(
        /^[0-9a-f-]{36}$/.test(income.memberId as string),
        `income ${income.id}: memberId should be a valid UUID`
      );
      // No expanded member object should be present.
      assert.equal(income.member, undefined, `income ${income.id}: no expanded 'member' object should be present`);

      // Required non-nullable fields must not be null.
      assert.notEqual(income.id, null, `income ${income.id}: id must not be null`);
      assert.notEqual(income.type, null, `income ${income.id}: type must not be null`);
      assert.notEqual(income.amount, null, `income ${income.id}: amount must not be null`);
      assert.notEqual(income.frequency, null, `income ${income.id}: frequency must not be null`);
    }
  });
});

// Config-managed queue ID — survives mock/reset (seeded from workflow-config.yaml at startup)
const SEED_QUEUE_ID = 'ae5ed10f-657d-55f3-b53c-b381ec583a1e';

// Resource creation is done inside tests (not before hooks) so Zod validation
// failures surface as clear test failures rather than crashing the whole suite.
// Tests within a describe run in order, so later tests can use IDs captured earlier.

describe('Zod sweep — users', () => {
  let serverStartedByTests = false;
  let userId: string;
  before(async () => { serverStartedByTests = await setupServer(); });
  after(async () => { await teardownServer(serverStartedByTests); });

  it('createUser — response validates against schema', async () => {
    const res = await createUser({ client: usersClient, body: { idpSubject: 'sweep-zod-1', email: 'sweep-zod@example.com', roles: { name: 'case_worker' } } });
    assert.equal(res.status, 201);
    userId = (res.data as { id: string }).id;
    assert.ok(userId, 'created user must have an id');
  });

  it('listUsers — response validates against schema', async () => {
    const res = await listUsers({ client: usersClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getUser — response validates against schema', async () => {
    if (!userId) throw new Error('skipped: createUser must pass first');
    const res = await getUser({ client: usersClient, path: { userId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, userId);
  });
});

describe('Zod sweep — workflow', () => {
  let serverStartedByTests = false;
  let taskId: string;
  before(async () => { serverStartedByTests = await setupServer(); });
  after(async () => { await teardownServer(serverStartedByTests); });

  it('listQueues — response validates against schema', async () => {
    const res = await listQueues({ client: workflowClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getQueue — response validates against schema', async () => {
    const res = await getQueue({ client: workflowClient, path: { queueId: SEED_QUEUE_ID } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, SEED_QUEUE_ID);
  });

  it('createTask — response validates against schema', async () => {
    const res = await createTask({ client: workflowClient, body: { name: 'Sweep task', queueId: SEED_QUEUE_ID, priority: 3 } });
    assert.equal(res.status, 201);
    taskId = (res.data as { id: string }).id;
    assert.ok(taskId, 'created task must have an id');
  });

  it('listTasks — response validates against schema', async () => {
    const res = await listTasks({ client: workflowClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: createTask must pass first');
    const res = await getTask({ client: workflowClient, path: { taskId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, taskId);
  });
});

describe('Zod sweep — client-management', () => {
  let serverStartedByTests = false;
  let personId: string;
  before(async () => { serverStartedByTests = await setupServer(); });
  after(async () => { await teardownServer(serverStartedByTests); });

  it('createPerson — response validates against schema', async () => {
    const res = await createPerson({ client: clientManagementClient, body: {} });
    assert.equal(res.status, 201);
    personId = (res.data as { id: string }).id;
    assert.ok(personId, 'created person must have an id');
  });

  it('listPersons — response validates against schema', async () => {
    const res = await listPersons({ client: clientManagementClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getPerson — response validates against schema', async () => {
    if (!personId) throw new Error('skipped: createPerson must pass first');
    const res = await getPerson({ client: clientManagementClient, path: { personId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, personId);
  });
});

describe('Zod sweep — case-management', () => {
  let serverStartedByTests = false;
  let caseId: string;
  before(async () => { serverStartedByTests = await setupServer(); });
  after(async () => { await teardownServer(serverStartedByTests); });

  it('createCase — response validates against schema', async () => {
    // Person is created inline since case requires primaryApplicantId
    const personRes = await createPerson({ client: clientManagementClient, body: {} });
    assert.equal(personRes.status, 201, 'createPerson prerequisite must succeed');
    const primaryApplicantId = (personRes.data as { id: string }).id;
    const res = await createCase({ client: caseManagementClient, body: { status: 'active', primaryApplicantId } });
    assert.equal(res.status, 201);
    caseId = (res.data as { id: string }).id;
    assert.ok(caseId, 'created case must have an id');
  });

  it('listCases — response validates against schema', async () => {
    const res = await listCases({ client: caseManagementClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getCase — response validates against schema', async () => {
    if (!caseId) throw new Error('skipped: createCase must pass first');
    const res = await getCase({ client: caseManagementClient, path: { caseId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, caseId);
  });
});

describe('Zod sweep — scheduling', () => {
  let serverStartedByTests = false;
  let appointmentId: string;
  before(async () => { serverStartedByTests = await setupServer(); });
  after(async () => { await teardownServer(serverStartedByTests); });

  it('createAppointment — response validates against schema', async () => {
    // Person is created inline since appointment requires personId
    const personRes = await createPerson({ client: clientManagementClient, body: {} });
    assert.equal(personRes.status, 201, 'createPerson prerequisite must succeed');
    const personId = (personRes.data as { id: string }).id;
    const res = await createAppointment({ client: schedulingClient, body: {
      startAt: '2025-01-01T10:00:00Z', endAt: '2025-01-01T11:00:00Z',
      appointmentType: 'interview', status: 'scheduled', personId,
    }});
    assert.equal(res.status, 201);
    appointmentId = (res.data as { id: string }).id;
    assert.ok(appointmentId, 'created appointment must have an id');
  });

  it('listAppointments — response validates against schema', async () => {
    const res = await listAppointments({ client: schedulingClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getAppointment — response validates against schema', async () => {
    if (!appointmentId) throw new Error('skipped: createAppointment must pass first');
    const res = await getAppointment({ client: schedulingClient, path: { appointmentId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, appointmentId);
  });
});

describe('Zod sweep — document-management', () => {
  let serverStartedByTests = false;
  before(async () => { serverStartedByTests = await setupServer(); });
  after(async () => { await teardownServer(serverStartedByTests); });

  it('listDocuments — response validates against schema', async () => {
    const res = await listDocuments({ client: documentManagementClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('listDocumentTypes — response validates against schema', async () => {
    const res = await listDocumentTypes({ client: documentManagementClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });
});

describe('Zod sweep — eligibility', () => {
  let serverStartedByTests = false;
  before(async () => { serverStartedByTests = await setupServer(); });
  after(async () => { await teardownServer(serverStartedByTests); });

  // Determinations and decisions are read-only (created via state machine events).
  // Tests validate that the list endpoint shape matches the Zod schema when empty.
  it('listDeterminations — response validates against schema', async () => {
    const res = await listDeterminations({ client: eligibilityClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });
});

describe('Zod sweep — platform', () => {
  let serverStartedByTests = false;
  before(async () => { serverStartedByTests = await setupServer(); });
  after(async () => { await teardownServer(serverStartedByTests); });

  it('listPolicies — response validates against schema', async () => {
    const res = await listPolicies({ client: platformClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });
});

describe('Zod sweep — data-exchange', () => {
  let serverStartedByTests = false;
  before(async () => { serverStartedByTests = await setupServer(); });
  after(async () => { await teardownServer(serverStartedByTests); });

  it('listServices — response validates against schema', async () => {
    const res = await listServices({ client: dataExchangeClient });
    assert.ok(res.status === 200 || res.error === undefined, `listServices failed: status=${res.status}, error=${JSON.stringify(res.error)}`);
    assert.ok(Array.isArray((res.data as { items: unknown[] })?.items));
  });
});
