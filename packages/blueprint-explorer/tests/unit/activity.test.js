import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, logRequest, clearActivity } from '../../src/try-it/activity.js';

const stored = new Map();
globalThis.sessionStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const where = { scope: 'file:///site/mock/' };

test('the requests Try it sent are kept for the tab, in order, until cleared', () => {
  assert.deepEqual(activityOf(where), { requests: [], clearedAt: null });
  logRequest(where, { time: '2026-11-22T10:00:00Z', method: 'POST', path: '/intake/applications', status: 201, ok: true, eventIds: ['e1'] });
  logRequest(where, { time: '2026-11-22T10:00:01Z', method: 'GET', path: '/intake/applications', status: 200, ok: true });
  assert.deepEqual(activityOf(where).requests.map((r) => r.method), ['POST', 'GET']);
  clearActivity(where);
  const cleared = activityOf(where);
  assert.deepEqual(cleared.requests, []);
  assert.ok(cleared.clearedAt, 'events from before the clear are hidden');
  assert.deepEqual(activityOf({ scope: 'file:///other/mock/' }).requests, [], 'another explorer keeps its own');
});
