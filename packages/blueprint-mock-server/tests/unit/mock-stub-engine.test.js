/**
 * Unit tests for mock-stub-engine
 * Tests registration, ID generation, FIFO matching, field filtering,
 * removal, and clearing.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createStubs } from '../../src/mock-stub-engine.js';

// Event types are short-form (no org prefix) in the current design.
// The x-event-type-prefix overlay config adds prefixes at resolve time for state deployments.

function makeStub(on, response, match) {
  return match ? { on, match, response } : { on, response };
}

function makeEnvelope(type, data = {}) {
  return { specversion: '1.0', type, source: '/test', subject: 'sub-1', data };
}

// A mock's stubs (instance.js); each test starts with a fresh set.
let stubs;
beforeEach(() => { stubs = createStubs(); });

// =============================================================================
// registerStub
// =============================================================================

test('registerStub — assigns human-readable ID from on suffix', () => {
  const stub = stubs.registerStub(makeStub(
    'data-exchange.external_service_call.created',
    { type: 'data-exchange.call.completed' }
  ));
  assert.strictEqual(stub.id, 'external_service_call.created-1');
});

test('registerStub — increments counter per suffix', () => {
  const a = stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed' }));
  const b = stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed' }));
  assert.strictEqual(a.id, 'external_service_call.created-1');
  assert.strictEqual(b.id, 'external_service_call.created-2');
});

test('registerStub — different suffixes use independent counters', () => {
  const a = stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed' }));
  const b = stubs.registerStub(makeStub('data-exchange.call.completed', { type: 'intake.application.submitted' }));
  assert.strictEqual(a.id, 'external_service_call.created-1');
  assert.strictEqual(b.id, 'call.completed-1');
});

test('registerStub — ID uses last two dot-segments of on field', () => {
  const stub = stubs.registerStub(makeStub(
    'data-exchange.external_service_call.created',
    { type: 'data-exchange.call.completed' }
  ));
  assert.ok(stub.id.startsWith('external_service_call.created-'));
});

test('registerStub — throws when on is missing', () => {
  assert.throws(
    () => stubs.registerStub({ response: { type: 'x.y.z' } }),
    /on/
  );
});

test('registerStub — throws when response is present but missing type', () => {
  assert.throws(
    () => stubs.registerStub({ on: 'data-exchange.external_service_call.created', response: {} }),
    /response/
  );
});

test('registerStub — allows stub without response (timer stub format)', () => {
  const stub = stubs.registerStub({ on: 'platform.timer.requested' });
  assert.ok(stub.id);
  assert.strictEqual(stub.response, undefined);
});

// =============================================================================
// matchAndPop — type matching
// =============================================================================

test('matchAndPop — matches by exact type', () => {
  stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed' }));
  const stub = stubs.matchAndPop('data-exchange.external_service_call.created', makeEnvelope('data-exchange.external_service_call.created'));
  assert.ok(stub, 'should match');
  assert.strictEqual(stubs.listStubs().length, 0);
});

test('matchAndPop — matches exact type in on field', () => {
  const eventType = 'data-exchange.external_service_call.created';
  stubs.registerStub(makeStub(eventType, { type: 'data-exchange.call.completed' }));
  const stub = stubs.matchAndPop(eventType, makeEnvelope(eventType));
  assert.ok(stub);
});

test('matchAndPop — returns null when no stub registered', () => {
  const result = stubs.matchAndPop('data-exchange.external_service_call.created', makeEnvelope('data-exchange.external_service_call.created'));
  assert.strictEqual(result, null);
});

test('matchAndPop — returns null when type does not match', () => {
  stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed' }));
  const result = stubs.matchAndPop('intake.application.submitted', makeEnvelope('intake.application.submitted'));
  assert.strictEqual(result, null);
  assert.strictEqual(stubs.listStubs().length, 1);
});

// =============================================================================
// matchAndPop — FIFO ordering
// =============================================================================

test('matchAndPop — pops first matching stub (FIFO)', () => {
  const a = stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed', data: { result: 'conclusive' } }));
  const b = stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed', data: { result: 'inconclusive' } }));
  const eventType = 'data-exchange.external_service_call.created';
  const first = stubs.matchAndPop(eventType, makeEnvelope(eventType));
  assert.strictEqual(first.id, a.id);
  assert.strictEqual(stubs.listStubs().length, 1);
  assert.strictEqual(stubs.listStubs()[0].id, b.id);
});

test('matchAndPop — second pop returns second stub', () => {
  stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed', data: { result: 'conclusive' } }));
  const b = stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed', data: { result: 'inconclusive' } }));
  const eventType = 'data-exchange.external_service_call.created';
  stubs.matchAndPop(eventType, makeEnvelope(eventType));
  const second = stubs.matchAndPop(eventType, makeEnvelope(eventType));
  assert.strictEqual(second.id, b.id);
  assert.strictEqual(stubs.listStubs().length, 0);
});

// =============================================================================
// matchAndPop — field match filtering
// =============================================================================

test('matchAndPop — matches when all match criteria satisfied', () => {
  stubs.registerStub(makeStub(
    'data-exchange.external_service_call.created',
    { type: 'data-exchange.call.completed' },
    { 'data.serviceType': 'fdsh_ssa' }
  ));
  const eventType = 'data-exchange.external_service_call.created';
  const stub = stubs.matchAndPop(eventType, makeEnvelope(eventType, { serviceType: 'fdsh_ssa' }));
  assert.ok(stub);
});

test('matchAndPop — skips stub when match criteria not satisfied', () => {
  stubs.registerStub(makeStub(
    'data-exchange.external_service_call.created',
    { type: 'data-exchange.call.completed' },
    { 'data.serviceType': 'fdsh_ssa' }
  ));
  const eventType = 'data-exchange.external_service_call.created';
  const stub = stubs.matchAndPop(eventType, makeEnvelope(eventType, { serviceType: 'save' }));
  assert.strictEqual(stub, null);
  assert.strictEqual(stubs.listStubs().length, 1);
});

test('matchAndPop — skips non-matching stub and returns next matching one', () => {
  stubs.registerStub(makeStub(
    'data-exchange.external_service_call.created',
    { type: 'data-exchange.call.completed', data: { result: 'inconclusive' } },
    { 'data.serviceType': 'fdsh_ssa' }
  ));
  const b = stubs.registerStub(makeStub(
    'data-exchange.external_service_call.created',
    { type: 'data-exchange.call.completed', data: { result: 'conclusive' } }
    // no match filter — matches any
  ));
  const eventType = 'data-exchange.external_service_call.created';
  const stub = stubs.matchAndPop(eventType, makeEnvelope(eventType, { serviceType: 'save' }));
  assert.strictEqual(stub.id, b.id);
  assert.strictEqual(stubs.listStubs().length, 1);
});

test('matchAndPop — empty match object matches any event of that type', () => {
  stubs.registerStub(makeStub(
    'data-exchange.external_service_call.created',
    { type: 'data-exchange.call.completed' },
    {}
  ));
  const eventType = 'data-exchange.external_service_call.created';
  const stub = stubs.matchAndPop(eventType, makeEnvelope(eventType, { serviceType: 'save' }));
  assert.ok(stub);
});

// =============================================================================
// listStubs
// =============================================================================

test('listStubs — returns empty array when no stubs registered', () => {
  assert.deepStrictEqual(stubs.listStubs(), []);
});

test('listStubs — returns snapshot of all registered stubs', () => {
  stubs.registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  stubs.registerStub(makeStub('a.b.c', { type: 'd.e.g' }));
  assert.strictEqual(stubs.listStubs().length, 2);
});

test('listStubs — returns a copy (mutations do not affect registry)', () => {
  stubs.registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  const list = stubs.listStubs();
  list.pop();
  assert.strictEqual(stubs.listStubs().length, 1);
});

// =============================================================================
// removeStub
// =============================================================================

test('removeStub — removes a stub by ID and returns true', () => {
  const stub = stubs.registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  const result = stubs.removeStub(stub.id);
  assert.strictEqual(result, true);
  assert.strictEqual(stubs.listStubs().length, 0);
});

test('removeStub — returns false for unknown ID', () => {
  const result = stubs.removeStub('nonexistent-id');
  assert.strictEqual(result, false);
});

test('removeStub — removes only the targeted stub', () => {
  const a = stubs.registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  const b = stubs.registerStub(makeStub('a.b.c', { type: 'd.e.g' }));
  stubs.removeStub(a.id);
  assert.strictEqual(stubs.listStubs().length, 1);
  assert.strictEqual(stubs.listStubs()[0].id, b.id);
});

// =============================================================================
// clearStubs
// =============================================================================

test('clearStubs — removes all stubs', () => {
  stubs.registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  stubs.registerStub(makeStub('a.b.c', { type: 'd.e.g' }));
  stubs.clearStubs();
  assert.strictEqual(stubs.listStubs().length, 0);
});

test('clearStubs — resets ID counters', () => {
  stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed' }));
  stubs.clearStubs();
  const stub = stubs.registerStub(makeStub('data-exchange.external_service_call.created', { type: 'data-exchange.call.completed' }));
  assert.strictEqual(stub.id, 'external_service_call.created-1');
});

// =============================================================================
// registerHttpStub
// =============================================================================

test('registerHttpStub — assigns human-readable ID from URL last segment', () => {
  const stub = stubs.registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' } , response: {} });
  assert.strictEqual(stub.id, 'http.expedited-screening-1');
});

test('registerHttpStub — increments counter per URL segment', () => {
  const a = stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  const b = stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  assert.strictEqual(a.id, 'http.expedited-screening-1');
  assert.strictEqual(b.id, 'http.expedited-screening-2');
});

test('registerHttpStub — sets type: http on stored stub', () => {
  const stub = stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' }, response: { body: { expedited: true } } });
  assert.strictEqual(stub.type, 'http');
});

test('registerHttpStub — throws when match.url is missing', () => {
  assert.throws(
    () => stubs.registerHttpStub({ match: { method: 'POST' } , response: {} }),
    /match\.url/
  );
});

// =============================================================================
// matchAndPopHttp
// =============================================================================

test('matchAndPopHttp — matches by method and URL', () => {
  stubs.registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' }, response: { body: { expedited: true } } });
  const stub = stubs.matchAndPopHttp('POST', '/evaluate/expedited-screening');
  assert.ok(stub, 'should match');
  assert.deepStrictEqual(stub.response.body, { expedited: true });
});

test('matchAndPopHttp — method matching is case-insensitive', () => {
  stubs.registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' } , response: {} });
  const stub = stubs.matchAndPopHttp('post', '/evaluate/expedited-screening');
  assert.ok(stub);
});

test('matchAndPopHttp — omitting method matches any method', () => {
  stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  const stub = stubs.matchAndPopHttp('GET', '/evaluate/expedited-screening');
  assert.ok(stub);
});

test('matchAndPopHttp — returns null when URL does not match', () => {
  stubs.registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' } , response: {} });
  const stub = stubs.matchAndPopHttp('POST', '/evaluate/determination');
  assert.strictEqual(stub, null);
});

test('matchAndPopHttp — returns null when method does not match', () => {
  stubs.registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' } , response: {} });
  const stub = stubs.matchAndPopHttp('GET', '/evaluate/expedited-screening');
  assert.strictEqual(stub, null);
});

test('matchAndPopHttp — FIFO: consumes stubs in registration order', () => {
  stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' }, response: { body: { expedited: true } } });
  stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' }, response: { body: { expedited: false } } });
  const first = stubs.matchAndPopHttp('POST', '/evaluate/expedited-screening');
  const second = stubs.matchAndPopHttp('POST', '/evaluate/expedited-screening');
  assert.deepStrictEqual(first.response.body, { expedited: true });
  assert.deepStrictEqual(second.response.body, { expedited: false });
});

test('matchAndPopHttp — removes the matched stub', () => {
  stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  stubs.matchAndPopHttp('POST', '/evaluate/expedited-screening');
  assert.strictEqual(stubs.matchAndPopHttp('POST', '/evaluate/expedited-screening'), null);
});

test('matchAndPopHttp — domain + url resolves to /<domain><url> for matching', () => {
  stubs.registerHttpStub({ match: { method: 'POST', domain: 'eligibility-adapter', url: '/evaluate/expedited-screening' } , response: {} });
  const stub = stubs.matchAndPopHttp('POST', '/eligibility-adapter/evaluate/expedited-screening');
  assert.ok(stub, 'should match full path');
});

test('matchAndPopHttp — domain stub does not match without domain prefix in request path', () => {
  stubs.registerHttpStub({ match: { domain: 'eligibility-adapter', url: '/evaluate/expedited-screening' } , response: {} });
  const stub = stubs.matchAndPopHttp('POST', '/evaluate/expedited-screening');
  assert.strictEqual(stub, null, 'should not match path without domain prefix');
});

test('matchAndPopHttp — domain disambiguates same url across domains', () => {
  stubs.registerHttpStub({ match: { domain: 'eligibility-adapter', url: '/evaluate/something' } , response: {} });
  stubs.registerHttpStub({ match: { domain: 'other-adapter', url: '/evaluate/something' } , response: {} });
  const stub = stubs.matchAndPopHttp('POST', '/other-adapter/evaluate/something');
  assert.strictEqual(stub?.match.domain, 'other-adapter', 'should match the other-adapter stub');
  assert.strictEqual(stubs.listHttpStubs().length, 1, 'eligibility-adapter stub should remain');
});

// =============================================================================
// listStubs / listHttpStubs — separate registries
// =============================================================================

test('listStubs — returns only event stubs, not HTTP stubs', () => {
  stubs.registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  assert.strictEqual(stubs.listStubs().length, 1);
});

test('listHttpStubs — returns only HTTP stubs, not event stubs', () => {
  stubs.registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  assert.strictEqual(stubs.listHttpStubs().length, 1);
});

// =============================================================================
// removeHttpStub
// =============================================================================

test('removeHttpStub — removes an HTTP stub by ID and returns true', () => {
  const stub = stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  const result = stubs.removeHttpStub(stub.id);
  assert.strictEqual(result, true);
  assert.strictEqual(stubs.listHttpStubs().length, 0);
});

test('removeHttpStub — returns false for unknown ID', () => {
  const result = stubs.removeHttpStub('nonexistent-id');
  assert.strictEqual(result, false);
});

// =============================================================================
// clearHttpStubs / clearAllStubs
// =============================================================================

test('clearHttpStubs — removes only HTTP stubs, leaves event stubs', () => {
  stubs.registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  stubs.clearHttpStubs();
  assert.strictEqual(stubs.listHttpStubs().length, 0);
  assert.strictEqual(stubs.listStubs().length, 1);
});

test('clearHttpStubs — resets HTTP ID counters', () => {
  stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  stubs.clearHttpStubs();
  const stub = stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  assert.strictEqual(stub.id, 'http.expedited-screening-1');
});

test('clearAllStubs — removes all event and HTTP stubs', () => {
  stubs.registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening' } , response: {} });
  stubs.clearAllStubs();
  assert.strictEqual(stubs.listStubs().length, 0);
  assert.strictEqual(stubs.listHttpStubs().length, 0);
});

console.log('\n✓ All mock-stub-engine tests passed\n');

// ── The two ways a stub used to register and then quietly do nothing ────────

test('registerHttpStub — accepts a stub with no response', () => {
  // A stub intercepting a procedure's create only has to match: the create is
  // suppressed and the response is never read.
  const stub = stubs.registerHttpStub({ match: { method: 'POST', domain: 'eligibility', url: '/evaluate/expedited-screening' } });
  assert.ok(stub.id);
});

test('registerHttpStub — refuses an unknown key rather than ignoring it', () => {
  assert.throws(
    () => stubs.registerHttpStub({ match: { url: '/evaluate/expedited-screening', methd: 'POST' } }),
    /unknown key "match\.methd"/,
  );
});

test('registerStub — refuses an unknown key rather than ignoring it', () => {
  assert.throws(
    () => stubs.registerStub({ on: 'x.y.z', response: { type: 'a.b.c', date: {} } }),
    /unknown key "response\.date"/,
  );
});

test('registerHttpStub — refuses the old "respond" key by name', () => {
  assert.throws(
    () => stubs.registerHttpStub({
      match: { url: '/evaluate/expedited-screening' },
      respond: { status: 418, body: {} },
    }),
    /renamed to "response"/,
  );
});

test('registerStub — refuses the old "respond" key by name', () => {
  assert.throws(
    () => stubs.registerStub({ on: 'x.y.z', respond: { type: 'a.b.c' } }),
    /renamed to "response"/,
  );
});

test('registerHttpStub — refuses a non-integer status', () => {
  assert.throws(
    () => stubs.registerHttpStub({
      match: { url: '/evaluate/expedited-screening' },
      response: { status: '418' },
    }),
    /must be integer/,
  );
});
