/**
 * Polymorphic references: an id whose resource is named by a type field
 * beside it. Checked when written, like any relationship, and reached by a
 * delete's onDelete. Against the harness, whose suggestions name a member or
 * an income (subjectType) and cascade with it.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/browser.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
const APPLICATION = '11111111-1111-4111-8111-111111111111';
const ROSA = '11111111-1111-4111-8111-100000000001';
const SALARY = '11111111-1111-4111-8111-200000000004';
const NOBODY = '99999999-9999-4999-8999-000000000000';

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
});

const send = async (method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'x-caller-id': 'worker-1', 'x-caller-roles': 'case_worker', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const inform = (subjectType, subjectId) => send('POST', '/decision-support/suggestions', {
  kind: 'informing', subjectType, subjectId, category: 'earned-income-varies', message: 'Her wages vary week to week.',
});

test('a suggestion about a record of the type it names is proposed', async () => {
  const { status, body } = await inform('application_income', SALARY);
  assert.strictEqual(status, 201, JSON.stringify(body));
});

test('a suggestion about a record that isn\'t there is refused, by the type it names', async () => {
  const { status, body } = await inform('application_income', NOBODY);
  assert.strictEqual(status, 422, JSON.stringify(body));
  assert.ok(body.details.some((d) => d.field === 'subjectId' && /ApplicationIncome/.test(d.message)), JSON.stringify(body));
  // The id of a member is not the id of an income.
  assert.strictEqual((await inform('application_income', ROSA)).status, 422);
});

test('a suggestion goes with the record it\'s about, through a cascade that reaches it', async () => {
  const { body: suggestion } = await inform('application_income', SALARY);
  assert.strictEqual((await send('DELETE', `/intake/applications/${APPLICATION}/members/${ROSA}`)).status, 204);
  assert.strictEqual((await send('GET', `/decision-support/suggestions/${suggestion.id}`)).status, 404);
});
