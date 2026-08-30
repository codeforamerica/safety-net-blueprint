/**
 * Unit tests for the relative-time token resolver
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { resolveTimeToken, resolveTimeTokens } from '../../src/time-tokens.js';

const T = new Date('2025-06-01T12:00:00.000Z');

// =============================================================================
// resolveTimeToken — basic tokens
// =============================================================================

test('resolveTimeToken — $now returns reference instant', () => {
  assert.strictEqual(resolveTimeToken('$now', T), '2025-06-01T12:00:00.000Z');
});

test('resolveTimeToken — $now-30d subtracts 30 days', () => {
  assert.strictEqual(resolveTimeToken('$now-30d', T), '2025-05-02T12:00:00.000Z');
});

test('resolveTimeToken — $now+7d adds 7 days', () => {
  assert.strictEqual(resolveTimeToken('$now+7d', T), '2025-06-08T12:00:00.000Z');
});

test('resolveTimeToken — $now+8h adds 8 hours', () => {
  assert.strictEqual(resolveTimeToken('$now+8h', T), '2025-06-01T20:00:00.000Z');
});

test('resolveTimeToken — $now-2h subtracts 2 hours', () => {
  assert.strictEqual(resolveTimeToken('$now-2h', T), '2025-06-01T10:00:00.000Z');
});

test('resolveTimeToken — $now+1w adds 7 days', () => {
  assert.strictEqual(resolveTimeToken('$now+1w', T), '2025-06-08T12:00:00.000Z');
});

test('resolveTimeToken — $now+90m adds 90 minutes', () => {
  assert.strictEqual(resolveTimeToken('$now+90m', T), '2025-06-01T13:30:00.000Z');
});

// =============================================================================
// resolveTimeToken — @HH:MM time-of-day pin
// =============================================================================

test('resolveTimeToken — $now@09:30 pins time-of-day in local time', () => {
  const result = resolveTimeToken('$now@09:30', T);
  const parsed = new Date(result);
  assert.strictEqual(parsed.getHours(), 9);
  assert.strictEqual(parsed.getMinutes(), 30);
  assert.strictEqual(parsed.getSeconds(), 0);
});

test('resolveTimeToken — $now+2d@09:30 offsets then pins time-of-day', () => {
  const result = resolveTimeToken('$now+2d@09:30', T);
  const parsed = new Date(result);
  // Date should be 2 days after T
  const expected = new Date(T.getTime() + 2 * 86400000);
  assert.strictEqual(parsed.getFullYear(), expected.getFullYear());
  assert.strictEqual(parsed.getMonth(), expected.getMonth());
  assert.strictEqual(parsed.getDate(), expected.getDate());
  // Time-of-day should be 09:30 local
  assert.strictEqual(parsed.getHours(), 9);
  assert.strictEqual(parsed.getMinutes(), 30);
  assert.strictEqual(parsed.getSeconds(), 0);
});

test('resolveTimeToken — @HH:MM accepts single-digit hour', () => {
  const result = resolveTimeToken('$now@9:00', T);
  const parsed = new Date(result);
  assert.strictEqual(parsed.getHours(), 9);
  assert.strictEqual(parsed.getMinutes(), 0);
});

// =============================================================================
// resolveTimeToken — pass-through for non-tokens
// =============================================================================

test('resolveTimeToken — literal string passes through', () => {
  assert.strictEqual(resolveTimeToken('hello', T), 'hello');
});

test('resolveTimeToken — ISO timestamp string passes through', () => {
  const ts = '2024-01-15T09:30:00.000Z';
  assert.strictEqual(resolveTimeToken(ts, T), ts);
});

test('resolveTimeToken — $object.field passes through', () => {
  assert.strictEqual(resolveTimeToken('$object.id', T), '$object.id');
});

test('resolveTimeToken — $nowish passes through (not a time token)', () => {
  assert.strictEqual(resolveTimeToken('$nowish', T), '$nowish');
});

test('resolveTimeToken — $now.field passes through (entity alias syntax)', () => {
  assert.strictEqual(resolveTimeToken('$now.field', T), '$now.field');
});

test('resolveTimeToken — number passes through', () => {
  assert.strictEqual(resolveTimeToken(42, T), 42);
});

test('resolveTimeToken — null passes through', () => {
  assert.strictEqual(resolveTimeToken(null, T), null);
});

// =============================================================================
// resolveTimeToken — error on malformed tokens
// =============================================================================

test('resolveTimeToken — $now+7dasys throws', () => {
  assert.throws(
    () => resolveTimeToken('$now+7dasys', T),
    /Invalid time token/
  );
});

test('resolveTimeToken — $now+d throws (missing amount)', () => {
  assert.throws(
    () => resolveTimeToken('$now+d', T),
    /Invalid time token/
  );
});

test('resolveTimeToken — $now-30x throws (unknown unit)', () => {
  assert.throws(
    () => resolveTimeToken('$now-30x', T),
    /Invalid time token/
  );
});

// =============================================================================
// resolveTimeTokens — recursive walk
// =============================================================================

test('resolveTimeTokens — resolves tokens in object values', () => {
  const result = resolveTimeTokens({ dueAt: '$now+7d', status: 'pending' }, T);
  assert.strictEqual(result.dueAt, '2025-06-08T12:00:00.000Z');
  assert.strictEqual(result.status, 'pending');
});

test('resolveTimeTokens — resolves tokens in nested objects', () => {
  const result = resolveTimeTokens({ sla: { deadline: '$now+30d' } }, T);
  assert.strictEqual(result.sla.deadline, '2025-07-01T12:00:00.000Z');
});

test('resolveTimeTokens — resolves tokens in arrays', () => {
  const result = resolveTimeTokens(['$now-1d', 'literal', '$now+1d'], T);
  assert.strictEqual(result[0], '2025-05-31T12:00:00.000Z');
  assert.strictEqual(result[1], 'literal');
  assert.strictEqual(result[2], '2025-06-02T12:00:00.000Z');
});

test('resolveTimeTokens — all tokens see the same reference instant', () => {
  const result = resolveTimeTokens({ a: '$now', b: '$now', c: '$now+0d' }, T);
  assert.strictEqual(result.a, result.b);
  assert.strictEqual(result.a, result.c);
});

test('resolveTimeTokens — non-object scalars pass through', () => {
  assert.strictEqual(resolveTimeTokens(42, T), 42);
  assert.strictEqual(resolveTimeTokens(true, T), true);
  assert.strictEqual(resolveTimeTokens(null, T), null);
});

test('resolveTimeTokens — throws on malformed token in nested object', () => {
  assert.throws(
    () => resolveTimeTokens({ bad: '$now+7dasys' }, T),
    /Invalid time token/
  );
});
