/**
 * An action answering with something other than its record, by `response:`,
 * answers with what its steps bound, fitted to the response's schema: what a
 * call didn't send, or sent as a null the schema doesn't take, is left out
 * rather than answered as null. Run against the harness's contracts, with a
 * trial action on the transcription session that asks its adapter's server
 * part for credentials, and an HTTP stub standing in for that.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, load, generate } from '@codeforamerica/blueprint-core';
import { createMockServer } from '../../src/server.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harness = resolve(packageRoot, '../blueprint-harness/generated/resolved');

// Where and how to connect, and nothing else: the adapter's metadata is left out.
const CONNECTION = {
  type: 'object',
  unevaluatedProperties: false,
  required: ['provider', 'protocol', 'url'],
  properties: {
    provider: { type: 'string' },
    protocol: { type: 'string' },
    url: { type: 'string' },
    accessToken: { type: 'string' },
    tokenType: { type: 'string' },
    expiresIn: { type: 'integer' },
  },
};

const ask = {
  id: 'ask-for-credentials',
  steps: [{
    call: {
      operationId: 'requestCredentials',
      requestBody: { payload: { provider: 'aws-transcribe', audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 }, protocols: ['websocket'], metadata: { transcriptionSessionId: '$object.id' } } },
    },
    bind: '$credentials',
  }],
  response: {
    schema: CONNECTION,
    payload: Object.fromEntries(Object.keys(CONNECTION.properties).map((field) => [field, `$credentials.${field}`])),
  },
};

/**
 * The harness, with the trial action added to the transcription session's
 * machine, and its endpoint to the sessions API, declaring the response
 * schema as resolve would.
 */
function contracts() {
  const docs = discover(harness).map(load).map((doc) => {
    if (doc.type === 'openapi' && doc.api === 'communication-transcription-sessions') {
      const endpoint = {
        post: {
          operationId: 'askForCredentialsTranscriptionSession',
          parameters: [{ name: 'transcriptionSessionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Where and how to connect.', content: { 'application/json': { schema: CONNECTION } } } },
        },
      };
      return { ...doc, content: { ...doc.content, paths: { ...doc.content.paths, '/transcription-sessions/{transcriptionSessionId}/ask-for-credentials': endpoint } } };
    }
    const machine = doc.type === 'state-machine' && doc.content?.machines?.find((m) => m.object === 'TranscriptionSession');
    if (!machine) return doc;
    return { ...doc, content: { ...doc.content, machines: doc.content.machines.map((m) => (m === machine ? { ...m, actions: [...m.actions, ask] } : m)) } };
  });
  return generate(docs, 'artifact');
}

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts: contracts(), seed: true }); } finally { console.log = log; console.warn = warn; }
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
const askFor = (session) => send('POST', `/communication/transcription-sessions/${session.id}/ask-for-credentials`, {});

const PRESIGNED = { provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://transcribe.example/stream?X-Amz-Expires=300', expiresIn: 300 };

test('a response leaves out what the call didn\'t send, and what its schema doesn\'t take', async () => {
  const session = await created();
  await adapterAnswers({ ...PRESIGNED, metadata: { transcriptionSessionId: session.id } });
  const { status, body } = await askFor(session);
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.deepStrictEqual(body, PRESIGNED);
});

test('a response leaves out a null the call sent where its schema takes none', async () => {
  const session = await created();
  await adapterAnswers({ ...PRESIGNED, metadata: {}, accessToken: null });
  const { body } = await askFor(session);
  assert.deepStrictEqual(body, PRESIGNED);
});

test('a response passes on every field the call sent that its schema takes', async () => {
  const session = await created();
  const token = { provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://service.example', accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 60 };
  await adapterAnswers({ ...token, metadata: {} });
  const { body } = await askFor(session);
  assert.deepStrictEqual(body, token);
});
