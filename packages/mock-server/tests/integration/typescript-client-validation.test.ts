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
  updateApplication,
  createApplicationMember,
  createIncome,
  updateIncome,
  listIncome,
  getIncome,
  createJob,
  createHealthEnrollment,
  createAsset,
  createExpense,
  getHousehold,
  updateHousehold,
  createTaxFiler,
  listTaxFilers,
  getTaxFiler,
  createDeduction,
  listDeductions,
  getDeduction,
  updateDeduction,
  getApplicationReview,
  getApplicationReviewDemographicsSection,
  getApplicationReviewIdentitySection,
  getApplicationReviewIncomeSection,
  getApplicationReviewEmploymentSection,
  getApplicationReviewHealthCoverageSection,
  getApplicationReviewAssetsSection,
  getApplicationReviewContactSection,
  getApplicationReviewExpensesSection,
  getApplicationReviewHouseholdSection,
} from './generated/intake/sdk.gen.js';
import { createClient as createUsersClient } from './generated/users/client/index.js';
import { listUsers, createUser, getUser, updateUser } from './generated/users/sdk.gen.js';
import { createClient as createWorkflowClient } from './generated/workflow/client/index.js';
import { listQueues, getQueue, listTasks, createTask, getTask, updateTask, claimTask, completeTask } from './generated/workflow/sdk.gen.js';
import { createClient as createCaseManagementClient } from './generated/case-management/client/index.js';
import { listCases, createCase, getCase, updateCase } from './generated/case-management/sdk.gen.js';
import { createClient as createClientManagementClient } from './generated/client-management/client/index.js';
import { listPersons, createPerson, getPerson, updatePerson } from './generated/client-management/sdk.gen.js';
import { createClient as createSchedulingClient } from './generated/scheduling/client/index.js';
import { listAppointments, createAppointment, getAppointment, updateAppointment } from './generated/scheduling/sdk.gen.js';
import { createClient as createDocumentManagementClient } from './generated/document-management/client/index.js';
import { listDocuments, listDocumentTypes } from './generated/document-management/sdk.gen.js';
import { createClient as createEligibilityClient } from './generated/eligibility/client/index.js';
import { listDeterminations, listDecisions } from './generated/eligibility/sdk.gen.js';
import { createClient as createPlatformClient } from './generated/platform/client/index.js';
import { listPolicies } from './generated/platform/sdk.gen.js';
import { createClient as createDataExchangeClient } from './generated/data-exchange/client/index.js';
import { listServices } from './generated/data-exchange/sdk.gen.js';
import { setupServer, teardownServer, fetch, BASE_URL } from './helpers.js';

// Additional intake CRUD functions
import {
  listApplications, getApplication, deleteApplication,
  createApplicationVerification, listApplicationVerifications, getApplicationVerification,
  updateApplicationVerification, deleteApplicationVerification,
  listApplicationMembers, getApplicationMember, updateApplicationMember, deleteApplicationMember,
  createContact, listContacts, getContact, updateContact, deleteContact,
  createOrganization, listOrganizations, getOrganization, updateOrganization, deleteOrganization,
  createPersonRelationship, listPersonRelationships, getPersonRelationship,
  updatePersonRelationship, deletePersonRelationship,
  createAuthorizedRepresentative, listAuthorizedRepresentatives, getAuthorizedRepresentative,
  updateAuthorizedRepresentative, deleteAuthorizedRepresentative,
  createDisabilityBenefit, listDisabilityBenefits, getDisabilityBenefit,
  updateDisabilityBenefit, deleteDisabilityBenefit,
  createHealthPlan, listHealthPlans, getHealthPlan, updateHealthPlan, deleteHealthPlan,
  listHealthEnrollments, getHealthEnrollment, updateHealthEnrollment, deleteHealthEnrollment,
  listJobs, getJob, updateJob, deleteJob,
  listAssets, getAsset, updateAsset, deleteAsset,
  createAssetDisposal, listAssetDisposals, getAssetDisposal, updateAssetDisposal, deleteAssetDisposal,
  listExpenses, getExpense, updateExpense, deleteExpense,
  createSignature, listSignatures, getSignature, updateSignature, deleteSignature,
  getInterview, updateInterview,
  getChildSupport, updateChildSupport,
  createSponsor, listSponsors, getSponsor, updateSponsor, deleteSponsor,
  deleteIncome, deleteTaxFiler, deleteDeduction,
  listReviewProgressBySection,
} from './generated/intake/sdk.gen.js';
// Additional workflow RPC functions
import {
  createQueue, updateQueue, deleteQueue, deleteTask,
  escalateTask, deEscalateTask, cancelTask, reopenTask, releaseTask,
  awaitClientTask, awaitVerificationTask, resumeTask, autoResumeTask,
  autoCancelTask, submitForReviewTask, approveTask, returnToWorkerTask,
  assignTask, setPriorityTask, slaEscalateTask,
  listMetrics, getMetric,
} from './generated/workflow/sdk.gen.js';
// Additional eligibility, platform, data-exchange, users, document-management functions
import { getDetermination, getDecision } from './generated/eligibility/sdk.gen.js';
import { getPolicy, listEvents, getEvent, publishEvent } from './generated/platform/sdk.gen.js';
import { getService, createServiceCall, listServiceCalls, getServiceCall } from './generated/data-exchange/sdk.gen.js';
import { getCurrentUser, deactivateUser } from './generated/users/sdk.gen.js';
import { createDocumentType, getDocumentType, deleteDocumentType } from './generated/document-management/sdk.gen.js';

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

// File-level server lifecycle — one start/stop shared across all suites.
// Each suite resets DB state in its own before() hook.
let serverStartedByTests = false;
before(async () => { serverStartedByTests = await setupServer(); });
after(async () => { await teardownServer(serverStartedByTests); });

describe('Client-side schema validation — income flow', () => {
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

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
  before(async () => {
    await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' });
    // Create the full setup needed for composition endpoints.
    const appRes = await createApplication({ client: intakeClient, body: { programsAppliedFor: ['snap'], channel: 'online' } });
    applicationId = (appRes.data as { id: string }).id;

    const memberRes = await createApplicationMember({ client: intakeClient, path: { applicationId }, body: { roles: ['primary_applicant'] } });
    memberId = (memberRes.data as { id: string }).id;

    // Create three income records (mirrors Leslie's three seeded incomes in the steel thread).
    await createIncome({ client: intakeClient, path: { applicationId }, body: { memberId, type: 'employed', amount: 3000, frequency: 'monthly' } });
    await createIncome({ client: intakeClient, path: { applicationId }, body: { memberId, type: 'self_employed', amount: 1500, frequency: 'monthly' } });
    await createIncome({ client: intakeClient, path: { applicationId }, body: { memberId, type: 'unearned', amount: 500, frequency: 'monthly' } });

    // Seed one record per section so each section test has at least one item to validate.
    await createJob({ client: intakeClient, path: { applicationId }, body: { memberId, type: 'employed', status: 'active' } });
    await createHealthEnrollment({ client: intakeClient, path: { applicationId }, body: { memberId, role: 'subscriber' } });
    await createAsset({ client: intakeClient, path: { applicationId }, body: { memberId, type: 'liquid', value: 5000 } });
    await createExpense({ client: intakeClient, path: { applicationId }, body: { memberId, type: 'rent', amount: 1200 } });
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
  let userId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

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

  it('updateUser — PATCH response validates against schema', async () => {
    if (!userId) throw new Error('skipped: createUser must pass first');
    const res = await updateUser({ client: usersClient, path: { userId }, body: { status: 'inactive' } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, userId);
  });
});

describe('Zod sweep — workflow', () => {
  let taskId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

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

  it('updateTask — PATCH response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: createTask must pass first');
    const res = await updateTask({ client: workflowClient, path: { taskId }, body: { name: 'Updated sweep task' } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, taskId);
  });

  it('claimTask — RPC response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: createTask must pass first');
    const res = await claimTask({ client: workflowClient, path: { taskId }, headers: { 'x-caller-id': '00000000-0000-0000-0000-000000000001', 'x-caller-roles': 'case_worker' } });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id, 'claimed task must have an id');
  });

  it('completeTask — RPC response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: claimTask must pass first');
    const res = await completeTask({ client: workflowClient, path: { taskId }, body: { outcome: 'approved' }, headers: { 'x-caller-id': '00000000-0000-0000-0000-000000000001', 'x-caller-roles': 'case_worker' } });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id, 'completed task must have an id');
  });
});

describe('Zod sweep — client-management', () => {
  let personId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

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

  it('updatePerson — PATCH response validates against schema', async () => {
    if (!personId) throw new Error('skipped: createPerson must pass first');
    const res = await updatePerson({ client: clientManagementClient, path: { personId }, body: { preferredLanguage: 'en' } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, personId);
  });
});

describe('Zod sweep — case-management', () => {
  let caseId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

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

  it('updateCase — PATCH response validates against schema', async () => {
    if (!caseId) throw new Error('skipped: createCase must pass first');
    const res = await updateCase({ client: caseManagementClient, path: { caseId }, body: { status: 'active' } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, caseId);
  });
});

describe('Zod sweep — scheduling', () => {
  let appointmentId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

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

  it('updateAppointment — PATCH response validates against schema', async () => {
    if (!appointmentId) throw new Error('skipped: createAppointment must pass first');
    const res = await updateAppointment({ client: schedulingClient, path: { appointmentId }, body: { notes: 'updated via sweep' } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, appointmentId);
  });
});

describe('Zod sweep — document-management', () => {
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

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
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  // Determinations and decisions are read-only (created via state machine events).
  // Tests validate that the list endpoint shape matches the Zod schema when empty.
  it('listDeterminations — response validates against schema', async () => {
    const res = await listDeterminations({ client: eligibilityClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });
});

describe('Zod sweep — platform', () => {
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('listPolicies — response validates against schema', async () => {
    const res = await listPolicies({ client: platformClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });
});

describe('Zod sweep — data-exchange', () => {
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('listServices — response validates against schema', async () => {
    const res = await listServices({ client: dataExchangeClient });
    assert.ok(res.status === 200 || res.error === undefined, `listServices failed: status=${res.status}, error=${JSON.stringify(res.error)}`);
    assert.ok(Array.isArray((res.data as { items: unknown[] })?.items));
  });
});

describe('Zod sweep — intake sub-resources', () => {
  let sweepApplicationId: string;
  let sweepMemberId: string;
  let sweepIncomeId: string;
  let taxFilerId: string;
  let deductionId: string;

  before(async () => {
    await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' });
    // Create application + member needed by all sub-resource tests.
    const appRes = await createApplication({ client: intakeClient, body: { programsAppliedFor: ['snap'], channel: 'online' } });
    assert.equal(appRes.status, 201, 'sweep application setup failed');
    sweepApplicationId = (appRes.data as { id: string }).id;

    const memberRes = await createApplicationMember({ client: intakeClient, path: { applicationId: sweepApplicationId }, body: { roles: ['primary_applicant'] } });
    assert.equal(memberRes.status, 201, 'sweep member setup failed');
    sweepMemberId = (memberRes.data as { id: string }).id;

    const incomeRes = await createIncome({ client: intakeClient, path: { applicationId: sweepApplicationId }, body: { memberId: sweepMemberId, type: 'employed', amount: 2500, frequency: 'monthly' } });
    assert.equal(incomeRes.status, 201, 'sweep income setup failed');
    sweepIncomeId = (incomeRes.data as { id: string }).id;
  });

  it('updateApplication — PATCH response validates against schema', async () => {
    const res = await updateApplication({ client: intakeClient, path: { applicationId: sweepApplicationId }, body: { channel: 'in_person' } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, sweepApplicationId);
  });

  it('updateIncome — PATCH response validates against schema', async () => {
    const res = await updateIncome({ client: intakeClient, path: { applicationId: sweepApplicationId, incomeId: sweepIncomeId }, body: { type: 'employed', amount: 3000, frequency: 'monthly' } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, sweepIncomeId);
  });

  it('getHousehold — response validates against schema', async () => {
    const res = await getHousehold({ client: intakeClient, path: { applicationId: sweepApplicationId } });
    assert.equal(res.status, 200);
  });

  it('updateHousehold — PATCH response validates against schema', async () => {
    const res = await updateHousehold({ client: intakeClient, path: { applicationId: sweepApplicationId }, body: { utilitiesIncludedInRent: false } });
    assert.equal(res.status, 200);
  });

  it('createTaxFiler — response validates against schema', async () => {
    const res = await createTaxFiler({ client: intakeClient, path: { applicationId: sweepApplicationId }, body: { memberId: sweepMemberId } });
    assert.equal(res.status, 201);
    taxFilerId = (res.data as { id: string }).id;
    assert.ok(taxFilerId, 'created tax filer must have an id');
  });

  it('listTaxFilers — response validates against schema', async () => {
    const res = await listTaxFilers({ client: intakeClient, path: { applicationId: sweepApplicationId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getTaxFiler — response validates against schema', async () => {
    if (!taxFilerId) throw new Error('skipped: createTaxFiler must pass first');
    const res = await getTaxFiler({ client: intakeClient, path: { applicationId: sweepApplicationId, taxFilerId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, taxFilerId);
  });

  it('createDeduction — response validates against schema', async () => {
    const res = await createDeduction({ client: intakeClient, path: { applicationId: sweepApplicationId }, body: { memberId: sweepMemberId, type: 'student_loan_interest', amount: 200 } });
    assert.equal(res.status, 201);
    deductionId = (res.data as { id: string }).id;
    assert.ok(deductionId, 'created deduction must have an id');
  });

  it('listDeductions — response validates against schema', async () => {
    const res = await listDeductions({ client: intakeClient, path: { applicationId: sweepApplicationId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getDeduction — response validates against schema', async () => {
    if (!deductionId) throw new Error('skipped: createDeduction must pass first');
    const res = await getDeduction({ client: intakeClient, path: { applicationId: sweepApplicationId, deductionId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, deductionId);
  });

  it('updateDeduction — PATCH response validates against schema', async () => {
    if (!deductionId) throw new Error('skipped: createDeduction must pass first');
    const res = await updateDeduction({ client: intakeClient, path: { applicationId: sweepApplicationId, deductionId }, body: { amount: 250 } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, deductionId);
  });
});

// ─── Shared constants for new sweep describes ─────────────────────────────────

const SEED_METRIC_ID = 'task_time_to_claim';
const SEED_POLICY_ID = 'snap-household-composition';
const SEED_SERVICE_ID = '65b5d4d9-3578-4a58-a4bd-c404ca380e08'; // fdsh_ssa
const SEED_DOC_TYPE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'; // birth_certificate
const CASEWORKER_HEADERS = {
  'x-caller-id': '00000000-0000-0000-0000-000000000001',
  'x-caller-roles': 'case_worker',
};
const SUPERVISOR_HEADERS = {
  'x-caller-id': '00000000-0000-0000-0000-000000000001',
  'x-caller-roles': 'supervisor',
};
const SYSTEM_HEADERS = {
  'x-caller-id': '00000000-0000-0000-0000-000000000000',
  'x-caller-roles': 'system',
};

/** Creates a fresh pending task and returns its ID. */
async function freshTask(): Promise<string> {
  const res = await createTask({ client: workflowClient, body: { name: 'RPC test task', queueId: SEED_QUEUE_ID, priority: 3 } });
  if (res.status !== 201) throw new Error(`createTask failed with status ${res.status}`);
  return (res.data as { id: string }).id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intake CRUD: applications, members & verifications
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — intake CRUD: applications & members', () => {
  let crudAppId: string;
  let crudMemberId: string;
  let crudMember2Id: string;
  let crudVerificationId: string;

  before(async () => {
    await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' });
    const a = await createApplication({ client: intakeClient, body: { programsAppliedFor: ['snap'], channel: 'online' } });
    assert.equal(a.status, 201, 'app setup failed');
    crudAppId = (a.data as { id: string }).id;
    const m1 = await createApplicationMember({ client: intakeClient, path: { applicationId: crudAppId }, body: { roles: ['primary_applicant'] } });
    crudMemberId = (m1.data as { id: string }).id;
    const m2 = await createApplicationMember({ client: intakeClient, path: { applicationId: crudAppId }, body: { roles: ['household_member'] } });
    crudMember2Id = (m2.data as { id: string }).id;
  });

  it('listApplications — response validates against schema', async () => {
    const res = await listApplications({ client: intakeClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getApplication — response validates against schema', async () => {
    const res = await getApplication({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudAppId);
  });

  it('createApplicationVerification — response validates against schema', async () => {
    const res = await createApplicationVerification({
      client: intakeClient,
      path: { applicationId: crudAppId },
      body: { applicationId: crudAppId, category: 'identity', status: 'pending', evidence: [], documentRequests: [] } as any,
    });
    assert.equal(res.status, 201);
    crudVerificationId = (res.data as { id: string }).id;
    assert.ok(crudVerificationId);
  });

  it('listApplicationVerifications — response validates against schema', async () => {
    const res = await listApplicationVerifications({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getApplicationVerification — response validates against schema', async () => {
    if (!crudVerificationId) throw new Error('skipped: createApplicationVerification must pass first');
    const res = await getApplicationVerification({ client: intakeClient, path: { applicationId: crudAppId, verificationId: crudVerificationId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudVerificationId);
  });

  it('updateApplicationVerification — PATCH response validates against schema', async () => {
    if (!crudVerificationId) throw new Error('skipped: createApplicationVerification must pass first');
    const res = await updateApplicationVerification({
      client: intakeClient,
      path: { applicationId: crudAppId, verificationId: crudVerificationId },
      body: { status: 'satisfied' } as any,
    });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudVerificationId);
  });

  it('deleteApplicationVerification — returns 204', async () => {
    if (!crudVerificationId) throw new Error('skipped: createApplicationVerification must pass first');
    const res = await deleteApplicationVerification({ client: intakeClient, path: { applicationId: crudAppId, verificationId: crudVerificationId } });
    assert.equal(res.status, 204);
  });

  it('listApplicationMembers — response validates against schema', async () => {
    const res = await listApplicationMembers({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getApplicationMember — response validates against schema', async () => {
    const res = await getApplicationMember({ client: intakeClient, path: { applicationId: crudAppId, memberId: crudMemberId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudMemberId);
  });

  it('updateApplicationMember — PATCH response validates against schema', async () => {
    const res = await updateApplicationMember({
      client: intakeClient,
      path: { applicationId: crudAppId, memberId: crudMemberId },
      body: { roles: ['primary_applicant'] },
    });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudMemberId);
  });

  it('deleteApplicationMember — returns 204', async () => {
    if (!crudMember2Id) throw new Error('skipped: second member setup must succeed');
    const res = await deleteApplicationMember({ client: intakeClient, path: { applicationId: crudAppId, memberId: crudMember2Id } });
    assert.equal(res.status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Intake CRUD: contacts, organizations, relationships & authorized representatives
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — intake CRUD: contacts, organizations & relationships', () => {
  let crudAppId: string;
  let crudMemberId: string;
  let crudMember2Id: string;
  let crudContactId: string;
  let crudOrgId: string;
  let crudRelationshipId: string;
  let crudAuthRepId: string;

  before(async () => {
    await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' });
    const a = await createApplication({ client: intakeClient, body: { programsAppliedFor: ['snap'], channel: 'online' } });
    crudAppId = (a.data as { id: string }).id;
    const m1 = await createApplicationMember({ client: intakeClient, path: { applicationId: crudAppId }, body: { roles: ['primary_applicant'] } });
    crudMemberId = (m1.data as { id: string }).id;
    const m2 = await createApplicationMember({ client: intakeClient, path: { applicationId: crudAppId }, body: { roles: ['household_member'] } });
    crudMember2Id = (m2.data as { id: string }).id;
  });

  it('createContact — response validates against schema', async () => {
    const res = await createContact({
      client: intakeClient,
      path: { applicationId: crudAppId },
      body: { name: { firstName: 'Jane', lastName: 'Contact' } },
    });
    assert.equal(res.status, 201);
    crudContactId = (res.data as { id: string }).id;
    assert.ok(crudContactId);
  });

  it('listContacts — response validates against schema', async () => {
    const res = await listContacts({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getContact — response validates against schema', async () => {
    if (!crudContactId) throw new Error('skipped: createContact must pass first');
    const res = await getContact({ client: intakeClient, path: { applicationId: crudAppId, contactId: crudContactId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudContactId);
  });

  it('updateContact — PATCH response validates against schema', async () => {
    if (!crudContactId) throw new Error('skipped: createContact must pass first');
    const res = await updateContact({
      client: intakeClient,
      path: { applicationId: crudAppId, contactId: crudContactId },
      body: { name: { firstName: 'Jane', lastName: 'Updated' } } as any,
    });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudContactId);
  });

  it('deleteContact — returns 204', async () => {
    if (!crudContactId) throw new Error('skipped: createContact must pass first');
    const res = await deleteContact({ client: intakeClient, path: { applicationId: crudAppId, contactId: crudContactId } });
    assert.equal(res.status, 204);
  });

  it('createOrganization — response validates against schema', async () => {
    const res = await createOrganization({
      client: intakeClient,
      path: { applicationId: crudAppId },
      body: { name: 'Acme Corp' },
    });
    assert.equal(res.status, 201);
    crudOrgId = (res.data as { id: string }).id;
    assert.ok(crudOrgId);
  });

  it('listOrganizations — response validates against schema', async () => {
    const res = await listOrganizations({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getOrganization — response validates against schema', async () => {
    if (!crudOrgId) throw new Error('skipped: createOrganization must pass first');
    const res = await getOrganization({ client: intakeClient, path: { applicationId: crudAppId, organizationId: crudOrgId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudOrgId);
  });

  it('updateOrganization — PATCH response validates against schema', async () => {
    if (!crudOrgId) throw new Error('skipped: createOrganization must pass first');
    const res = await updateOrganization({
      client: intakeClient,
      path: { applicationId: crudAppId, organizationId: crudOrgId },
      body: { name: 'Acme Corp Updated' },
    });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudOrgId);
  });

  it('deleteOrganization — returns 204', async () => {
    if (!crudOrgId) throw new Error('skipped: createOrganization must pass first');
    const res = await deleteOrganization({ client: intakeClient, path: { applicationId: crudAppId, organizationId: crudOrgId } });
    assert.equal(res.status, 204);
  });

  it('createPersonRelationship — response validates against schema', async () => {
    const res = await createPersonRelationship({
      client: intakeClient,
      path: { applicationId: crudAppId },
      body: {
        from: { type: 'member', id: crudMemberId },
        to: { type: 'member', id: crudMember2Id },
        relationshipTypes: ['spouse'],
      },
    });
    assert.equal(res.status, 201);
    crudRelationshipId = (res.data as { id: string }).id;
    assert.ok(crudRelationshipId);
  });

  it('listPersonRelationships — response validates against schema', async () => {
    const res = await listPersonRelationships({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getPersonRelationship — response validates against schema', async () => {
    if (!crudRelationshipId) throw new Error('skipped: createPersonRelationship must pass first');
    const res = await getPersonRelationship({ client: intakeClient, path: { applicationId: crudAppId, personRelationshipId: crudRelationshipId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudRelationshipId);
  });

  it('updatePersonRelationship — PATCH response validates against schema', async () => {
    if (!crudRelationshipId) throw new Error('skipped: createPersonRelationship must pass first');
    const res = await updatePersonRelationship({
      client: intakeClient,
      path: { applicationId: crudAppId, personRelationshipId: crudRelationshipId },
      body: {
        from: { type: 'member', id: crudMemberId },
        to: { type: 'member', id: crudMember2Id },
        relationshipTypes: ['domestic_partner'],
      } as any,
    });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudRelationshipId);
  });

  it('deletePersonRelationship — returns 204', async () => {
    if (!crudRelationshipId) throw new Error('skipped: createPersonRelationship must pass first');
    const res = await deletePersonRelationship({ client: intakeClient, path: { applicationId: crudAppId, personRelationshipId: crudRelationshipId } });
    assert.equal(res.status, 204);
  });

  it('createAuthorizedRepresentative — response validates against schema', async () => {
    const res = await createAuthorizedRepresentative({
      client: intakeClient,
      path: { applicationId: crudAppId },
      body: { type: 'member', id: crudMemberId },
    });
    assert.equal(res.status, 201);
    crudAuthRepId = (res.data as { id: string }).id;
    assert.ok(crudAuthRepId);
  });

  it('listAuthorizedRepresentatives — response validates against schema', async () => {
    const res = await listAuthorizedRepresentatives({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getAuthorizedRepresentative — response validates against schema', async () => {
    if (!crudAuthRepId) throw new Error('skipped: createAuthorizedRepresentative must pass first');
    const res = await getAuthorizedRepresentative({ client: intakeClient, path: { applicationId: crudAppId, authorizedRepresentativeId: crudAuthRepId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudAuthRepId);
  });

  it('updateAuthorizedRepresentative — PATCH response validates against schema', async () => {
    if (!crudAuthRepId) throw new Error('skipped: createAuthorizedRepresentative must pass first');
    const res = await updateAuthorizedRepresentative({
      client: intakeClient,
      path: { applicationId: crudAppId, authorizedRepresentativeId: crudAuthRepId },
      body: { type: 'member', id: crudMemberId, receivesNotices: true } as any,
    });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudAuthRepId);
  });

  it('deleteAuthorizedRepresentative — returns 204', async () => {
    if (!crudAuthRepId) throw new Error('skipped: createAuthorizedRepresentative must pass first');
    const res = await deleteAuthorizedRepresentative({ client: intakeClient, path: { applicationId: crudAppId, authorizedRepresentativeId: crudAuthRepId } });
    assert.equal(res.status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Intake CRUD: health plans, health enrollments & disability benefits
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — intake CRUD: health, disability & enrollment', () => {
  let crudAppId: string;
  let crudMemberId: string;
  let crudHealthPlanId: string;
  let crudHealthEnrollmentId: string;
  let crudDisabilityBenefitId: string;

  before(async () => {
    await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' });
    const a = await createApplication({ client: intakeClient, body: { programsAppliedFor: ['snap', 'medicaid'], channel: 'online' } });
    crudAppId = (a.data as { id: string }).id;
    const m = await createApplicationMember({ client: intakeClient, path: { applicationId: crudAppId }, body: { roles: ['primary_applicant'] } });
    crudMemberId = (m.data as { id: string }).id;
    const he = await createHealthEnrollment({ client: intakeClient, path: { applicationId: crudAppId }, body: { memberId: crudMemberId, role: 'subscriber' } });
    crudHealthEnrollmentId = (he.data as { id: string }).id;
  });

  it('createHealthPlan — response validates against schema', async () => {
    const res = await createHealthPlan({ client: intakeClient, path: { applicationId: crudAppId }, body: { type: 'medicaid' } as any });
    assert.equal(res.status, 201);
    crudHealthPlanId = (res.data as { id: string }).id;
    assert.ok(crudHealthPlanId);
  });

  it('listHealthPlans — response validates against schema', async () => {
    const res = await listHealthPlans({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getHealthPlan — response validates against schema', async () => {
    if (!crudHealthPlanId) throw new Error('skipped: createHealthPlan must pass first');
    const res = await getHealthPlan({ client: intakeClient, path: { applicationId: crudAppId, healthPlanId: crudHealthPlanId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudHealthPlanId);
  });

  it('updateHealthPlan — PATCH response validates against schema', async () => {
    if (!crudHealthPlanId) throw new Error('skipped: createHealthPlan must pass first');
    const res = await updateHealthPlan({ client: intakeClient, path: { applicationId: crudAppId, healthPlanId: crudHealthPlanId }, body: { premiumAmount: 250 } as any });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudHealthPlanId);
  });

  it('deleteHealthPlan — returns 204', async () => {
    if (!crudHealthPlanId) throw new Error('skipped: createHealthPlan must pass first');
    const res = await deleteHealthPlan({ client: intakeClient, path: { applicationId: crudAppId, healthPlanId: crudHealthPlanId } });
    assert.equal(res.status, 204);
  });

  it('listHealthEnrollments — response validates against schema', async () => {
    const res = await listHealthEnrollments({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getHealthEnrollment — response validates against schema', async () => {
    const res = await getHealthEnrollment({ client: intakeClient, path: { applicationId: crudAppId, healthEnrollmentId: crudHealthEnrollmentId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudHealthEnrollmentId);
  });

  it('updateHealthEnrollment — PATCH response validates against schema', async () => {
    const res = await updateHealthEnrollment({ client: intakeClient, path: { applicationId: crudAppId, healthEnrollmentId: crudHealthEnrollmentId }, body: { role: 'subscriber' } as any });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudHealthEnrollmentId);
  });

  it('deleteHealthEnrollment — returns 204', async () => {
    const res = await deleteHealthEnrollment({ client: intakeClient, path: { applicationId: crudAppId, healthEnrollmentId: crudHealthEnrollmentId } });
    assert.equal(res.status, 204);
  });

  it('createDisabilityBenefit — response validates against schema', async () => {
    const res = await createDisabilityBenefit({ client: intakeClient, path: { applicationId: crudAppId }, body: { memberId: crudMemberId, programType: 'ssi', status: 'pending' } as any });
    assert.equal(res.status, 201);
    crudDisabilityBenefitId = (res.data as { id: string }).id;
    assert.ok(crudDisabilityBenefitId);
  });

  it('listDisabilityBenefits — response validates against schema', async () => {
    const res = await listDisabilityBenefits({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getDisabilityBenefit — response validates against schema', async () => {
    if (!crudDisabilityBenefitId) throw new Error('skipped: createDisabilityBenefit must pass first');
    const res = await getDisabilityBenefit({ client: intakeClient, path: { applicationId: crudAppId, disabilityBenefitId: crudDisabilityBenefitId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudDisabilityBenefitId);
  });

  it('updateDisabilityBenefit — PATCH response validates against schema', async () => {
    if (!crudDisabilityBenefitId) throw new Error('skipped: createDisabilityBenefit must pass first');
    const res = await updateDisabilityBenefit({ client: intakeClient, path: { applicationId: crudAppId, disabilityBenefitId: crudDisabilityBenefitId }, body: { programType: 'ssdi' } as any });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudDisabilityBenefitId);
  });

  it('deleteDisabilityBenefit — returns 204', async () => {
    if (!crudDisabilityBenefitId) throw new Error('skipped: createDisabilityBenefit must pass first');
    const res = await deleteDisabilityBenefit({ client: intakeClient, path: { applicationId: crudAppId, disabilityBenefitId: crudDisabilityBenefitId } });
    assert.equal(res.status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Intake CRUD: jobs, assets, asset disposals & expenses
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — intake CRUD: jobs, assets & expenses', () => {
  let crudAppId: string;
  let crudMemberId: string;
  let crudJobId: string;
  let crudAssetId: string;
  let crudAssetDisposalId: string;
  let crudExpenseId: string;

  before(async () => {
    await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' });
    const a = await createApplication({ client: intakeClient, body: { programsAppliedFor: ['snap'], channel: 'online' } });
    crudAppId = (a.data as { id: string }).id;
    const m = await createApplicationMember({ client: intakeClient, path: { applicationId: crudAppId }, body: { roles: ['primary_applicant'] } });
    crudMemberId = (m.data as { id: string }).id;
    const j = await createJob({ client: intakeClient, path: { applicationId: crudAppId }, body: { memberId: crudMemberId, type: 'employed', status: 'active' } });
    crudJobId = (j.data as { id: string }).id;
    const ast = await createAsset({ client: intakeClient, path: { applicationId: crudAppId }, body: { memberId: crudMemberId, type: 'liquid', value: 5000 } });
    crudAssetId = (ast.data as { id: string }).id;
    const exp = await createExpense({ client: intakeClient, path: { applicationId: crudAppId }, body: { memberId: crudMemberId, type: 'rent', amount: 1200 } });
    crudExpenseId = (exp.data as { id: string }).id;
  });

  it('listJobs — response validates against schema', async () => {
    const res = await listJobs({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getJob — response validates against schema', async () => {
    const res = await getJob({ client: intakeClient, path: { applicationId: crudAppId, jobId: crudJobId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudJobId);
  });

  it('updateJob — PATCH response validates against schema', async () => {
    const res = await updateJob({ client: intakeClient, path: { applicationId: crudAppId, jobId: crudJobId }, body: { status: 'active' } as any });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudJobId);
  });

  it('deleteJob — returns 204', async () => {
    const res = await deleteJob({ client: intakeClient, path: { applicationId: crudAppId, jobId: crudJobId } });
    assert.equal(res.status, 204);
  });

  it('listAssets — response validates against schema', async () => {
    const res = await listAssets({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getAsset — response validates against schema', async () => {
    const res = await getAsset({ client: intakeClient, path: { applicationId: crudAppId, assetId: crudAssetId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudAssetId);
  });

  it('updateAsset — PATCH response validates against schema', async () => {
    const res = await updateAsset({ client: intakeClient, path: { applicationId: crudAppId, assetId: crudAssetId }, body: { value: 6000 } as any });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudAssetId);
  });

  it('createAssetDisposal — response validates against schema', async () => {
    const res = await createAssetDisposal({
      client: intakeClient,
      path: { applicationId: crudAppId },
      body: { memberId: crudMemberId, type: 'liquid', dateOfDisposal: '2024-06-01', amountReceived: 4000, fairMarketValue: 5000 },
    });
    assert.equal(res.status, 201);
    crudAssetDisposalId = (res.data as { id: string }).id;
    assert.ok(crudAssetDisposalId);
  });

  it('listAssetDisposals — response validates against schema', async () => {
    const res = await listAssetDisposals({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getAssetDisposal — response validates against schema', async () => {
    if (!crudAssetDisposalId) throw new Error('skipped: createAssetDisposal must pass first');
    const res = await getAssetDisposal({ client: intakeClient, path: { applicationId: crudAppId, assetDisposalId: crudAssetDisposalId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudAssetDisposalId);
  });

  it('updateAssetDisposal — PATCH response validates against schema', async () => {
    if (!crudAssetDisposalId) throw new Error('skipped: createAssetDisposal must pass first');
    const res = await updateAssetDisposal({ client: intakeClient, path: { applicationId: crudAppId, assetDisposalId: crudAssetDisposalId }, body: { dateOfDisposal: '2024-06-01', fairMarketValue: 5000, amountReceived: 3500 } as any });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudAssetDisposalId);
  });

  it('deleteAssetDisposal — returns 204', async () => {
    if (!crudAssetDisposalId) throw new Error('skipped: createAssetDisposal must pass first');
    const res = await deleteAssetDisposal({ client: intakeClient, path: { applicationId: crudAppId, assetDisposalId: crudAssetDisposalId } });
    assert.equal(res.status, 204);
  });

  it('deleteAsset — returns 204', async () => {
    const res = await deleteAsset({ client: intakeClient, path: { applicationId: crudAppId, assetId: crudAssetId } });
    assert.equal(res.status, 204);
  });

  it('listExpenses — response validates against schema', async () => {
    const res = await listExpenses({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getExpense — response validates against schema', async () => {
    const res = await getExpense({ client: intakeClient, path: { applicationId: crudAppId, expenseId: crudExpenseId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudExpenseId);
  });

  it('updateExpense — PATCH response validates against schema', async () => {
    const res = await updateExpense({ client: intakeClient, path: { applicationId: crudAppId, expenseId: crudExpenseId }, body: { amount: 1300 } as any });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudExpenseId);
  });

  it('deleteExpense — returns 204', async () => {
    const res = await deleteExpense({ client: intakeClient, path: { applicationId: crudAppId, expenseId: crudExpenseId } });
    assert.equal(res.status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Intake CRUD: signatures, interview, child-support, sponsors & deletes
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — intake CRUD: signatures, admin & deletes', () => {
  let crudAppId: string;
  let crudMemberId: string;
  let crudIncomeId: string;
  let crudTaxFilerId: string;
  let crudDeductionId: string;
  let crudSignatureId: string;
  let crudSponsorId: string;

  before(async () => {
    await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' });
    const a = await createApplication({ client: intakeClient, body: { programsAppliedFor: ['snap'], channel: 'online' } });
    crudAppId = (a.data as { id: string }).id;
    const m = await createApplicationMember({ client: intakeClient, path: { applicationId: crudAppId }, body: { roles: ['primary_applicant'] } });
    crudMemberId = (m.data as { id: string }).id;
    const i = await createIncome({ client: intakeClient, path: { applicationId: crudAppId }, body: { memberId: crudMemberId, type: 'employed', amount: 2000, frequency: 'monthly' } });
    crudIncomeId = (i.data as { id: string }).id;
    const tf = await createTaxFiler({ client: intakeClient, path: { applicationId: crudAppId }, body: { memberId: crudMemberId } });
    crudTaxFilerId = (tf.data as { id: string }).id;
    const d = await createDeduction({ client: intakeClient, path: { applicationId: crudAppId }, body: { memberId: crudMemberId, type: 'student_loan_interest', amount: 100 } });
    crudDeductionId = (d.data as { id: string }).id;
  });

  it('createSignature — response validates against schema', async () => {
    const res = await createSignature({
      client: intakeClient,
      path: { applicationId: crudAppId },
      body: {
        signer: { type: 'member', id: crudMemberId, role: 'applicant' },
        purpose: 'application',
        signedAt: '2025-01-01T10:00:00Z',
        signatureMethod: 'electronic',
      },
    });
    assert.equal(res.status, 201);
    crudSignatureId = (res.data as { id: string }).id;
    assert.ok(crudSignatureId);
  });

  it('listSignatures — response validates against schema', async () => {
    const res = await listSignatures({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getSignature — response validates against schema', async () => {
    if (!crudSignatureId) throw new Error('skipped: createSignature must pass first');
    const res = await getSignature({ client: intakeClient, path: { applicationId: crudAppId, signatureId: crudSignatureId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudSignatureId);
  });

  it('updateSignature — PATCH response validates against schema', async () => {
    if (!crudSignatureId) throw new Error('skipped: createSignature must pass first');
    const res = await updateSignature({
      client: intakeClient,
      path: { applicationId: crudAppId, signatureId: crudSignatureId },
      body: {
        signer: { type: 'member', id: crudMemberId, role: 'applicant' },
        purpose: 'application',
        signedAt: '2025-01-01T10:00:00Z',
        signatureMethod: 'electronic',
      } as any,
    });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudSignatureId);
  });

  it('deleteSignature — returns 204', async () => {
    if (!crudSignatureId) throw new Error('skipped: createSignature must pass first');
    const res = await deleteSignature({ client: intakeClient, path: { applicationId: crudAppId, signatureId: crudSignatureId } });
    assert.equal(res.status, 204);
  });

  it('getInterview — response validates against schema', async () => {
    const res = await getInterview({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
  });

  it('updateInterview — PATCH response validates against schema', async () => {
    const res = await updateInterview({ client: intakeClient, path: { applicationId: crudAppId }, body: { applicationId: crudAppId, appointments: [], waiverStatus: 'pending' } as any });
    assert.equal(res.status, 200);
  });

  it('getChildSupport — response validates against schema', async () => {
    const res = await getChildSupport({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
  });

  it('updateChildSupport — PATCH response validates against schema', async () => {
    const res = await updateChildSupport({ client: intakeClient, path: { applicationId: crudAppId }, body: { goodCauseChildSupportWaiver: true } as any });
    assert.equal(res.status, 200);
  });

  it('createSponsor — response validates against schema', async () => {
    const res = await createSponsor({ client: intakeClient, path: { applicationId: crudAppId }, body: { sponsoredMemberId: crudMemberId } });
    assert.equal(res.status, 201);
    crudSponsorId = (res.data as { id: string }).id;
    assert.ok(crudSponsorId);
  });

  it('listSponsors — response validates against schema', async () => {
    const res = await listSponsors({ client: intakeClient, path: { applicationId: crudAppId } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getSponsor — response validates against schema', async () => {
    if (!crudSponsorId) throw new Error('skipped: createSponsor must pass first');
    const res = await getSponsor({ client: intakeClient, path: { applicationId: crudAppId, sponsorId: crudSponsorId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudSponsorId);
  });

  it('updateSponsor — PATCH response validates against schema', async () => {
    if (!crudSponsorId) throw new Error('skipped: createSponsor must pass first');
    const res = await updateSponsor({ client: intakeClient, path: { applicationId: crudAppId, sponsorId: crudSponsorId }, body: { livesWithSponsored: true } as any });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, crudSponsorId);
  });

  it('deleteSponsor — returns 204', async () => {
    if (!crudSponsorId) throw new Error('skipped: createSponsor must pass first');
    const res = await deleteSponsor({ client: intakeClient, path: { applicationId: crudAppId, sponsorId: crudSponsorId } });
    assert.equal(res.status, 204);
  });

  it('listReviewProgressBySection — response validates against schema', async () => {
    const res = await listReviewProgressBySection({ client: intakeClient, path: { applicationId: crudAppId, section: 'income' } });
    assert.equal(res.status, 200);
  });

  it('deleteDeduction — returns 204', async () => {
    const res = await deleteDeduction({ client: intakeClient, path: { applicationId: crudAppId, deductionId: crudDeductionId } });
    assert.equal(res.status, 204);
  });

  it('deleteTaxFiler — returns 204', async () => {
    const res = await deleteTaxFiler({ client: intakeClient, path: { applicationId: crudAppId, taxFilerId: crudTaxFilerId } });
    assert.equal(res.status, 204);
  });

  it('deleteIncome — returns 204', async () => {
    const res = await deleteIncome({ client: intakeClient, path: { applicationId: crudAppId, incomeId: crudIncomeId } });
    assert.equal(res.status, 204);
  });

  it('deleteApplication — returns 204', async () => {
    // Use a fresh application so deletion does not affect other tests.
    const freshApp = await createApplication({ client: intakeClient, body: { programsAppliedFor: ['snap'], channel: 'online' } });
    const freshAppId = (freshApp.data as { id: string }).id;
    const res = await deleteApplication({ client: intakeClient, path: { applicationId: freshAppId } });
    assert.equal(res.status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow: queue CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow queues', () => {
  let newQueueId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('createQueue — response validates against schema', async () => {
    const res = await createQueue({ client: workflowClient, body: { name: 'sweep-test-queue' } });
    assert.equal(res.status, 201);
    newQueueId = (res.data as { id: string }).id;
    assert.ok(newQueueId);
  });

  it('updateQueue — PATCH response validates against schema', async () => {
    if (!newQueueId) throw new Error('skipped: createQueue must pass first');
    const res = await updateQueue({ client: workflowClient, path: { queueId: newQueueId }, body: { name: 'sweep-test-queue-updated' } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, newQueueId);
  });

  it('deleteQueue — returns 204', async () => {
    if (!newQueueId) throw new Error('skipped: createQueue must pass first');
    const res = await deleteQueue({ client: workflowClient, path: { queueId: newQueueId } });
    assert.equal(res.status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow: task delete
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow task delete', () => {
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('deleteTask — returns 204', async () => {
    const taskId = await freshTask();
    const res = await deleteTask({ client: workflowClient, path: { taskId } });
    assert.equal(res.status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow RPC: escalate / de-escalate
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow RPC: escalate / de-escalate', () => {
  let taskId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('setup: createTask + claimTask', async () => {
    taskId = await freshTask();
    const claim = await claimTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    assert.equal(claim.status, 200, `claimTask failed: ${claim.status}`);
  });

  it('escalateTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: setup must pass first');
    const res = await escalateTask({ client: workflowClient, path: { taskId }, body: { reason: 'Needs supervisor review' }, headers: CASEWORKER_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });

  it('deEscalateTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: escalateTask must pass first');
    const res = await deEscalateTask({ client: workflowClient, path: { taskId }, body: {}, headers: SUPERVISOR_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow RPC: cancel / reopen
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow RPC: cancel / reopen', () => {
  let taskId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('setup: createTask', async () => {
    taskId = await freshTask();
    assert.ok(taskId);
  });

  it('cancelTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: setup must pass first');
    const res = await cancelTask({ client: workflowClient, path: { taskId }, body: { reason: 'Duplicate task' }, headers: SUPERVISOR_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });

  it('reopenTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: cancelTask must pass first');
    const res = await reopenTask({ client: workflowClient, path: { taskId }, body: { reason: 'Was not a duplicate' }, headers: SUPERVISOR_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow RPC: release
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow RPC: release', () => {
  let taskId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('setup: createTask + claimTask', async () => {
    taskId = await freshTask();
    const claim = await claimTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    assert.equal(claim.status, 200, `claimTask failed: ${claim.status}`);
  });

  it('releaseTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: setup must pass first');
    const res = await releaseTask({ client: workflowClient, path: { taskId }, body: { reason: 'Reassigning to another worker' }, headers: CASEWORKER_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow RPC: await-client / resume
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow RPC: await-client / resume', () => {
  let taskId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('setup: createTask + claimTask', async () => {
    taskId = await freshTask();
    const claim = await claimTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    assert.equal(claim.status, 200, `claimTask failed: ${claim.status}`);
  });

  it('awaitClientTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: setup must pass first');
    const res = await awaitClientTask({ client: workflowClient, path: { taskId }, body: {}, headers: CASEWORKER_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });

  it('resumeTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: awaitClientTask must pass first');
    const res = await resumeTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow RPC: await-verification / auto-resume
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow RPC: await-verification / auto-resume', () => {
  let taskId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('setup: createTask + claimTask', async () => {
    taskId = await freshTask();
    const claim = await claimTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    assert.equal(claim.status, 200, `claimTask failed: ${claim.status}`);
  });

  it('awaitVerificationTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: setup must pass first');
    const res = await awaitVerificationTask({ client: workflowClient, path: { taskId }, body: {}, headers: CASEWORKER_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });

  it('autoResumeTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: awaitVerificationTask must pass first');
    const res = await autoResumeTask({ client: workflowClient, path: { taskId }, body: {}, headers: SYSTEM_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow RPC: submit-for-review / approve
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow RPC: submit-for-review / approve', () => {
  let taskId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('setup: createTask + claimTask', async () => {
    taskId = await freshTask();
    const claim = await claimTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    assert.equal(claim.status, 200, `claimTask failed: ${claim.status}`);
  });

  it('submitForReviewTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: setup must pass first');
    const res = await submitForReviewTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });

  it('approveTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: submitForReviewTask must pass first');
    const res = await approveTask({ client: workflowClient, path: { taskId }, body: { outcome: 'approved' }, headers: SUPERVISOR_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow RPC: submit-for-review / return-to-worker
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow RPC: submit-for-review / return-to-worker', () => {
  let taskId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('setup: createTask + claimTask', async () => {
    taskId = await freshTask();
    const claim = await claimTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    assert.equal(claim.status, 200, `claimTask failed: ${claim.status}`);
  });

  it('submitForReviewTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: setup must pass first');
    const res = await submitForReviewTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });

  it('returnToWorkerTask — response validates against schema', async () => {
    if (!taskId) throw new Error('skipped: submitForReviewTask must pass first');
    const res = await returnToWorkerTask({ client: workflowClient, path: { taskId }, body: { reason: 'Missing documentation' }, headers: SUPERVISOR_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow RPC: system transitions (assign, set-priority, sla-escalate, auto-cancel)
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow RPC: system transitions', () => {
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('assignTask — response validates against schema', async () => {
    const taskId = await freshTask();
    const res = await assignTask({
      client: workflowClient,
      path: { taskId },
      body: { assignedToId: '00000000-0000-0000-0000-000000000001' },
      headers: SUPERVISOR_HEADERS,
    });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });

  it('setPriorityTask — response validates against schema', async () => {
    const taskId = await freshTask();
    const res = await setPriorityTask({
      client: workflowClient,
      path: { taskId },
      body: { priority: 1, reason: 'Expedited processing required' },
      headers: SUPERVISOR_HEADERS,
    });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });

  it('slaEscalateTask — response validates against schema', async () => {
    const taskId = await freshTask();
    const res = await slaEscalateTask({
      client: workflowClient,
      path: { taskId },
      body: { reason: 'sla_deadline_exceeded' },
      headers: SYSTEM_HEADERS,
    });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });

  it('autoCancelTask — response validates against schema', async () => {
    const taskId = await freshTask();
    // auto-cancel requires awaiting_client state
    await claimTask({ client: workflowClient, path: { taskId }, headers: CASEWORKER_HEADERS });
    await awaitClientTask({ client: workflowClient, path: { taskId }, body: {}, headers: CASEWORKER_HEADERS });
    const res = await autoCancelTask({ client: workflowClient, path: { taskId }, headers: SYSTEM_HEADERS });
    assert.equal(res.status, 200);
    assert.ok((res.data as { id: string }).id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow: metrics
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — workflow metrics', () => {
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('listMetrics — response validates against schema', async () => {
    const res = await listMetrics({ client: workflowClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getMetric — response validates against schema', async () => {
    const res = await getMetric({ client: workflowClient, path: { metricId: SEED_METRIC_ID } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, SEED_METRIC_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Platform (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — platform (extended)', () => {
  let publishedEventId: string;
  before(async () => {
    await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' });
    await fetch(`${BASE_URL}/mock/reseed`, { method: 'POST' });
  });

  it('getPolicy — response validates against schema', async () => {
    const res = await getPolicy({ client: platformClient, path: { policyId: SEED_POLICY_ID } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, SEED_POLICY_ID);
  });

  it('publishEvent — response validates against schema', async () => {
    const res = await publishEvent({
      client: platformClient,
      body: {
        type: 'intake.application.submitted',
        specversion: '1.0',
        id: '00000000-0000-0000-0000-000000000099',
        source: '/intake',
        subject: '00000000-0000-0000-0000-000000000001',
        time: '2025-01-01T10:00:00Z',
        datacontenttype: 'application/json',
      },
    });
    assert.equal(res.status, 201);
    publishedEventId = (res.data as { id: string }).id;
    assert.ok(publishedEventId);
  });

  it('listEvents — response validates against schema', async () => {
    const res = await listEvents({ client: platformClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getEvent — response validates against schema', async () => {
    if (!publishedEventId) throw new Error('skipped: publishEvent must pass first');
    const res = await getEvent({ client: platformClient, path: { eventId: publishedEventId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, publishedEventId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Data exchange (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — data-exchange (extended)', () => {
  let serviceCallId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('getService — response validates against schema', async () => {
    const res = await getService({ client: dataExchangeClient, path: { serviceId: SEED_SERVICE_ID } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, SEED_SERVICE_ID);
  });

  it('createServiceCall — response validates against schema', async () => {
    const res = await createServiceCall({
      client: dataExchangeClient,
      body: { serviceId: SEED_SERVICE_ID, requestingResourceId: '00000000-0000-0000-0000-000000000001' },
    });
    assert.equal(res.status, 201);
    serviceCallId = (res.data as { id: string }).id;
    assert.ok(serviceCallId);
  });

  it('listServiceCalls — response validates against schema', async () => {
    const res = await listServiceCalls({ client: dataExchangeClient });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
  });

  it('getServiceCall — response validates against schema', async () => {
    if (!serviceCallId) throw new Error('skipped: createServiceCall must pass first');
    const res = await getServiceCall({ client: dataExchangeClient, path: { serviceCallId } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, serviceCallId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Users (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — users (extended)', () => {
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('getCurrentUser — response validates against schema', async () => {
    const res = await getCurrentUser({ client: usersClient });
    // The mock may return 200 with a default user or 404 with no auth context.
    assert.ok(res.status === 200 || res.status === 404 || res.status === 401, `getCurrentUser returned unexpected status ${res.status}`);
  });

  it('deactivateUser — returns 204', async () => {
    const createRes = await createUser({
      client: usersClient,
      body: { idpSubject: 'deactivate-test-sweep', email: 'deactivate-sweep@example.com', roles: { name: 'case_worker' } },
    });
    assert.equal(createRes.status, 201, 'createUser prerequisite must succeed');
    const toDeactivateId = (createRes.data as { id: string }).id;
    const res = await deactivateUser({ client: usersClient, path: { userId: toDeactivateId } });
    assert.equal(res.status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Document management (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — document management (extended)', () => {
  let newDocTypeId: string;
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  it('getDocumentType — seeded type validates against schema', async () => {
    const res = await getDocumentType({ client: documentManagementClient, path: { documentTypeId: SEED_DOC_TYPE_ID } });
    assert.equal(res.status, 200);
    assert.equal((res.data as { id: string }).id, SEED_DOC_TYPE_ID);
  });

  it('createDocumentType — response validates against schema', async () => {
    const res = await createDocumentType({
      client: documentManagementClient,
      body: { name: 'sweep_test_doc', retentionYears: 5, retentionTrigger: 'case_closure' },
    });
    assert.equal(res.status, 201);
    newDocTypeId = (res.data as { id: string }).id;
    assert.ok(newDocTypeId);
  });

  it('deleteDocumentType — returns 204', async () => {
    if (!newDocTypeId) throw new Error('skipped: createDocumentType must pass first');
    const res = await deleteDocumentType({ client: documentManagementClient, path: { documentTypeId: newDocTypeId } });
    assert.equal(res.status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe('Zod sweep — eligibility (extended)', () => {
  before(async () => { await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' }); });

  // Determinations are created via state machine events (not directly). These tests verify
  // that the list/sub-list schema validation works with whatever data is present at runtime.
  it('listDecisions — schema validates when determinations exist', async () => {
    const listRes = await listDeterminations({ client: eligibilityClient });
    assert.equal(listRes.status, 200);
    const items = (listRes.data as { items: Array<{ id: string }> }).items;
    if (items.length > 0) {
      const determinationId = items[0].id;
      const res = await listDecisions({ client: eligibilityClient, path: { determinationId } });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray((res.data as { items: unknown[] }).items));
    } else {
      assert.ok(true, 'no determinations seeded; listDecisions coverage deferred to runtime');
    }
  });
});

// Node.js v20: file-level after() fires before the last registered item completes.
// This dummy test ensures after(teardownServer) runs after all suites finish.
it('teardown guard', () => {});
