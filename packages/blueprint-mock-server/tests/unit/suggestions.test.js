/**
 * Proposing and deciding a suggestion, run against the harness's contracts, which list the
 * `suggestions` capability.
 *
 * An operation suggestion carries a call, and the call is checked the way the
 * operation it names would check the request it stands for. An informing one
 * names a category the set declares. Accepting an operation suggestion is in
 * operation-calls-in-actions.test.js.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
const APPLICATION = '6a0c3e2b-1f4d-4b8a-9c7e-5d2f1a0b3c84';
const MEMBER = '1b7d9e3f-2a4c-4e6b-8d0f-3c5e7a9b1d26';
// What an informing suggestion is about has to exist: Rosa, seeded in the harness.
const ROSA = '11111111-1111-4111-8111-100000000001';

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
  hearTimers();
});
afterEach(() => listening.abort());

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
  requestBody: { payload: { firstName: 'Rosa' } },
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
    requestBody: { payload: body },
  });
  const accepted = await pause({ at: '2026-10-12T10:00:00Z' });
  assert.strictEqual(accepted.status, 201, JSON.stringify(accepted.body));
  const refused = await pause({ at: 'yesterday' });
  assert.strictEqual(refused.status, 422);
  assert.deepStrictEqual(fields(refused), ['call.requestBody.payload.at']);
});

test('an operationId the set does not declare is refused, naming it', async () => {
  const response = await propose(memberUpdate({ operationId: 'updateWidget' }));
  assert.strictEqual(response.status, 422);
  assert.deepStrictEqual(fields(response), ['call.operationId']);
  assert.match(response.body.details[0].message, /updateWidget/);
});

test('a body the operation\'s request schema refuses is refused, naming the field', async () => {
  const response = await propose(memberUpdate({ requestBody: { payload: { firstName: 5 } } }));
  assert.strictEqual(response.status, 422);
  assert.deepStrictEqual(fields(response), ['call.requestBody.payload.firstName']);
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
  subjectId: ROSA,
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

// Expiry: a suggestion asks the scheduler for a timer at its expiresAt — a day
// out unless it says when — and deciding it cancels the timer. Scheduling
// events go to the bus, for a scheduler or a stub, not to /platform/events.
// Heard on each test's mock's event stream, as a scheduler would hear them.
const scheduling = [];
let listening;
function hearTimers() {
  listening = new AbortController();
  mock.fetch(new Request('http://localhost/platform/events/stream?type=platform.timer.*', { signal: listening.signal }))
    .then(async (response) => {
      const lines = response.body.pipeThrough(new TextDecoderStream());
      for await (const chunk of lines) {
        for (const line of chunk.split('\n')) if (line.startsWith('data: ')) scheduling.push(JSON.parse(line.slice(6)));
      }
    })
    .catch(() => { /* aborted at the end of the test */ });
}
// What the stream has sent arrives a turn later than the request that sent it.
const delivered = () => new Promise((resolve) => setImmediate(resolve));
const eventsOf = async (type) => (await send('GET', `/platform/events?type=${type}`)).body.items;
const timerFor = async (id) => (await delivered(), scheduling)
  .find((e) => e.type === 'platform.timer.requested' && e.data.timerId === `decision-support.suggestion_expiry.${id}`);
const cancelledFor = async (id) => (await delivered(), scheduling)
  .filter((e) => e.type === 'platform.timer.cancelled' && e.data.timerId === `decision-support.suggestion_expiry.${id}`);

test('a suggestion with no expiresAt expires a day out, and asks for a timer then', async () => {
  const before = Date.now();
  const { body: created } = await inform();
  const { body: suggestion } = await send('GET', `/decision-support/suggestions/${created.id}`);
  const day = 24 * 60 * 60 * 1000;
  const expiresAt = Date.parse(suggestion.expiresAt);
  assert.ok(expiresAt >= before + day && expiresAt <= Date.now() + day, suggestion.expiresAt);
  const timer = await timerFor(created.id);
  assert.ok(timer, 'a timer is requested');
  assert.strictEqual(timer.data.fireAt, suggestion.expiresAt);
  assert.strictEqual(timer.data.callback.event, 'decision-support.suggestion_expiry');
});

test('a suggestion that says when it expires keeps that, and its timer fires then', async () => {
  const { body: created } = await inform({ expiresAt: '2030-01-01T00:00:00.000Z' });
  const { body: suggestion } = await send('GET', `/decision-support/suggestions/${created.id}`);
  assert.strictEqual(suggestion.expiresAt, '2030-01-01T00:00:00.000Z');
  assert.strictEqual((await timerFor(created.id)).data.fireAt, '2030-01-01T00:00:00.000Z');
});

test('the timer firing expires a suggestion nobody decided', async () => {
  await send('DELETE', '/mock/stubs/events');
  await send('POST', '/mock/stubs/events', {
    on: 'platform.timer.requested', match: { 'data.callback.event': 'decision-support.suggestion_expiry' },
  });
  try {
    const { body: created } = await inform();
    const { body: after } = await send('GET', `/decision-support/suggestions/${created.id}`);
    assert.strictEqual(after.status, 'expired');
    assert.ok((await eventsOf('decision-support.suggestion.expired')).some((e) => e.subject === created.id));
  } finally {
    await send('DELETE', '/mock/stubs/events');
  }
});

test('deciding a suggestion cancels its timer, and a late timer leaves it as decided', async () => {
  const { body: created } = await inform();
  assert.strictEqual((await send('POST', `/decision-support/suggestions/${created.id}/dismiss`, { reason: 'already fixed' })).status, 200);
  assert.strictEqual((await cancelledFor(created.id)).length, 1);
  const late = await send('POST', '/platform/events', {
    specversion: '1.0', id: crypto.randomUUID(), source: '/scheduling', type: 'decision-support.suggestion_expiry',
    subject: created.id, time: new Date().toISOString(), data: { timerId: `decision-support.suggestion_expiry.${created.id}` },
  });
  assert.ok(late.status < 300, JSON.stringify(late.body));
  const { body: after } = await send('GET', `/decision-support/suggestions/${created.id}`);
  assert.strictEqual(after.status, 'dismissed');
});

test('accepting, and expiring by hand, cancel the timer too', async () => {
  const { body: accepted } = await inform();
  assert.strictEqual((await send('POST', `/decision-support/suggestions/${accepted.id}/accept`, {})).status, 200);
  assert.strictEqual((await cancelledFor(accepted.id)).length, 1);
  const { body: expired } = await inform({ category: 'missing-income' });
  assert.strictEqual((await send('POST', `/decision-support/suggestions/${expired.id}/expire`)).status, 200);
  assert.strictEqual((await cancelledFor(expired.id)).length, 1);
});

// Duplicates: a proposal repeating one still open, or dismissed, is refused,
// naming it. An operation suggestion is its whole call; an informing one its
// subject, path and category — or, uncategorized, its message.

test('proposing the same change again while it is open is refused, naming the open one', async () => {
  const { body: first } = await propose(memberUpdate());
  const { status, body } = await propose(memberUpdate());
  assert.strictEqual(status, 409, JSON.stringify(body));
  assert.deepStrictEqual(body.details, [{ id: first.id, status: 'proposed' }]);
  assert.match(body.message, new RegExp(first.id));
});

test('the same call differing only in case, spacing or the order of its parameters is the same', async () => {
  const { body: first } = await propose(memberUpdate());
  const call = memberUpdate({ requestBody: { payload: { firstName: '  ROSA ' } } });
  call.parameters.reverse();
  const { status, body } = await propose(call);
  assert.strictEqual(status, 409, JSON.stringify(body));
  assert.strictEqual(body.details[0].id, first.id);
});

test('changing an argument is a different suggestion', async () => {
  await propose(memberUpdate());
  const { status, body } = await propose(memberUpdate({ requestBody: { payload: { firstName: 'Rosalind' } } }));
  assert.strictEqual(status, 201, JSON.stringify(body));
});

test('the fingerprint is a keyed hash, not the values it identifies', async () => {
  const { body } = await propose(memberUpdate());
  assert.match(body.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(!/rosa|updateapplicationmember/i.test(body.fingerprint));
  const { body: other } = await inform();
  assert.notStrictEqual(other.fingerprint, body.fingerprint);
});

test('an informing suggestion reworded is the same; uncategorized, a new message is a new one', async () => {
  await inform();
  const reworded = await inform({ message: 'Her first name may be misspelled.' });
  assert.strictEqual(reworded.status, 409, JSON.stringify(reworded.body));
  const otherField = await inform({ path: '/lastName' });
  assert.strictEqual(otherField.status, 201, JSON.stringify(otherField.body));

  await inform({ category: undefined, message: 'Ask about the second job.' });
  const same = await inform({ category: undefined, message: 'ask about  the second job. ' });
  assert.strictEqual(same.status, 409, JSON.stringify(same.body));
  const different = await inform({ category: undefined, message: 'Ask about child support.' });
  assert.strictEqual(different.status, 201, JSON.stringify(different.body));
});

test('one dismissed stays refused; one accepted or expired can be suggested again', async () => {
  const { body: dismissed } = await inform();
  await decide(dismissed.id, 'dismiss', { reason: 'She confirmed the spelling on file.' });
  const again = await inform();
  assert.strictEqual(again.status, 409);
  assert.deepStrictEqual(again.body.details, [{ id: dismissed.id, status: 'dismissed' }]);

  const { body: accepted } = await inform({ category: 'missing-income' });
  await decide(accepted.id, 'accept');
  assert.strictEqual((await inform({ category: 'missing-income' })).status, 201);

  const { body: expired } = await inform({ path: '/lastName' });
  await decide(expired.id, 'expire');
  assert.strictEqual((await inform({ path: '/lastName' })).status, 201);
});
