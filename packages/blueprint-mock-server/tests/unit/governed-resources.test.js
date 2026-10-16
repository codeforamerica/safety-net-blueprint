/**
 * What a state machine decides about records nested under its object, and the
 * capabilities that make it work, end to end through a booted mock:
 *
 *   - a machine's `resources:` guards a nested create, with `object` the
 *     parent found from the path and `request` the body
 *   - and its own object's create, with no `object` yet, and update, with
 *     `object` the record being updated
 *   - a config catalog seeds the resource it names, wherever its routes are
 *   - a context binding's `where` can be CEL, seeing `item`, `object`, `request`
 *   - a step's call means what the API's route means: a nested create, an
 *     update, an action
 *   - an operation declaring Idempotency-Key honors it
 *   - a nested list is ordered as its x-sortable says
 *
 * The contract set is synthetic — a board with cards, and holds that stop
 * cards being added — so it describes the mechanism and nothing else.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMockServer } from '../../src/browser.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';
import { seedConfigs } from '../../src/config-registry.js';
import { extract } from '@codeforamerica/blueprint-core';

const ok = (schema, status = 200) => ({ [status]: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } });
const IDEMPOTENCY_KEY = { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 255 } };

const openapi = {
  openapi: '3.1.0',
  info: { title: 'Boards', version: '1.0.0', 'x-domain': 'demo' },
  servers: [{ url: 'http://localhost:1080/demo' }],
  paths: {
    '/boards': {
      post: { operationId: 'createBoard', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: ok('Board', 201) },
    },
    '/boards/{boardId}': {
      parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getBoard', responses: ok('Board') },
      patch: { operationId: 'updateBoard', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: ok('Board') },
    },
    '/templates': {
      get: { operationId: 'listTemplates', responses: ok('TemplateList') },
      post: { operationId: 'createTemplate', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: ok('Template', 201) },
    },
    '/templates/{templateId}': {
      parameters: [{ name: 'templateId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getTemplate', responses: ok('Template') },
      patch: { operationId: 'updateTemplate', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: ok('Template') },
    },
    '/boards/{boardId}/cards': {
      parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'listCards', 'x-sortable': { fields: ['at'], default: 'at' }, responses: ok('CardList') },
      post: {
        operationId: 'createCard',
        parameters: [IDEMPOTENCY_KEY],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CardCreate' } } } },
        responses: ok('Card', 201),
      },
    },
    '/boards/{boardId}/cards/{cardId}': {
      parameters: [
        { name: 'boardId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'cardId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      get: { operationId: 'getCard', responses: ok('Card') },
      patch: { operationId: 'updateCard', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: ok('Card') },
    },
  },
  components: {
    schemas: {
      Board: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, name: { type: 'string' }, templateId: { type: 'string' } } },
      Template: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, source: { enum: ['system', 'user'] } } },
      TemplateList: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Template' } } } },
      // Clients add notes. Holds are the machine's alone, so the create schema
      // does not allow them — and the full schema, which steps are checked
      // against, does.
      CardCreate: {
        type: 'object', required: ['kind', 'at'], additionalProperties: false,
        properties: { kind: { const: 'note' }, at: { type: 'string' }, text: { type: 'string' } },
      },
      Card: {
        type: 'object', required: ['kind', 'at'],
        properties: {
          id: { type: 'string' }, boardId: { type: 'string' },
          kind: { enum: ['note', 'hold'] }, at: { type: 'string' }, endedAt: { type: ['string', 'null'] }, text: { type: 'string' },
          createdAt: { type: 'string' }, updatedAt: { type: 'string' },
        },
      },
      CardList: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Card' } } } },
    },
  },
};

const stateMachine = {
  domain: 'demo',
  machines: [{
    object: 'Board',
    states: [{ id: 'open' }, { id: 'closed' }],
    initialState: 'open',
    guards: [
      { id: 'boardOpen', description: 'the board is open', condition: 'object.status == "open"' },
      { id: 'notDuringAHold', condition: 'holdAtCard == null' },
      { id: 'templateExists', condition: '!has(request.templateId) || template != null' },
    ],
    actions: [
      {
        id: 'hold',
        steps: [{ call: { POST: 'demo/boards/$object.id/cards', body: { kind: 'hold', at: '$request.at', endedAt: null } } }],
      },
      {
        id: 'release',
        context: [{ openHold: { from: 'demo/boards/cards', where: 'item.kind == "hold" && item.boardId == object.id && item.endedAt == null' } }],
        steps: [{ call: { PATCH: 'demo/boards/$object.id/cards/$openHold.id', body: { endedAt: '$request.at' } } }],
      },
      { id: 'close', transition: { from: 'open', to: 'closed' }, steps: [{ set: { field: 'closedAt', value: '$now' } }] },
    ],
    resources: {
      Board: {
        create: {
          context: [{ template: { from: 'demo/templates', where: 'item.id == request.templateId' } }],
          guards: [{ conditions: ['templateExists'] }],
        },
        update: { guards: [{ conditions: ['boardOpen'] }] },
      },
      Card: {
        create: {
          context: [{
            holdAtCard: {
              from: 'demo/boards/cards',
              where: 'item.kind == "hold" && item.boardId == object.id && item.at <= request.at && (item.endedAt == null || item.endedAt > request.at)',
            },
          }],
          guards: [{ conditions: ['boardOpen', 'notDuringAHold'] }],
        },
        update: { guards: [{ actors: ['system'] }] },
      },
    },
  }],
};

const contracts = {
  artifactVersion: 1,
  docs: [
    { path: '/x/domains/demo/demo-openapi.yaml', relativePath: 'domains/demo/demo-openapi.yaml', domain: 'demo', type: 'openapi', provenance: null, content: openapi },
    { path: '/x/domains/demo/demo-state-machine.yaml', relativePath: 'domains/demo/demo-state-machine.yaml', domain: 'demo', type: 'state-machine', provenance: null, content: stateMachine },
    {
      path: '/x/domains/demo/demo-config.yaml', relativePath: 'domains/demo/demo-config.yaml', domain: 'demo', type: 'config', provenance: null,
      // Keyed differently from the collection, so seeding can only have
      // found it through the resource the catalog names.
      content: { version: '1', domain: 'demo', starterTemplates: { resource: 'Template', entries: [{ id: 'kanban', name: 'Kanban', 'x-note': 'not stored' }] } },
    },
  ],
};

let mock;
let board;
let keys = 0;

const send = async (method, path, body, headers = {}) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-caller-id': 'tester', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, replayed: response.headers.get('idempotent-replayed') };
};
const addCard = (body, key = `key-${++keys}`) => send('POST', `/demo/boards/${board.id}/cards`, body, { 'idempotency-key': key });

beforeEach(async () => {
  const log = console.log; console.log = () => {};
  try {
    mock = await createMockServer({ contracts, store: createMemoryStore(), seed: false });
  } finally {
    console.log = log;
  }
  board = (await send('POST', '/demo/boards', {})).body;
});

describe('a machine guarding a nested create', () => {
  test('allows it while the guard passes', async () => {
    const { status, body } = await addCard({ kind: 'note', at: '2026-01-01T00:00:01Z' });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.boardId, board.id, 'the parent id comes from the path');
  });

  test('refuses it, with 409, once the parent no longer allows it', async () => {
    await send('POST', `/demo/boards/${board.id}/close`, {});
    const { status, body } = await addCard({ kind: 'note', at: '2026-01-01T00:00:01Z' });
    assert.strictEqual(status, 409);
    assert.match(body.message, /Can't create a card on this board\. It requires that /);
  });

  test('reports a body missing a field as 422, not as a condition that failed', async () => {
    const { status } = await addCard({ kind: 'note' });
    assert.strictEqual(status, 422);
  });

  test('answers 404 when the parent does not exist', async () => {
    const response = await send('POST', '/demo/boards/missing/cards', { kind: 'note', at: '2026-01-01T00:00:01Z' }, { 'idempotency-key': 'k' });
    assert.strictEqual(response.status, 404);
  });

  test('judges the request against a CEL binding that sees item, object and request', async () => {
    await send('POST', `/demo/boards/${board.id}/hold`, { at: '2026-01-01T00:00:10Z' });
    await send('POST', `/demo/boards/${board.id}/release`, { at: '2026-01-01T00:00:20Z' });

    assert.strictEqual((await addCard({ kind: 'note', at: '2026-01-01T00:00:05Z' })).status, 201, 'before the hold');
    assert.strictEqual((await addCard({ kind: 'note', at: '2026-01-01T00:00:15Z' })).status, 409, 'during it');
    assert.strictEqual((await addCard({ kind: 'note', at: '2026-01-01T00:00:25Z' })).status, 201, 'after it');
  });
});

describe('a machine guarding its own object', () => {
  test('guards its create with no record yet, seeing the body', async () => {
    assert.strictEqual((await send('POST', '/demo/boards', { templateId: 'kanban' })).status, 201);
    const { status, body } = await send('POST', '/demo/boards', { templateId: 'missing' });
    assert.strictEqual(status, 409);
    assert.match(body.message, /Can't create a board\. It requires that the templateExists condition holds\./);
  });

  test('guards its update with the record being updated', async () => {
    assert.strictEqual((await send('PATCH', `/demo/boards/${board.id}`, { name: 'Sprint' })).status, 200);
    await send('POST', `/demo/boards/${board.id}/close`, {});
    const { status, body } = await send('PATCH', `/demo/boards/${board.id}`, { name: 'Later' });
    assert.strictEqual(status, 409);
    assert.match(body.message, /Can't update this board\. It requires that the board is open\./);
  });
});

describe('a config catalog', () => {
  test('seeds the resource it names, marked system, without its x- fields', async () => {
    const { body } = await send('GET', '/demo/templates/kanban');
    assert.deepStrictEqual({ name: body.name, source: body.source, note: body['x-note'] }, { name: 'Kanban', source: 'system', note: undefined });
  });

  test('marks a record added through the API as user', async () => {
    assert.strictEqual((await send('POST', '/demo/templates', { name: 'Mine' })).body.source, 'user');
  });

  test('seeds only what is missing, so a change made through the API is kept', () => {
    const store = createMemoryStore();
    store.insertResource('templates', { id: 'kanban', name: 'Renamed', source: 'system' });
    seedConfigs(extract(extract(contracts, 'docs'), 'config'), store);
    assert.strictEqual(store.findById('templates', 'kanban').name, 'Renamed');
  });
});

describe('a machine guarding a nested update', () => {
  test('refuses a caller without the role, with 403', async () => {
    const card = (await addCard({ kind: 'note', at: '2026-01-01T00:00:01Z' })).body;
    const { status, body } = await send('PATCH', `/demo/boards/${board.id}/cards/${card.id}`, { text: 'edited' });
    assert.strictEqual(status, 403);
    assert.match(body.message, /Only system can update a card on this board\./);
  });

  test('lets a caller with the role through', async () => {
    const card = (await addCard({ kind: 'note', at: '2026-01-01T00:00:01Z' })).body;
    const { status, body } = await send('PATCH', `/demo/boards/${board.id}/cards/${card.id}`, { text: 'edited' }, { 'x-caller-roles': 'system' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.text, 'edited');
  });

  test('does not hold the machine\'s own step to it', async () => {
    // release runs as an ordinary caller, and its step updates the hold.
    await send('POST', `/demo/boards/${board.id}/hold`, { at: '2026-01-01T00:00:10Z' });
    await send('POST', `/demo/boards/${board.id}/release`, { at: '2026-01-01T00:00:20Z' });
    const [hold] = (await send('GET', `/demo/boards/${board.id}/cards`)).body.items.filter((c) => c.kind === 'hold');
    assert.strictEqual(hold.endedAt, '2026-01-01T00:00:20Z');
  });
});

describe('a step call', () => {
  test('creates a nested record the client could not, checked against the full schema', async () => {
    await send('POST', `/demo/boards/${board.id}/hold`, { at: '2026-01-01T00:00:10Z' });
    const holds = (await send('GET', `/demo/boards/${board.id}/cards`)).body.items.filter((c) => c.kind === 'hold');
    assert.strictEqual(holds.length, 1);
    assert.strictEqual(holds[0].boardId, board.id);
    assert.strictEqual(holds[0].endedAt, null);
  });

  test('updates the record a binding found', async () => {
    await send('POST', `/demo/boards/${board.id}/hold`, { at: '2026-01-01T00:00:10Z' });
    await send('POST', `/demo/boards/${board.id}/release`, { at: '2026-01-01T00:00:20Z' });
    const [hold] = (await send('GET', `/demo/boards/${board.id}/cards`)).body.items.filter((c) => c.kind === 'hold');
    assert.strictEqual(hold.endedAt, '2026-01-01T00:00:20Z');
  });

  test('emits the created and updated events a client\'s write would', async () => {
    await send('POST', `/demo/boards/${board.id}/hold`, { at: '2026-01-01T00:00:10Z' });
    await send('POST', `/demo/boards/${board.id}/release`, { at: '2026-01-01T00:00:20Z' });
    const types = mock.store.findAll('events', {}, { limit: null }).items.map((e) => e.type);
    assert.ok(types.includes('demo.card.created'), types.join(', '));
    assert.ok(types.includes('demo.card.updated'), types.join(', '));
  });

  test('is refused when it means no route the API declares', async () => {
    const { createStepCalls } = await import('../../src/step-calls.js');
    const { extract } = await import('@codeforamerica/blueprint-core/browser');
    const { apiSpecsFromDocs } = await import('../../src/spec-loader.js');
    const docs = extract(contracts, 'docs');
    const calls = createStepCalls({ apiSpecs: apiSpecsFromDocs(docs), stateMachines: extract(docs, 'state-machines'), store: createMemoryStore() });
    assert.throws(() => calls.resolve('POST', 'demo/boards/b1/stickers'), /is not a route any API declares/);
    assert.throws(() => calls.resolve('PATCH', 'demo/boards/b1/cards/undefined'), /a binding it uses found no record/);
    assert.strictEqual(calls.resolve('POST', 'demo/boards/b1/close').kind, 'action');
    assert.strictEqual(calls.resolve('POST', 'demo/boards/b1/cards').kind, 'create');
  });
});

describe('Idempotency-Key', () => {
  test('a repeat with the same key gets the same response, and makes nothing new', async () => {
    const first = await addCard({ kind: 'note', at: '2026-01-01T00:00:01Z' }, 'same');
    const again = await addCard({ kind: 'note', at: '2026-01-01T00:00:01Z' }, 'same');
    assert.strictEqual(again.status, 201);
    assert.strictEqual(again.replayed, 'true', 'marked as a replay');
    assert.strictEqual(first.replayed, 'false');
    assert.strictEqual(again.body.id, first.body.id);
    assert.strictEqual((await send('GET', `/demo/boards/${board.id}/cards`)).body.items.length, 1);
  });

  test('the same key with a different request is refused with 422', async () => {
    await addCard({ kind: 'note', at: '2026-01-01T00:00:01Z' }, 'same');
    assert.strictEqual((await addCard({ kind: 'note', at: '2026-01-01T00:00:02Z' }, 'same')).status, 422);
  });

  test('is required where the operation requires it', async () => {
    const response = await send('POST', `/demo/boards/${board.id}/cards`, { kind: 'note', at: '2026-01-01T00:00:01Z' });
    assert.strictEqual(response.status, 400);
  });

  test('is scoped to the caller', async () => {
    const mine = await addCard({ kind: 'note', at: '2026-01-01T00:00:01Z' }, 'shared');
    const theirs = await send('POST', `/demo/boards/${board.id}/cards`, { kind: 'note', at: '2026-01-01T00:00:01Z' },
      { 'idempotency-key': 'shared', 'x-caller-id': 'someone-else' });
    assert.notStrictEqual(theirs.body.id, mine.body.id);
  });
});

describe('a nested list', () => {
  test('is ordered as its x-sortable says', async () => {
    for (const at of ['2026-01-01T00:00:03Z', '2026-01-01T00:00:01Z', '2026-01-01T00:00:02Z']) {
      await addCard({ kind: 'note', at });
    }
    const { body } = await send('GET', `/demo/boards/${board.id}/cards`);
    assert.deepStrictEqual(body.items.map((c) => c.at), ['2026-01-01T00:00:01Z', '2026-01-01T00:00:02Z', '2026-01-01T00:00:03Z']);
  });
});
