/**
 * Client-validation integration tests.
 *
 * These tests use the generated TypeScript SDK — which has zod response
 * validation built in — to exercise the mock server. Any response that
 * doesn't match the resolved spec schema causes the SDK call to throw,
 * making schema/mock mismatches impossible to miss.
 *
 * Run with: npm run test:integration
 * (clients:generate runs automatically as a pre-step)
 *
 * The flow mirrors what the steel thread does: create an application,
 * add a member, add income records, then fetch and validate them. This
 * reproduces the class of bugs Leo found where the mock returns a shape
 * that doesn't match the generated zod schema.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './generated/intake/client/index.js';
import {
  createApplication,
  createApplicationMember,
  createIncome,
  listIncome,
  getIncome,
  getApplicationReview,
  getApplicationReviewIncomeSection,
} from './generated/intake/sdk.gen.js';
import { setupServer, teardownServer } from './helpers.js';

const BASE_URL = 'http://localhost:1080/intake';

const client = createClient({ baseURL: BASE_URL });

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
      client,
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
      client,
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
      client,
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
      client,
      path: { applicationId },
    });
    assert.equal(res.status, 200);
    const list = res.data as { items: unknown[]; total: number };
    assert.ok(Array.isArray(list.items), 'items should be an array');
    assert.ok(list.items.length > 0, 'should have at least one income record');
  });

  it('gets a single income — zod validates the record matches the schema', async () => {
    const res = await getIncome({
      client,
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
    const appRes = await createApplication({ client, body: { programsAppliedFor: ['snap'], channel: 'online' } });
    applicationId = (appRes.data as { id: string }).id;

    const memberRes = await createApplicationMember({ client, path: { applicationId }, body: { roles: ['primary_applicant'] } });
    memberId = (memberRes.data as { id: string }).id;

    // Create three income records (mirrors Leslie's three seeded incomes in the steel thread).
    await createIncome({ client, path: { applicationId }, body: { memberId, type: 'employed', amount: 3000, frequency: 'monthly' } });
    await createIncome({ client, path: { applicationId }, body: { memberId, type: 'self_employed', amount: 1500, frequency: 'monthly' } });
    await createIncome({ client, path: { applicationId }, body: { memberId, type: 'unearned', amount: 500, frequency: 'monthly' } });
  });

  after(async () => {
    await teardownServer(serverStartedByTests);
  });

  it('gets the application review index — returns sections and no errors', async () => {
    const res = await getApplicationReview({ client, path: { applicationId } });
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
    const res = await getApplicationReviewIncomeSection({ client, path: { applicationId } });
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
