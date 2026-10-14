/**
 * Ids in a write that name no record, end to end through a booted mock (#481).
 *
 *   - a create or update whose id matches no record is refused with a 422
 *     naming the field, and one that matches is kept
 *   - ids inside nested objects and arrays are checked too
 *   - an id left out or null is the schema's business, not this check's
 *   - `External` and `Polymorphic` name nothing to look up
 *   - a collection forwarded to a real service isn't checked here
 *   - nothing is created under a parent the path names that isn't there
 *   - a link points at the related record's own route, parent ids and all,
 *     and is left out when no loaded API serves it
 *
 * The contract set is synthetic — members, and incomes pointing at them — so it
 * describes the mechanism and nothing else.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMockServer } from '../../src/browser.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';

const ok = (schema, status = 200) => ({ [status]: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } });
const body = (schema) => ({ content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } });
const uuid = { type: 'string', format: 'uuid' };

const openapi = {
  openapi: '3.1.0',
  info: { title: 'Households', version: '1.0.0', 'x-domain': 'demo' },
  servers: [{ url: 'http://localhost:1080/demo' }],
  paths: {
    '/members': {
      post: { operationId: 'createMember', requestBody: body('MemberCreate'), responses: ok('Member', 201) },
    },
    '/members/{memberId}': {
      parameters: [{ name: 'memberId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getMember', responses: ok('Member') },
    },
    '/members/{memberId}/notes': {
      parameters: [{ name: 'memberId', in: 'path', required: true, schema: { type: 'string' } }],
      post: { operationId: 'createNote', requestBody: body('NoteCreate'), responses: ok('Note', 201) },
    },
    '/members/{memberId}/notes/{noteId}': {
      parameters: [
        { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'noteId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      get: { operationId: 'getNote', responses: ok('Note') },
    },
    '/incomes': {
      post: { operationId: 'createIncome', requestBody: body('IncomeWrite'), responses: ok('Income', 201) },
    },
    '/incomes/{incomeId}': {
      parameters: [{ name: 'incomeId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getIncome', responses: ok('Income') },
      patch: { operationId: 'updateIncome', requestBody: body('IncomeWrite'), responses: ok('Income') },
    },
  },
  components: {
    schemas: {
      MemberCreate: { type: 'object', properties: { name: { type: 'string' } } },
      Member: { type: 'object', properties: { id: uuid, name: { type: 'string' } } },
      NoteCreate: { type: 'object', properties: { text: { type: 'string' } } },
      Note: { type: 'object', properties: { id: uuid, memberId: uuid, text: { type: 'string' } } },
      IncomeWrite: {
        type: 'object',
        properties: {
          memberId: { ...uuid, 'x-relationship': { resource: 'Member', style: 'links-only' } },
          noteId: { ...uuid, 'x-relationship': { resource: 'Note', style: 'links-only' } },
          caseId: { ...uuid, 'x-relationship': { resource: 'Case', style: 'links-only' } },
          sharedWith: { type: 'array', items: { type: 'object', properties: { memberId: { ...uuid, 'x-relationship': { resource: 'Member' } } } } },
          payerId: { ...uuid, 'x-relationship': { resource: 'External' } },
          sourceId: { ...uuid, 'x-relationship': { resource: 'Polymorphic' } },
          amount: { type: 'number' },
        },
      },
      Income: { allOf: [{ $ref: '#/components/schemas/IncomeWrite' }, { type: 'object', properties: { id: uuid } }] },
    },
  },
};

const contracts = {
  artifactVersion: 1,
  docs: [
    { path: '/x/domains/demo/demo-openapi.yaml', relativePath: 'domains/demo/demo-openapi.yaml', domain: 'demo', type: 'openapi', provenance: null, content: openapi },
  ],
};

const NOBODY = '00000000-0000-4000-8000-000000000000';

let mock;
let member;

async function boot(options = {}) {
  const log = console.log; console.log = () => {};
  try {
    return await createMockServer({ contracts, store: createMemoryStore(), seed: false, ...options });
  } finally {
    console.log = log;
  }
}

const send = async (method, path, payload) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-caller-id': 'tester' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

beforeEach(async () => {
  mock = await boot();
  member = (await send('POST', '/demo/members', { name: 'Rosa' })).body;
});

describe('a create', () => {
  test('naming a record that exists is kept', async () => {
    const { status } = await send('POST', '/demo/incomes', { memberId: member.id, amount: 900 });
    assert.strictEqual(status, 201);
  });

  test('naming no record is refused, with the field and the id', async () => {
    const { status, body: answer } = await send('POST', '/demo/incomes', { memberId: NOBODY, amount: 900 });
    assert.strictEqual(status, 422);
    assert.strictEqual(answer.code, 'VALIDATION_ERROR');
    assert.deepStrictEqual(answer.details, [{ field: 'memberId', message: `No Member has the id "${NOBODY}".` }]);
  });

  test('leaving the id out is not this check\'s business', async () => {
    assert.strictEqual((await send('POST', '/demo/incomes', { amount: 900 })).status, 201);
  });

  test('External and Polymorphic name nothing to look up', async () => {
    const { status } = await send('POST', '/demo/incomes', { memberId: member.id, payerId: NOBODY, sourceId: NOBODY });
    assert.strictEqual(status, 201);
  });
});

describe('an update', () => {
  test('changing the id to a record that exists is kept', async () => {
    const income = (await send('POST', '/demo/incomes', { amount: 900 })).body;
    assert.strictEqual((await send('PATCH', `/demo/incomes/${income.id}`, { memberId: member.id })).status, 200);
  });

  test('changing the id to no record is refused, and the record is unchanged', async () => {
    const income = (await send('POST', '/demo/incomes', { memberId: member.id, amount: 900 })).body;
    const { status, body: answer } = await send('PATCH', `/demo/incomes/${income.id}`, { memberId: NOBODY });
    assert.strictEqual(status, 422);
    assert.strictEqual(answer.details[0].field, 'memberId');
    assert.strictEqual((await send('GET', `/demo/incomes/${income.id}`)).body.memberId, member.id);
  });

  test('an update that doesn\'t send the id isn\'t checked for it', async () => {
    const income = (await send('POST', '/demo/incomes', { memberId: member.id, amount: 900 })).body;
    assert.strictEqual((await send('PATCH', `/demo/incomes/${income.id}`, { amount: 950 })).status, 200);
  });
});

describe('a nested id', () => {
  test('naming a record that exists is kept', async () => {
    const { status } = await send('POST', '/demo/incomes', { sharedWith: [{ memberId: member.id }] });
    assert.strictEqual(status, 201);
  });

  test('naming no record is refused, with where it is in the body', async () => {
    const { status, body: answer } = await send('POST', '/demo/incomes', { sharedWith: [{ memberId: member.id }, { memberId: NOBODY }] });
    assert.strictEqual(status, 422);
    assert.deepStrictEqual(answer.details, [{ field: 'sharedWith[1].memberId', message: `No Member has the id "${NOBODY}".` }]);
  });
});

describe('a nested create', () => {
  test('under a parent that exists is kept', async () => {
    assert.strictEqual((await send('POST', `/demo/members/${member.id}/notes`, { text: 'moved in March' })).status, 201);
  });

  test('under a parent that isn\'t there is refused with a 404', async () => {
    const { status, body: answer } = await send('POST', `/demo/members/${NOBODY}/notes`, { text: 'moved in March' });
    assert.strictEqual(status, 404);
    assert.strictEqual(answer.code, 'NOT_FOUND');
  });
});

describe('a link', () => {
  test('points at the related record\'s own route', async () => {
    const { body: income } = await send('POST', '/demo/incomes', { memberId: member.id });
    assert.strictEqual(income.links.member, `/demo/members/${member.id}`);
  });

  test('to a nested record fills in its parent id from that record', async () => {
    const note = (await send('POST', `/demo/members/${member.id}/notes`, { text: 'moved in March' })).body;
    const { body: income } = await send('POST', '/demo/incomes', { noteId: note.id });
    assert.strictEqual(income.links.note, `/demo/members/${member.id}/notes/${note.id}`);
  });

  test('to a resource no loaded API serves is left out', async () => {
    const { status, body: income } = await send('POST', '/demo/incomes', { memberId: member.id, caseId: NOBODY });
    assert.strictEqual(status, 201);
    assert.deepStrictEqual(Object.keys(income.links), ['member']);
  });
});

describe('a collection forwarded to a real service', () => {
  test('isn\'t checked here, since its records live there', async () => {
    mock = await boot({ forwarding: [{ endpoint: 'GET /demo/members/{memberId}', to: 'http://127.0.0.1:9' }] });
    const { status } = await send('POST', '/demo/incomes', { memberId: NOBODY, amount: 900 });
    assert.strictEqual(status, 201);
  });
});
