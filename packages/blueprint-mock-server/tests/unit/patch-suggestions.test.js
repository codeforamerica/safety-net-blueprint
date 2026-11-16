/**
 * A suggestion that changes data: an operation suggestion whose call is a
 * JSON Patch to an editable composition. Against the harness's
 * applicationDetails and Rosa's seeded application.
 *
 * Proposing one tries the patch against the composition as it is now; its
 * fingerprint reads the records it creates in order, so the same new member
 * under a fresh id is the same suggestion; accepting may change values only,
 * and makes the call with the suggestion's id as its Idempotency-Key.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
const APPLICATION = '11111111-1111-4111-8111-111111111111';
const SALARY = '11111111-1111-4111-8111-200000000004';
const LINE = '7a1e0c2d-0000-4000-8000-0000000000e1';
const DETAILS = `/intake/applications/${APPLICATION}/details`;

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
});

const send = async (method, path, body, headers = {}) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1', 'x-caller-roles': 'case_worker', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const patchCall = (payload) => ({
  operationId: 'updateApplicationDetails',
  parameters: [{ name: 'applicationId', in: 'path', value: APPLICATION }],
  requestBody: { contentType: 'application/json-patch+json', payload },
});
const propose = (payload, extra = {}) =>
  send('POST', '/decision-support/suggestions', { kind: 'operation', call: patchCall(payload), ...extra });
const decide = (id, action, body = {}) => send('POST', `/decision-support/suggestions/${id}/${action}`, body);
const details = async () => (await send('GET', DETAILS)).body;

const newMember = (memberId, incomeId, amount = 1100) => [
  { op: 'add', path: `/members/${memberId}`, value: { firstName: 'Maria', lastName: 'Delgado', relationship: 'child' } },
  { op: 'add', path: `/incomes/${incomeId}`, value: { memberId, source: 'earned', amount, frequency: 'monthly' } },
];
const correction = (read, to) => [
  { op: 'test', path: `/incomes/${SALARY}/amount`, value: read },
  { op: 'replace', path: `/incomes/${SALARY}/amount`, value: to },
];

test('a new member and their income are proposed together', async () => {
  const { status, body } = await propose(newMember(crypto.randomUUID(), crypto.randomUUID()));
  assert.strictEqual(status, 201, JSON.stringify(body));
  assert.strictEqual(body.status, 'proposed');
});

test('an income naming a member who neither exists nor is created in the patch is refused with 422', async () => {
  const [, income] = newMember(crypto.randomUUID(), crypto.randomUUID());
  const { status, body } = await propose([income]);
  assert.strictEqual(status, 422, JSON.stringify(body));
  assert.match(body.details[0].field, /^call\.requestBody\.payload\[0\]/);
});

test('a new record its own operation would refuse is refused with 422, naming the change', async () => {
  const { status, body } = await propose([
    { op: 'add', path: `/members/${crypto.randomUUID()}`, value: { firstName: 'Maria', relationship: 'child' } },
  ]);
  assert.strictEqual(status, 422, JSON.stringify(body));
  assert.strictEqual(body.details[0].field, 'call.requestBody.payload[0]');
  assert.match(body.details[0].message, /^createApplicationMember: .*lastName/);
});

test('a replace with no test before it is refused with 422', async () => {
  const { status, body } = await propose([{ op: 'replace', path: `/incomes/${SALARY}/amount`, value: 1250 }]);
  assert.strictEqual(status, 422, JSON.stringify(body));
  assert.strictEqual(body.details[0].field, 'call.requestBody.payload[0]');
});

test('a test that no longer holds is refused with 409: the data changed after it was read', async () => {
  const { status, body } = await propose(correction(999, 1250));
  assert.strictEqual(status, 409, JSON.stringify(body));
});

test('a path that names nothing in the composition is refused with 422', async () => {
  const missing = crypto.randomUUID();
  const { status, body } = await propose([
    { op: 'test', path: `/incomes/${missing}/amount`, value: 1 },
    { op: 'replace', path: `/incomes/${missing}/amount`, value: 2 },
  ]);
  assert.strictEqual(status, 422, JSON.stringify(body));
});

test('the same new member proposed again under fresh ids repeats the dismissed one; a different amount does not', async () => {
  const first = await propose(newMember(crypto.randomUUID(), crypto.randomUUID()));
  assert.strictEqual(first.status, 201, JSON.stringify(first.body));
  assert.strictEqual((await decide(first.body.id, 'dismiss', { reason: 'Not in the household' })).status, 200);

  const again = await propose(newMember(crypto.randomUUID(), crypto.randomUUID()));
  assert.strictEqual(again.status, 409, JSON.stringify(again.body));
  assert.strictEqual(again.body.details[0].id, first.body.id);

  const different = await propose(newMember(crypto.randomUUID(), crypto.randomUUID(), 1150));
  assert.strictEqual(different.status, 201, JSON.stringify(different.body));
});

test('evidence names the change it backs up by its path, and a path no change has is refused with 422', async () => {
  const memberId = crypto.randomUUID();
  const payload = newMember(memberId, crypto.randomUUID());
  const cited = await propose(payload, { evidence: [{ sourceType: 'transcript_entry', sourceId: LINE, path: `/members/${memberId}` }] });
  assert.strictEqual(cited.status, 201, JSON.stringify(cited.body));

  const stray = await propose(newMember(crypto.randomUUID(), crypto.randomUUID(), 900),
    { evidence: [{ sourceType: 'transcript_entry', sourceId: LINE, path: '/members/nobody' }] });
  assert.strictEqual(stray.status, 422, JSON.stringify(stray.body));
  assert.strictEqual(stray.body.details[0].field, 'evidence[0].path');
});

test('accepting saves every change in one call, as the person accepting, caused by the acceptance, with the suggestion\'s id as its key', async () => {
  const memberId = crypto.randomUUID();
  const incomeId = crypto.randomUUID();
  const { body: suggestion } = await propose(newMember(memberId, incomeId));
  const { status, body } = await decide(suggestion.id, 'accept');
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.status, 'accepted');

  const after = await details();
  assert.strictEqual(after.members[memberId].firstName, 'Maria');
  assert.strictEqual(after.incomes[incomeId].memberId, memberId);

  const events = (await send('GET', '/platform/events?limit=200')).body.items;
  const created = events.filter((e) => e.type === 'intake.application_member.created' && e.subject === memberId);
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].authid, 'worker-1');
  const acceptance = events.find((e) => e.type === 'decision-support.suggestion.accepted' && e.subject === suggestion.id);
  assert.strictEqual(created[0].causationid, acceptance.id);

  // Kept under the accepting caller and the suggestion's id.
  assert.ok(mock.store.findById('idempotency-keys', `worker-1:${suggestion.id}`));
});

test('a corrected value is saved and kept as performed', async () => {
  const { body: suggestion } = await propose(correction(1100, 1250));
  const corrected = patchCall(correction(1100, 1300));
  const { status, body } = await decide(suggestion.id, 'accept', { call: corrected });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.deepStrictEqual(body.performed, corrected);
  assert.strictEqual((await details()).incomes[SALARY].amount, 1300);
});

test('a correction that changes a path, or what a test read, is refused with 409', async () => {
  const { body: suggestion } = await propose(correction(1100, 1250));
  const otherPath = patchCall([
    { op: 'test', path: `/incomes/${SALARY}/frequency`, value: 'monthly' },
    { op: 'replace', path: `/incomes/${SALARY}/frequency`, value: 'weekly' },
  ]);
  assert.strictEqual((await decide(suggestion.id, 'accept', { call: otherPath })).status, 409);
  assert.strictEqual((await decide(suggestion.id, 'accept', { call: patchCall(correction(1000, 1250)) })).status, 409);
  assert.strictEqual((await details()).incomes[SALARY].amount, 1100);
});

test('accepting after the tested value changed leaves the suggestion refused', async () => {
  const { body: suggestion } = await propose(correction(1100, 1250));
  const byHand = await send('PATCH', DETAILS, [{ op: 'replace', path: `/incomes/${SALARY}/amount`, value: 1400 }],
    { 'content-type': 'application/json-patch+json', 'idempotency-key': 'by-hand' });
  assert.strictEqual(byHand.status, 200, JSON.stringify(byHand.body));

  const accepted = await decide(suggestion.id, 'accept');
  assert.strictEqual(accepted.status, 409, JSON.stringify(accepted.body));
  assert.strictEqual((await send('GET', `/decision-support/suggestions/${suggestion.id}`)).body.status, 'refused');
  assert.strictEqual((await details()).incomes[SALARY].amount, 1400);
});
