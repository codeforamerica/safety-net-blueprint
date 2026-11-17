/**
 * Unit tests for the update handler: its utilities, deepEqual and
 * buildChanges, and what a PATCH is checked against.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { deepEqual, buildChanges } from '../../src/handlers/update-handler.js';
import { createMockServer } from '../../src/server.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';

// =============================================================================
// deepEqual
// =============================================================================

test('deepEqual — identical scalars are equal', () => {
  assert.ok(deepEqual(1, 1));
  assert.ok(deepEqual('snap', 'snap'));
  assert.ok(deepEqual(true, true));
  assert.ok(deepEqual(null, null));
});

test('deepEqual — different scalars are not equal', () => {
  assert.ok(!deepEqual(1, 2));
  assert.ok(!deepEqual('snap', 'medicaid'));
  assert.ok(!deepEqual(true, false));
  assert.ok(!deepEqual(null, 0));
});

test('deepEqual — identical arrays are equal', () => {
  assert.ok(deepEqual(['snap', 'medicaid'], ['snap', 'medicaid']));
  assert.ok(deepEqual([], []));
});

test('deepEqual — arrays with different elements are not equal', () => {
  assert.ok(!deepEqual(['snap'], ['medicaid']));
  assert.ok(!deepEqual(['snap', 'medicaid'], ['snap']));
  assert.ok(!deepEqual([], ['snap']));
});

test('deepEqual — array order matters', () => {
  assert.ok(!deepEqual(['snap', 'medicaid'], ['medicaid', 'snap']));
});

test('deepEqual — identical objects are equal', () => {
  assert.ok(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }));
  assert.ok(deepEqual({}, {}));
});

test('deepEqual — objects with different values are not equal', () => {
  assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
  assert.ok(!deepEqual({ a: 1 }, { b: 1 }));
  assert.ok(!deepEqual({ a: 1, b: 2 }, { a: 1 }));
});

test('deepEqual — nested structures', () => {
  assert.ok(deepEqual({ tags: ['snap'], meta: { county: 'alameda' } }, { tags: ['snap'], meta: { county: 'alameda' } }));
  assert.ok(!deepEqual({ tags: ['snap'] }, { tags: ['medicaid'] }));
});

// =============================================================================
// buildChanges
// =============================================================================

test('buildChanges — reports changed scalar fields', () => {
  const before = { id: '1', createdAt: 'x', updatedAt: 'y', priority: 'normal', status: 'pending' };
  const after  = { id: '1', createdAt: 'x', updatedAt: 'z', priority: 'expedited', status: 'pending' };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'priority', before: 'normal', after: 'expedited' });
});

test('buildChanges — excludes id, createdAt, updatedAt', () => {
  const before = { id: '1', createdAt: 'x', updatedAt: 'y', name: 'old' };
  const after  = { id: '2', createdAt: 'a', updatedAt: 'b', name: 'new' };
  const changes = buildChanges(before, after);
  const fields = changes.map(c => c.field);
  assert.ok(!fields.includes('id'));
  assert.ok(!fields.includes('createdAt'));
  assert.ok(!fields.includes('updatedAt'));
  assert.ok(fields.includes('name'));
});

test('buildChanges — unchanged arrays are not reported', () => {
  const before = { id: '1', updatedAt: 'y', programs: ['snap', 'medicaid'] };
  const after  = { id: '1', updatedAt: 'z', programs: ['snap', 'medicaid'] };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 0);
});

test('buildChanges — changed arrays are reported with full before/after', () => {
  const before = { id: '1', updatedAt: 'y', programs: ['snap'] };
  const after  = { id: '1', updatedAt: 'z', programs: ['snap', 'medicaid'] };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'programs', before: ['snap'], after: ['snap', 'medicaid'] });
});

test('buildChanges — unchanged objects are not reported', () => {
  const before = { id: '1', updatedAt: 'y', address: { city: 'Oakland', state: 'CA' } };
  const after  = { id: '1', updatedAt: 'z', address: { city: 'Oakland', state: 'CA' } };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 0);
});

test('buildChanges — captures rule-driven mutations not in the original PATCH', () => {
  // Simulates: PATCH sets isExpedited=true, and something else re-scores priority to "expedited"
  const before = { id: '1', updatedAt: 'y', isExpedited: false, priority: 'normal' };
  const after  = { id: '1', updatedAt: 'z', isExpedited: true,  priority: 'expedited' };
  const changes = buildChanges(before, after);
  const fields = changes.map(c => c.field).sort();
  assert.deepStrictEqual(fields, ['isExpedited', 'priority']);
});

test('buildChanges — field added after update is reported (before is null)', () => {
  const before = { id: '1', updatedAt: 'y' };
  const after  = { id: '1', updatedAt: 'z', queueId: 'snap-intake' };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'queueId', before: null, after: 'snap-intake' });
});

test('buildChanges — empty when nothing changed (excluding system fields)', () => {
  const before = { id: '1', createdAt: 'x', updatedAt: 'y', status: 'pending' };
  const after  = { id: '1', createdAt: 'x', updatedAt: 'z', status: 'pending' };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 0);
});

test('buildChanges — nested scalar change emits dot-path key', () => {
  const before = { id: '1', updatedAt: 'y', personalInformation: { dateOfBirth: '1990-01-01', firstName: 'Jane' } };
  const after  = { id: '1', updatedAt: 'z', personalInformation: { dateOfBirth: '1991-05-15', firstName: 'Jane' } };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'personalInformation.dateOfBirth', before: '1990-01-01', after: '1991-05-15' });
});

test('buildChanges — multiple nested fields changed emit separate dot-path entries', () => {
  const before = { id: '1', updatedAt: 'y', address: { city: 'Oakland', state: 'CA', zip: '94601' } };
  const after  = { id: '1', updatedAt: 'z', address: { city: 'Fresno',  state: 'CA', zip: '93701' } };
  const changes = buildChanges(before, after);
  const fields = changes.map(c => c.field).sort();
  assert.deepStrictEqual(fields, ['address.city', 'address.zip']);
});

test('buildChanges — deeply nested change (three levels) emits correct dot-path', () => {
  const before = { id: '1', updatedAt: 'y', contact: { phone: { number: '555-0100', type: 'cell' } } };
  const after  = { id: '1', updatedAt: 'z', contact: { phone: { number: '555-9999', type: 'cell' } } };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'contact.phone.number', before: '555-0100', after: '555-9999' });
});

test('buildChanges — unchanged sibling fields in nested object are not reported', () => {
  const before = { id: '1', updatedAt: 'y', name: { firstName: 'Jane', lastName: 'Doe' } };
  const after  = { id: '1', updatedAt: 'z', name: { firstName: 'Jane', lastName: 'Smith' } };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(changes[0].field, 'name.lastName');
});

test('buildChanges — nested array treated as leaf (whole array in before/after)', () => {
  const before = { id: '1', updatedAt: 'y', household: { members: ['Alice', 'Bob'] } };
  const after  = { id: '1', updatedAt: 'z', household: { members: ['Alice', 'Bob', 'Carol'] } };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'household.members', before: ['Alice', 'Bob'], after: ['Alice', 'Bob', 'Carol'] });
});

test('buildChanges — nested object added whole (before null) emits top-level field as leaf', () => {
  const before = { id: '1', updatedAt: 'y' };
  const after  = { id: '1', updatedAt: 'z', address: { city: 'Oakland', state: 'CA' } };
  const changes = buildChanges(before, after);
  assert.strictEqual(changes.length, 1);
  assert.deepStrictEqual(changes[0], { field: 'address', before: null, after: { city: 'Oakland', state: 'CA' } });
});

// =============================================================================
// What a PATCH is checked against
// =============================================================================

/** Boot a mock over a contract set, quietly, and send it requests. */
async function boot(contracts) {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  let mock;
  try { mock = await createMockServer({ contracts, store: createMemoryStore(), seed: true }); } finally { console.log = log; console.warn = warn; }
  return async (method, path, body) => {
    const response = await mock.fetch(new Request(`http://localhost${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

const ok = (schema, status = 200) => ({ [status]: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } });
const sends = (schema) => ({ requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } });

// A journal whose update schema allows only `name`, and whose notes require one.
const journal = {
  artifactVersion: 1,
  docs: [{
    path: '/x/domains/journal/journal-openapi.yaml',
    relativePath: 'domains/journal/journal-openapi.yaml',
    domain: 'journal',
    type: 'openapi',
    provenance: null,
    content: {
      openapi: '3.1.0',
      info: { title: 'Journal', version: '1', 'x-domain': 'journal' },
      servers: [{ url: 'http://localhost:1080/journal' }],
      paths: {
        '/notes': { get: { operationId: 'listNotes', responses: ok('NoteList') }, post: { operationId: 'createNote', ...sends('NoteCreate'), responses: ok('Note', 201) } },
        '/notes/{noteId}': {
          parameters: [{ name: 'noteId', in: 'path', required: true, schema: { type: 'string' } }],
          get: { operationId: 'getNote', responses: ok('Note') },
          patch: { operationId: 'updateNote', ...sends('NoteUpdate'), responses: ok('Note') },
        },
      },
      components: {
        schemas: {
          Note: {
            type: 'object', required: ['id', 'name'],
            properties: { id: { type: 'string', readOnly: true }, name: { type: 'string', minLength: 1 }, createdAt: { type: 'string' }, updatedAt: { type: 'string' } },
          },
          NoteCreate: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string' } } },
          NoteUpdate: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } },
          NoteList: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Note' } } } },
        },
      },
    },
  }],
};

describe('PATCH', () => {
  // The update schema is for what the client sends; the record's id and
  // timestamps were never part of it.
  test('a closed update schema accepts a change to a field it names', async () => {
    const send = await boot(journal);
    const { body: note } = await send('POST', '/journal/notes', { name: 'first' });
    const { status, body } = await send('PATCH', `/journal/notes/${note.id}`, { name: 'second' });
    assert.strictEqual(status, 200, JSON.stringify(body));
    assert.strictEqual(body.name, 'second');
  });

  test('a closed update schema refuses a field it does not name', async () => {
    const send = await boot(journal);
    const { body: note } = await send('POST', '/journal/notes', { name: 'first' });
    const { status, body } = await send('PATCH', `/journal/notes/${note.id}`, { title: 'not a field' });
    assert.strictEqual(status, 422);
    assert.ok(body.details.some((d) => d.field === 'title'), JSON.stringify(body));
  });

  test('the record a change leaves is checked against the resource\'s schema', async () => {
    const send = await boot(journal);
    const { body: note } = await send('POST', '/journal/notes', { name: 'first' });
    const { status } = await send('PATCH', `/journal/notes/${note.id}`, { name: '' });
    assert.strictEqual(status, 422);
  });

  // The framework's own TranscriptionProfileUpdate is closed.
  test('the framework\'s PATCH /communication/profiles/{profileId} succeeds', async () => {
    const send = await boot(JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8')));
    const { body: list } = await send('GET', '/communication/profiles?limit=1');
    const [profile] = list.items;
    const { status, body } = await send('PATCH', `/communication/profiles/${profile.id}`, { description: 'Changed.' });
    assert.strictEqual(status, 200, JSON.stringify(body));
    assert.strictEqual(body.description, 'Changed.');
  });
});
