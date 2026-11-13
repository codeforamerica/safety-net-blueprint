/**
 * An editable composition: one document, changed with a JSON Patch through
 * each record's own operations, all or nothing. Against the harness's
 * applicationDetails and Rosa's seeded application.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
const APPLICATION = '11111111-1111-4111-8111-111111111111';
const ROSA = '11111111-1111-4111-8111-100000000001';
const SALARY = '11111111-1111-4111-8111-200000000004';
const MARIA = '33333333-3333-4333-8333-000000000001';
const MARIA_INCOME = '33333333-3333-4333-8333-000000000002';
const DETAILS = `/intake/applications/${APPLICATION}/details`;

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
});

const send = async (method, path, body, headers = {}) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'x-caller-id': 'worker-1', 'x-caller-roles': 'case_worker', ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
};
let keys = 0;
const patch = (ops, headers = {}) => send('PATCH', DETAILS, ops, {
  'content-type': 'application/json-patch+json', 'idempotency-key': `key-${++keys}`, ...headers,
});
const addMaria = [
  { op: 'add', path: `/members/${MARIA}`, value: { firstName: 'Maria', lastName: 'Delgado', relationship: 'child' } },
  { op: 'add', path: `/incomes/${MARIA_INCOME}`, value: { memberId: MARIA, source: 'earned', amount: 200, frequency: 'monthly' } },
];
const events = async () => (await send('GET', '/platform/events?limit=200')).body.items ?? [];

test('the document is the root under its key, and includes keyed by id', async () => {
  const { status, body } = await send('GET', DETAILS);
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.deepStrictEqual(Object.keys(body), ['application', 'members', 'incomes']);
  assert.strictEqual(body.application.id, APPLICATION);
  assert.strictEqual(body.members[ROSA].firstName, 'Rosa');
  assert.strictEqual(body.incomes[SALARY].amount, 1100);
});

test('each record reads as its own read returns it, with the links to the compositions built around it', async () => {
  const own = (await send('GET', `/intake/applications/${APPLICATION}`)).body;
  const { body } = await send('GET', DETAILS);
  assert.deepStrictEqual(body.application._links, own._links);
  assert.strictEqual(body.application._links.applicationDetails.href, DETAILS);
});

test('a new member and their income are added in one patch, with the ids the caller chose', async () => {
  const before = (await events()).length;
  const { status, body } = await patch(addMaria);
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.members[MARIA].firstName, 'Maria');
  assert.strictEqual(body.incomes[MARIA_INCOME].memberId, MARIA);
  const sent = await events();
  assert.ok(sent.length > before);
  assert.ok(sent.some((e) => e.type === 'intake.application_member.created' && e.subject === MARIA));
  assert.ok(sent.some((e) => e.type === 'intake.application_income.created' && e.subject === MARIA_INCOME));
});

test('a change to a field goes through the record\'s own update', async () => {
  const { status, body } = await patch([{ op: 'replace', path: `/incomes/${SALARY}/amount`, value: 1250 }]);
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.incomes[SALARY].amount, 1250);
});

test('one refused change keeps none of them, and sends no events', async () => {
  const before = await events();
  const { status, body } = await patch([...addMaria, { op: 'replace', path: `/incomes/${SALARY}/amount`, value: null }]);
  assert.strictEqual(status, 422, JSON.stringify(body));
  assert.strictEqual(body.details[0].field, `/incomes/${SALARY}`);
  const after = (await send('GET', DETAILS)).body;
  assert.strictEqual(after.members[MARIA], undefined);
  assert.strictEqual(after.incomes[MARIA_INCOME], undefined);
  assert.strictEqual(after.incomes[SALARY].amount, 1100);
  assert.strictEqual((await events()).length, before.length);
});

test('a failed test, or a path that names nothing, is a 409 and changes nothing', async () => {
  const stale = await patch([
    { op: 'test', path: `/incomes/${SALARY}/amount`, value: 999 },
    { op: 'replace', path: `/incomes/${SALARY}/amount`, value: 1250 },
  ]);
  assert.strictEqual(stale.status, 409, JSON.stringify(stale.body));
  const gone = await patch([{ op: 'replace', path: '/incomes/44444444-4444-4444-8444-000000000000/amount', value: 1 }]);
  assert.strictEqual(gone.status, 409, JSON.stringify(gone.body));
  assert.strictEqual((await send('GET', DETAILS)).body.incomes[SALARY].amount, 1100);
});

test('a change the record\'s own operation refuses is a 422: status, and the field binding it to the application', async () => {
  const status = await patch([{ op: 'replace', path: '/application/status', value: 'closed' }]);
  assert.strictEqual(status.status, 422, JSON.stringify(status.body));
  const moved = await patch([{ op: 'replace', path: `/incomes/${SALARY}/applicationId`, value: '55555555-5555-4555-8555-000000000000' }]);
  assert.strictEqual(moved.status, 422, JSON.stringify(moved.body));
});

test('new records that name each other are refused', async () => {
  const other = '33333333-3333-4333-8333-000000000003';
  const { status } = await patch([
    { op: 'add', path: `/incomes/${MARIA_INCOME}`, value: { memberId: other, source: 'earned', amount: 1, frequency: 'monthly' } },
    { op: 'add', path: `/incomes/${other}`, value: { memberId: MARIA_INCOME, source: 'earned', amount: 1, frequency: 'monthly' } },
  ]);
  assert.strictEqual(status, 422);
});

test('the body has to be a JSON Patch, sent as one', async () => {
  assert.strictEqual((await patch([{ op: 'replace', path: `/incomes/${SALARY}/amount`, value: 1 }], { 'content-type': 'application/json' })).status, 415);
  assert.strictEqual((await patch('not json')).status, 400);
  assert.strictEqual((await patch([{ op: 'merge', path: '/application' }])).status, 400);
  assert.strictEqual((await patch([{ op: 'replace', path: `/incomes/${SALARY}/amount` }])).status, 400);
});

test('an Idempotency-Key is required, and a retry gets the first answer back', async () => {
  const missing = await send('PATCH', DETAILS, addMaria, { 'content-type': 'application/json-patch+json' });
  assert.strictEqual(missing.status, 400);
  const headers = { 'idempotency-key': 'same-key' };
  const first = await patch(addMaria, headers);
  assert.strictEqual(first.status, 200, JSON.stringify(first.body));
  const retry = await patch(addMaria, headers);
  assert.strictEqual(retry.status, 200);
  assert.strictEqual(retry.headers.get('idempotent-replayed'), 'true');
});
