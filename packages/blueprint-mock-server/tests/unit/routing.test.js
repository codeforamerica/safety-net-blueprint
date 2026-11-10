import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  forwardTo, planRouting, applyRouting, routingFromDocument, deliverEvent,
} from '../../src/routing.js';
import { createStubs } from '../../src/mock-stub-engine.js';
import { createSchemaRegistry } from '../../src/validator.js';

/**
 * The contracts this reads, reduced to their operations: two APIs in intake,
 * one in eligibility, and the receive operations their machines have.
 */
const OPERATIONS = [
  { api: 'intake', id: 'listApplications', kind: 'openapi', method: 'GET', path: '/intake/applications' },
  { api: 'intake', id: 'createApplication', kind: 'openapi', method: 'POST', path: '/intake/applications' },
  { api: 'intake', id: 'getApplication', kind: 'openapi', method: 'GET', path: '/intake/applications/{applicationId}' },
  { api: 'intake', id: 'submitApplication', kind: 'openapi', method: 'POST', path: '/intake/applications/{applicationId}/submit' },
  { api: 'intake', id: 'sendIntakeApplicationSubmitted', kind: 'asyncapi', action: 'send', event: 'intake.application.submitted' },
  { api: 'intake-rules', id: 'evaluateFlags', kind: 'openapi', method: 'POST', path: '/intake/rules/flags' },
  { api: 'eligibility', id: 'listDeterminations', kind: 'openapi', method: 'GET', path: '/eligibility/determinations' },
  { api: 'eligibility', id: 'receiveIntakeApplicationSubmitted', kind: 'asyncapi', action: 'receive', event: 'intake.application.submitted' },
  { api: 'workflow', id: 'listTasks', kind: 'openapi', method: 'GET', path: '/workflow/tasks' },
  { api: 'workflow', id: 'receiveIntakeApplicationSubmitted', kind: 'asyncapi', action: 'receive', event: 'intake.application.submitted' },
];
const DOMAINS = { intake: 'intake', 'intake-rules': 'intake', eligibility: 'eligibility', workflow: 'workflow' };

/** As extract(docs, 'operations') answers: a bare id one API has, or $apis.<api>.<id>. */
const operations = {
  all: OPERATIONS,
  find(ref) {
    const [, api, id] = /^\$apis\.([^.]+)\.(.+)$/.exec(ref) ?? [null, null, ref];
    const candidates = OPERATIONS.filter((o) => o.id === id && (!api || o.api === api));
    return { operation: candidates.length === 1 ? candidates[0] : undefined, candidates };
  },
};
const domainOfApi = new Map(Object.entries(DOMAINS));
// What routing reads from the mock it routes: its stubs and its validator.
const instance = { stubs: createStubs(), schemas: createSchemaRegistry() };
const context = { operations, domainOfApi, responseSchema: () => null, instance };

/**
 * The route table as `assembleServer` leaves it, reduced to what this reads:
 * each OpenAPI operation's route, tagged with its domain, API and id.
 */
function table() {
  return new Map(OPERATIONS.filter((o) => o.kind === 'openapi').map((o) => [
    `${o.method} ${o.path}`,
    { operationId: o.id, description: null, domain: DOMAINS[o.api], api: o.api, mock: false, handler: () => new Response() },
  ]));
}

const plan = (routing, routes = table()) => planRouting(routing, { routes, operations, domainOfApi });
const routedKeys = (routing) => [...plan(routing).byRoute.keys()].sort();

/** Capture what the handler asked `fetch` for, without a network. */
let seen;
const realFetch = globalThis.fetch;

beforeEach(() => {
  instance.stubs.clearAllStubs();
  seen = [];
  globalThis.fetch = async (url, init) => {
    // A Request, as an event is delivered, carries its own method and headers.
    seen.push(url instanceof Request ? { url: url.url, init: { ...init, method: url.method, headers: url.headers } } : { url: String(url), init });
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
  instance.stubs.registerHttpStub({ match: { method: 'GET', url: '/intake/applications' }, response: { status: 418, body: { stubbed: true } } });
  const handler = forwardTo('https://x.test', { stubs: instance.stubs });

  const stubbed = await handler(new Request('http://localhost:1080/intake/applications'));
  assert.equal(stubbed.status, 418);
  assert.equal(seen.length, 0, 'the real service was not called');

  await handler(new Request('http://localhost:1080/intake/applications'));
  assert.equal(seen.length, 1, 'consumed, so the next request is forwarded');
});

test('forwardTo — a stub on a DELETE answers 204, as the mock\'s own DELETE does', async () => {
  instance.stubs.registerHttpStub({ match: { method: 'DELETE', url: '/intake/applications/a-1' } });

  const response = await forwardTo('https://x.test', { stubs: instance.stubs })(new Request('http://localhost:1080/intake/applications/a-1', { method: 'DELETE' }));

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

test('planRouting — refuses a relative target', () => {
  assert.throws(() => plan([{ operation: 'createApplication', to: '/elsewhere' }]), /"to" must match pattern/);
});

test('planRouting — refuses a target carrying a username or password', () => {
  // The file is configuration, and is printed, logged and committed.
  for (const to of ['https://user:secret@intake.example.gov', 'https://token@intake.example.gov/api']) {
    assert.throws(() => plan([{ operation: 'createApplication', to }]), /"to" must match pattern/, to);
  }
  // An @ in the path is not a credential.
  plan([{ operation: 'createApplication', to: 'https://intake.example.gov/@v1' }]);
});

test('planRouting — needs one of to and handler, and not both', () => {
  assert.throws(() => plan([{ operation: 'createApplication' }]), /must match a schema in anyOf|needs exactly one of "to" or "handler"/);
  assert.throws(() => plan([{ operation: 'createApplication', to: 'https://x.test', handler: () => new Response() }]), /needs exactly one of "to" or "handler"/);
  assert.throws(() => plan([{ operation: 'createApplication', handler: 'not a function' }]), /handler is a function/);
});

test('planRouting — needs exactly one of domain, api and operation', () => {
  assert.throws(() => plan([{ to: 'https://x.test' }]), /needs exactly one of "domain", "api" or "operation"/);
  assert.throws(() => plan([{ domain: 'intake', api: 'intake', to: 'https://x.test' }]), /needs exactly one of "domain", "api" or "operation"/);
});

test('planRouting — refuses an unknown key rather than ignoring it', () => {
  // `includeHeader` ignored would mean the header it names is quietly dropped.
  assert.throws(() => plan([{ api: 'intake', to: 'https://x.test', includeHeader: ['Authorization'] }]), /unknown key "includeHeader"/);
  // Forwarding's `endpoint` is gone; naming one says so rather than routing nothing.
  assert.throws(() => plan([{ endpoint: 'POST /intake/applications', to: 'https://x.test' }]), /unknown key "endpoint"/);
});

test('planRouting — refuses a timeout that is not a whole number', () => {
  assert.throws(() => plan([{ api: 'intake', to: 'https://x.test', timeoutMs: '5000' }]), /"timeoutMs" must be integer/);
});

test('planRouting — refuses the same domain, API or operation twice', () => {
  for (const name of [{ domain: 'intake' }, { api: 'intake' }, { operation: 'createApplication' }]) {
    assert.throws(() => plan([{ ...name, to: 'https://a.test' }, { ...name, to: 'https://b.test' }]), /configured more than once/);
  }
});

test('planRouting — refuses something that is not a list', () => {
  assert.throws(() => plan({ api: 'intake' }), /routing must be array/);
});

test('planRouting — refuses a name the contracts don\'t declare, naming the ones they do', () => {
  assert.throws(() => plan([{ domain: 'intak', to: 'https://x.test' }]), /domain "intak" declares no APIs\. Domains the contracts declare: eligibility, intake, workflow/);
  assert.throws(() => plan([{ api: 'intak', to: 'https://x.test' }]), /API "intak" is no API the contracts declare\. APIs: eligibility, intake, intake-rules, workflow/);
  assert.throws(() => plan([{ operation: 'createAplication', to: 'https://x.test' }]), /names no operation the contracts declare/);
});

test('planRouting — refuses a bare id more than one API declares, naming the qualified forms', () => {
  assert.throws(
    () => plan([{ operation: 'receiveIntakeApplicationSubmitted', to: 'https://x.test' }]),
    /write \$apis\.eligibility\.receiveIntakeApplicationSubmitted or \$apis\.workflow\.receiveIntakeApplicationSubmitted/,
  );
});

test('planRouting — refuses a send operation, which is the API\'s own to send', () => {
  assert.throws(() => plan([{ operation: 'sendIntakeApplicationSubmitted', to: 'https://x.test' }]), /is a send operation/);
});

test('planRouting — refuses an except outside its entry, or on an operation', () => {
  assert.throws(() => plan([{ domain: 'intake', except: [{ api: 'workflow' }], to: 'https://x.test' }]), /excepts API "workflow", which isn't inside it/);
  assert.throws(() => plan([{ api: 'intake', except: [{ operation: 'listTasks' }], to: 'https://x.test' }]), /excepts "listTasks", which isn't inside it/);
  assert.throws(() => plan([{ api: 'intake', except: [{ api: 'intake-rules' }], to: 'https://x.test' }]), /excepts API "intake-rules", which isn't inside it/);
  assert.throws(() => plan([{ operation: 'createApplication', except: [{ operation: 'listApplications' }], to: 'https://x.test' }]), /takes no except/);
});

test('planRouting — refuses a route the mock serves itself', () => {
  // Stubs and reset are the mock's own; no contract declares them.
  const routes = table();
  routes.get('POST /intake/applications').mock = true;
  assert.throws(() => plan([{ operation: 'createApplication', to: 'https://x.test' }], routes), /one the mock serves itself/);
});

test('routingFromDocument — returns the entries of a well-formed file', () => {
  const entries = [{ domain: 'intake', to: 'https://x.test' }];
  assert.deepEqual(routingFromDocument({ routing: entries }), entries);
});

test('routingFromDocument — refuses a file that would route nothing by accident', () => {
  // An empty file parses as null or undefined; a misspelled key as an object
  // without one. Either would boot a server that routed nothing.
  assert.throws(() => routingFromDocument(null), /configuration must be object/);
  assert.throws(() => routingFromDocument(undefined), /configuration must be object/);
  assert.throws(() => routingFromDocument({ forwarding: [] }), /needs "routing"/);
  assert.throws(() => routingFromDocument([]), /configuration must be object/);
});

// ── What an entry covers ────────────────────────────────────────────────────

test('planRouting — a domain covers every route of every API in it, and no other', () => {
  assert.deepEqual(routedKeys([{ domain: 'intake', to: 'https://x.test' }]), [
    'GET /intake/applications', 'GET /intake/applications/{applicationId}',
    'POST /intake/applications', 'POST /intake/applications/{applicationId}/submit', 'POST /intake/rules/flags',
  ]);
});

test('planRouting — an API covers its own routes only', () => {
  assert.deepEqual(routedKeys([{ api: 'intake-rules', to: 'https://x.test' }]), ['POST /intake/rules/flags']);
});

test('planRouting — except keeps an API or an operation in the mock', () => {
  assert.deepEqual(routedKeys([{ domain: 'intake', except: [{ api: 'intake-rules' }, { operation: 'submitApplication' }], to: 'https://x.test' }]), [
    'GET /intake/applications', 'GET /intake/applications/{applicationId}', 'POST /intake/applications',
  ]);
});

test('planRouting — the narrowest entry answers, whichever is listed first', () => {
  const { byRoute } = plan([
    { operation: 'getApplication', to: 'http://localhost:4000' },
    { domain: 'intake', except: [{ api: 'intake-rules' }], to: 'https://intake.example.gov' },
    { api: 'intake-rules', to: 'https://rules.example.gov' },
  ]);
  assert.equal(byRoute.get('GET /intake/applications/{applicationId}').to, 'http://localhost:4000');
  assert.equal(byRoute.get('GET /intake/applications').to, 'https://intake.example.gov');
  assert.equal(byRoute.get('POST /intake/rules/flags').to, 'https://rules.example.gov');
});

test('planRouting — a domain or API covers the events its machines receive', () => {
  const receives = (routing) => plan(routing).receives.map((r) => `${r.api}#${r.id}`);
  assert.deepEqual(receives([{ domain: 'workflow', to: 'https://x.test' }]), ['workflow#receiveIntakeApplicationSubmitted']);
  assert.deepEqual(receives([{ api: 'eligibility', to: 'https://x.test' }]), ['eligibility#receiveIntakeApplicationSubmitted']);
  assert.deepEqual(receives([{ operation: '$apis.workflow.receiveIntakeApplicationSubmitted', to: 'https://x.test' }]), ['workflow#receiveIntakeApplicationSubmitted']);
  assert.deepEqual(receives([{ domain: 'workflow', except: [{ operation: '$apis.workflow.receiveIntakeApplicationSubmitted' }], to: 'https://x.test' }]), []);
  // Routing intake, which sends it, leaves the receivers alone.
  assert.deepEqual(receives([{ domain: 'intake', to: 'https://x.test' }]), []);
});

// ── Applying it ─────────────────────────────────────────────────────────────

test('applyRouting — sends a routed route to its target, and leaves the rest', async () => {
  const routes = table();
  const before = routes.get('GET /intake/applications').handler;

  const { routed } = applyRouting(routes, [{ operation: 'createApplication', to: 'https://intake.example.gov' }], context);

  assert.deepEqual(routed, ['POST /intake/applications']);
  assert.equal(routes.get('GET /intake/applications').handler, before, 'other routes are untouched');
  assert.equal(routes.get('POST /intake/applications').routed, true);
  await routes.get('POST /intake/applications').handler(new Request('http://localhost:1080/intake/applications', { method: 'POST' }));
  assert.equal(seen[0].url, 'https://intake.example.gov/intake/applications');
});

test('applyRouting — a handler answers in the page, with no request leaving it', async () => {
  const routes = table();
  applyRouting(routes, [{ operation: 'createApplication', handler: async () => Response.json({ id: 'a-1' }, { status: 201 }) }], context);

  const response = await routes.get('POST /intake/applications').handler(new Request('http://localhost/intake/applications', { method: 'POST' }));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 'a-1' });
  assert.equal(seen.length, 0);
});

test('applyRouting — a handler\'s answer its response schema doesn\'t allow is 502, naming why, and logged', async () => {
  const routes = table();
  const schema = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } };
  applyRouting(routes, [{ operation: 'createApplication', handler: async () => Response.json({ name: 'no id' }, { status: 201 }) }],
    { ...context, responseSchema: (route, status) => (status === 201 ? { schema, key: 'routing-test-201' } : null) });

  const warn = console.warn; const logged = [];
  console.warn = (...args) => logged.push(args);
  let response;
  try {
    response = await routes.get('POST /intake/applications').handler(new Request('http://localhost/intake/applications', { method: 'POST' }));
  } finally { console.warn = warn; }
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.match(body.message, /answered 201 with a body its response schema doesn't allow/);
  assert.ok(body.details.length > 0);
  assert.equal(logged.length, 1);
});

test('applyRouting — adds no routes', () => {
  const routes = table();
  const size = routes.size;
  applyRouting(routes, [{ domain: 'intake', to: 'https://x.test' }], context);
  assert.equal(routes.size, size);
});

// ── Delivering a received event ─────────────────────────────────────────────

const EVENT = {
  specversion: '1.0', id: 'e-1', type: 'intake.application.submitted', source: '/intake', subject: 'a-1',
  time: '2026-11-06T15:04:00Z', datacontenttype: 'application/json', data: {}, traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
};

test('deliverEvent — POSTs the event to the URL as written, in CloudEvents structured mode', async () => {
  await deliverEvent(EVENT, { api: 'workflow', id: 'receiveIntakeApplicationSubmitted', entry: { to: 'https://workflow.example.gov/inbox' } });

  const [request] = seen;
  assert.equal(request.url, 'https://workflow.example.gov/inbox');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.get('content-type'), 'application/cloudevents+json');
  assert.equal(request.init.redirect, 'manual');
});

test('deliverEvent — hands a handler the same request', async () => {
  let got;
  await deliverEvent(EVENT, { api: 'workflow', id: 'receiveIntakeApplicationSubmitted', entry: { handler: async (request) => { got = request; return new Response(null, { status: 202 }); } } });

  assert.equal(got.method, 'POST');
  assert.equal(got.headers.get('content-type'), 'application/cloudevents+json');
  assert.equal(got.headers.get('traceparent'), EVENT.traceparent);
  assert.deepEqual(await got.json(), EVENT);
});

test('deliverEvent — logs and drops a delivery that fails', async () => {
  const warn = console.warn; const logged = [];
  console.warn = (...args) => logged.push(args.join(' '));
  try {
    await deliverEvent(EVENT, { api: 'workflow', id: 'receiveIntakeApplicationSubmitted', entry: { handler: async () => { throw new Error('down'); } } });
    await deliverEvent(EVENT, { api: 'workflow', id: 'receiveIntakeApplicationSubmitted', entry: { handler: async () => new Response(null, { status: 500 }) } });
  } finally { console.warn = warn; }

  assert.match(logged[0], /failed: down; it was not retried/);
  assert.match(logged[1], /was answered 500; it was not retried/);
});
