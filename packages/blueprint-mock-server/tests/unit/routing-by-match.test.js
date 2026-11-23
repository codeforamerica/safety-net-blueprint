/**
 * Several implementations of one adapter, routed by match: the request's
 * provider chooses the route; a later request about the same resource, which
 * names no provider, goes to the same one. A routed
 * handler gets `publish` and `call`. Run against the harness's contracts,
 * with two implementations of the transcription session adapter as modules.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/contracts.json', import.meta.url), 'utf8'));
const ADAPTER = 'communication-transcription-sessions-adapter';
const heard = [];

/** An implementation that says which it is, and reports connected for the session. */
const implementation = (service) => ({
  async startStream(request, { publish }) {
    const stream = await request.json();
    heard.push(`${service} start`);
    await publish('transcription_session.connected', { transcriptId: stream.transcriptId }, { subject: stream.transcriptionSessionId });
    return Response.json({ metadata: stream.metadata ?? {} }, { status: 202 });
  },
  async pauseStream() { heard.push(`${service} pause`); return Response.json({ metadata: {} }, { status: 202 }); },
  async stopStream(request, { params, call }) {
    heard.push(`${service} stop`);
    // The handler can read the session it's stopping, through routing.
    const { body } = await call('getTranscriptionSession', { params: { transcriptionSessionId: params.transcriptionSessionId } });
    heard.push(`${service} saw ${body.status}`);
    return Response.json({ metadata: {} }, { status: 202 });
  },
  async requestCredentials() { return Response.json({ metadata: {}, provider: service, protocol: 'websocket', url: 'wss://x.invalid', expiresIn: 60 }); },
});

let mock;
before(async () => {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try {
    mock = await createMockServer({
      contracts,
      routing: [
        { api: ADAPTER, match: { provider: 'whisper' }, handler: implementation('whisper') },
        { api: ADAPTER, match: { provider: 'aws-transcribe' }, handler: implementation('aws-transcribe') },
      ],
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
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
};

test('the profile\'s provider chooses the implementation, and stopping goes to the same one', async () => {
  const { body: profile } = await send('POST', '/communication/profiles', { name: 'english-transcribe', provider: 'aws-transcribe', languages: ['en-US'] });
  const { body: session } = await send('POST', '/communication/transcription-sessions', {
    profileId: profile.id, model: 'standard', client: 'test/1.0.0', startedAt: '2026-10-12T10:00:00Z',
  });
  const path = `/communication/transcription-sessions/${session.id}`;
  const started = await send('POST', `${path}/start`, {});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  // What the implementation published moved the session.
  await eventually(async () => (await send('GET', path)).body.status === 'connected', 'the session never followed connected');
  assert.equal((await send('POST', `${path}/stop`, { at: '2026-10-12T10:05:00Z' })).status, 200);
  assert.deepEqual(heard, ['aws-transcribe start', 'aws-transcribe stop', 'aws-transcribe saw connected']);
});

test('a module that implements none of what it is routed for stops the mock from starting', async () => {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try {
    await assert.rejects(createMockServer({ contracts, routing: [{ api: ADAPTER, match: { provider: 'whisper' }, handler: { startStreem() {} } }] }),
      /module exports a handler for none of the operations it's routed for/);
  } finally { console.log = log; console.warn = warn; }
});
