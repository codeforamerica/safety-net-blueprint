/**
 * What deleting a record does to the records that name it: x-relationship's
 * onDelete, OData's OnDelete. With cascade they go with it; without one, the
 * delete is refused while any names it. Against the harness's seeded
 * application, whose members, incomes and interviews cascade and whose
 * determination doesn't.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
const APPLICATION = '11111111-1111-4111-8111-111111111111';
const ROSA = '11111111-1111-4111-8111-100000000001';
const ROSA_INCOMES = ['200000000001', '200000000002', '200000000003', '200000000004'].map((n) => `11111111-1111-4111-8111-${n}`);

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
});

const send = async (method, path, body, headers = {}) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'x-caller-id': 'worker-1', 'x-caller-roles': 'case_worker', 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const incomes = async () => (await send('GET', `/intake/applications/${APPLICATION}/incomes?limit=100`)).body.items.map((i) => i.id);

test('deleting a member deletes the incomes that name her, each announcing it', async () => {
  for (const id of ROSA_INCOMES) assert.ok((await incomes()).includes(id));
  const { status } = await send('DELETE', `/intake/applications/${APPLICATION}/members/${ROSA}`);
  assert.strictEqual(status, 204);
  for (const id of ROSA_INCOMES) assert.ok(!(await incomes()).includes(id), id);
  const events = (await send('GET', '/platform/events?limit=200')).body.items;
  assert.ok(events.some((e) => e.type === 'intake.application_member.deleted' && e.subject === ROSA));
  for (const id of ROSA_INCOMES) {
    assert.ok(events.some((e) => e.type === 'intake.application_income.deleted' && e.subject === id), id);
  }
});

test('a record that names it without onDelete refuses the delete, and nothing goes', async () => {
  const { status, body } = await send('DELETE', `/intake/applications/${APPLICATION}`);
  assert.strictEqual(status, 409, JSON.stringify(body));
  assert.ok(body.details.some((d) => d.message.startsWith('Determination ')));
  assert.strictEqual((await send('GET', `/intake/applications/${APPLICATION}`)).status, 200);
  assert.strictEqual((await send('GET', `/intake/applications/${APPLICATION}/members/${ROSA}`)).status, 200);
  assert.strictEqual((await incomes()).length, ROSA_INCOMES.length);
});

test('removing a member in an editable composition\'s patch takes her incomes too', async () => {
  const { status, body } = await send('PATCH', `/intake/applications/${APPLICATION}/details`,
    [{ op: 'remove', path: `/members/${ROSA}` }],
    { 'content-type': 'application/json-patch+json', 'idempotency-key': 'remove-rosa' });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.members[ROSA], undefined);
  for (const id of ROSA_INCOMES) assert.strictEqual(body.incomes[id], undefined, id);
});
