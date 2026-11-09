/**
 * The event stream, and events from routed services.
 *
 * The stream sends each event with its id, filters as listing events does,
 * catches a reader up from Last-Event-ID, and answers 410 for an id the log
 * doesn't have (platform-events-openapi.yaml).
 *
 * A mock whose state machines react to events a routed API sends reads them
 * from the service: its stream, or its event log when it has none. The
 * harness's session follows its transcript, so with the transcripts routed
 * elsewhere, the transcript's events come from there.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, load, generate } from '@codeforamerica/blueprint-core';
import { createMockServer } from '../../src/browser.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contracts = generate(discover(resolve(packageRoot, '../blueprint-harness/generated/resolved')).map(load), 'artifact');

async function boot(options = {}) {
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try {
    return await createMockServer({ contracts, ...options });
  } finally { console.log = log; console.warn = warn; }
}

const json = (method, body) => ({ method, headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' }, body: body && JSON.stringify(body) });
const call = async (mock, method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, json(method, body)));
  return { status: response.status, body: await response.json().catch(() => null) };
};

const eventually = async (check, message = 'timed out') => {
  for (let i = 0; i < 1000; i += 1) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  assert.fail(message);
};

/** Read a stream's messages as they come: `{ id, data }`. */
function readMessages(response) {
  const messages = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const id = block.match(/^id: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (data) messages.push({ id, data: JSON.parse(data) });
      }
    }
  })().catch(() => {});
  return { messages, stop: () => reader.cancel() };
}

const publish = (mock, event) => call(mock, 'POST', '/platform/events', { specversion: '1.0', source: '/test', ...event });

test('the stream sends each event with its id, and filters by type', async () => {
  const mock = await boot();
  const response = await mock.fetch(new Request('http://localhost/platform/events/stream?type=test.kept.*'));
  const { messages, stop } = readMessages(response);
  await publish(mock, { id: 'a', type: 'test.kept.one' });
  await publish(mock, { id: 'b', type: 'test.dropped' });
  await publish(mock, { id: 'c', type: 'test.kept.two' });
  await eventually(() => messages.length === 2);
  assert.deepEqual(messages.map((m) => [m.id, m.data.id, m.data.type]), [['a', 'a', 'test.kept.one'], ['c', 'c', 'test.kept.two']]);
  await stop();
});

test('a reader that reconnects with Last-Event-ID gets what it missed, then live', async () => {
  const mock = await boot();
  await publish(mock, { id: 'one', type: 'test.x' });
  await publish(mock, { id: 'two', type: 'test.x' });
  await publish(mock, { id: 'three', type: 'test.x' });
  const response = await mock.fetch(new Request('http://localhost/platform/events/stream?type=test.x', { headers: { 'last-event-id': 'one' } }));
  const { messages, stop } = readMessages(response);
  await publish(mock, { id: 'four', type: 'test.x' });
  await eventually(() => messages.length === 3);
  assert.deepEqual(messages.map((m) => m.id), ['two', 'three', 'four']);
  await stop();
});

test('an id the log doesn\'t have is answered 410', async () => {
  const mock = await boot();
  const response = await mock.fetch(new Request('http://localhost/platform/events/stream', { headers: { 'last-event-id': 'never' } }));
  assert.equal(response.status, 410);
});

/**
 * A page's mock with the transcripts answered elsewhere, and a session there
 * connected to transcript `tr-1`. `serve` answers what the routed service is
 * asked: its event stream and log included.
 */
async function pageWithSession(serve) {
  const asked = [];
  const mock = await boot({
    routing: [{ api: 'communication-transcripts', handler: async (request) => { asked.push(request); return serve(request); } }],
  });
  const created = await call(mock, 'POST', '/communication/transcription-sessions', {
    profileId: '00000000-0000-4000-8000-000000000001', model: 'standard', client: 'test/1.0.0', startedAt: '2026-10-12T10:00:00Z',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const collection = Object.keys(mock.store.snapshot()).find((name) => mock.store.findById(name, created.body.id));
  mock.store.update(collection, created.body.id, { status: 'connected', transcriptId: '00000000-0000-4000-8000-0000000000aa' });
  const statusOf = async () => (await call(mock, 'GET', `/communication/transcription-sessions/${created.body.id}`)).body.status;
  return { mock, asked, statusOf };
}

const paused = { specversion: '1.0', id: 'ev-paused', type: 'communication.transcript.paused', source: '/communication', subject: '00000000-0000-4000-8000-0000000000aa', time: '2026-10-12T10:05:00Z', data: {} };

/** A stream a test writes events onto. */
function sseStream() {
  let push;
  const body = new ReadableStream({ start(controller) { push = (event) => controller.enqueue(new TextEncoder().encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)); } });
  return { response: () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }), push: (event) => push(event) };
}

test('the session follows its transcript paused on the service, through its stream', async () => {
  const stream = sseStream();
  const { mock, asked, statusOf } = await pageWithSession((request) => (
    new URL(request.url).pathname === '/platform/events/stream' ? stream.response() : new Response(null, { status: 404 })));
  await eventually(() => asked.some((r) => new URL(r.url).pathname === '/platform/events/stream'), 'the mock never asked for the stream');
  const streamRequest = asked.find((r) => new URL(r.url).pathname === '/platform/events/stream');
  assert.equal(new URL(streamRequest.url).searchParams.get('type'), 'communication.transcript.*');
  stream.push(paused);
  await eventually(async () => (await statusOf()) === 'paused', 'the session didn\'t follow');
  // Arrived from the service, so not sent back to it.
  assert.ok(!asked.some((r) => r.method === 'POST' && r.headers.get('content-type')?.includes('cloudevents')));
  mock.stopFollowing();
});

test('with no stream, the service\'s event log is polled', async () => {
  let log = [];
  const { mock, statusOf } = await pageWithSession((request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/platform/events/stream') return new Response(null, { status: 404 });
    if (pathname === '/platform/events') return Response.json({ items: log, total: log.length });
    return new Response(null, { status: 404 });
  });
  // Paused once the session is connected, as it would be.
  log = [paused];
  await eventually(async () => (await statusOf()) === 'paused', 'the session didn\'t follow');
  mock.stopFollowing();
});

test('an event the mock already has isn\'t handled twice', async () => {
  const stream = sseStream();
  const { mock, asked } = await pageWithSession((request) => (
    new URL(request.url).pathname === '/platform/events/stream' ? stream.response() : new Response(null, { status: 404 })));
  await eventually(() => asked.length > 0);
  await publish(mock, { ...paused, id: 'mine' });
  const before = (await call(mock, 'GET', '/platform/events?limit=100')).body.items.filter((e) => e.id === 'mine').length;
  stream.push({ ...paused, id: 'mine' });
  await new Promise((done) => setTimeout(done, 30));
  const after = (await call(mock, 'GET', '/platform/events?limit=100')).body.items.filter((e) => e.id === 'mine').length;
  assert.equal(after, before);
  mock.stopFollowing();
});
