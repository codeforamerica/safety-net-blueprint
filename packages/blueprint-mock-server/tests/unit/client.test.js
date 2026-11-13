/**
 * A mock client and a mock server in one process, as a page runs them: the
 * client keeps the session API and sends everything else to the server
 * (client.js). The client starts with no records; the server has its seeded
 * ones.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockClient } from '../../src/client.js';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));

let server;
let client;
let reached;
before(async () => {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try {
    server = await createMockServer({ contracts });
    reached = [];
    client = await createMockClient({
      contracts,
      routing: [{
        domain: '*',
        handler: (request) => {
          reached.push({ path: new URL(request.url).pathname, method: request.method, authorization: request.headers.get('authorization') });
          return server.fetch(request);
        },
        except: [{ api: 'communication-transcription-sessions' }],
      }],
    });
  } finally { console.log = log; console.warn = warn; }
});
after(() => client.stopFollowing());

const list = async (mock, path) => (await (await mock.fetch(new Request(`http://localhost${path}`))).json()).items;

test('what the client keeps is answered in the client, and is only there', async () => {
  const created = await client.fetch(new Request('http://localhost/communication/transcription-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' },
    body: JSON.stringify({ profileId: '00000000-0000-4000-8000-000000000001', model: 'standard', client: 'test/1', startedAt: '2026-10-12T10:00:00Z' }),
  }));
  assert.strictEqual(created.status, 201);
  const { id } = await created.json();
  const path = `/communication/transcription-sessions/${id}`;

  assert.strictEqual((await client.fetch(new Request(`http://localhost${path}`))).status, 200);
  assert.strictEqual((await server.fetch(new Request(`http://localhost${path}`))).status, 404);
  assert.ok(!reached.some((r) => r.path.startsWith('/communication/transcription-sessions')), JSON.stringify(reached));
});

test('everything else is the server\'s, seeded records and all', async () => {
  const fromClient = await list(client, '/intake/applications');
  assert.ok(fromClient.length > 0, 'the server has seeded applications');
  assert.deepStrictEqual(fromClient, await list(server, '/intake/applications'));
  assert.ok(reached.some((r) => r.path === '/intake/applications'));
});

test('an action\'s call made as the caller carries the caller\'s Authorization to the server', async () => {
  const caller = { 'content-type': 'application/json', 'x-caller-id': 'worker-1', authorization: 'Bearer worker-token' };
  const created = await client.fetch(new Request('http://localhost/communication/transcription-sessions', {
    method: 'POST', headers: caller,
    body: JSON.stringify({ profileId: '00000000-0000-4000-8000-000000000001', model: 'standard', client: 'test/1', startedAt: '2026-10-12T10:00:00Z' }),
  }));
  const { id } = await created.json();
  reached.length = 0;
  await client.fetch(new Request(`http://localhost/communication/transcription-sessions/${id}/get-connection`, {
    method: 'POST', headers: caller,
    body: JSON.stringify({ audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 }, protocols: ['websocket'] }),
  }));
  // get-connection starts the transcript first, with runAs: caller.
  const start = reached.find((r) => r.method === 'POST' && r.path === '/communication/transcripts');
  assert.ok(start, JSON.stringify(reached));
  assert.strictEqual(start.authorization, 'Bearer worker-token');
});
