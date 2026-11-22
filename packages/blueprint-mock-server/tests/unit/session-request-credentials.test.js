/**
 * A session's request-credentials answers with what its session adapter issued,
 * fitted to StreamConnection — run against the harness's contracts, with an
 * HTTP stub standing in for the adapter.
 *
 * The action's response maps every field a StreamConnection can have; what
 * the adapter didn't send, or sent as a null StreamConnection doesn't take,
 * is left out rather than answered as null.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/contracts.json', import.meta.url), 'utf8'));

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
  // Stubs outlive a server: clear the last test's.
  await mock.fetch(new Request('http://localhost/mock/stubs/http', { method: 'DELETE' }));
});

const send = async (method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const created = async () => {
  const { body: profile } = await send('POST', '/communication/profiles', { name: 'english', provider: 'aws-transcribe', languages: ['en-US'] });
  const { body: session } = await send('POST', '/communication/transcription-sessions', {
    profileId: profile.id, model: 'standard', client: 'interview-assistant/0.1.0', startedAt: '2026-10-12T10:00:00Z',
  });
  return session;
};
const adapterAnswers = (body) => send('POST', '/mock/stubs/http', { match: { method: 'POST', url: '/credentials' }, response: { status: 200, body } });
const requestCredentials = (session) => send('POST', `/communication/transcription-sessions/${session.id}/request-credentials`, {
  audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 }, protocols: ['websocket'],
});

const PRESIGNED = { provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://transcribe.example/stream?X-Amz-Expires=300', expiresIn: 300 };

test('request-credentials leaves out what the adapter didn\'t send, and its metadata', async () => {
  const session = await created();
  await adapterAnswers({ ...PRESIGNED, metadata: { transcriptionSessionId: session.id } });
  const { status, body } = await requestCredentials(session);
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body, PRESIGNED);
});

test('request-credentials leaves out a null the adapter sent where StreamConnection takes none', async () => {
  const session = await created();
  await adapterAnswers({ ...PRESIGNED, subprotocol: null, accessToken: null });
  const { body } = await requestCredentials(session);
  assert.deepStrictEqual(body, PRESIGNED);
});

test('request-credentials passes on a token the adapter issued', async () => {
  const session = await created();
  const token = { provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://relay.example', subprotocol: 'blueprint.audio.v1', accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 60 };
  await adapterAnswers(token);
  const { body } = await requestCredentials(session);
  assert.deepStrictEqual(body, token);
});
