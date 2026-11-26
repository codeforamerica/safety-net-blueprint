/**
 * Changes to one record take turns (record-turns.js): a reaction that arrives
 * while an action on its record waits on a call runs after the action, and
 * reads the record as the action left it. Shown with the transcription
 * session in a mock client and its transcript on a mock server: the
 * session's pause calls the server's pauseTranscript, and the server's
 * transcript paused event reaches the client before that call has answered.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockClient } from '../../src/client.js';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/contracts.json', import.meta.url), 'utf8'));

let server;
let client;
// The server's answer to pauseTranscript, held until the test lets it go.
let holdPause = null;
// The session adapter's streaming part, answering at once as it does.
const adapter = ['startStream', 'pauseStream', 'stopStream']
  .map((operation) => ({ operation, handler: async () => Response.json({ metadata: {} }, { status: 202 }) }));
before(async () => {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try {
    server = await createMockServer({
      contracts,
    });
    client = await createMockClient({
      contracts,
      routing: [{
        domain: '*',
        handler: async (request) => {
          const answer = await server.fetch(request);
          if (holdPause && request.method === 'POST' && /\/transcripts\/[^/]+\/pause$/.test(new URL(request.url).pathname)) await holdPause;
          return answer;
        },
        except: [{ api: 'communication-transcription-sessions' }, { api: 'platform-events' }],
      }, ...adapter],
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
  assert.strictEqual((await send(client, 'POST', `${path}/start`, {})).status, 200);
  const { transcriptId } = (await send(client, 'GET', path)).body;
  // The adapter says it connected.
  await send(client, 'POST', '/platform/events', {
    specversion: '1.0', id: 'connected-1', source: '/communication', type: 'communication.transcription_session.connected',
    subject: session.id, partitionkey: session.id, data: { transcriptId },
  });
  for (let i = 0; i < 100 && (await send(client, 'GET', path)).body.status !== 'connected'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  let letPause;
  holdPause = new Promise((resolve) => { letPause = resolve; });
  const pausing = send(client, 'POST', `${path}/pause`, { at });
  // The transcript is paused on the server, and its paused event reaches the
  // client, while pause waits for its answer.
  for (let i = 0; i < 100 && (await send(server, 'GET', `/communication/transcripts/${transcriptId}`)).body.status !== 'paused'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual((await send(client, 'GET', path)).body.status, 'connected', 'the reaction waits for pause');
  letPause();
  holdPause = null;

  assert.strictEqual((await pausing).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual((await send(client, 'GET', path)).body.status, 'paused');
  const events = (await send(client, 'GET', '/platform/events?limit=100')).body.items
    .filter((event) => event.subject === session.id && event.type.endsWith('.transcription_session.paused'));
  assert.strictEqual(events.length, 1, 'paused is sent once');
});
