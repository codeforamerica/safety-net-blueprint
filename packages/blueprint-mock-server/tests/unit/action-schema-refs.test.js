/**
 * Schemas whose refs lead into other files are checked, not skipped: an
 * action's request schema, declared in a state machine, and what a routed
 * handler answers. Run against the harness's transcription session, whose
 * get-connection request is a ref to a ref into the transcripts schema file,
 * and whose add-line request refers to the transcripts API's Speaker.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));

const AUDIO = { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 };
let answer;
let mock;
let warnings;
const { log, warn } = console;
// Warnings are collected through each test, since one a request causes is
// what says a schema was skipped.
beforeEach(async () => {
  answer = () => ({ provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://transcribe.example/stream', expiresIn: 300 });
  warnings = [];
  console.log = () => {};
  console.warn = (...args) => warnings.push(args.join(' '));
  mock = await createMockServer({
    contracts,
    routing: [{
      operation: 'issueTranscriptConnection',
      // Echoes metadata, as every adapter does.
      handler: async (request) => Response.json({ metadata: (await request.json()).metadata, ...answer() }),
    }],
  });
});
afterEach(() => { console.log = log; console.warn = warn; });

const send = async (method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const session = async () => {
  const { body: profile } = await send('POST', '/communication/profiles', { name: 'english', provider: 'aws-transcribe', languages: ['en-US'] });
  const { body } = await send('POST', '/communication/transcription-sessions', {
    profileId: profile.id, model: 'standard', client: 'interview-assistant/0.1.0', startedAt: '2026-10-12T10:00:00Z',
  });
  return body;
};
const act = (s, action, body) => send('POST', `/communication/transcription-sessions/${s.id}/${action}`, body);

test('an action\'s request is checked against a schema in another file', async () => {
  const s = await session();
  const refused = await act(s, 'get-connection', { audio: { ...AUDIO, encoding: 'wav' }, protocols: ['websocket'] });
  const accepted = await act(s, 'get-connection', { audio: AUDIO, protocols: ['websocket'] });
  assert.strictEqual(refused.status, 422);
  assert.strictEqual(accepted.status, 200);
  assert.deepStrictEqual(warnings.filter((w) => w.includes('no validator')), []);
});

test('an inline action schema\'s ref into another file is checked', async () => {
  const s = await session();
  await act(s, 'get-connection', { audio: AUDIO, protocols: ['websocket'] });
  await act(s, 'connect', {});
  const line = { key: 'l1', startedAt: '2026-10-12T10:00:01Z', endedAt: '2026-10-12T10:00:02Z', text: 'Hello.' };
  const refused = await act(s, 'add-line', { ...line, speaker: 'narrator' });
  const accepted = await act(s, 'add-line', { ...line, speaker: 'staff' });
  assert.strictEqual(refused.status, 422);
  assert.strictEqual(accepted.status, 200);
  assert.deepStrictEqual(warnings.filter((w) => w.includes('no validator')), []);
});

test('a routed handler\'s answer is checked against a response schema with refs into other files', async () => {
  answer = () => ({ provider: 'aws-transcribe', protocol: 'carrier-pigeon', url: 'wss://transcribe.example/stream', expiresIn: 300 });
  const s = await session();
  const { status } = await act(s, 'get-connection', { audio: AUDIO, protocols: ['websocket'] });
  assert.notStrictEqual(status, 200);
  assert.deepStrictEqual(warnings.filter((w) => w.includes('no validator')), []);
});
