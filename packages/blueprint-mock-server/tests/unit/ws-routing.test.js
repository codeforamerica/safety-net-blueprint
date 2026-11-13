/**
 * The mock's WebSockets over the network, and routed: a real client reaching
 * the Node server, and a socket's connections sent to a URL or a handler
 * instead of its stubs, every message still checked against the contract.
 * Against the harness's relay contract,
 * communication-transcripts-relay-asyncapi.yaml, served at its localhost
 * server's pathname.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createMockServer } from '../../src/server.js';
import { createWs } from '../../src/ws.js';
import { createNodeServer } from '../../src/http/node-server.js';
import { extract } from '@codeforamerica/blueprint-core/browser';

const contracts = JSON.parse(readFileSync(fileURLToPath(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url)), 'utf8'));
const docs = extract(contracts, 'docs');
const API = 'communication-transcripts-relay';
const CHANNEL = 'communication-transcripts-relay-asyncapi.yaml#/channels/audio';
const PATH = '/communication/transcripts-relay';
const PROTOCOL = 'blueprint.transcripts.relay.v1';
const START = { type: 'start', audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 } };
const RESULT = { type: 'result', id: 'r1', isFinal: true, startOffsetMs: 0, endOffsetMs: 1200, alternatives: [{ transcript: 'Who lives with you?' }] };

async function quietMock(options = {}) {
  const log = console.log; console.log = () => {};
  try { return await createMockServer({ contracts, seed: false, ...options }); } finally { console.log = log; }
}

const stub = (mock, body) => mock.fetch(new Request('http://localhost/mock/stubs/ws', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

/** A connection, with what it heard and how it closed. */
function connect(Socket, url, protocols = []) {
  const socket = new Socket(url, protocols);
  const heard = [];
  const closed = new Promise((settle) => socket.addEventListener('close', (e) => settle({ code: e.code, reason: e.reason })));
  socket.addEventListener('message', (e) => heard.push(typeof e.data === 'string' ? JSON.parse(e.data) : e.data));
  const opened = new Promise((settle) => socket.addEventListener('open', settle));
  return { socket, heard, closed, opened };
}

/** Wait until `heard` holds `n` messages. */
async function until(heard, n) {
  for (let i = 0; i < 200 && heard.length < n; i++) await new Promise((settle) => setTimeout(settle, 5));
}

/** A server on a free port, closed when the test ends. */
async function listening(t, server) {
  await new Promise((settle) => server.listen(0, '127.0.0.1', settle));
  t.after(() => new Promise((settle) => { server.closeAllConnections?.(); server.close(settle); }));
  return server.address().port;
}

test('the relay is served at its localhost server\'s pathname, and nowhere else', async () => {
  const sockets = createWs(docs);
  assert.deepStrictEqual([...sockets.sockets()].map(([api, s]) => [api, s.paths]), [[API, [PATH]]]);
  assert.strictEqual(sockets.serves('/mock/ws/communication-transcripts-relay-asyncapi.yaml'), false);
});

test('the Node server accepts a real WebSocket at the relay\'s path, answering with the first subprotocol only', async (t) => {
  const sockets = createWs(docs);
  sockets.registerStub({ channel: CHANNEL, on: 'start', send: [{ type: 'started' }] });
  sockets.registerStub({ channel: CHANNEL, on: 'audio', send: [RESULT] });
  const port = await listening(t, createNodeServer(async () => new Response(null, { status: 404 }), { sockets }));

  const client = connect(WebSocket, `ws://127.0.0.1:${port}${PATH}`, [PROTOCOL, 'a-token']);
  await client.opened;
  assert.strictEqual(client.socket.protocol, PROTOCOL, 'the token is never sent back');
  client.socket.send(JSON.stringify(START));
  client.socket.send(new Uint8Array([1, 2, 3]));
  await until(client.heard, 2);
  assert.deepStrictEqual(client.heard, [{ type: 'started' }, RESULT]);
  client.socket.close();
});

test('the Node server closes a real connection with 1007 for a message the contract doesn\'t allow, and refuses any other path', async (t) => {
  const sockets = createWs(docs);
  const port = await listening(t, createNodeServer(async () => new Response(null, { status: 404 }), { sockets }));

  const client = connect(WebSocket, `ws://127.0.0.1:${port}${PATH}`);
  await client.opened;
  client.socket.send(JSON.stringify({ type: 'start' }));
  const { code, reason } = await client.closed;
  assert.strictEqual(code, 1007);
  assert.ok(new TextEncoder().encode(reason).length <= 123, 'a close reason fits in a frame');

  // Node's WebSocket reports a refused upgrade as an error, and no close.
  const elsewhere = new WebSocket(`ws://127.0.0.1:${port}/mock/ws/communication-transcripts-relay-asyncapi.yaml`);
  const ended = await new Promise((settle) => {
    elsewhere.addEventListener('open', () => settle('open'));
    elsewhere.addEventListener('error', () => settle('refused'));
  });
  assert.strictEqual(ended, 'refused');
});

test('a routed socket passes messages to its handler and back, with the subprotocols offered, after the mock\'s own stubs', async () => {
  // The far side: another mock, answering with its stubs.
  const relay = await quietMock();
  await stub(relay, { channel: CHANNEL, on: 'audio', protocols: ['good-token'], send: [RESULT] });
  const mock = await quietMock({ routing: [{ api: API, handler: relay.WebSocket }] });
  assert.ok(mock.routed.includes(`WS ${PATH}`));
  // The mock's own stub answers first, and start never reaches the relay,
  // which has no stub for it and would close the connection with 1011.
  await stub(mock, { channel: CHANNEL, on: 'start', send: [{ type: 'started' }] });

  const client = connect(mock.WebSocket, `ws://localhost${PATH}`, [PROTOCOL, 'good-token']);
  await client.opened;
  client.socket.send(JSON.stringify(START));
  client.socket.send(new Uint8Array([1, 2]));
  await until(client.heard, 2);
  assert.deepStrictEqual(client.heard, [{ type: 'started' }, RESULT], 'the relay\'s stub matched the token the client offered');
});

test('a routed socket closes the client\'s connection with 1007 when its handler sends what the contract doesn\'t allow', async () => {
  class Wrong extends EventTarget {
    constructor() {
      super();
      this.readyState = 0;
      queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
    }
    send() { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ type: 'started', extra: true, alternatives: 'no' }) })); this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ type: 'nonsense' }) })); }
    close() { this.readyState = 3; }
  }
  const mock = await quietMock({ routing: [{ api: API, handler: Wrong }] });
  const client = connect(mock.WebSocket, `ws://localhost${PATH}`);
  await client.opened;
  client.socket.send(JSON.stringify(START));
  const { code, reason } = await client.closed;
  assert.strictEqual(code, 1007);
  assert.match(reason, /sent a message the contract doesn't let it send/);
});

test('a routed socket closes the client\'s connection with 1014 when its target can\'t be reached, or doesn\'t open in time', async () => {
  const unreachable = await quietMock({ routing: [{ api: API, to: 'ws://127.0.0.1:9/' }] });
  const first = connect(unreachable.WebSocket, `ws://localhost${PATH}`);
  assert.strictEqual((await first.closed).code, 1014);

  class Silent extends EventTarget { constructor() { super(); this.readyState = 0; } close() {} }
  const slow = await quietMock({ routing: [{ api: API, handler: Silent, timeoutMs: 20 }] });
  const second = connect(slow.WebSocket, `ws://localhost${PATH}`);
  const { code, reason } = await second.closed;
  assert.strictEqual(code, 1014);
  assert.match(reason, /did not open within 20ms/);
});

test('a socket routed to a URL connects there as written, passing on the subprotocols, and a normal close passes back', async (t) => {
  // A real relay: answers start, and closes after end.
  const relay = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: (p) => [...p][0] });
  t.after(() => new Promise((settle) => relay.close(settle)));
  await new Promise((settle) => relay.once('listening', settle));
  const reached = [];
  relay.on('connection', (socket, request) => {
    reached.push({ path: request.url, protocols: request.headers['sec-websocket-protocol'] });
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'start') socket.send(JSON.stringify({ type: 'started' }));
      if (message.type === 'end') { socket.send(JSON.stringify({ type: 'ended' })); socket.close(1000, 'done'); }
    });
  });
  const mock = await quietMock({ routing: [{ api: API, to: `ws://127.0.0.1:${relay.address().port}/stream` }] });

  const client = connect(mock.WebSocket, `ws://localhost${PATH}`, [PROTOCOL, 'a-token']);
  await client.opened;
  client.socket.send(JSON.stringify(START));
  client.socket.send(JSON.stringify({ type: 'end' }));
  const closed = await client.closed;
  assert.deepStrictEqual(client.heard, [{ type: 'started' }, { type: 'ended' }]);
  assert.deepStrictEqual(closed, { code: 1000, reason: 'done' });
  assert.deepStrictEqual(reached, [{ path: '/stream', protocols: `${PROTOCOL}, a-token` }]);
});

test('routing refuses what a socket can\'t take, and only an entry naming a socket routes it', async () => {
  const refused = (routing, pattern) => assert.rejects(quietMock({ routing }), pattern);
  await refused([{ api: API, to: 'wss://relay.example.org', except: [{ operation: 'receiveStart' }] }], /takes no except/);
  await refused([{ api: API, to: 'wss://relay.example.org', includeHeaders: ['authorization'] }], /takes no includeHeaders/);
  await refused([{ operation: `$apis.${API}.receiveStart`, to: 'wss://relay.example.org' }], /route the API instead/);
  await refused([{ api: 'communication-transcripts', to: 'wss://relay.example.org' }], /routed to a WebSocket URL/);

  const domain = await quietMock({ routing: [{ domain: 'communication', to: 'https://communication.example.org' }] });
  assert.ok(!domain.routed.some((key) => key.startsWith('WS ')), 'the domain\'s requests are routed, its socket isn\'t');
});
