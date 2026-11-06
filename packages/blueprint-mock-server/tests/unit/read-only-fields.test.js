/**
 * A field the server sets (readOnly) is the server's: a client's update may
 * not change it, though it may send it back unchanged, and only the server's
 * own calls may — not a client claiming the system role. A
 * create may send one its create schema declares writable — an id the caller
 * chooses — or the value the server sets anyway, such as the state a machine
 * starts every record in. Against the harness contracts; the states are read
 * from the application's state machine.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/browser.js';
import { asSystem } from '../../src/auth-context.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
const machine = contracts.docs
  .flatMap((doc) => doc.content?.machines ?? [])
  .find((m) => m.object === 'Application');
const initialState = machine.initialState;
const otherState = machine.states.map((s) => s.id).find((id) => id !== initialState);

const APPLICATION = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-000000000001';

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
});

const request = (method, path, body) => new Request(`http://localhost${path}`, {
  method,
  headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1', 'x-caller-roles': 'case_worker' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const send = async (req) => {
  const response = await mock.fetch(req);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const stored = async () => (await send(request('GET', `/intake/applications/${APPLICATION}`))).body;

test('a client update that changes a readOnly field is refused with 422, naming it', async () => {
  const before = await stored();
  const { status, body } = await send(request('PATCH', `/intake/applications/${APPLICATION}`, { status: otherState === before.status ? initialState : otherState }));
  assert.strictEqual(status, 422, JSON.stringify(body));
  assert.deepStrictEqual(body.details.map((d) => d.field), ['status']);
  assert.strictEqual((await stored()).status, before.status);
});

test('a client may send a readOnly field back unchanged', async () => {
  const before = await stored();
  const { status, body } = await send(request('PATCH', `/intake/applications/${APPLICATION}`, { status: before.status, interviewDate: '2026-12-01' }));
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.interviewDate, '2026-12-01');
});

test('a client claiming the system role in X-Caller-Roles is still a client, and is refused', async () => {
  const before = await stored();
  const claimed = new Request(`http://localhost/intake/applications/${APPLICATION}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-caller-id': 'anyone', 'x-caller-roles': 'system' },
    body: JSON.stringify({ status: otherState === before.status ? initialState : otherState }),
  });
  const { status, body } = await send(claimed);
  assert.strictEqual(status, 422, JSON.stringify(body));
  assert.strictEqual((await stored()).status, before.status);
});

test('the system may change a readOnly field', async () => {
  const before = await stored();
  const next = otherState === before.status ? initialState : otherState;
  const { status, body } = await send(asSystem(request('PATCH', `/intake/applications/${APPLICATION}`, { status: next })));
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.status, next);
});

test('a create may send a readOnly field its create schema declares: the id a caller chooses', async () => {
  const { status, body } = await send(request('POST', `/intake/applications/${APPLICATION}/members`, {
    id: MEMBER, firstName: 'Maria', lastName: 'Delgado', relationship: 'child',
  }));
  assert.strictEqual(status, 201, JSON.stringify(body));
  assert.strictEqual(body.id, MEMBER);
});

test('a create may send the value the server sets anyway, and not another', async () => {
  const same = await send(request('POST', '/intake/applications', { programsAppliedFor: ['snap'], channel: 'online', status: initialState }));
  assert.strictEqual(same.status, 201, JSON.stringify(same.body));
  assert.strictEqual(same.body.status, initialState);
  const other = await send(request('POST', '/intake/applications', { programsAppliedFor: ['snap'], channel: 'online', status: otherState }));
  assert.strictEqual(other.status, 422, JSON.stringify(other.body));
  assert.deepStrictEqual(other.body.details.map((d) => d.field), ['status']);
});
