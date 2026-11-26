/**
 * A finished line a session's adapter publishes becomes a transcript entry,
 * and the entry's created event names the line_finished event as its cause
 * (causationid): how a consumer finds the entry a line became. Published
 * twice, as after a network error, the line is kept once. It goes to the
 * session's own transcript, whatever the event's data names. Run against the
 * harness's contracts, with the adapter's streaming part answering in place.
 */

import { test, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/contracts.json', import.meta.url), 'utf8'));

let mock;
before(async () => {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try {
    mock = await createMockServer({
      contracts,
      routing: ['startStream', 'pauseStream', 'stopStream']
        .map((operation) => ({ operation, handler: async () => Response.json({ metadata: {} }, { status: 202 }) })),
    });
  } finally { console.log = log; console.warn = warn; }
});

const send = async (method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const eventually = async (check, message) => {
  for (let i = 0; i < 200; i += 1) {
    const found = await check();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
};

test('the entry a finished line became names the line_finished event as its cause, and the line is kept once', async () => {
  const { body: session } = await send('POST', '/communication/transcription-sessions', {
    // english-interviews, seeded by the harness's overlays.
    profileId: '7a1e0c2d-0000-4000-8000-0000000000f1', model: 'standard', client: 'test/1.0.0', startedAt: '2026-10-12T10:00:00Z',
  });
  assert.strictEqual((await send('POST', `/communication/transcription-sessions/${session.id}/start`, {})).status, 200);
  const { transcriptId } = (await send('GET', `/communication/transcription-sessions/${session.id}`)).body;

  const line = {
    specversion: '1.0', source: '/communication', type: 'communication.transcription_session.line_finished',
    subject: session.id, partitionkey: session.id,
    data: { transcriptId, key: 'c1.l1', text: 'Who lives with you?', speaker: 'staff', startedAt: '2026-10-12T10:00:01Z', endedAt: '2026-10-12T10:00:03Z' },
  };
  assert.strictEqual((await send('POST', '/platform/events', { ...line, id: 'line-1' })).status, 201);
  // Published again, as after a network error.
  assert.strictEqual((await send('POST', '/platform/events', { ...line, id: 'line-1-again' })).status, 201);

  const created = await eventually(async () => (await send('GET', '/platform/events?limit=100')).body.items
    .find((event) => event.type.endsWith('.transcript_entry.created') && event.data?.transcriptId === transcriptId), 'no entry was created');
  assert.strictEqual(created.causationid, 'line-1');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const { body: entries } = await send('GET', `/communication/transcripts/${transcriptId}/entries`);
  assert.deepStrictEqual(entries.items.map((entry) => entry.text), ['Who lives with you?']);
});

test('a line goes to the session\'s own transcript, whatever transcript the event names', async () => {
  const started = async () => {
    const { body: session } = await send('POST', '/communication/transcription-sessions', {
      profileId: '7a1e0c2d-0000-4000-8000-0000000000f1', model: 'standard', client: 'test/1.0.0', startedAt: '2026-10-12T10:00:00Z',
    });
    await send('POST', `/communication/transcription-sessions/${session.id}/start`, {});
    return (await send('GET', `/communication/transcription-sessions/${session.id}`)).body;
  };
  const a = await started();
  const b = await started();

  // Session A's line, naming session B's transcript.
  assert.strictEqual((await send('POST', '/platform/events', {
    specversion: '1.0', id: 'line-a-to-b', source: '/communication', type: 'communication.transcription_session.line_finished',
    subject: a.id, partitionkey: a.id,
    data: { transcriptId: b.transcriptId, key: 'a.l1', text: 'Written by session A', speaker: 'staff', startedAt: '2026-10-12T10:00:05Z', endedAt: '2026-10-12T10:00:06Z' },
  })).status, 201);

  await eventually(async () => (await send('GET', `/communication/transcripts/${a.transcriptId}/entries`)).body.items
    .some((entry) => entry.text === 'Written by session A'), 'the line did not reach session A\'s transcript');
  const { body: bEntries } = await send('GET', `/communication/transcripts/${b.transcriptId}/entries`);
  assert.ok(!bEntries.items.some((entry) => entry.text === 'Written by session A'), 'session B\'s transcript got session A\'s line');
});
