/**
 * Two mocks in one process share nothing: a page's client and the server it
 * routes to, or two servers in one test (instance.js). An event one sends
 * reaches neither the other's event stream nor its reactions, a stub
 * registered on one doesn't answer the other, and each validates against its
 * own contracts.
 */

import { test, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
// What an informing suggestion is about has to exist: Rosa, seeded in the harness.
const ROSA = '11111111-1111-4111-8111-100000000001';

/** The same contracts, except that a suggestion's message is at most 5 characters. */
function withShortMessages() {
  const changed = structuredClone(contracts);
  const doc = changed.docs.find((d) => d.relativePath.endsWith('decision-support-suggestions-openapi.yaml'));
  doc.content.components.schemas.InformingSuggestionFields.properties.message.maxLength = 5;
  return changed;
}

async function boot(set) {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try { return await createMockServer({ contracts: set, seed: true }); } finally { console.log = log; console.warn = warn; }
}

const send = async (mock, method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'assistant-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const inform = (mock, message = 'Rosa') => send(mock, 'POST', '/decision-support/suggestions', {
  kind: 'informing', subjectType: 'application_member', subjectId: ROSA, path: '/firstName', category: 'name-mismatch', message,
});

/** The event that expires a suggestion, as the scheduler sends it when its timer fires. */
const expiry = (id) => ({
  specversion: '1.0', id: crypto.randomUUID(), source: '/scheduling', type: 'decision-support.suggestion_expiry',
  subject: id, time: new Date().toISOString(), data: { timerId: `decision-support.suggestion_expiry.${id}` },
});

let one;
let other;
before(async () => {
  one = await boot(contracts);
  other = await boot(withShortMessages());
});

test("an event one mock sends reaches neither the other's reactions nor its event log", async () => {
  const { status, body: suggestion } = await inform(other);
  assert.strictEqual(status, 201, JSON.stringify(suggestion));

  // Sent to the first: the second's machine doesn't react to it.
  const sent = expiry(suggestion.id);
  assert.strictEqual((await send(one, 'POST', '/platform/events', sent)).status, 201);
  assert.strictEqual((await send(other, 'GET', `/decision-support/suggestions/${suggestion.id}`)).body.status, 'proposed');
  const logged = (await send(other, 'GET', '/platform/events?type=decision-support.suggestion_expiry')).body.items;
  assert.ok(!logged.some((event) => event.id === sent.id), "not in the other's log");

  // Sent to the second, it does.
  assert.strictEqual((await send(other, 'POST', '/platform/events', expiry(suggestion.id))).status, 201);
  assert.strictEqual((await send(other, 'GET', `/decision-support/suggestions/${suggestion.id}`)).body.status, 'expired');
});

test("an event one mock sends doesn't reach the other's event stream", async () => {
  const controller = new AbortController();
  const response = await other.fetch(new Request('http://localhost/platform/events/stream?type=decision-support.suggestion_expiry', {
    headers: { accept: 'text/event-stream' }, signal: controller.signal,
  }));
  assert.strictEqual(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const fromOne = expiry('11111111-1111-4111-8111-999999999991');
  const fromOther = expiry('11111111-1111-4111-8111-999999999992');
  await send(one, 'POST', '/platform/events', fromOne);
  await send(other, 'POST', '/platform/events', fromOther);

  // Read until the second's own event arrives; the first's never came before it.
  let text = '';
  while (!text.includes(fromOther.id)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  controller.abort();
  await reader.cancel().catch(() => {});
  assert.ok(text.includes(fromOther.id), 'its own event is streamed');
  assert.ok(!text.includes(fromOne.id), "the other mock's is not");
});

test("a stub registered on one mock doesn't answer the other", async () => {
  const stub = { match: { method: 'GET', url: '/decision-support/suggestions' }, response: { status: 418, body: { stubbed: true } } };
  assert.strictEqual((await send(one, 'POST', '/mock/stubs/http', stub)).status, 201);
  assert.strictEqual((await send(other, 'GET', '/mock/stubs/http')).body.items.length, 0);
  assert.strictEqual((await send(other, 'GET', '/decision-support/suggestions')).status, 200);
  assert.strictEqual((await send(one, 'GET', '/decision-support/suggestions')).status, 418);
});

test('each mock validates against its own contracts', async () => {
  const message = 'The caller spelled her first name R-O-S-A.';
  const here = await inform(one, message);
  assert.strictEqual(here.status, 201, JSON.stringify(here.body));
  const there = await inform(other, message);
  assert.strictEqual(there.status, 422, 'the second allows 5 characters');
  assert.ok(there.body.details.some((d) => d.field === 'message'), JSON.stringify(there.body));
});
