/**
 * Unit tests for mock-stub-engine
 * Tests registration, ID generation, FIFO matching, field filtering,
 * removal, and clearing.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  registerStub,
  matchAndPop,
  registerHttpStub,
  matchAndPopHttp,
  listStubs,
  listHttpStubs,
  removeStub,
  removeHttpStub,
  clearStubs,
  clearHttpStubs,
  clearAllStubs,
} from '../../src/mock-stub-engine.js';

const PREFIX = 'org.codeforamerica.safety-net-blueprint.';

function makeStub(on, respond, match) {
  return match ? { on, match, respond } : { on, respond };
}

function makeEnvelope(type, data = {}) {
  return { specversion: '1.0', type, source: '/test', subject: 'sub-1', data };
}

beforeEach(() => clearAllStubs());

// =============================================================================
// registerStub
// =============================================================================

test('registerStub — assigns human-readable ID from on suffix', () => {
  const stub = registerStub(makeStub(
    'data_exchange.service_call.created',
    { type: 'data_exchange.call.completed' }
  ));
  assert.strictEqual(stub.id, 'service_call.created-1');
});

test('registerStub — increments counter per suffix', () => {
  const a = registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed' }));
  const b = registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed' }));
  assert.strictEqual(a.id, 'service_call.created-1');
  assert.strictEqual(b.id, 'service_call.created-2');
});

test('registerStub — different suffixes use independent counters', () => {
  const a = registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed' }));
  const b = registerStub(makeStub('data_exchange.call.completed', { type: 'intake.application.submitted' }));
  assert.strictEqual(a.id, 'service_call.created-1');
  assert.strictEqual(b.id, 'call.completed-1');
});

test('registerStub — accepts full CloudEvents type prefix in on field', () => {
  const stub = registerStub(makeStub(
    PREFIX + 'data_exchange.service_call.created',
    { type: 'data_exchange.call.completed' }
  ));
  assert.ok(stub.id.startsWith('service_call.created-'));
});

test('registerStub — throws when on is missing', () => {
  assert.throws(
    () => registerStub({ respond: { type: 'x.y.z' } }),
    /on/
  );
});

test('registerStub — throws when respond is present but missing type', () => {
  assert.throws(
    () => registerStub({ on: 'data_exchange.service_call.created', respond: {} }),
    /respond/
  );
});

test('registerStub — allows stub without respond (timer stub format)', () => {
  const stub = registerStub({ on: 'scheduling.timer.requested' });
  assert.ok(stub.id);
  assert.strictEqual(stub.respond, undefined);
});

// =============================================================================
// matchAndPop — type matching
// =============================================================================

test('matchAndPop — matches by short suffix form', () => {
  registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed' }));
  const fullType = PREFIX + 'data_exchange.service_call.created';
  const stub = matchAndPop(fullType, makeEnvelope(fullType));
  assert.ok(stub, 'should match');
  assert.strictEqual(listStubs().length, 0);
});

test('matchAndPop — matches by full type in on field', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub(makeStub(fullType, { type: 'data_exchange.call.completed' }));
  const stub = matchAndPop(fullType, makeEnvelope(fullType));
  assert.ok(stub);
});

test('matchAndPop — returns null when no stub registered', () => {
  const result = matchAndPop(PREFIX + 'data_exchange.service_call.created', makeEnvelope(PREFIX + 'data_exchange.service_call.created'));
  assert.strictEqual(result, null);
});

test('matchAndPop — returns null when type does not match', () => {
  registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed' }));
  const result = matchAndPop(PREFIX + 'intake.application.submitted', makeEnvelope(PREFIX + 'intake.application.submitted'));
  assert.strictEqual(result, null);
  assert.strictEqual(listStubs().length, 1);
});

// =============================================================================
// matchAndPop — FIFO ordering
// =============================================================================

test('matchAndPop — pops first matching stub (FIFO)', () => {
  const a = registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed', data: { result: 'conclusive' } }));
  const b = registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed', data: { result: 'inconclusive' } }));
  const fullType = PREFIX + 'data_exchange.service_call.created';
  const first = matchAndPop(fullType, makeEnvelope(fullType));
  assert.strictEqual(first.id, a.id);
  assert.strictEqual(listStubs().length, 1);
  assert.strictEqual(listStubs()[0].id, b.id);
});

test('matchAndPop — second pop returns second stub', () => {
  registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed', data: { result: 'conclusive' } }));
  const b = registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed', data: { result: 'inconclusive' } }));
  const fullType = PREFIX + 'data_exchange.service_call.created';
  matchAndPop(fullType, makeEnvelope(fullType));
  const second = matchAndPop(fullType, makeEnvelope(fullType));
  assert.strictEqual(second.id, b.id);
  assert.strictEqual(listStubs().length, 0);
});

// =============================================================================
// matchAndPop — field match filtering
// =============================================================================

test('matchAndPop — matches when all match criteria satisfied', () => {
  registerStub(makeStub(
    'data_exchange.service_call.created',
    { type: 'data_exchange.call.completed' },
    { 'data.serviceType': 'fdsh_ssa' }
  ));
  const fullType = PREFIX + 'data_exchange.service_call.created';
  const stub = matchAndPop(fullType, makeEnvelope(fullType, { serviceType: 'fdsh_ssa' }));
  assert.ok(stub);
});

test('matchAndPop — skips stub when match criteria not satisfied', () => {
  registerStub(makeStub(
    'data_exchange.service_call.created',
    { type: 'data_exchange.call.completed' },
    { 'data.serviceType': 'fdsh_ssa' }
  ));
  const fullType = PREFIX + 'data_exchange.service_call.created';
  const stub = matchAndPop(fullType, makeEnvelope(fullType, { serviceType: 'save' }));
  assert.strictEqual(stub, null);
  assert.strictEqual(listStubs().length, 1);
});

test('matchAndPop — skips non-matching stub and returns next matching one', () => {
  registerStub(makeStub(
    'data_exchange.service_call.created',
    { type: 'data_exchange.call.completed', data: { result: 'inconclusive' } },
    { 'data.serviceType': 'fdsh_ssa' }
  ));
  const b = registerStub(makeStub(
    'data_exchange.service_call.created',
    { type: 'data_exchange.call.completed', data: { result: 'conclusive' } }
    // no match filter — matches any
  ));
  const fullType = PREFIX + 'data_exchange.service_call.created';
  const stub = matchAndPop(fullType, makeEnvelope(fullType, { serviceType: 'save' }));
  assert.strictEqual(stub.id, b.id);
  assert.strictEqual(listStubs().length, 1);
});

test('matchAndPop — empty match object matches any event of that type', () => {
  registerStub(makeStub(
    'data_exchange.service_call.created',
    { type: 'data_exchange.call.completed' },
    {}
  ));
  const fullType = PREFIX + 'data_exchange.service_call.created';
  const stub = matchAndPop(fullType, makeEnvelope(fullType, { serviceType: 'save' }));
  assert.ok(stub);
});

// =============================================================================
// listStubs
// =============================================================================

test('listStubs — returns empty array when no stubs registered', () => {
  assert.deepStrictEqual(listStubs(), []);
});

test('listStubs — returns snapshot of all registered stubs', () => {
  registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  registerStub(makeStub('a.b.c', { type: 'd.e.g' }));
  assert.strictEqual(listStubs().length, 2);
});

test('listStubs — returns a copy (mutations do not affect registry)', () => {
  registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  const list = listStubs();
  list.pop();
  assert.strictEqual(listStubs().length, 1);
});

// =============================================================================
// removeStub
// =============================================================================

test('removeStub — removes a stub by ID and returns true', () => {
  const stub = registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  const result = removeStub(stub.id);
  assert.strictEqual(result, true);
  assert.strictEqual(listStubs().length, 0);
});

test('removeStub — returns false for unknown ID', () => {
  const result = removeStub('nonexistent-id');
  assert.strictEqual(result, false);
});

test('removeStub — removes only the targeted stub', () => {
  const a = registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  const b = registerStub(makeStub('a.b.c', { type: 'd.e.g' }));
  removeStub(a.id);
  assert.strictEqual(listStubs().length, 1);
  assert.strictEqual(listStubs()[0].id, b.id);
});

// =============================================================================
// clearStubs
// =============================================================================

test('clearStubs — removes all stubs', () => {
  registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  registerStub(makeStub('a.b.c', { type: 'd.e.g' }));
  clearStubs();
  assert.strictEqual(listStubs().length, 0);
});

test('clearStubs — resets ID counters', () => {
  registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed' }));
  clearStubs();
  const stub = registerStub(makeStub('data_exchange.service_call.created', { type: 'data_exchange.call.completed' }));
  assert.strictEqual(stub.id, 'service_call.created-1');
});

// =============================================================================
// registerHttpStub
// =============================================================================

test('registerHttpStub — assigns human-readable ID from URL last segment', () => {
  const stub = registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' } });
  assert.strictEqual(stub.id, 'http.expedited-screening-1');
});

test('registerHttpStub — increments counter per URL segment', () => {
  const a = registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  const b = registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  assert.strictEqual(a.id, 'http.expedited-screening-1');
  assert.strictEqual(b.id, 'http.expedited-screening-2');
});

test('registerHttpStub — sets type: http on stored stub', () => {
  const stub = registerHttpStub({ match: { url: '/evaluate/expedited-screening' }, response: { body: { expedited: true } } });
  assert.strictEqual(stub.type, 'http');
});

test('registerHttpStub — throws when match.url is missing', () => {
  assert.throws(
    () => registerHttpStub({ match: { method: 'POST' } }),
    /match\.url/
  );
});

// =============================================================================
// matchAndPopHttp
// =============================================================================

test('matchAndPopHttp — matches by method and URL', () => {
  registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' }, response: { body: { expedited: true } } });
  const stub = matchAndPopHttp('POST', '/evaluate/expedited-screening');
  assert.ok(stub, 'should match');
  assert.deepStrictEqual(stub.response.body, { expedited: true });
});

test('matchAndPopHttp — method matching is case-insensitive', () => {
  registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' } });
  const stub = matchAndPopHttp('post', '/evaluate/expedited-screening');
  assert.ok(stub);
});

test('matchAndPopHttp — omitting method matches any method', () => {
  registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  const stub = matchAndPopHttp('GET', '/evaluate/expedited-screening');
  assert.ok(stub);
});

test('matchAndPopHttp — returns null when URL does not match', () => {
  registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' } });
  const stub = matchAndPopHttp('POST', '/evaluate/determination');
  assert.strictEqual(stub, null);
});

test('matchAndPopHttp — returns null when method does not match', () => {
  registerHttpStub({ match: { method: 'POST', url: '/evaluate/expedited-screening' } });
  const stub = matchAndPopHttp('GET', '/evaluate/expedited-screening');
  assert.strictEqual(stub, null);
});

test('matchAndPopHttp — FIFO: consumes stubs in registration order', () => {
  registerHttpStub({ match: { url: '/evaluate/expedited-screening' }, response: { body: { expedited: true } } });
  registerHttpStub({ match: { url: '/evaluate/expedited-screening' }, response: { body: { expedited: false } } });
  const first = matchAndPopHttp('POST', '/evaluate/expedited-screening');
  const second = matchAndPopHttp('POST', '/evaluate/expedited-screening');
  assert.deepStrictEqual(first.response.body, { expedited: true });
  assert.deepStrictEqual(second.response.body, { expedited: false });
});

test('matchAndPopHttp — removes the matched stub', () => {
  registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  matchAndPopHttp('POST', '/evaluate/expedited-screening');
  assert.strictEqual(matchAndPopHttp('POST', '/evaluate/expedited-screening'), null);
});

test('matchAndPopHttp — domain + url resolves to /<domain><url> for matching', () => {
  registerHttpStub({ match: { method: 'POST', domain: 'eligibility-adapter', url: '/evaluate/expedited-screening' } });
  const stub = matchAndPopHttp('POST', '/eligibility-adapter/evaluate/expedited-screening');
  assert.ok(stub, 'should match full path');
});

test('matchAndPopHttp — domain stub does not match without domain prefix in request path', () => {
  registerHttpStub({ match: { domain: 'eligibility-adapter', url: '/evaluate/expedited-screening' } });
  const stub = matchAndPopHttp('POST', '/evaluate/expedited-screening');
  assert.strictEqual(stub, null, 'should not match path without domain prefix');
});

test('matchAndPopHttp — domain disambiguates same url across domains', () => {
  registerHttpStub({ match: { domain: 'eligibility-adapter', url: '/evaluate/something' } });
  registerHttpStub({ match: { domain: 'other-adapter', url: '/evaluate/something' } });
  const stub = matchAndPopHttp('POST', '/other-adapter/evaluate/something');
  assert.strictEqual(stub?.match.domain, 'other-adapter', 'should match the other-adapter stub');
  assert.strictEqual(listHttpStubs().length, 1, 'eligibility-adapter stub should remain');
});

// =============================================================================
// listStubs / listHttpStubs — separate registries
// =============================================================================

test('listStubs — returns only event stubs, not HTTP stubs', () => {
  registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  assert.strictEqual(listStubs().length, 1);
});

test('listHttpStubs — returns only HTTP stubs, not event stubs', () => {
  registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  assert.strictEqual(listHttpStubs().length, 1);
});

// =============================================================================
// removeHttpStub
// =============================================================================

test('removeHttpStub — removes an HTTP stub by ID and returns true', () => {
  const stub = registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  const result = removeHttpStub(stub.id);
  assert.strictEqual(result, true);
  assert.strictEqual(listHttpStubs().length, 0);
});

test('removeHttpStub — returns false for unknown ID', () => {
  const result = removeHttpStub('nonexistent-id');
  assert.strictEqual(result, false);
});

// =============================================================================
// clearHttpStubs / clearAllStubs
// =============================================================================

test('clearHttpStubs — removes only HTTP stubs, leaves event stubs', () => {
  registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  clearHttpStubs();
  assert.strictEqual(listHttpStubs().length, 0);
  assert.strictEqual(listStubs().length, 1);
});

test('clearHttpStubs — resets HTTP ID counters', () => {
  registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  clearHttpStubs();
  const stub = registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  assert.strictEqual(stub.id, 'http.expedited-screening-1');
});

test('clearAllStubs — removes all event and HTTP stubs', () => {
  registerStub(makeStub('a.b.c', { type: 'd.e.f' }));
  registerHttpStub({ match: { url: '/evaluate/expedited-screening' } });
  clearAllStubs();
  assert.strictEqual(listStubs().length, 0);
  assert.strictEqual(listHttpStubs().length, 0);
});

console.log('\n✓ All mock-stub-engine tests passed\n');
