/**
 * An operation answered outside the contracts (x-relationship type external),
 * such as a state's adapter's: the mock doesn't answer it itself, whatever its
 * shape. A stub stands in, or routing sends it on; otherwise it's a 501 saying so.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMockServer } from '../../src/server.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';

const ok = (schema, status = 200) => ({ [status]: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } });
const body = { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } };
const external = { 'x-relationship': { type: 'external' } };

const contracts = {
  artifactVersion: 1,
  docs: [{
    path: '/x/domains/decision-support/decision-support-openapi.yaml',
    relativePath: 'domains/decision-support/decision-support-openapi.yaml',
    domain: 'decision-support',
    type: 'openapi',
    provenance: null,
    content: {
      openapi: '3.1.0',
      info: { title: 'Suggestions', version: '1', 'x-domain': 'decision-support' },
      servers: [{ url: 'http://localhost:1080/decision-support' }],
      paths: {
        '/suggestions': {
          get: { operationId: 'listSuggestions', ...external, responses: ok('SuggestionList') },
          post: { operationId: 'createSuggestion', ...external, ...body, responses: ok('Suggestion', 201) },
        },
        '/notes': { post: { operationId: 'createNote', ...body, responses: ok('Note', 201) } },
        '/notes/{noteId}': {
          parameters: [{ name: 'noteId', in: 'path', required: true, schema: { type: 'string' } }],
          get: { operationId: 'getNote', responses: ok('Note') },
        },
      },
      components: {
        schemas: {
          Suggestion: { type: 'object', properties: { id: { type: 'string' } } },
          SuggestionList: { type: 'object' },
          Note: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    },
  }],
};

let mock;
beforeEach(async () => {
  const log = console.log; console.log = () => {};
  try { mock = await createMockServer({ contracts, store: createMemoryStore(), seed: false }); } finally { console.log = log; }
});

const send = async (method, path, payload) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

test('an external operation is a 501 naming how to answer it, though its path is a collection', async () => {
  for (const method of ['GET', 'POST']) {
    const { status, body: answer } = await send(method, '/decision-support/suggestions', method === 'POST' ? {} : undefined);
    assert.equal(status, 501);
    assert.equal(answer.code, 'NOT_IMPLEMENTED');
    assert.match(answer.message, /answered outside the contracts .* Register an HTTP stub for it/);
  }
});

test('a stub answers an external operation', async () => {
  await send('POST', '/mock/stubs/http', { match: { method: 'POST', url: '/decision-support/suggestions' }, response: { status: 201, body: { id: 's1' } } });
  assert.deepEqual(await send('POST', '/decision-support/suggestions', {}), { status: 201, body: { id: 's1' } });
});

test('an operation beside it that isn\'t external is answered as usual', async () => {
  assert.equal((await send('POST', '/decision-support/notes', {})).status, 201);
});
