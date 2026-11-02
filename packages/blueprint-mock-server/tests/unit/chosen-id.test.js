/**
 * A caller may choose a new record's id (NewId in the base contracts), and an
 * id another record already has is refused with 409.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMemoryStore } from '../../src/stores/memory-store.js';
import { createCreateHandler } from '../../src/handlers/create-handler.js';
import { makeRequest, readResponse } from '../helpers/fetch.js';

const store = createMemoryStore();
const schema = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } },
};

function makeHandler() {
  const endpoint = { collectionName: `chosen-id-${Date.now()}-${Math.random()}`, requestSchema: schema };
  return createCreateHandler({ serverBasePath: '/test', name: 'test' }, endpoint, 'http://localhost:1080', null, [], null, { store });
}

async function post(handler, body) {
  const { status, body: responseBody } = await readResponse(handler(makeRequest('/test', { method: 'POST', body }), { params: {} }));
  return { status, body: responseBody };
}

test('a create keeps the id the caller chose', async () => {
  const id = '22222222-2222-4222-8222-000000000001';
  const { status, body } = await post(makeHandler(), { id, name: 'Maria' });
  assert.strictEqual(status, 201);
  assert.strictEqual(body.id, id);
});

test('a create without an id gets one from the server', async () => {
  const { status, body } = await post(makeHandler(), { name: 'Rosa' });
  assert.strictEqual(status, 201);
  assert.match(body.id, /^[0-9a-f-]{36}$/);
});

test('a create with an id another record has is refused with 409', async () => {
  const handler = makeHandler();
  const id = '22222222-2222-4222-8222-000000000002';
  await post(handler, { id, name: 'First' });
  const { status, body } = await post(handler, { id, name: 'Second' });
  assert.strictEqual(status, 409);
  assert.strictEqual(body.code, 'CONFLICT');
  assert.deepStrictEqual(body.details, [{ field: 'id', message: 'already in use' }]);
});
