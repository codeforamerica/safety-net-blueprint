/**
 * Schemas whose refs lead into other files are checked, not skipped: an
 * action's request schema, declared in a state machine, and what a routed
 * handler answers. Run against the harness's contracts: a suggestion's accept
 * request is a ref to a $def whose call refers into the base operations
 * schema, and the transcription session adapter's credentials answer refers
 * into the transcripts schema file.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/contracts.json', import.meta.url), 'utf8'));

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
      operation: 'requestCredentials',
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

const CALL = {
  operationId: 'getTranscriptionProfile',
  parameters: [{ name: 'profileId', in: 'path', value: '7a1e0c2d-0000-4000-8000-0000000000f1' }],
};

test('an action\'s request is checked against a schema in another file', async () => {
  const { status: proposed, body: suggestion } = await send('POST', '/decision-support/suggestions', { kind: 'operation', call: CALL });
  assert.strictEqual(proposed, 201, JSON.stringify(suggestion));
  const accept = (body) => send('POST', `/decision-support/suggestions/${suggestion.id}/accept`, body);
  const refused = await accept({ call: { ...CALL, parameters: 'none' } });
  assert.strictEqual(refused.status, 422, JSON.stringify(refused.body));
  const accepted = await accept({ call: CALL });
  assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
  assert.deepStrictEqual(warnings.filter((w) => w.includes('no validator')), []);
});

const credentials = (audio) => send('POST', '/credentials', {
  metadata: { transcriptionSessionId: 'a' }, provider: 'aws-transcribe', languages: ['en-US'], audio, protocols: ['websocket'],
});

test('a routed handler\'s answer is checked against a response schema with refs into other files', async () => {
  answer = () => ({ provider: 'aws-transcribe', protocol: 'carrier-pigeon', url: 'wss://transcribe.example/stream', expiresIn: 300 });
  const { status } = await credentials(AUDIO);
  assert.notStrictEqual(status, 200);
  assert.deepStrictEqual(warnings.filter((w) => w.includes('no validator')), []);
});
