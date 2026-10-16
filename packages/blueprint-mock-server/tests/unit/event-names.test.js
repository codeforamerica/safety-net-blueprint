/**
 * The events a write emits are named for the resource it acts on —
 * `domain.resource.event`, the domain as declared — and a POST to a path that
 * is no resource's is a call: it keeps nothing and emits nothing.
 *
 * The contract set is synthetic: a hyphenated domain with a case, notes under
 * it, a collection that can be listed but not read one by one, and an
 * evaluate endpoint.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMockServer } from '../../src/browser.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';

const ok = (schema, status = 200) => ({ [status]: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } });
const body = { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } };
const id = (name) => ({ name, in: 'path', required: true, schema: { type: 'string' } });

const contracts = {
  artifactVersion: 1,
  docs: [{
    path: '/x/domains/case-management/case-management-openapi.yaml',
    relativePath: 'domains/case-management/case-management-openapi.yaml',
    domain: 'case-management',
    type: 'openapi',
    provenance: null,
    content: {
      openapi: '3.1.0',
      info: { title: 'Cases', version: '1', 'x-domain': 'case-management' },
      servers: [{ url: 'http://localhost:1080/case-management' }],
      paths: {
        '/cases': { post: { operationId: 'createCase', ...body, responses: ok('Case', 201) } },
        '/cases/{caseId}': {
          parameters: [id('caseId')],
          get: { operationId: 'getCase', responses: ok('Case') },
          patch: { operationId: 'updateCase', ...body, responses: ok('Case') },
        },
        '/cases/{caseId}/notes': {
          parameters: [id('caseId')],
          post: { operationId: 'addNote', ...body, responses: ok('CaseNote', 201) },
        },
        '/cases/{caseId}/notes/{noteId}': {
          parameters: [id('caseId'), id('noteId')],
          get: { operationId: 'getNote', responses: ok('CaseNote') },
        },
        '/tags': {
          get: { operationId: 'listTags', responses: ok('TagList') },
          post: { operationId: 'createTag', ...body, responses: ok('Tag', 201) },
        },
        '/evaluate/priority': { post: { operationId: 'evaluatePriority', ...body, responses: ok('Priority') } },
      },
      components: {
        schemas: {
          Case: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } },
          CaseNote: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } } },
          Tag: { type: 'object', properties: { id: { type: 'string' } } },
          TagList: { type: 'object' },
          Priority: { type: 'object' },
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
  const response = await mock.fetch(new Request(`http://localhost/case-management${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const types = () => mock.store.findAll('events', {}, { limit: null }).items.map((e) => e.type);

test('a create and an update are named for the resource, with the domain as declared', async () => {
  const created = await send('POST', '/cases', { title: 'A' });
  await send('PATCH', `/cases/${created.body.id}`, { title: 'B' });
  assert.deepStrictEqual(types(), ['case-management.case.created', 'case-management.case.updated']);
});

test('a nested resource is named for itself, not its parent', async () => {
  const created = await send('POST', '/cases', { title: 'A' });
  await send('POST', `/cases/${created.body.id}/notes`, { text: 'hi' });
  assert.ok(types().includes('case-management.case_note.created'), types().join(', '));
});

test('a collection with no item endpoint is named for what its create returns', async () => {
  assert.strictEqual((await send('POST', '/tags', {})).status, 201);
  assert.ok(types().includes('case-management.tag.created'), types().join(', '));
});

test('a POST to a path with no list and no item is a call: 501 naming the stub, nothing kept or emitted', async () => {
  const { status, body: answer } = await send('POST', '/evaluate/priority', { x: 1 });
  assert.strictEqual(status, 501);
  assert.match(answer.message, /Register an HTTP stub/);
  assert.deepStrictEqual(types(), []);
});
