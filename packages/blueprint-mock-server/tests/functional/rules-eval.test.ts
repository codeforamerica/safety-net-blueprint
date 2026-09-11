/**
 * Functional tests for rules evaluation endpoints.
 *
 * Exercises the POST endpoint registered by registerRulesRoutes from
 * the rules-eval-rules.yaml fixture. Uses fetch directly — no TypeScript
 * client is generated for rules endpoints (they are not declared in an
 * OpenAPI spec).
 *
 * Run via: node tests/run-tests.js --functional
 * The server is started by the test runner before this file executes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:1080';
const ENDPOINT = `${BASE}/test/assess-snap-eligibility`;

async function post(body: unknown) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Functional — rules evaluation endpoint', () => {

  it('returns 200 for a valid request', async () => {
    const res = await post({ household: { monthlyIncome: 800, size: 3 } });
    assert.equal(res.status, 200);
  });

  it('returns complete result when all inputs are provided', async () => {
    const res = await post({ household: { monthlyIncome: 800, size: 3 } });
    const body = await res.json() as Record<string, unknown>;
    assert.ok('complete' in body, 'result must have complete');
    assert.ok('missing' in body, 'result must have missing');
    assert.ok('errors' in body, 'result must have errors');
  });

  it('meetsIncomeTest is true when income is below threshold', async () => {
    // size=3, threshold = 3*500 = 1500; income=800 < 1500 → true
    const res = await post({ household: { monthlyIncome: 800, size: 3 } });
    const body = await res.json() as { complete: Record<string, unknown> };
    assert.equal(body.complete.meetsIncomeTest, true);
  });

  it('meetsIncomeTest is false when income exceeds threshold', async () => {
    // size=2, threshold = 2*500 = 1000; income=1200 > 1000 → false
    const res = await post({ household: { monthlyIncome: 1200, size: 2 } });
    const body = await res.json() as { complete: Record<string, unknown> };
    assert.equal(body.complete.meetsIncomeTest, false);
  });

  it('returns missing facts when inputs are absent', async () => {
    const res = await post({});
    const body = await res.json() as { missing: Record<string, unknown> };
    assert.ok(Object.keys(body.missing).length > 0, 'missing must be non-empty when inputs are absent');
    assert.ok('meetsIncomeTest' in body.missing);
  });

  it('returns partial result when only some inputs are provided', async () => {
    // Only size provided — monthlyIncome missing, so meetsIncomeTest is missing
    const res = await post({ household: { size: 3 } });
    const body = await res.json() as { missing: Record<string, unknown>; complete: Record<string, unknown> };
    assert.ok('meetsIncomeTest' in body.missing, 'meetsIncomeTest must be missing when income is absent');
    assert.ok(!('meetsIncomeTest' in body.complete), 'meetsIncomeTest must not be in complete');
  });

  it('accepts empty body and returns all facts as missing', async () => {
    const res = await post(null);
    assert.equal(res.status, 200);
    const body = await res.json() as { missing: Record<string, unknown> };
    assert.ok('meetsIncomeTest' in body.missing);
  });

});
