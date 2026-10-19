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

// Households, the people in each, their earnings and their pets — all nested
// under the household. A person declares the household it belongs to with
// x-relationship; a pet doesn't, so there's nothing declared to compare for it.
const id = (name) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const nestedContracts = {
  artifactVersion: 1,
  docs: [{
    path: '/x/domains/homes/homes-openapi.yaml', relativePath: 'domains/homes/homes-openapi.yaml', domain: 'homes', type: 'openapi', provenance: null,
    content: {
      openapi: '3.1.0',
      info: { title: 'Households', version: '1.0.0', 'x-domain': 'homes' },
      servers: [{ url: 'http://localhost:1080/homes' }],
      paths: {
        '/households': { post: { operationId: 'createHousehold', requestBody: body('HouseholdCreate'), responses: ok('Household', 201) } },
        '/households/{householdId}': { parameters: [id('householdId')], get: { operationId: 'getHousehold', responses: ok('Household') } },
        '/households/{householdId}/residents': { parameters: [id('householdId')], post: { operationId: 'createPerson', requestBody: body('PersonCreate'), responses: ok('Person', 201) } },
        '/households/{householdId}/residents/{personId}': { parameters: [id('householdId'), id('personId')], get: { operationId: 'getPerson', responses: ok('Person') } },
        '/households/{householdId}/pets': { parameters: [id('householdId')], post: { operationId: 'createPet', requestBody: body('PetCreate'), responses: ok('Pet', 201) } },
        '/households/{householdId}/pets/{petId}': { parameters: [id('householdId'), id('petId')], get: { operationId: 'getPet', responses: ok('Pet') } },
        '/households/{householdId}/vehicles': { parameters: [id('householdId')], post: { operationId: 'createVehicle', requestBody: body('VehicleCreate'), responses: ok('Vehicle', 201) } },
        '/households/{householdId}/vehicles/{vehicleId}': { parameters: [id('householdId'), id('vehicleId')], get: { operationId: 'getVehicle', responses: ok('Vehicle') } },
        '/households/{householdId}/earnings': { parameters: [id('householdId')], post: { operationId: 'createEarning', requestBody: body('EarningWrite'), responses: ok('Earning', 201) } },
        '/households/{householdId}/earnings/{earningId}': {
          parameters: [id('householdId'), id('earningId')],
          get: { operationId: 'getEarning', responses: ok('Earning') },
          patch: { operationId: 'updateEarning', requestBody: body('EarningWrite'), responses: ok('Earning') },
        },
      },
      components: {
        schemas: {
          HouseholdCreate: { type: 'object', properties: { name: { type: 'string' } } },
          Household: { type: 'object', properties: { id: uuid, name: { type: 'string' } } },
          PersonCreate: { type: 'object', properties: { name: { type: 'string' } } },
          Person: { type: 'object', properties: { id: uuid, householdId: { ...uuid, readOnly: true, 'x-relationship': { resource: 'Household' } }, name: { type: 'string' } } },
          PetCreate: { type: 'object', properties: { name: { type: 'string' } } },
          Pet: { type: 'object', properties: { id: uuid, householdId: { ...uuid, readOnly: true }, name: { type: 'string' } } },
          VehicleCreate: { type: 'object', properties: { make: { type: 'string' } } },
          // As resolve leaves a relationship it expanded: read as the household
          // itself, while the record is stored under householdId.
          Vehicle: { type: 'object', properties: { id: uuid, household: { type: 'object', 'x-relationship': { resource: 'Household', style: 'expand' } }, make: { type: 'string' } } },
          EarningWrite: {
            type: 'object',
            properties: {
              personId: { ...uuid, 'x-relationship': { resource: 'Person', style: 'links-only' } },
              petId: { ...uuid, 'x-relationship': { resource: 'Pet', style: 'links-only' } },
              vehicleId: { ...uuid, 'x-relationship': { resource: 'Vehicle', style: 'links-only' } },
              amount: { type: 'number' },
            },
          },
          Earning: { allOf: [{ $ref: '#/components/schemas/EarningWrite' }, { type: 'object', properties: { id: uuid } }] },
        },
      },
    },
  }],
};

describe('a record under another parent', () => {
  let first;
  let second;
  let person;

  beforeEach(async () => {
    mock = await boot({ contracts: nestedContracts });
    first = (await send('POST', '/homes/households', { name: 'Lopez' })).body;
    second = (await send('POST', '/homes/households', { name: 'Chen' })).body;
    person = (await send('POST', `/homes/households/${first.id}/residents`, { name: 'Rosa' })).body;
  });

  test('named in a create under the same parent is kept', async () => {
    assert.strictEqual((await send('POST', `/homes/households/${first.id}/earnings`, { personId: person.id, amount: 900 })).status, 201);
  });

  test('named in a create under a different parent is refused', async () => {
    // The mistake a tool proposing changes is most likely to make: an id from
    // the wrong household, which exists, so only this check catches it.
    const { status, body: answer } = await send('POST', `/homes/households/${second.id}/earnings`, { personId: person.id, amount: 900 });
    assert.strictEqual(status, 422);
    assert.deepStrictEqual(answer.details, [{ field: 'personId', message: `Person "${person.id}" belongs to a different Household.` }]);
  });

  test('named in an update under a different parent is refused, and the record is unchanged', async () => {
    const other = (await send('POST', `/homes/households/${second.id}/residents`, { name: 'Wei' })).body;
    const earning = (await send('POST', `/homes/households/${second.id}/earnings`, { personId: other.id, amount: 900 })).body;
    const { status } = await send('PATCH', `/homes/households/${second.id}/earnings/${earning.id}`, { personId: person.id });
    assert.strictEqual(status, 422);
    assert.strictEqual((await send('GET', `/homes/households/${second.id}/earnings/${earning.id}`)).body.personId, other.id);
  });

  test('whose parent is read expanded is compared by the key it is stored under', async () => {
    const vehicle = (await send('POST', `/homes/households/${first.id}/vehicles`, { make: 'Ford' })).body;
    const { status, body: answer } = await send('POST', `/homes/households/${second.id}/earnings`, { vehicleId: vehicle.id });
    assert.strictEqual(status, 422);
    assert.strictEqual(answer.details[0].message, `Vehicle "${vehicle.id}" belongs to a different Household.`);
  });

  test('whose schema declares no parent is left alone, not guessed at', async () => {
    const pet = (await send('POST', `/homes/households/${first.id}/pets`, { name: 'Bean' })).body;
    assert.strictEqual((await send('POST', `/homes/households/${second.id}/earnings`, { petId: pet.id })).status, 201);
  });
});

describe('a collection forwarded to a real service', () => {
  test('isn\'t checked here, since its records live there', async () => {
    mock = await boot({ forwarding: [{ endpoint: 'GET /demo/members/{memberId}', to: 'http://127.0.0.1:9' }] });
    const { status } = await send('POST', '/demo/incomes', { memberId: NOBODY, amount: 900 });
    assert.strictEqual(status, 201);
  });
});
