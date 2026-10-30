/**
 * Proposing and deciding a suggestion, run against the harness's contracts, which list the
 * `suggestions` capability.
 *
 * An operation suggestion carries a call, and the call is checked the way the
 * operation it names would check the request it stands for. An informing one
 * names a category the set declares. Accepting an operation suggestion is in
 * operation-calls-in-actions.test.js.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/browser.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
const APPLICATION = '6a0c3e2b-1f4d-4b8a-9c7e-5d2f1a0b3c84';
const MEMBER = '1b7d9e3f-2a4c-4e6b-8d0f-3c5e7a9b1d26';

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
});

const send = async (method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'assistant-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const propose = (call) => send('POST', '/decision-support/suggestions', { kind: 'operation', call });
const memberUpdate = (overrides = {}) => ({
  operationId: 'updateApplicationMember',
  parameters: [
    { name: 'applicationId', in: 'path', value: APPLICATION },
    { name: 'memberId', in: 'path', value: MEMBER },
  ],
  body: { firstName: 'Rosa' },
  ...overrides,
});
const fields = (response) => response.body.details.map((d) => d.field);

test('a set listing suggestions serves them', async () => {
  const { status, body } = await send('GET', '/decision-support/suggestions');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.items, []);
});

test('a call the operation would accept is proposed', async () => {
  const { status, body } = await propose(memberUpdate());
  assert.strictEqual(status, 201, JSON.stringify(body));
  assert.strictEqual(body.status, 'proposed');
  assert.deepStrictEqual(body.call, memberUpdate());
});

test('an operation a state machine adds can be proposed too, and is checked the same way', async () => {
  const pause = (body) => propose({
    operationId: 'pauseTranscript',
    parameters: [{ name: 'transcriptId', in: 'path', value: '4d1f13f0-3e26-4c50-b2fb-8d140f7ec1c2' }],
    body,
  });
  const accepted = await pause({ at: '2026-10-12T10:00:00Z' });
  assert.strictEqual(accepted.status, 201, JSON.stringify(accepted.body));
  const refused = await pause({ at: 'yesterday' });
  assert.strictEqual(refused.status, 422);
  assert.deepStrictEqual(fields(refused), ['call.body.at']);
});

test('an operationId the set does not declare is refused, naming it', async () => {
  const response = await propose(memberUpdate({ operationId: 'updateWidget' }));
  assert.strictEqual(response.status, 422);
  assert.deepStrictEqual(fields(response), ['call.operationId']);
  assert.match(response.body.details[0].message, /updateWidget/);
});

test('a body the operation\'s request schema refuses is refused, naming the field', async () => {
  const response = await propose(memberUpdate({ body: { firstName: 5 } }));
  assert.strictEqual(response.status, 422);
  assert.deepStrictEqual(fields(response), ['call.body.firstName']);
});

test('a parameter the operation does not declare is refused', async () => {
  const call = memberUpdate();
  call.parameters.push({ name: 'color', in: 'query', value: 'blue' });
  const response = await propose(call);
  assert.strictEqual(response.status, 422);
  assert.deepStrictEqual(fields(response), ['call.parameters[2]']);
});

test('a path parameter left out is refused', async () => {
  const response = await propose(memberUpdate({ parameters: [{ name: 'applicationId', in: 'path', value: APPLICATION }] }));
  assert.strictEqual(response.status, 422);
  assert.match(response.body.details[0].message, /requires the path parameter "memberId"/);
});

test('a parameter value its schema refuses is refused', async () => {
  const response = await propose(memberUpdate({
    parameters: [
      { name: 'applicationId', in: 'path', value: 'not-a-uuid' },
      { name: 'memberId', in: 'path', value: MEMBER },
    ],
  }));
  assert.strictEqual(response.status, 422);
  assert.deepStrictEqual(fields(response), ['call.parameters[0].value']);
});

const inform = (overrides = {}) => send('POST', '/decision-support/suggestions', {
  kind: 'informing',
  subjectType: 'application_member',
  subjectId: MEMBER,
  path: '/firstName',
  category: 'name-mismatch',
  message: 'The caller spelled her first name R-O-S-A.',
  ...overrides,
});

test('an informing suggestion in a category the set declares is proposed', async () => {
  const { status, body } = await inform();
  assert.strictEqual(status, 201, JSON.stringify(body));
  assert.strictEqual(body.status, 'proposed');
});

test('a category alone is enough: its description is what a person reads', async () => {
  const { status, body } = await inform({ message: undefined });
  assert.strictEqual(status, 201, JSON.stringify(body));
  assert.strictEqual(body.message, undefined);
});

test('a message alone is an uncategorized suggestion, found by the category it lacks', async () => {
  const { status, body } = await inform({ category: undefined });
  assert.strictEqual(status, 201, JSON.stringify(body));
  await inform();
  const { body: list } = await send('GET', `/decision-support/suggestions?q=${encodeURIComponent('kind:informing -category:*')}`);
  assert.deepStrictEqual(list.items.map((s) => s.id), [body.id]);
});

test('one with neither a category nor a message is refused', async () => {
  const response = await inform({ category: undefined, message: undefined });
  assert.strictEqual(response.status, 422);
});

test('a category the set does not declare is refused', async () => {
  const response = await inform({ category: 'weather' });
  assert.strictEqual(response.status, 422);
  assert.ok(fields(response).includes('category'), JSON.stringify(response.body));
});

test('a path that is not a JSON Pointer is refused', async () => {
  const response = await inform({ path: 'firstName' });
  assert.strictEqual(response.status, 422);
  assert.ok(fields(response).includes('path'), JSON.stringify(response.body));
});

const decide = (id, action, body = {}) => send('POST', `/decision-support/suggestions/${id}/${action}`, body);
const events = async (type) => (await send('GET', `/platform/events?q=${encodeURIComponent(`type:${type}`)}`)).body.items;

test('accepting an informing suggestion means the person took it up', async () => {
  const { body: suggestion } = await inform();
  const { status, body } = await decide(suggestion.id, 'accept');
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.status, 'accepted');
  assert.strictEqual((await events('decision-support.suggestion.accepted')).length, 1);
});

test('a call sent when accepting an informing suggestion is refused', async () => {
  const { body: suggestion } = await inform();
  const { status, body } = await decide(suggestion.id, 'accept', { call: memberUpdate() });
  assert.strictEqual(status, 409, JSON.stringify(body));
  assert.match(body.message, /only for an operation suggestion/);
});

test('dismissing takes a reason, and keeps it', async () => {
  const { body: suggestion } = await inform();
  const without = await decide(suggestion.id, 'dismiss');
  assert.strictEqual(without.status, 422);
  const { status, body } = await decide(suggestion.id, 'dismiss', { reason: 'She confirmed the spelling on file.' });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.status, 'dismissed');
  assert.strictEqual(body.reason, 'She confirmed the spelling on file.');
  assert.strictEqual((await events('decision-support.suggestion.dismissed')).length, 1);
});

test('the proposal\'s event is the suggestion\'s created event', async () => {
  const { body: suggestion } = await inform();
  const [created] = await events('decision-support.suggestion.created');
  assert.strictEqual(created.subject, suggestion.id);
});

test('expiring closes an open suggestion, and a closed one cannot be decided', async () => {
  const { body: suggestion } = await inform();
  const { status, body } = await decide(suggestion.id, 'expire');
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.status, 'expired');
  assert.strictEqual((await events('decision-support.suggestion.expired')).length, 1);
  assert.strictEqual((await decide(suggestion.id, 'accept')).status, 409);
  assert.strictEqual((await decide(suggestion.id, 'dismiss', { reason: 'Too late.' })).status, 409);
});
