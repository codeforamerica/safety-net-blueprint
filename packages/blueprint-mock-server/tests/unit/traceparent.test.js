/**
 * The trace a request's events carry: the caller's when it sent one, otherwise
 * one the request starts, shared by everything that request causes.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { traceparentOf } from '../../src/auth-context.js';

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

test('traceparentOf — keeps the trace the caller sent', () => {
  const sent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const request = new Request('http://localhost/x', { headers: { traceparent: sent } });
  assert.strictEqual(traceparentOf(request), sent);
});

test('traceparentOf — starts a trace when the caller sent none', () => {
  assert.match(traceparentOf(new Request('http://localhost/x')), TRACEPARENT);
});

test('traceparentOf — one request starts one trace, however often it is asked', () => {
  const request = new Request('http://localhost/x');
  assert.strictEqual(traceparentOf(request), traceparentOf(request));
});

test('traceparentOf — two requests start two traces', () => {
  assert.notStrictEqual(traceparentOf(new Request('http://localhost/x')), traceparentOf(new Request('http://localhost/x')));
});
