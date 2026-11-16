/**
 * Changes to one record take turns (record-turns.js): a reaction that arrives
 * while an action on its record waits on a call runs after the action, and
 * reads the record as the action left it. Shown with the transcription
 * session in a mock client and its transcript on a mock server: the
 * session's close calls the server's closeTranscript, and the server's
 * transcript closed event reaches the client before that call has answered.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockClient } from '../../src/client.js';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));

let server;
let client;
// The server's answer to closeTranscript, held until the test lets it go.
let holdClose = null;
before(async () => {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try {
    server = await createMockServer({
      contracts,
      routing: [{
        operation: 'issueTranscriptConnection',
        handler: async (request) => Response.json({ metadata: (await request.json()).metadata, provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://transcribe.example', expiresIn: 300 }),
      }],
    });
    client = await createMockClient({
      contracts,
      routing: [{
        domain: '*',
        handler: async (request) => {
          const answer = await server.fetch(request);
          if (holdClose && request.method === 'POST' && /\/transcripts\/[^/]+\/close$/.test(new URL(request.url).pathname)) await holdClose;
          return answer;
        },
        except: [{ api: 'communication-transcription-sessions' }, { api: 'platform-events' }],
      }],
    });
  } finally { console.log = log; console.warn = warn; }
});
after(() => client.stopFollowing());

const CALLER = { 'content-type': 'application/json', 'x-caller-id': 'worker-1' };
const send = async (mock, method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, { method, headers: CALLER, body: body && JSON.stringify(body) }));
  return { status: response.status, body: await response.json().catch(() => null) };
};
const at = '2026-10-12T10:00:00Z';

test('a reaction arriving during an action on its record waits for it, and finds the record as the action left it', async () => {
  const profile = (await send(server, 'POST', '/communication/profiles', { name: 'english', provider: 'aws-transcribe', languages: ['en-US'] })).body;
  const session = (await send(client, 'POST', '/communication/transcription-sessions', { profileId: profile.id, model: 'standard', client: 'test/1', startedAt: at })).body;
  const path = `/communication/transcription-sessions/${session.id}`;
  assert.strictEqual((await send(client, 'POST', `${path}/get-connection`, { audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 }, protocols: ['websocket'] })).status, 200);
  assert.strictEqual((await send(client, 'POST', `${path}/connect`, {})).status, 200);
  assert.strictEqual((await send(client, 'POST', `${path}/stop`, { at })).status, 200);

  let letClose;
  holdClose = new Promise((resolve) => { letClose = resolve; });
  const closing = send(client, 'POST', `${path}/close`, { at });
  // The transcript is closed on the server, and its closed event reaches the
  // client, while close waits for its answer.
  const { transcriptId } = (await send(client, 'GET', path)).body;
  for (let i = 0; i < 100 && (await send(server, 'GET', `/communication/transcripts/${transcriptId}`)).body.status !== 'closed'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual((await send(client, 'GET', path)).body.status, 'stopping', 'the reaction waits for close');
  letClose();
  holdClose = null;

  assert.strictEqual((await closing).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual((await send(client, 'GET', path)).body.status, 'closed');
  const events = (await send(client, 'GET', '/platform/events?limit=100')).body.items
    .filter((event) => event.subject === session.id && event.type.endsWith('.transcription_session.closed'));
  assert.strictEqual(events.length, 1, 'closed is sent once');
});
