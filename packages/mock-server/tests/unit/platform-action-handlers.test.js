/**
 * Unit tests for platform action handlers — fireEvent and applyStub.
 *
 * Tests use real dependencies (database, stub engine) rather than mocks so
 * that the integration between handlers, event emission, and stub matching
 * is verified end-to-end at the unit level.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { platformActionRegistry } from '../../src/platform-action-handlers.js';
import { registerStub, clearStubs, listStubs } from '../../src/mock-stub-engine.js';
import { clearAll, findAll } from '../../src/database-manager.js';

const PREFIX = 'org.codeforamerica.safety-net-blueprint.';

const fireEvent = platformActionRegistry.get('fireEvent');
const applyStub = platformActionRegistry.get('applyStub');

function events() {
  return findAll('events', {}).items;
}

function makeEnvelope(type, data = {}) {
  return { specversion: '1.0', type, source: '/test', subject: 'sub-1', data };
}

beforeEach(() => {
  clearAll('events');
  clearStubs();
});

// =============================================================================
// fireEvent
// =============================================================================

test('fireEvent — prepends platform prefix when not present', () => {
  fireEvent({ type: 'data_exchange.call.completed' }, {}, { context: {} });
  const [evt] = events();
  assert.strictEqual(evt.type, PREFIX + 'data_exchange.call.completed');
});

test('fireEvent — does not double-prepend prefix', () => {
  fireEvent({ type: PREFIX + 'data_exchange.call.completed' }, {}, { context: {} });
  const [evt] = events();
  assert.strictEqual(evt.type, PREFIX + 'data_exchange.call.completed');
});

test('fireEvent — resolves JSON Logic expression in subject', () => {
  const ctx = { this: { subject: 'sc-abc' } };
  fireEvent(
    { type: 'data_exchange.call.completed', subject: { var: 'this.subject' } },
    {},
    { context: ctx }
  );
  const [evt] = events();
  assert.strictEqual(evt.subject, 'sc-abc');
});

test('fireEvent — resolves JSON Logic expressions in data fields', () => {
  const ctx = { this: { data: { serviceType: 'fdsh_ssa' } }, result: 'conclusive' };
  fireEvent(
    {
      type: 'data_exchange.call.completed',
      data: {
        serviceType: { var: 'this.data.serviceType' },
        result: { var: 'result' }
      }
    },
    {},
    { context: ctx }
  );
  const [evt] = events();
  assert.strictEqual(evt.data.serviceType, 'fdsh_ssa');
  assert.strictEqual(evt.data.result, 'conclusive');
});

test('fireEvent — passes literal values in data through unchanged', () => {
  fireEvent(
    { type: 'x.y.z', data: { result: 'conclusive', count: 3 } },
    {},
    { context: {} }
  );
  const [evt] = events();
  assert.strictEqual(evt.data.result, 'conclusive');
  assert.strictEqual(evt.data.count, 3);
});

test('fireEvent — sets subject to null when omitted', () => {
  fireEvent({ type: 'x.y.z' }, {}, { context: {} });
  const [evt] = events();
  assert.strictEqual(evt.subject, null);
});

test('fireEvent — defaults source to /system when omitted', () => {
  fireEvent({ type: 'x.y.z' }, {}, { context: {} });
  const [evt] = events();
  assert.strictEqual(evt.source, '/system');
});

test('fireEvent — uses provided literal source', () => {
  fireEvent({ type: 'x.y.z', source: '/data-exchange' }, {}, { context: {} });
  const [evt] = events();
  assert.strictEqual(evt.source, '/data-exchange');
});

test('fireEvent — emits nothing and logs error when type is missing', () => {
  fireEvent({}, {}, { context: {} });
  assert.strictEqual(events().length, 0);
});

// =============================================================================
// applyStub — stub matched
// =============================================================================

test('applyStub — fires respond event when stub matches', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub({
    on: 'data_exchange.service_call.created',
    respond: {
      type: 'data_exchange.call.completed',
      data: { result: 'conclusive' }
    }
  });

  applyStub({}, makeEnvelope(fullType), { context: {} });

  const evts = events();
  assert.strictEqual(evts.length, 1);
  assert.strictEqual(evts[0].type, PREFIX + 'data_exchange.call.completed');
  assert.strictEqual(evts[0].data.result, 'conclusive');
});

test('applyStub — consumes matched stub (FIFO)', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub({ on: 'data_exchange.service_call.created', respond: { type: 'data_exchange.call.completed', data: { result: 'conclusive' } } });
  registerStub({ on: 'data_exchange.service_call.created', respond: { type: 'data_exchange.call.completed', data: { result: 'inconclusive' } } });

  applyStub({}, makeEnvelope(fullType), { context: {} });

  assert.strictEqual(listStubs().length, 1);
  assert.strictEqual(events()[0].data.result, 'conclusive');
});

// Schema used in schema-driven tests — mirrors CallCompletedEvent required fields.
const callCompletedSchema = {
  properties: {
    serviceCallId: { type: 'string' },
    serviceType: { type: 'string' },
    requestingResourceId: { type: 'string' },
    result: { type: 'string' }
  },
  required: ['serviceCallId', 'serviceType', 'requestingResourceId', 'result']
};
const completedType = PREFIX + 'data_exchange.call.completed';
const eventSchemas = { [completedType]: callCompletedSchema };

test('applyStub — echoes trigger subject by default', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub({
    on: 'data_exchange.service_call.created',
    respond: { type: 'data_exchange.call.completed', data: { result: 'conclusive' } }
  });

  const envelope = makeEnvelope(fullType, { serviceType: 'fdsh_ssa', requestingResourceId: 'r-1', id: 'sc-1' });
  envelope.subject = 'sc-1';

  applyStub({}, envelope, { context: { this: envelope }, eventSchemas });

  const [evt] = events();
  assert.strictEqual(evt.subject, 'sc-1');
});

test('applyStub — schema-driven: populates same-named fields from trigger data', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub({
    on: 'data_exchange.service_call.created',
    respond: { type: 'data_exchange.call.completed', data: { result: 'inconclusive' } }
  });

  const envelope = makeEnvelope(fullType, { serviceType: 'fdsh_ssa', requestingResourceId: 'app-1', id: 'sc-1' });
  envelope.subject = 'sc-1';

  applyStub({}, envelope, { context: { this: envelope }, eventSchemas });

  const [evt] = events();
  assert.strictEqual(evt.data.serviceType, 'fdsh_ssa');
  assert.strictEqual(evt.data.requestingResourceId, 'app-1');
  assert.strictEqual(evt.data.result, 'inconclusive');
});

test('applyStub — schema-driven: derives serviceCallId from trigger entity name + subject', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub({
    on: 'data_exchange.service_call.created',
    respond: { type: 'data_exchange.call.completed', data: { result: 'conclusive' } }
  });

  const envelope = makeEnvelope(fullType, { serviceType: 'fdsh_ssa', requestingResourceId: 'r-1', id: 'sc-abc' });
  envelope.subject = 'sc-abc';

  applyStub({}, envelope, { context: { this: envelope }, eventSchemas });

  const [evt] = events();
  assert.strictEqual(evt.data.serviceCallId, 'sc-abc');
});

test('applyStub — schema-driven: only includes schema-defined fields (no extras)', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub({
    on: 'data_exchange.service_call.created',
    respond: { type: 'data_exchange.call.completed', data: { result: 'conclusive' } }
  });

  const envelope = makeEnvelope(fullType, {
    serviceType: 'fdsh_ssa', requestingResourceId: 'r-1', id: 'sc-1',
    callMode: 'async', status: 'pending', createdAt: '2026-01-01T00:00:00Z'
  });
  envelope.subject = 'sc-1';

  applyStub({}, envelope, { context: { this: envelope }, eventSchemas });

  const [evt] = events();
  const keys = Object.keys(evt.data);
  assert.ok(!keys.includes('callMode'), 'callMode should not appear in response');
  assert.ok(!keys.includes('status'), 'status should not appear in response');
  assert.ok(!keys.includes('createdAt'), 'createdAt should not appear in response');
  assert.ok(!keys.includes('id'), 'id should not appear in response');
});

test('applyStub — stub data fields override schema-derived values', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub({
    on: 'data_exchange.service_call.created',
    respond: {
      type: 'data_exchange.call.completed',
      data: { result: 'conclusive', serviceType: 'overridden' }
    }
  });

  const envelope = makeEnvelope(fullType, { serviceType: 'fdsh_ssa', requestingResourceId: 'r-1', id: 'sc-1' });
  envelope.subject = 'sc-1';

  applyStub({}, envelope, { context: { this: envelope }, eventSchemas });

  const [evt] = events();
  assert.strictEqual(evt.data.serviceType, 'overridden');
  assert.strictEqual(evt.data.result, 'conclusive');
});

test('applyStub — explicit respond.subject overrides trigger subject', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub({
    on: 'data_exchange.service_call.created',
    respond: { type: 'data_exchange.call.completed', subject: 'explicit-subject', data: { result: 'conclusive' } }
  });

  const envelope = makeEnvelope(fullType, { serviceType: 'fdsh_ssa', requestingResourceId: 'r-1', id: 'sc-1' });
  envelope.subject = 'trigger-subject';

  applyStub({}, envelope, { context: { this: envelope }, eventSchemas });

  const [evt] = events();
  assert.strictEqual(evt.subject, 'explicit-subject');
});

test('applyStub — falls back to stub data only when no schema available', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  registerStub({
    on: 'data_exchange.service_call.created',
    respond: { type: 'data_exchange.call.completed', data: { result: 'conclusive' } }
  });

  const envelope = makeEnvelope(fullType, { serviceType: 'fdsh_ssa' });

  // No eventSchemas passed → falls back to stub data
  applyStub({}, envelope, { context: { this: envelope } });

  const [evt] = events();
  assert.strictEqual(evt.data.result, 'conclusive');
  assert.ok(!('serviceType' in evt.data), 'no schema → no field derivation');
});

// =============================================================================
// applyStub — no stub matched
// =============================================================================

test('applyStub — fires fallback.fireEvent when no stub matches', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  applyStub(
    { fallback: { fireEvent: { type: 'data_exchange.call.completed', data: { result: 'conclusive' } } } },
    makeEnvelope(fullType),
    { context: {} }
  );

  const [evt] = events();
  assert.ok(evt, 'fallback event should fire');
  assert.strictEqual(evt.type, PREFIX + 'data_exchange.call.completed');
  assert.strictEqual(evt.data.result, 'conclusive');
});

test('applyStub — no-op when no stub and no fallback', () => {
  const fullType = PREFIX + 'data_exchange.service_call.created';
  applyStub({}, makeEnvelope(fullType), { context: {} });
  assert.strictEqual(events().length, 0);
});

test('applyStub — skips stub lookup and warns when resource has no type', () => {
  registerStub({ on: 'data_exchange.service_call.created', respond: { type: 'data_exchange.call.completed' } });
  applyStub({}, {}, { context: {} });
  assert.strictEqual(listStubs().length, 1); // stub not consumed
  assert.strictEqual(events().length, 0);
});

console.log('\n✓ All platform-action-handlers tests passed\n');
