/**
 * Unit tests for mergePathParamsIntoBody.
 *
 * Companion to issue #341 (scope-creep, third related engine issue).
 *
 * Sub-sub-resource POST routes (e.g.
 * POST /applications/{applicationId}/members/{memberId}/incomes) historically
 * injected only the LAST URL param (memberId) into the request body. The
 * schema for MemberIncome requires BOTH memberId and applicationId — the
 * grandparent FK is denormalized onto the record. Stripping applicationId
 * during create produces records that fail downstream Zod validation in
 * generated TypeScript clients.
 *
 * Fix: spread ALL path params into the body. The URL is the authoritative
 * source for parent FK identities; params win over body fields of the same
 * name. additionalProperties: true on request schemas (current convention)
 * means extra params don't trip validation when the URL param name doesn't
 * happen to match a schema field.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mergePathParamsIntoBody } from '../../src/route-generator.js';

test('mergePathParamsIntoBody — empty body + empty params returns empty object', () => {
  assert.deepStrictEqual(mergePathParamsIntoBody({}, {}), {});
});

test('mergePathParamsIntoBody — null body + null params returns empty object', () => {
  assert.deepStrictEqual(mergePathParamsIntoBody(null, null), {});
});

test('mergePathParamsIntoBody — body fields are preserved when no params overlap', () => {
  const body = { amount: 1800, frequency: 'monthly' };
  const params = { memberId: 'm1' };
  assert.deepStrictEqual(mergePathParamsIntoBody(body, params), {
    amount: 1800,
    frequency: 'monthly',
    memberId: 'm1',
  });
});

test('mergePathParamsIntoBody — all path params land in the body (issue #341 grandparent FK case)', () => {
  // The actual bug: POST /applications/{applicationId}/members/{memberId}/incomes
  // produces a MemberIncome that needs both FKs in the persisted record.
  const body = { amount: 1800, frequency: 'monthly', source: 'employment' };
  const params = { applicationId: 'app-1', memberId: 'mem-1' };
  assert.deepStrictEqual(mergePathParamsIntoBody(body, params), {
    amount: 1800,
    frequency: 'monthly',
    source: 'employment',
    applicationId: 'app-1',
    memberId: 'mem-1',
  });
});

test('mergePathParamsIntoBody — path params win on key collision', () => {
  // URL is authoritative for parent identities. A client trying to override
  // the parent FK via the body should not succeed; the URL is the system
  // of record for "which parent does this belong to."
  const body = { applicationId: 'attacker-supplied', amount: 1800 };
  const params = { applicationId: 'real-from-url' };
  assert.deepStrictEqual(mergePathParamsIntoBody(body, params), {
    applicationId: 'real-from-url',
    amount: 1800,
  });
});

test('mergePathParamsIntoBody — singly-nested route still works (single param case)', () => {
  // Backwards compatibility: /applications/{applicationId}/documents
  const body = { type: 'paystub' };
  const params = { applicationId: 'app-1' };
  assert.deepStrictEqual(mergePathParamsIntoBody(body, params), {
    type: 'paystub',
    applicationId: 'app-1',
  });
});

test('mergePathParamsIntoBody — empty body + non-empty params returns the params', () => {
  const params = { applicationId: 'app-1', memberId: 'mem-1' };
  assert.deepStrictEqual(mergePathParamsIntoBody({}, params), {
    applicationId: 'app-1',
    memberId: 'mem-1',
  });
});

test('mergePathParamsIntoBody — body + empty params returns the body unchanged', () => {
  const body = { amount: 1800 };
  assert.deepStrictEqual(mergePathParamsIntoBody(body, {}), { amount: 1800 });
});
