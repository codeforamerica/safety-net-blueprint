/**
 * Functional tests for X-Caller-Id auth context resolution.
 *
 * Tests the full pipeline:
 *   X-Caller-Id header → mock server auth context extraction
 *   → GET /users/me resolves the caller's own record
 *   → 401 when header is absent, 404 when ID is unknown
 *
 * Run via: node tests/run-all-tests.js --functional
 *
 * The server is started by the test runner before this file executes.
 * DO NOT start/stop the server in this file.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './generated/typescript/auth-context/client/index.js';
import { createUser } from './generated/typescript/auth-context/sdk.gen.js';

const BASE = 'http://localhost:1080';
const client = createClient({ baseURL: 'http://localhost:1080' });

let userId: string;

describe('Functional — auth-context: X-Caller-Id resolution', () => {
  before(async () => {
    const res = await createUser({ client, body: { name: 'Auth Test User' } });
    assert.equal(res.status, 201, `expected 201, got ${res.status}`);
    userId = (res.data as { id: string }).id;
  });

  it('GET /users/me with X-Caller-Id returns the caller\'s own record', async () => {
    const res = await fetch(`${BASE}/users/me`, {
      headers: { 'X-Caller-Id': userId },
    });
    assert.equal(res.status, 200);
    const data = await res.json() as { id: string; name: string };
    assert.equal(data.id, userId, 'returned record must match the caller\'s id');
    assert.equal(data.name, 'Auth Test User');
  });

  it('GET /users/me without X-Caller-Id returns 401', async () => {
    const res = await fetch(`${BASE}/users/me`);
    assert.equal(res.status, 401);
    const data = await res.json() as { code: string };
    assert.equal(data.code, 'UNAUTHORIZED');
  });

  it('GET /users/me with unknown X-Caller-Id returns 404', async () => {
    const res = await fetch(`${BASE}/users/me`, {
      headers: { 'X-Caller-Id': '00000000-0000-0000-0000-000000000000' },
    });
    assert.equal(res.status, 404);
    const data = await res.json() as { code: string };
    assert.equal(data.code, 'NOT_FOUND');
  });
});
