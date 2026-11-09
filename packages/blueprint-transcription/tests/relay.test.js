/**
 * The relay client adapter and the fake relay, talking through an in-memory
 * socket pair, with every JSON message either side sends checked against the
 * relay contract's schema for it (communication-transcripts-relay-asyncapi.yaml,
 * as the harness resolves it).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';
import { createMockServer } from '@codeforamerica/blueprint-mock-server/browser';
import { createRelayAdapter, createTranscriptionClient, RELAY_PROTOCOL } from '../src/client/index.js';
import { createFakeRelay, createInPageSocket } from '../src/fakes/index.js';

// The relay contract and the files it refers to, each under the address its
// refs name it by, as the harness resolves them.
const RESOLVED = fileURLToPath(new URL('../../blueprint-harness/generated/resolved/', import.meta.url));
const BASE = 'https://blueprint.codeforamerica.org/';
const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);
for (const path of [
  'base/domains/communication/communication-transcripts-relay-asyncapi.yaml',
  'base/domains/communication/communication-transcripts-schema.yaml',
  'base/schemas/enums.yaml',
]) {
  const { $schema, ...document } = yaml.load(readFileSync(join(RESOLVED, path), 'utf8'));
  ajv.addSchema({ ...document, $id: BASE + path });
}
const RELAY = `${BASE}base/domains/communication/communication-transcripts-relay-asyncapi.yaml`;
const check = (message) => {
  const validate = ajv.getSchema(`${RELAY}#/components/messages/${message.type}/payload`);
  assert.ok(validate, `the relay contract has no message ${message.type}`);
  assert.ok(validate(message), `${message.type} breaks the relay contract: ${ajv.errorsText(validate.errors)}`);
};

/**
 * The package's in-page socket to the relay, with every message logged by who
 * sent it, and JSON ones checked against the contract as they're sent.
 */
function socketsTo(relay) {
  const log = [];
  const Base = createInPageSocket(relay, {
    tap: (from, data) => {
      if (typeof data === 'string') check(JSON.parse(data));
      log.push({ from, data });
    },
  });
  class WebSocket extends Base {
    constructor(...args) { super(...args); WebSocket.last = this; }
  }
  return { WebSocket, log };
}

const immediately = () => Promise.resolve();
const FORMAT = { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 };
const CONNECTION = { provider: 'google-cloud-speech', protocol: 'websocket', url: 'wss://relay.example', subprotocol: RELAY_PROTOCOL, accessToken: 'token', tokenType: 'Bearer', expiresIn: 60 };
const LINES = {
  events: [
    { at: 1, type: 'update', key: 'l1', text: 'Who lives', speakerLabel: 'spk_0', start: 0.5 },
    { at: 2, type: 'add', key: 'l1', text: 'Who lives with you?', speakerLabel: 'spk_0', start: 0.5, end: 1.8, confidence: 0.96, language: 'en-US' },
    { at: 3, type: 'add', key: 'l2', text: 'My two kids.', speakerLabel: 'spk_1', start: 2.1, end: 2.9 },
  ],
};
const recorder = () => {
  const told = { update: [], add: [], dropped: 0 };
  return { told, report: { update: (l) => told.update.push(l), add: (l) => told.add.push(l), dropped: () => { told.dropped += 1; } } };
};
async function* chunks(...parts) { for (const part of parts) yield new Uint8Array(part); }
const json = (log, from) => log.filter((m) => m.from === from && typeof m.data === 'string').map((m) => JSON.parse(m.data));

test('the relay\'s subprotocol is asked for, with the token beside it', async () => {
  const { WebSocket } = socketsTo(createFakeRelay(LINES, { sleep: immediately }));
  const { report } = recorder();
  const handle = await createRelayAdapter({ WebSocket }).open({ connection: CONNECTION, format: FORMAT, audio: chunks(), report });
  assert.deepStrictEqual(WebSocket.last.offered, [RELAY_PROTOCOL, 'token']);
  assert.strictEqual(WebSocket.last.url, 'wss://relay.example');
  await handle.finish();
});

test('a relay refuses a connection without its subprotocol, or with a token it won\'t take', () => {
  const relay = createFakeRelay(LINES, { verifyToken: (token) => token === 'good' });
  assert.strictEqual(relay.protocolFor([RELAY_PROTOCOL, 'good']), RELAY_PROTOCOL);
  assert.strictEqual(relay.protocolFor([RELAY_PROTOCOL, 'bad']), null);
  assert.strictEqual(relay.protocolFor([RELAY_PROTOCOL]), null);
  assert.strictEqual(relay.protocolFor(['something-else', 'good']), null);
});

test('start, audio and end go one way; started, results and ended come back, all as the contract says', async () => {
  const { WebSocket, log } = socketsTo(createFakeRelay(LINES, { sleep: immediately }));
  const { told, report } = recorder();
  const connection = { ...CONNECTION, connectionParameters: { languages: ['en-US'], model: 'latest_long' } };
  const handle = await createRelayAdapter({ WebSocket }).open({ connection, format: FORMAT, audio: chunks([1, 2], [3]), report });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handle.finish();

  const sent = json(log, 'client');
  assert.deepStrictEqual(sent[0], { type: 'start', audio: FORMAT, languages: ['en-US'], model: 'latest_long', interimResults: true });
  assert.deepStrictEqual(sent.at(-1), { type: 'end' });
  assert.deepStrictEqual(log.filter((m) => m.from === 'client' && typeof m.data !== 'string').map((m) => [...m.data]), [[1, 2], [3]]);

  const received = json(log, 'relay').map((m) => m.type);
  assert.deepStrictEqual(received, ['started', 'result', 'result', 'result', 'ended']);
  assert.deepStrictEqual(told.update, [{ key: 'l1', text: 'Who lives', start: 0.5, speakerLabel: 'spk_0' }]);
  assert.deepStrictEqual(told.add[0], { key: 'l1', text: 'Who lives with you?', start: 0.5, end: 1.8, speakerLabel: 'spk_0', confidence: 0.96, language: 'en-US' });
  assert.strictEqual(told.dropped, 0);
});

test('a message the relay can\'t read is answered with a bad-message error, and the connection closes', async () => {
  const { WebSocket, log } = socketsTo(createFakeRelay(LINES, { sleep: immediately }));
  const socket = new WebSocket('wss://relay.example', [RELAY_PROTOCOL, 'token']);
  const closed = new Promise((resolve) => socket.addEventListener('close', resolve));
  socket.addEventListener('open', () => socket.send(new Uint8Array([9])));
  await closed;
  const [error] = json(log, 'relay');
  assert.strictEqual(error.type, 'error');
  assert.strictEqual(error.code, 'bad-message');
});

test('a quiet connection is kept open with keepalive', async () => {
  const { WebSocket, log } = socketsTo(createFakeRelay({ events: [] }, { sleep: immediately }));
  const { report } = recorder();
  const handle = await createRelayAdapter({ WebSocket, keepaliveMs: 10 }).open({ connection: CONNECTION, format: FORMAT, audio: chunks(), report });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await handle.finish();
  assert.ok(json(log, 'client').some((m) => m.type === 'keepalive'));
});

test('end to end: a session streams through a relay, and a drop is reconnected with a gap', async () => {
  const contracts = JSON.parse(readFileSync(new URL('../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
  const recording = {
    events: [
      { at: 1, type: 'add', key: 'l1', text: 'Before the drop.', speakerLabel: 'spk_0', start: 0, end: 1 },
      { at: 2, type: 'drop' },
      { at: 3, type: 'add', key: 'l2', text: 'After it.', speakerLabel: 'spk_1', start: 3, end: 3.5 },
    ],
  };
  const { WebSocket } = socketsTo(createFakeRelay(recording, { sleep: immediately }));
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  let mock;
  try {
    mock = await createMockServer({
      contracts,
      routing: [{
        operation: 'issueTranscriptConnection',
        // The state's adapter answers for a service behind its relay with the relay's URL and a token.
        handler: async (request) => Response.json({ metadata: (await request.json()).metadata, ...CONNECTION }),
      }],
    });
  } finally { console.log = log; console.warn = warn; }

  const send = async (method, path, body) => (await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' }, body: body && JSON.stringify(body),
  }))).json();
  const profile = await send('POST', '/communication/profiles', { name: 'english', provider: 'google-cloud-speech', languages: ['en-US'] });
  const client = createTranscriptionClient({
    fetch: (request) => mock.fetch(request),
    headers: { 'x-caller-id': 'worker-1' },
    audio: FORMAT,
    adapters: { [RELAY_PROTOCOL]: createRelayAdapter({ WebSocket }) },
    speakerFor: (label) => (label === 'spk_0' ? 'staff' : 'client'),
    retryDelay: () => 0,
    sleep: immediately,
    onError: (error) => { throw error; },
  });
  const session = await client.start({ profileId: profile.id, model: 'latest_long', client: 'interview-assistant/0.1.0', startedAt: '2026-10-12T10:00:00Z' });
  await session.connect(chunks());
  for (let i = 0; i < 200; i++) {
    const { items } = await send('GET', `/communication/transcripts/${session.record.transcriptId}/entries`);
    if (items.some((e) => e.text === 'After it.')) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await session.stop();

  const { items } = await send('GET', `/communication/transcripts/${session.record.transcriptId}/entries`);
  assert.deepStrictEqual(items.map((e) => [e.kind, e.text ?? null, e.speaker ?? null]), [
    ['line', 'Before the drop.', 'staff'], ['gap', null, null], ['line', 'After it.', 'client'],
  ]);
  assert.strictEqual(session.status, 'closed');
});
