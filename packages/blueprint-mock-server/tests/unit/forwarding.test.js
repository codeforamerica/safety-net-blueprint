import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  forwardTo, validateForwarding, applyForwarding, forwardingFromDocument,
} from '../../src/forwarding.js';
import { registerHttpStub, clearAllStubs } from '../../src/mock-stub-engine.js';

/**
 * The route table as `addRoute` leaves it, reduced to what this reads. Each
 * route is a key, or a `[key, domain]` pair for one a contract's domain owns.
 */
function tableWith(...routes) {
  return new Map(routes.map((route) => {
    const [key, domain = null] = Array.isArray(route) ? route : [route];
    return [key, { operationId: 'x', description: null, domain, mock: false, handler: () => new Response() }];
  }));
}

/** Capture what the handler asked `fetch` for, without a network. */
let seen;
const realFetch = globalThis.fetch;

beforeEach(() => {
  clearAllStubs();
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

// ── What travels, and what does not ─────────────────────────────────────────

test('forwardTo — sends the headers that describe the request', async () => {
  const handler = forwardTo('https://eligibility.example.gov');
  const sent = {
    accept: 'application/json',
    'accept-language': 'es',
    'content-type': 'application/json',
    'idempotency-key': 'k-1',
    'if-match': '"v3"',
    'if-none-match': '"v2"',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    tracestate: 'vendor=1',
  };
  await handler(new Request('http://localhost:1080/intake/applications', { method: 'PATCH', headers: sent, body: '{}' }));

  for (const [name, value] of Object.entries(sent)) {
    assert.equal(seen[0].init.headers.get(name), value, `${name} describes the request and travels`);
  }
});

test('forwardTo — drops every other header unless it is named', async () => {
  // A list of credentials to strip would have to anticipate every name one
  // travels under. X-API-Key is the one that list missed.
  const handler = forwardTo('https://eligibility.example.gov');
  await handler(new Request('http://localhost:1080/intake/applications', {
    headers: {
      authorization: 'Bearer secret', cookie: 'session=abc', 'x-api-key': 'k',
      'x-caller-id': 'me', connection: 'keep-alive',
    },
  }));

  const sent = seen[0].init.headers;
  for (const name of ['authorization', 'cookie', 'x-api-key', 'x-caller-id', 'connection']) {
    assert.equal(sent.get(name), null, `${name} must not travel unnamed`);
  }
});

test('forwardTo — sends a header when asked to by name', async () => {
  const handler = forwardTo('https://eligibility.example.gov', { includeHeaders: ['Authorization', 'X-API-Key'] });
  await handler(new Request('http://localhost:1080/intake/applications', {
    headers: { authorization: 'Bearer secret', 'x-api-key': 'k', cookie: 'session=abc' },
  }));

  assert.equal(seen[0].init.headers.get('authorization'), 'Bearer secret');
  assert.equal(seen[0].init.headers.get('x-api-key'), 'k');
  assert.equal(seen[0].init.headers.get('cookie'), null, 'only the named headers are opted in');
});

test('forwardTo — withholds the service\'s cookie unless it is named', async () => {
  globalThis.fetch = async () => new Response('{}', {
    headers: { 'content-type': 'application/json', 'set-cookie': 'session=real', etag: '"v3"' },
  });
  const request = () => new Request('http://localhost:1080/intake/applications');

  const plain = await forwardTo('https://x.test')(request());
  assert.equal(plain.headers.get('set-cookie'), null);
  assert.equal(plain.headers.get('etag'), '"v3"', 'other response headers pass back');

  const named = await forwardTo('https://x.test', { includeHeaders: ['Set-Cookie'] })(request());
  assert.equal(named.headers.get('set-cookie'), 'session=real');
});

test('forwardTo — does not pass on an encoding fetch has already undone', async () => {
  // fetch hands back a decoded body with the encoding header still on it.
  // Passed on, the caller would try to gunzip plain JSON.
  globalThis.fetch = async () => new Response('{"ok":true}', {
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '31' },
  });

  const response = await forwardTo('https://x.test')(new Request('http://localhost:1080/intake/applications'));

  assert.equal(response.headers.get('content-encoding'), null);
  assert.deepEqual(await response.json(), { ok: true });
});

test('forwardTo — does not pass on the service\'s own CORS policy', async () => {
  // It describes what the service allows the mock, and would override what
  // the mock allows the page.
  globalThis.fetch = async () => new Response('{}', {
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://vendor.example' },
  });

  const response = await forwardTo('https://x.test')(new Request('http://localhost:1080/intake/applications'));

  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

// ── What comes back ─────────────────────────────────────────────────────────

test('forwardTo — passes the service\'s answer back, status and body', async () => {
  globalThis.fetch = async () => Response.json({ code: 'NOT_FOUND' }, { status: 404 });

  const response = await forwardTo('https://x.test')(new Request('http://localhost:1080/intake/applications/a-1'));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { code: 'NOT_FOUND' });
});

test('forwardTo — refuses a redirect rather than following it', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(init.redirect, 'manual', 'fetch must not follow it either');
    return new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/login' } });
  };

  const response = await forwardTo('https://x.test')(new Request('http://localhost:1080/intake/applications'));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.match(body.message, /elsewhere\.test\/login/);
});

test('forwardTo — refuses the opaque redirect a page sees', async () => {
  // In a browser a manual redirect has status 0, no location, and no body.
  globalThis.fetch = async () => {
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
    return response;
  };

  const response = await forwardTo('https://x.test')(new Request('http://localhost:1080/intake/applications'));

  assert.equal(response.status, 502);
});

test('forwardTo — passes a 304 back, which is not a redirect', async () => {
  globalThis.fetch = async () => new Response(null, { status: 304, headers: { etag: '"v3"' } });

  const response = await forwardTo('https://x.test')(new Request('http://localhost:1080/intake/applications/a-1'));

  assert.equal(response.status, 304);
});

test('forwardTo — a stub outranks the real service', async () => {
  registerHttpStub({ match: { method: 'GET', url: '/intake/applications' }, response: { status: 418, body: { stubbed: true } } });
  const handler = forwardTo('https://x.test');

  const stubbed = await handler(new Request('http://localhost:1080/intake/applications'));
  assert.equal(stubbed.status, 418);
  assert.equal(seen.length, 0, 'the real service was not called');

  await handler(new Request('http://localhost:1080/intake/applications'));
  assert.equal(seen.length, 1, 'consumed, so the next request is forwarded');
});

test('forwardTo — a stub on a DELETE answers 204, as the mock\'s own DELETE does', async () => {
  registerHttpStub({ match: { method: 'DELETE', url: '/intake/applications/a-1' } });

  const response = await forwardTo('https://x.test')(new Request('http://localhost:1080/intake/applications/a-1', { method: 'DELETE' }));

  assert.equal(response.status, 204);
  assert.equal(seen.length, 0);
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

test('forwardTo — answers 504 when the target is too slow', async () => {
  // A service that never answers. The held timer keeps the process alive,
  // since AbortSignal.timeout does not, and would otherwise let it exit with
  // the test still pending.
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    const held = setTimeout(() => {}, 1000);
    init.signal.addEventListener('abort', () => { clearTimeout(held); reject(init.signal.reason); });
  });
  const handler = forwardTo('https://eligibility.example.gov', { timeoutMs: 5 });

  const response = await handler(new Request('http://localhost:1080/intake/applications'));
  const body = await response.json();

  assert.equal(response.status, 504);
  assert.equal(body.code, 'GATEWAY_TIMEOUT');
  assert.match(body.message, /5ms/);
});

// ── Configuration ───────────────────────────────────────────────────────────

test('validateForwarding — refuses an endpoint naming no route', () => {
  const routes = tableWith('POST /intake/applications');

  assert.throws(
    () => validateForwarding([{ endpoint: 'POST /intake/aplications', to: 'https://x.test' }], routes),
    /matches no route/,
  );
});

test('validateForwarding — refuses a relative target', () => {
  const routes = tableWith('POST /intake/applications');

  assert.throws(
    () => validateForwarding([{ endpoint: 'POST /intake/applications', to: '/elsewhere' }], routes),
    /"to" must match pattern/,
  );
});

test('validateForwarding — refuses a target carrying a username or password', () => {
  // The file is configuration, and is printed, logged and committed.
  const routes = tableWith('POST /intake/applications');

  for (const to of ['https://user:secret@intake.example.gov', 'https://token@intake.example.gov/api']) {
    assert.throws(
      () => validateForwarding([{ endpoint: 'POST /intake/applications', to }], routes),
      /"to" must match pattern/,
      to,
    );
  }
  // An @ in the path is not a credential.
  validateForwarding([{ endpoint: 'POST /intake/applications', to: 'https://intake.example.gov/@v1' }], routes);
});

test('validateForwarding — requires a target', () => {
  const routes = tableWith('POST /intake/applications');

  assert.throws(
    () => validateForwarding([{ endpoint: 'POST /intake/applications' }], routes),
    /endpoint "POST \/intake\/applications" needs "to"/,
  );
});

test('validateForwarding — needs exactly one of domain and endpoint', () => {
  const routes = tableWith('POST /intake/applications');

  assert.throws(() => validateForwarding([{ to: 'https://x.test' }], routes), /needs exactly one of "domain" or "endpoint"/);
  assert.throws(
    () => validateForwarding([{ domain: 'intake', endpoint: 'POST /intake/applications', to: 'https://x.test' }], routes),
    /needs exactly one of "domain" or "endpoint"/,
  );
});

test('validateForwarding — refuses an unknown key rather than ignoring it', () => {
  // `includeHeader` ignored would mean the header it names is quietly dropped.
  const routes = tableWith('POST /intake/applications');

  assert.throws(
    () => validateForwarding([
      { endpoint: 'POST /intake/applications', to: 'https://x.test', includeHeader: ['Authorization'] },
    ], routes),
    /unknown key "includeHeader"/,
  );
});

test('validateForwarding — refuses a timeout that is not a whole number', () => {
  const routes = tableWith('POST /intake/applications');

  assert.throws(
    () => validateForwarding([{ endpoint: 'POST /intake/applications', to: 'https://x.test', timeoutMs: '5000' }], routes),
    /"timeoutMs" must be integer/,
  );
});

test('validateForwarding — refuses the same domain or endpoint twice', () => {
  const routes = tableWith(['POST /intake/applications', 'intake']);

  assert.throws(
    () => validateForwarding([
      { endpoint: 'POST /intake/applications', to: 'https://a.test' },
      { endpoint: 'POST /intake/applications', to: 'https://b.test' },
    ], routes),
    /configured more than once/,
  );
  assert.throws(
    () => validateForwarding([
      { domain: 'intake', to: 'https://a.test' },
      { domain: 'intake', to: 'https://b.test' },
    ], routes),
    /configured more than once/,
  );
});

test('validateForwarding — refuses something that is not a list', () => {
  assert.throws(() => validateForwarding({ endpoint: 'POST /x' }, tableWith()), /forwarding must be array/);
});

test('validateForwarding — refuses a domain with no routes, naming the ones there are', () => {
  const routes = tableWith(['POST /intake/applications', 'intake'], ['GET /eligibility/determinations', 'eligibility']);

  assert.throws(
    () => validateForwarding([{ domain: 'intak', to: 'https://x.test' }], routes),
    /domain "intak" declares no routes\. Domains the contracts declare: eligibility, intake/,
  );
});

test('validateForwarding — refuses a route the mock serves itself', () => {
  // Stubs and reset are the mock's own; no contract declares them.
  const routes = tableWith('POST /intake/applications');
  routes.set('POST /mock/stubs/http', { operationId: null, description: null, domain: null, mock: true, handler: () => new Response() });

  assert.throws(
    () => validateForwarding([{ endpoint: 'POST /mock/stubs/http', to: 'https://x.test' }], routes),
    /one the mock serves itself/,
  );
});

test('forwardingFromDocument — returns the entries of a well-formed file', () => {
  const entries = [{ domain: 'intake', to: 'https://x.test' }];
  assert.deepEqual(forwardingFromDocument({ forwarding: entries }), entries);
});

test('forwardingFromDocument — refuses a file that would forward nothing by accident', () => {
  // An empty file parses as null or undefined; a misspelled key as an object
  // without one. Either used to boot a server that forwarded nothing.
  assert.throws(() => forwardingFromDocument(null), /configuration must be object/);
  assert.throws(() => forwardingFromDocument(undefined), /configuration must be object/);
  assert.throws(() => forwardingFromDocument({ forward: [] }), /needs "forwarding"/);
  assert.throws(() => forwardingFromDocument([]), /configuration must be object/);
});

// ── Applying it ─────────────────────────────────────────────────────────────

test('applyForwarding — an endpoint replaces the handler on that route only', async () => {
  const routes = tableWith('POST /intake/applications', 'GET /intake/applications');
  const before = routes.get('GET /intake/applications').handler;

  const switched = applyForwarding(routes, [
    { endpoint: 'POST /intake/applications', to: 'https://intake.example.gov' },
  ]);

  assert.deepEqual(switched, ['POST /intake/applications']);
  assert.equal(routes.get('GET /intake/applications').handler, before, 'other routes are untouched');

  await routes.get('POST /intake/applications').handler(
    new Request('http://localhost:1080/intake/applications', { method: 'POST' }),
  );
  assert.equal(seen[0].url, 'https://intake.example.gov/intake/applications');
});

test('applyForwarding — a domain forwards every route tagged with it, and no other', async () => {
  const routes = tableWith(
    ['GET /intake/applications', 'intake'],
    ['POST /intake/applications/{applicationId}/submit', 'intake'],
    // Served from the root, so the path says nothing about its domain.
    ['GET /persons', 'client-management'],
  );
  const untouched = routes.get('GET /persons').handler;

  const switched = applyForwarding(routes, [{ domain: 'intake', to: 'https://intake.example.gov' }]);

  assert.deepEqual(switched.sort(), ['GET /intake/applications', 'POST /intake/applications/{applicationId}/submit']);
  assert.equal(routes.get('GET /persons').handler, untouched);
});

test('applyForwarding — an endpoint overrides its domain, whichever is listed first', async () => {
  const routes = tableWith(['GET /intake/applications', 'intake'], ['GET /intake/applications/{applicationId}', 'intake']);

  applyForwarding(routes, [
    { endpoint: 'GET /intake/applications/{applicationId}', to: 'http://localhost:4000' },
    { domain: 'intake', to: 'https://intake.example.gov' },
  ]);

  await routes.get('GET /intake/applications/{applicationId}').handler(new Request('http://localhost:1080/intake/applications/a-1'));
  await routes.get('GET /intake/applications').handler(new Request('http://localhost:1080/intake/applications'));
  assert.equal(seen[0].url, 'http://localhost:4000/intake/applications/a-1');
  assert.equal(seen[1].url, 'https://intake.example.gov/intake/applications');
});

test('applyForwarding — a domain leaves the mock\'s own routes alone', () => {
  const routes = tableWith(['GET /platform/events', 'platform']);
  routes.set('GET /health', { operationId: null, description: null, domain: 'platform', mock: true, handler: () => new Response() });

  assert.deepEqual(applyForwarding(routes, [{ domain: 'platform', to: 'https://x.test' }]), ['GET /platform/events']);
});

test('applyForwarding — adds no routes', () => {
  const routes = tableWith('POST /intake/applications');

  applyForwarding(routes, [{ endpoint: 'POST /intake/applications', to: 'https://x.test' }]);

  assert.equal(routes.size, 1);
});
