/**
 * A transcript's get-connection answers with what its transcripts adapter issued,
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
import { createMockServer } from '../../src/browser.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));

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

const recording = async () => {
  const { body: profile } = await send('POST', '/communication/profiles', { name: 'english', provider: 'aws-transcribe', languages: ['en-US'] });
  const { body: transcript } = await send('POST', '/communication/transcripts', {
    profileId: profile.id, model: 'standard', client: 'interview-assistant/0.1.0', startedAt: '2026-10-12T10:00:00Z',
  });
  return transcript;
};
const adapterAnswers = (body) => send('POST', '/mock/stubs/http', { match: { method: 'POST', url: '/issue-connection' }, response: { status: 200, body } });
const getConnection = (transcript) => send('POST', `/communication/transcripts/${transcript.id}/get-connection`, {
  audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 }, protocols: ['websocket'],
});

const PRESIGNED = { provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://transcribe.example/stream?X-Amz-Expires=300', expiresIn: 300 };

test('get-connection leaves out what the adapter didn\'t send, and its metadata', async () => {
  const transcript = await recording();
  await adapterAnswers({ ...PRESIGNED, metadata: { transcriptId: transcript.id } });
  const { status, body } = await getConnection(transcript);
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body, PRESIGNED);
});

test('get-connection leaves out a null the adapter sent where StreamConnection takes none', async () => {
  const transcript = await recording();
  await adapterAnswers({ ...PRESIGNED, subprotocol: null, accessToken: null });
  const { body } = await getConnection(transcript);
  assert.deepStrictEqual(body, PRESIGNED);
});

test('get-connection passes on a token the adapter issued', async () => {
  const transcript = await recording();
  const token = { provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://relay.example', subprotocol: 'blueprint.audio.v1', accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 60 };
  await adapterAnswers(token);
  const { body } = await getConnection(transcript);
  assert.deepStrictEqual(body, token);
});
