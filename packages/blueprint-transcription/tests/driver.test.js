/**
 * The driver and the fake adapter, run against the harness's contracts in
 * the in-page mock, with a routing handler standing in for the transcripts
 * adapter, as a demo with no backend answers it.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';
import { createTranscriptionClient } from '../src/client/index.js';
import { createFakeAdapter } from '../src/fakes/index.js';
import { sdkFor } from './sdk.js';

const contracts = JSON.parse(readFileSync(new URL('../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));

const AUDIO = { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 };
const immediately = () => Promise.resolve();

let mock;
let issued;
let issuing;
beforeEach(async () => {
  issued = 0;
  issuing = () => ({ provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://transcribe.example/stream', expiresIn: 300 });
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try {
    mock = await createMockServer({
      contracts,
      routing: [{
        operation: 'issueTranscriptConnection',
        handler: async (request) => {
          const { metadata } = await request.json();
          issued += 1;
          return Response.json({ metadata, ...issuing() });
        },
      }],
    });
  } finally { console.log = log; console.warn = warn; }
});

const send = async (method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'someone-else' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return response.json();
};

const startSession = async ({ fetch = (request) => mock.fetch(request), ...options } = {}) => {
  const profile = await send('POST', '/communication/profiles', { name: 'english', provider: 'aws-transcribe', languages: ['en-US'] });
  const client = createTranscriptionClient({
    ...sdkFor(fetch),
    audio: AUDIO,
    sleep: immediately,
    retryDelay: () => 0,
    onError: (error) => { throw error; },
    ...options,
  });
  return client.start({ profileId: profile.id, model: 'standard', client: 'interview-assistant/0.1.0', startedAt: '2026-10-12T10:00:00Z' });
};

const entriesOf = async (session) => (await send('GET', `/communication/transcripts/${session.record.transcriptId}/entries`)).items;

const until = async (check) => {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out');
};

const LINES = {
  events: [
    { at: 1, type: 'update', key: 'l1', text: 'Who lives', speakerLabel: 'spk_0', start: 0.5 },
    { at: 2, type: 'add', key: 'l1', text: 'Who lives with you?', speakerLabel: 'spk_0', start: 0.5, end: 1.8 },
    { at: 3, type: 'add', key: 'l2', text: 'My two kids.', speakerLabel: 'spk_1', start: 2.1, end: 2.9 },
  ],
};

test('a session streams a recording, adds its finished lines, and closes the transcript', async () => {
  const session = await startSession({ adapters: { default: createFakeAdapter(LINES, { sleep: immediately }) } });
  await session.connect(null);
  assert.strictEqual(session.status, 'connected');
  await session.stop();

  assert.strictEqual(session.status, 'closed');
  const lines = (await entriesOf(session)).filter((e) => e.kind === 'line');
  assert.deepStrictEqual(lines.map((e) => e.text), ['Who lives with you?', 'My two kids.']);
  const transcript = await send('GET', `/communication/transcripts/${session.record.transcriptId}`);
  assert.strictEqual(transcript.status, 'closed');
});

test('a line\'s times are from when its connection opened, by the client\'s clock', async () => {
  const opened = new Date('2026-10-12T10:00:00Z');
  const session = await startSession({ now: () => opened, adapters: { default: createFakeAdapter(LINES, { sleep: immediately }) } });
  await session.connect(null);
  await session.stop();
  const [first] = (await entriesOf(session)).filter((e) => e.kind === 'line');
  assert.strictEqual(first.startedAt, '2026-10-12T10:00:00.500Z');
  assert.strictEqual(first.endedAt, '2026-10-12T10:00:01.800Z');
});

test('the adapter is chosen by the service the server answered with', async () => {
  const used = [];
  const named = (name) => ({ open: async (args) => { used.push(name); return createFakeAdapter(LINES, { sleep: immediately }).open(args); } });
  const session = await startSession({ adapters: { 'aws-transcribe': named('transcribe'), default: named('default') } });
  await session.connect(null);
  await session.stop();
  assert.deepStrictEqual(used, ['transcribe']);
});

test('a speaker is told by its label, when the adapter gives no speaker', async () => {
  const session = await startSession({
    adapters: { default: createFakeAdapter(LINES, { sleep: immediately }) },
    speakerFor: (label) => (label === 'spk_0' ? 'staff' : 'client'),
  });
  await session.connect(null);
  await session.stop();
  const lines = (await entriesOf(session)).filter((e) => e.kind === 'line');
  assert.deepStrictEqual(lines.map((e) => e.speaker), ['staff', 'client']);
});

test('a dropped connection reconnects, and the transcript records the gap', async () => {
  const recording = {
    events: [
      { at: 1, type: 'add', key: 'l1', text: 'Before the drop.', start: 0, end: 1 },
      { at: 2, type: 'drop' },
      { at: 3, type: 'add', key: 'l2', text: 'After it.', start: 3, end: 3.5 },
    ],
  };
  const session = await startSession({ adapters: { default: createFakeAdapter(recording, { sleep: immediately }) } });
  await session.connect(null);
  await until(async () => (await entriesOf(session)).some((e) => e.text === 'After it.'));
  await session.stop();

  const entries = await entriesOf(session);
  assert.deepStrictEqual(entries.map((e) => e.kind), ['line', 'gap', 'line']);
  assert.strictEqual(entries[1].cause, 'connection');
  assert.strictEqual(issued, 2);
});

test('pause closes the connection, and resume carries on with the recording on a new one', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const recording = {
    events: [
      { at: 1, type: 'add', key: 'l1', text: 'On the record.', start: 0, end: 1 },
      { at: 5, type: 'add', key: 'l2', text: 'Back on it.', start: 5, end: 6 },
    ],
  };
  // The first wait passes at once; the one before the second line waits for the gate.
  let waits = 0;
  const sleep = () => (waits++ === 0 ? Promise.resolve() : gate);
  const session = await startSession({ adapters: { default: createFakeAdapter(recording, { sleep }) } });
  await session.connect(null);
  await until(async () => (await entriesOf(session)).length === 1);

  await session.pause();
  assert.strictEqual(session.status, 'paused');
  release();
  await session.resume();
  assert.strictEqual(session.status, 'connected');
  await until(async () => (await entriesOf(session)).some((e) => e.text === 'Back on it.'));
  await session.stop();

  const lines = (await entriesOf(session)).filter((e) => e.kind === 'line');
  assert.deepStrictEqual(lines.map((e) => e.text), ['On the record.', 'Back on it.']);
  assert.strictEqual(issued, 2);
});

test('a connection that won\'t open is tried again, then the session fails', async () => {
  const refusing = { open: async () => { throw new Error('unreachable'); } };
  const session = await startSession({ adapters: { default: refusing }, retries: 2 });
  await assert.rejects(session.connect(null), /unreachable/);
  assert.strictEqual(session.status, 'failed');
  assert.strictEqual(issued, 3);
});

/** An adapter that keeps its connection open until finished, and counts the finishes. */
function heldOpen() {
  const state = { open: 0, finished: 0, report: null };
  return {
    state,
    adapter: {
      async open({ report }) {
        state.open += 1;
        state.report = report;
        return { finish: async () => { state.finished += 1; } };
      },
    },
  };
}

const transcriptOf = (session) => `/communication/transcripts/${session.record.transcriptId}`;

test('the transcript paused by someone else stops the audio', async () => {
  const { state, adapter } = heldOpen();
  const session = await startSession({ adapters: { default: adapter } });
  await session.connect(null);
  await send('POST', `${transcriptOf(session)}/pause`, { at: '2026-10-12T10:01:00Z' });
  await until(() => state.finished === 1);
  await until(() => session.status === 'paused');
});

test('the transcript closed by someone else stops the audio', async () => {
  const { state, adapter } = heldOpen();
  const session = await startSession({ adapters: { default: adapter } });
  await session.connect(null);
  await send('POST', `${transcriptOf(session)}/close`, { at: '2026-10-12T10:01:00Z' });
  await until(() => state.finished === 1);
  await until(() => session.status === 'closed');
});

test('the software\'s own pause and resume close and reopen the connection once each', async () => {
  const { state, adapter } = heldOpen();
  const session = await startSession({ adapters: { default: adapter } });
  await session.connect(null);
  await session.pause();
  assert.strictEqual(session.status, 'paused');
  await session.resume();
  assert.strictEqual(session.status, 'connected');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepStrictEqual([state.open, state.finished], [2, 1]);
  await session.stop();
});

test('a line the session refuses because it stopped stops the audio, though no event came', async () => {
  const { state, adapter } = heldOpen();
  // Events never arrive: no stream, and an empty log.
  const session = await startSession({
    adapters: { default: adapter },
    onError: () => {},
    fetch: (request) => (new URL(request.url).pathname.startsWith('/platform/events')
      ? Promise.resolve(new Response(null, { status: 501 }))
      : mock.fetch(request)),
  });
  await session.connect(null);
  // Paused behind the software's back, as a lost event would leave it.
  await send('POST', `/communication/transcription-sessions/${session.id}/pause`, { at: '2026-10-12T10:01:00Z' });
  state.report.add({ key: 'late', text: 'Said after the pause.', start: 70, end: 71 });
  await until(() => state.finished === 1);
});
