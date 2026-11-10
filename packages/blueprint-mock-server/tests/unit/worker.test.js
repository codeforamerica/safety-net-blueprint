/**
 * A server in a worker, over a MessageChannel, as a page and its worker talk:
 * requests and their bodies go across, responses stream back, an abort
 * reaches the worker, and a named connection opens a port. The browsers run
 * the same code in the transcription demo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, load, generate } from '@codeforamerica/blueprint-core';
import { createMockServer } from '../../src/server.js';
import { expose, wrap } from '../../src/worker.js';

/** A server's two sides, joined as a worker and its page are. */
function across(server) {
  const { port1, port2 } = new MessageChannel();
  expose(server, port1);
  const page = wrap(port2);
  return { page, close: () => { page.close(); port1.close(); } };
}

test('a request goes across with its body, and its response comes back', async () => {
  const { page, close } = across({
    fetch: async (request) => Response.json({ method: request.method, url: request.url, got: await request.json(), who: request.headers.get('x-caller-id') }, { status: 201 }),
  });
  const response = await page.fetch('http://localhost/things', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' }, body: JSON.stringify({ a: 1 }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { method: 'POST', url: 'http://localhost/things', got: { a: 1 }, who: 'worker-1' });
  close();
});

test('a streamed body arrives as it is written, and aborting stops it in the worker', async () => {
  let cancelled = false;
  const { page, close } = across({
    fetch: (request) => {
      let timer;
      const body = new ReadableStream({
        start(controller) {
          let n = 0;
          timer = setInterval(() => controller.enqueue(new TextEncoder().encode(`data: ${n += 1}\n\n`)), 5);
          request.signal.addEventListener('abort', () => { clearInterval(timer); cancelled = true; controller.close(); });
        },
        cancel() { clearInterval(timer); },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const controller = new AbortController();
  const response = await page.fetch('http://localhost/events/stream', { signal: controller.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /^data: 1/);
  controller.abort();
  for (let i = 0; i < 100 && !cancelled; i += 1) await new Promise((done) => setTimeout(done, 5));
  assert.ok(cancelled, 'the worker saw the abort');
  close();
});

test('a named connection opens a port to the worker, and an unknown name is refused', async () => {
  const { page, close } = across({
    fetch: () => new Response(null, { status: 204 }),
    connections: { echo: (port) => { port.onmessage = ({ data }) => port.postMessage(`echo ${data}`); } },
  });
  const port = await page.connect('echo');
  const reply = new Promise((done) => { port.onmessage = ({ data }) => done(data); });
  port.postMessage('hello');
  assert.equal(await reply, 'echo hello');
  port.close();
  await assert.rejects(page.connect('nope'), /no connection named "nope"/);
  close();
});

test('a mock served across answers as it does in the page', async () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const contracts = generate(discover(resolve(packageRoot, '../blueprint-harness/generated/resolved')).map(load), 'artifact');
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  let mock;
  try { mock = await createMockServer({ contracts }); } finally { console.log = log; console.warn = warn; }
  const { page, close } = across({ fetch: mock.fetch });
  const response = await page.fetch('http://localhost/communication/profiles', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' },
    body: JSON.stringify({ name: 'english', provider: 'none', languages: ['en-US'] }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).name, 'english');
  close();
});
