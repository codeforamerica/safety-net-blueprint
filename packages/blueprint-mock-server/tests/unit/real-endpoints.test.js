import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  forwardTo, validateRealEndpoints, applyRealEndpoints,
  conformanceFindings, clearConformance, responseSchemasByRoute,
} from '../../src/real-endpoints.js';

/** The route table as `addRoute` leaves it, reduced to what this reads. */
function tableWith(...keys) {
  return new Map(keys.map((key) => [key, { operationId: 'x', description: null, handler: () => new Response() }]));
}

/** Capture what the handler asked `fetch` for, without a network. */
let seen;
const realFetch = globalThis.fetch;

beforeEach(() => {
  clearConformance();
  seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return Response.json({ reached: true }, { status: 200 });
  };
});

afterEach(() => { globalThis.fetch = realFetch; });

// ── Where the request goes ──────────────────────────────────────────────────

test('forwardTo — reissues the path and query against the target', async () => {
  const handler = forwardTo('https://eligibility.example.gov');
  await handler(new Request('http://localhost:1080/intake/applications?limit=5'));

  assert.equal(seen[0].url, 'https://eligibility.example.gov/intake/applications?limit=5');
});

test('forwardTo — keeps a path prefix on the target', async () => {
  // `https://host/api` plus `/intake/applications` is `/api/intake/applications`,
  // not `/intake/applications`.
  const handler = forwardTo('https://eligibility.example.gov/api');
  await handler(new Request('http://localhost:1080/intake/applications'));

  assert.equal(seen[0].url, 'https://eligibility.example.gov/api/intake/applications');
});

test('forwardTo — carries the method and body', async () => {
  const handler = forwardTo('https://eligibility.example.gov');
  await handler(new Request('http://localhost:1080/intake/applications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel: 'online' }),
  }));

  assert.equal(seen[0].init.method, 'POST');
  assert.equal(new TextDecoder().decode(seen[0].init.body), '{"channel":"online"}');
});

// ── What does not travel ────────────────────────────────────────────────────

test('forwardTo — strips an inbound credential by default', async () => {
  const handler = forwardTo('https://eligibility.example.gov');
  await handler(new Request('http://localhost:1080/intake/applications', {
    headers: { authorization: 'Bearer secret', cookie: 'session=abc', 'x-caller-id': 'me' },
  }));

  const sent = seen[0].init.headers;
  assert.equal(sent.get('authorization'), null, 'a bearer token must not reach a third party by default');
  assert.equal(sent.get('cookie'), null);
  assert.equal(sent.get('x-caller-id'), 'me', 'ordinary headers still travel');
});

test('forwardTo — forwards a credential when asked to by name', async () => {
  const handler = forwardTo('https://eligibility.example.gov', { forwardHeaders: ['Authorization'] });
  await handler(new Request('http://localhost:1080/intake/applications', {
    headers: { authorization: 'Bearer secret', cookie: 'session=abc' },
  }));

  assert.equal(seen[0].init.headers.get('authorization'), 'Bearer secret');
  assert.equal(seen[0].init.headers.get('cookie'), null, 'only the named header is opted in');
});

test('forwardTo — drops hop-by-hop headers', async () => {
  const handler = forwardTo('https://eligibility.example.gov');
  await handler(new Request('http://localhost:1080/intake/applications', {
    headers: { connection: 'keep-alive', te: 'trailers' },
  }));

  assert.equal(seen[0].init.headers.get('connection'), null);
  assert.equal(seen[0].init.headers.get('te'), null);
});

// ── When the target is not there ────────────────────────────────────────────

test('forwardTo — answers 502 when the target cannot be reached', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const handler = forwardTo('https://eligibility.example.gov');

  const response = await handler(new Request('http://localhost:1080/intake/applications'));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.code, 'BAD_GATEWAY');
  assert.match(body.message, /eligibility\.example\.gov/);
});

// ── Configuration ───────────────────────────────────────────────────────────

test('validateRealEndpoints — refuses a match naming no route', () => {
  const routes = tableWith('POST /intake/applications');

  assert.throws(
    () => validateRealEndpoints([{ match: 'POST /intake/aplications', forwardTo: 'https://x.test' }], routes),
    /matches no route/,
  );
});

test('validateRealEndpoints — refuses a relative forwardTo', () => {
  const routes = tableWith('POST /intake/applications');

  assert.throws(
    () => validateRealEndpoints([{ match: 'POST /intake/applications', forwardTo: '/elsewhere' }], routes),
    /not an absolute URL/,
  );
});

test('validateRealEndpoints — requires both fields', () => {
  const routes = tableWith('POST /intake/applications');

  assert.throws(() => validateRealEndpoints([{ forwardTo: 'https://x.test' }], routes), /needs a "match"/);
  assert.throws(() => validateRealEndpoints([{ match: 'POST /intake/applications' }], routes), /needs a "forwardTo"/);
});

test('applyRealEndpoints — replaces the handler on the named route only', async () => {
  const routes = tableWith('POST /intake/applications', 'GET /intake/applications');
  const before = routes.get('GET /intake/applications').handler;

  const switched = applyRealEndpoints(routes, [
    { match: 'POST /intake/applications', forwardTo: 'https://eligibility.example.gov' },
  ]);

  assert.deepEqual(switched, ['POST /intake/applications']);
  assert.equal(routes.get('GET /intake/applications').handler, before, 'other routes are untouched');

  await routes.get('POST /intake/applications').handler(
    new Request('http://localhost:1080/intake/applications', { method: 'POST' }),
  );
  assert.equal(seen[0].url, 'https://eligibility.example.gov/intake/applications');
});

test('applyRealEndpoints — adds no routes', () => {
  const routes = tableWith('POST /intake/applications');

  applyRealEndpoints(routes, [{ match: 'POST /intake/applications', forwardTo: 'https://x.test' }]);

  assert.equal(routes.size, 1);
});


// ── Checking a real implementation against its contract ─────────────────────

const DECLARED = {
  schema: { type: 'object', required: ['extracted'], properties: { extracted: { type: 'array' } } },
  source: { relativePath: 'domains/platform/extract-openapi.yaml', ref: null },
};

test('forwardTo — records a response the contract disallows, and passes it through anyway', async () => {
  globalThis.fetch = async () => Response.json({ wrong: 'shape' }, { status: 200 });
  const handler = forwardTo('https://x.test', { match: 'POST /platform/extract', declared: DECLARED });

  const response = await handler(new Request('http://localhost:1080/platform/extract', { method: 'POST' }));

  // The mock does not overrule a real service.
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { wrong: 'shape' });

  const [finding] = conformanceFindings();
  assert.equal(finding.match, 'POST /platform/extract');
  assert.match(finding.errors[0].field, /extracted/);
});

test('forwardTo — records nothing when the response conforms', async () => {
  globalThis.fetch = async () => Response.json({ extracted: [] }, { status: 200 });
  const handler = forwardTo('https://x.test', { match: 'POST /platform/extract', declared: DECLARED });

  await handler(new Request('http://localhost:1080/platform/extract', { method: 'POST' }));

  assert.deepEqual(conformanceFindings(), []);
});

test('forwardTo — leaves a non-JSON response alone', async () => {
  // A stream cannot be read twice without buffering it, and SSE is the case
  // that matters.
  globalThis.fetch = async () => new Response('data: hello\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const handler = forwardTo('https://x.test', { match: 'GET /platform/events/stream', declared: DECLARED });

  await handler(new Request('http://localhost:1080/platform/events/stream'));

  assert.deepEqual(conformanceFindings(), []);
});

test('responseSchemasByRoute — keys declared response schemas by route', () => {
  const specs = [{
    relativePath: 'domains/platform/extract-openapi.yaml',
    endpoints: [
      { method: 'POST', path: '/platform/extract', responseSchema: DECLARED.schema, responseSchemaRef: null },
      { method: 'GET', path: '/platform/health', responseSchema: null },
    ],
  }];

  const byRoute = responseSchemasByRoute(specs, (m, p) => `${m.toUpperCase()} ${p}`, (p) => p);

  assert.ok(byRoute.has('POST /platform/extract'));
  assert.equal(byRoute.has('GET /platform/health'), false, 'an endpoint declaring no response schema has nothing to check');
});
