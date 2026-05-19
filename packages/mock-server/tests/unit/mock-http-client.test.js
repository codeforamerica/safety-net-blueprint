/**
 * Unit tests for mock-http-client
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { callHttp } from '../../src/mock-http-client.js';
import { registerHttpStub, clearStubs } from '../../src/mock-stub-engine.js';

beforeEach(() => clearStubs());

test('callHttp — returns stub response when stub is registered', async () => {
  registerHttpStub({
    match: { method: 'POST', url: '/evaluate/expedited-screening' },
    response: { status: 200, body: { expedited: true } },
  });
  const result = await callHttp('POST', '/evaluate/expedited-screening');
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body, { expedited: true });
});

test('callHttp — normalizes full URL to path for stub matching', async () => {
  registerHttpStub({
    match: { method: 'POST', url: '/evaluate/expedited-screening' },
    response: { body: { expedited: false } },
  });
  const result = await callHttp('POST', 'http://adapter.example.com/evaluate/expedited-screening');
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body, { expedited: false });
});

test('callHttp — returns 501 when no stub is registered', async () => {
  const result = await callHttp('POST', '/evaluate/expedited-screening');
  assert.strictEqual(result.status, 501);
  assert.strictEqual(result.body.code, 'NOT_IMPLEMENTED');
  assert.ok(result.body.message.includes('/evaluate/expedited-screening'));
});

test('callHttp — 501 message includes method and path', async () => {
  const result = await callHttp('POST', 'http://adapter.example.com/evaluate/determination');
  assert.ok(result.body.message.includes('POST'));
  assert.ok(result.body.message.includes('/evaluate/determination'));
});

test('callHttp — stub is consumed after match', async () => {
  registerHttpStub({
    match: { url: '/evaluate/expedited-screening' },
    response: { body: { expedited: true } },
  });
  await callHttp('POST', '/evaluate/expedited-screening');
  const second = await callHttp('POST', '/evaluate/expedited-screening');
  assert.strictEqual(second.status, 501);
});
