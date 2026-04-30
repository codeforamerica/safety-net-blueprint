/**
 * Unit tests for emitEvent utility
 * Tests CloudEvents envelope construction and persistence
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { emitEvent, emitEventEnvelope } from '../../src/emit-event.js';
import { findAll, clearAll } from '../../src/database-manager.js';

test('emitEvent', async (t) => {

  // ==========================================================================
  // Envelope structure
  // ==========================================================================

  await t.test('produces a valid CloudEvents 1.0 envelope', () => {
    clearAll('events');
    const stored = emitEvent({
      domain: 'workflow',
      object: 'task',
      action: 'created',
      resourceId: 'abc123',
      source: '/workflow',
      data: { status: 'pending' },
      callerId: 'user-1',
      traceparent: null,
      now: '2024-01-01T00:00:00.000Z',
    });

    assert.strictEqual(stored.specversion, '1.0');
    assert.match(stored.type, /^org\.codeforamerica\.safety-net-blueprint\./);
    assert.strictEqual(stored.type, 'org.codeforamerica.safety-net-blueprint.workflow.task.created');
    assert.strictEqual(stored.source, '/workflow');
    assert.strictEqual(stored.subject, 'abc123');
    assert.strictEqual(stored.time, '2024-01-01T00:00:00.000Z');
    assert.strictEqual(stored.datacontenttype, 'application/json');
    assert.ok(stored.id, 'Should have a generated UUID');
    console.log('  ✓ Produces valid CloudEvents 1.0 envelope');
  });

  await t.test('derives type from domain + object + action', () => {
    clearAll('events');
    const stored = emitEvent({
      domain: 'intake',
      object: 'application',
      action: 'submitted',
      resourceId: 'res-1',
      source: '/intake',
      data: null,
      now: '2024-01-01T00:00:00.000Z',
    });

    assert.strictEqual(stored.type, 'org.codeforamerica.safety-net-blueprint.intake.application.submitted');
    console.log('  ✓ Derives type from domain + object + action');
  });

  await t.test('generates a unique id for each event', () => {
    clearAll('events');
    const e1 = emitEvent({ domain: 'x', object: 'y', action: 'z', resourceId: '1', source: '/x', data: null, now: '2024-01-01T00:00:00.000Z' });
    const e2 = emitEvent({ domain: 'x', object: 'y', action: 'z', resourceId: '1', source: '/x', data: null, now: '2024-01-01T00:00:00.000Z' });

    assert.notStrictEqual(e1.id, e2.id);
    console.log('  ✓ Generates a unique id for each event');
  });

  // ==========================================================================
  // Traceparent propagation
  // ==========================================================================

  await t.test('includes traceparent when provided', () => {
    clearAll('events');
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const stored = emitEvent({
      domain: 'workflow',
      object: 'task',
      action: 'claimed',
      resourceId: 'abc123',
      source: '/workflow',
      data: { assignedToId: 'user-1' },
      callerId: 'user-1',
      traceparent,
      now: '2024-01-01T00:00:00.000Z',
    });

    assert.strictEqual(stored.traceparent, traceparent);
    console.log('  ✓ Includes traceparent when provided');
  });

  await t.test('sets traceparent to null when not provided', () => {
    clearAll('events');
    const stored = emitEvent({
      domain: 'workflow',
      object: 'task',
      action: 'created',
      resourceId: 'abc123',
      source: '/workflow',
      data: null,
      now: '2024-01-01T00:00:00.000Z',
    });

    assert.strictEqual(stored.traceparent, null);
    console.log('  ✓ Sets traceparent to null when not provided');
  });

  // ==========================================================================
  // Persistence
  // ==========================================================================

  await t.test('persists event to the events collection', () => {
    clearAll('events');
    const stored = emitEvent({
      domain: 'workflow',
      object: 'task',
      action: 'created',
      resourceId: 'abc123',
      source: '/workflow',
      data: { status: 'pending' },
      now: '2024-01-01T00:00:00.000Z',
    });

    const result = findAll('events', {});
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].id, stored.id);
    console.log('  ✓ Persists event to the events collection');
  });

  await t.test('multiple calls produce multiple stored events', () => {
    clearAll('events');
    emitEvent({ domain: 'a', object: 'b', action: 'c', resourceId: '1', source: '/a', data: null, now: '2024-01-01T00:00:00.000Z' });
    emitEvent({ domain: 'a', object: 'b', action: 'd', resourceId: '1', source: '/a', data: null, now: '2024-01-01T00:00:00.000Z' });

    const result = findAll('events', {});
    assert.strictEqual(result.items.length, 2);
    console.log('  ✓ Multiple calls produce multiple stored events');
  });

  // ==========================================================================
  // Data payload
  // ==========================================================================

  await t.test('stores null data when not provided', () => {
    clearAll('events');
    const stored = emitEvent({
      domain: 'workflow',
      object: 'task',
      action: 'deleted',
      resourceId: 'abc123',
      source: '/workflow',
      data: null,
      now: '2024-01-01T00:00:00.000Z',
    });

    assert.strictEqual(stored.data, null);
    console.log('  ✓ Stores null data when not provided');
  });

  await t.test('stores event payload in data field', () => {
    clearAll('events');
    const payload = { outcome: 'approved', notes: 'looks good' };
    const stored = emitEvent({
      domain: 'workflow',
      object: 'task',
      action: 'completed',
      resourceId: 'abc123',
      source: '/workflow',
      data: payload,
      now: '2024-01-01T00:00:00.000Z',
    });

    assert.deepStrictEqual(stored.data, payload);
    console.log('  ✓ Stores event payload in data field');
  });

  // ==========================================================================
  // emitEventEnvelope — pre-built envelope injection
  // ==========================================================================

  await t.test('emitEventEnvelope - stores and returns a pre-built envelope', () => {
    clearAll('events');
    const stored = emitEventEnvelope({
      specversion: '1.0',
      type: 'org.codeforamerica.safety-net-blueprint.intake.interview.completed',
      source: '/intake',
      subject: 'interview-1',
      time: '2026-04-15T10:00:00.000Z',
      data: { completedAt: '2026-04-15T10:00:00.000Z' },
    });

    assert.strictEqual(stored.specversion, '1.0');
    assert.strictEqual(stored.type, 'org.codeforamerica.safety-net-blueprint.intake.interview.completed');
    assert.strictEqual(stored.subject, 'interview-1');
    assert.strictEqual(stored.time, '2026-04-15T10:00:00.000Z');
    assert.ok(stored.id, 'Should have a generated id');
    console.log('  ✓ emitEventEnvelope stores and returns pre-built envelope');
  });

  await t.test('emitEventEnvelope - persists to events collection', () => {
    clearAll('events');
    const stored = emitEventEnvelope({
      specversion: '1.0',
      type: 'intake.interview.completed',
      source: '/intake',
      subject: 'interview-2',
      data: null,
    });

    const result = findAll('events', {});
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].id, stored.id);
    console.log('  ✓ emitEventEnvelope persists to events collection');
  });

  await t.test('emitEventEnvelope - preserves provided id', () => {
    clearAll('events');
    const stored = emitEventEnvelope({
      specversion: '1.0',
      type: 'intake.interview.completed',
      source: '/intake',
      subject: 'interview-3',
      id: 'my-explicit-id',
      data: null,
    });

    assert.strictEqual(stored.id, 'my-explicit-id');
    console.log('  ✓ emitEventEnvelope preserves provided id');
  });

  await t.test('emitEventEnvelope - generates id when not provided', () => {
    clearAll('events');
    const stored = emitEventEnvelope({
      specversion: '1.0',
      type: 'intake.interview.completed',
      source: '/intake',
      subject: 'interview-4',
      data: null,
    });

    assert.ok(stored.id && stored.id.length > 0, 'Should generate an id');
    console.log('  ✓ emitEventEnvelope generates id when not provided');
  });

  await t.test('emitEventEnvelope - defaults specversion and datacontenttype', () => {
    clearAll('events');
    const stored = emitEventEnvelope({
      type: 'intake.interview.completed',
      source: '/intake',
      subject: 'interview-5',
      data: null,
    });

    assert.strictEqual(stored.specversion, '1.0');
    assert.strictEqual(stored.datacontenttype, 'application/json');
    console.log('  ✓ emitEventEnvelope defaults specversion and datacontenttype');
  });

  // ==========================================================================
  // Default now
  // ==========================================================================

  await t.test('defaults time to current timestamp when now is not provided', () => {
    clearAll('events');
    const before = new Date().toISOString();
    const stored = emitEvent({
      domain: 'workflow',
      object: 'task',
      action: 'created',
      resourceId: 'abc123',
      source: '/workflow',
      data: null,
    });
    const after = new Date().toISOString();

    assert.ok(stored.time >= before && stored.time <= after, 'time should be current timestamp');
    console.log('  ✓ Defaults time to current timestamp when now not provided');
  });

});

console.log('\n✓ All emitEvent tests passed\n');
