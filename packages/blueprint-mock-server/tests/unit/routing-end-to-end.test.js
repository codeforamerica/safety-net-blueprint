/**
 * Routing, end to end: the harness contracts, a real socket, and a small
 * server standing in for a state's backend (#283, #520).
 *
 * `routing.test.js` checks the pieces against a fake `fetch`. This checks
 * what those cannot: that every route a domain declares is tagged with it
 * when the real registration code runs — including state machine routes,
 * which are not in the OpenAPI document — that a request goes out over the
 * network and comes back, and that an event a routed machine receives is
 * delivered there instead of reacted to here. The stand-in is a stand-in: it
 * proves the routing, not that any particular backend integrates.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, load, generate } from '@codeforamerica/blueprint-core';
import { createMockServer } from '../../src/browser.js';
import { createNodeServer } from '../../src/http/node-server.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harness = resolve(packageRoot, '../blueprint-harness/generated/resolved');

const contracts = generate(discover(harness).map(load), 'artifact');

/** Listen on a free loopback port and resolve to the base URL. */
function listen(server) {
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}`)));
}

/** Boot the mock quietly; it logs every route it registers. */
async function boot(options) {
  const log = console.log;
  console.log = () => {};
  try {
    return await createMockServer({ contracts, ...options });
  } finally {
    console.log = log;
  }
}

describe('routing a domain to a real service', () => {
  let standIn;
  let target;
  let received;

  before(async () => {
    standIn = createServer((req, res) => {
      received.push({ method: req.method, url: req.url, headers: req.headers });
      res.setHeader('content-type', 'application/json');
      res.setHeader('set-cookie', 'session=the-real-service');
      res.end(JSON.stringify({ from: 'stand-in', path: req.url }));
    });
    target = await listen(standIn);
  });
  after(() => standIn.close());
  beforeEach(() => { received = []; });

  test('every route the domain declares reaches the service, and nothing else does', async () => {
    const mock = await boot({ routing: [{ domain: 'intake', to: `${target}/state` }] });

    assert.ok(
      mock.routed.includes('POST /intake/applications/{applicationId}/submit'),
      'a state machine route is the domain\'s too, though no OpenAPI path declares it',
    );
    assert.ok(mock.routed.every((key) => / \/intake\//.test(key)), mock.routed.join('\n'));

    const read = await mock.fetch(new Request('http://mock.test/intake/applications?limit=1'));
    assert.deepEqual(await read.json(), { from: 'stand-in', path: '/state/intake/applications?limit=1' });

    const submit = await mock.fetch(new Request('http://mock.test/intake/applications/a-1/submit', { method: 'POST', body: '{}' }));
    assert.equal(submit.status, 200);
    assert.equal(received.at(-1).url, '/state/intake/applications/a-1/submit');

    // Another domain is still the mock's.
    const mocked = await mock.fetch(new Request('http://mock.test/eligibility/determinations'));
    assert.equal(mocked.status, 200);
    assert.ok(Array.isArray((await mocked.json()).items));
    assert.equal(received.length, 2, 'the mocked request never reached the stand-in');
  });

  test('a credential arrives only where it is named, and the service\'s cookie never comes back', async () => {
    const mock = await boot({
      routing: [{ domain: 'intake', to: target, includeHeaders: ['Authorization'] }],
    });

    const response = await mock.fetch(new Request('http://mock.test/intake/applications', {
      headers: { authorization: 'Bearer user-token', 'x-api-key': 'not-named', cookie: 'mock=1' },
    }));

    const { headers } = received[0];
    assert.equal(headers.authorization, 'Bearer user-token');
    assert.equal(headers['x-api-key'], undefined);
    assert.equal(headers.cookie, undefined);
    assert.equal(response.headers.get('set-cookie'), null);
  });

  test('over Node, a page may send the header it is configured to pass on', async () => {
    const mock = await boot({
      routing: [{ domain: 'intake', to: target, includeHeaders: ['X-API-Key'] }],
    });
    const server = createNodeServer(mock.fetch);
    const base = await listen(server);
    try {
      // What a browser asks before sending a header outside the simple set.
      // A fixed allow-list without X-API-Key would refuse here, and the
      // request would never be sent at all.
      const preflight = await fetch(`${base}/intake/applications`, {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-api-key, if-match' },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-headers'), 'x-api-key, if-match');

      await fetch(`${base}/intake/applications`, { headers: { 'x-api-key': 'k-1', 'if-match': '"v1"' } });
      assert.equal(received[0].headers['x-api-key'], 'k-1');
      assert.equal(received[0].headers['if-match'], '"v1"');
    } finally {
      server.close();
    }
  });

  test('a stub on a routed route answers instead, once', async () => {
    const mock = await boot({ routing: [{ domain: 'intake', to: target }] });

    const registered = await mock.fetch(new Request('http://mock.test/mock/stubs/http', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ match: { method: 'GET', url: '/intake/applications' }, response: { status: 503 } }),
    }));
    assert.equal(registered.status, 201);

    assert.equal((await mock.fetch(new Request('http://mock.test/intake/applications'))).status, 503);
    assert.equal(received.length, 0);
    assert.equal((await mock.fetch(new Request('http://mock.test/intake/applications'))).status, 200);
    assert.equal(received.length, 1);
  });
});

describe('routing the events a machine receives', () => {
  let standIn;
  let target;
  let received;

  before(async () => {
    standIn = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) });
        res.statusCode = 202;
        res.end();
      });
    });
    target = await listen(standIn);
  });
  after(() => standIn.close());
  beforeEach(() => { received = []; });

  const caseworker = { 'content-type': 'application/json', 'x-caller-id': 'worker-1', 'x-caller-roles': 'case_worker' };
  const DRAFT = '22222222-2222-4222-8222-222222222222';
  const determinations = async (mock) => (await (await mock.fetch(new Request('http://mock.test/eligibility/determinations', { headers: caseworker }))).json()).items.length;
  const submit = (mock) => mock.fetch(new Request(`http://mock.test/intake/applications/${DRAFT}/submit`, { method: 'POST', headers: caseworker, body: '{}' }));
  const settled = () => new Promise((done) => setTimeout(done, 100));

  test('without routing, eligibility reacts to a submitted application by starting a determination', async () => {
    const mock = await boot({ seed: true });
    const before = await determinations(mock);
    assert.equal((await submit(mock)).status, 200);
    await settled();
    assert.equal(await determinations(mock), before + 1);
  });

  test('routed, the event goes to the service as a CloudEvent, and eligibility doesn\'t react here', async () => {
    const mock = await boot({ seed: true, routing: [{ operation: '$apis.eligibility.receiveIntakeApplicationSubmitted', to: `${target}/inbox` }] });
    const before = await determinations(mock);

    assert.equal((await submit(mock)).status, 200);
    await settled();

    assert.equal(received.length, 1);
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].url, '/inbox');
    assert.equal(received[0].headers['content-type'], 'application/cloudevents+json');
    assert.equal(received[0].body.type, 'intake.application.submitted');
    assert.equal(received[0].body.subject, DRAFT);
    assert.equal(await determinations(mock), before);
  });
});

describe('the mock\'s own routes', () => {
  test('cannot be routed: no contract declares them', async () => {
    await assert.rejects(
      boot({ routing: [{ operation: 'registerHttpStub', to: 'http://127.0.0.1:9' }] }),
      /names no operation the contracts declare/,
    );
  });

  test('cannot be declared by a contract, which is what passing the mock\'s own spec would do', async () => {
    const own = discover(resolve(packageRoot, 'contracts')).map(load);
    const withOwnSpec = generate([...discover(harness).map(load), ...own], 'artifact');

    await assert.rejects(
      (async () => {
        const log = console.log;
        console.log = () => {};
        try {
          await createMockServer({ contracts: withOwnSpec, seed: false });
        } finally {
          console.log = log;
        }
      })(),
      /GET \/health[\s\S]*serves itself|serves itself[\s\S]*GET \/health/,
    );
  });
});

describe('two contracts declaring one route', () => {
  test('refuse to start, naming both documents', async () => {
    // A set's own file still declaring GET /platform/events beside the
    // framework's — the failure moving the events contract could cause, which
    // first-wins used to hide by quietly serving one of them.
    const dir = mkdtempSync(join(tmpdir(), 'dup-route-'));
    const path = join(dir, 'platform-events-openapi.yaml');
    writeFileSync(path, [
      'openapi: 3.1.0',
      'info: { title: Platform events, version: 1.0.0, x-domain: platform }',
      'servers: [{ url: "http://localhost:1080/platform" }]',
      'paths:',
      '  /events:',
      '    get: { operationId: listFrameworkEvents, responses: { "200": { description: ok } } }',
      '',
    ].join('\n'));
    const events = load({ path, relativePath: 'domains/platform/platform-openapi.yaml' });
    rmSync(dir, { recursive: true, force: true });

    const set = [...discover(harness).map(load), events];
    await assert.rejects(boot({ contracts: generate(set, 'artifact'), seed: false }),
      /GET \/platform\/events is declared by two contracts: (base\/domains\/platform\/platform-events-openapi\.yaml and domains\/platform\/platform-openapi\.yaml|domains\/platform\/platform-openapi\.yaml and base\/domains\/platform\/platform-events-openapi\.yaml)/);
  });
});

describe('a handler\'s answer, against a response schema with refs into other files', () => {
  test('is refused with 502 when the schema doesn\'t allow it', async () => {
    // Application refers to Household in another file; checked without the
    // operation's own document, the refs can't resolve and the answer passed.
    const warn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const mock = await boot({
        contracts,
        routing: [{ operation: 'getApplication', handler: async () => Response.json({ id: 42 }) }],
      });
      const response = await mock.fetch(new Request('http://localhost/intake/applications/11111111-1111-4111-8111-111111111111', {
        headers: { 'x-caller-id': 'worker-1' },
      }));
      const body = await response.json();
      assert.equal(response.status, 502);
      assert.ok(body.details.some((d) => /id/.test(d.field) && /string/.test(d.message)), JSON.stringify(body.details));
      assert.deepEqual(warnings.filter((w) => w.includes('no validator')), []);
    } finally {
      console.warn = warn;
    }
  });
});
