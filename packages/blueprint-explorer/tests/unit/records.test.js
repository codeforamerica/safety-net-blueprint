/**
 * The mock's records, carried between explorer pages through the tab's
 * session storage (src/try-it/records.js).
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '@codeforamerica/blueprint-mock-server/store';
import { restoreRecords, saveRecords } from '../../src/try-it/records.js';

const storage = new Map();
globalThis.sessionStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => { storage.set(key, String(value)); },
};
beforeEach(() => storage.clear());

const mockWith = (records) => {
  const store = createMemoryStore();
  for (const [collection, items] of Object.entries(records)) {
    for (const item of items) store.insertResource(collection, item);
  }
  return { store };
};
const ids = (mock, collection) => mock.store.findAll(collection, {}, { limit: null }).items.map((r) => r.id);
const where = { scope: 'file:///explorer/mock/', version: 'v1' };

test('what one page saves, the next restores', () => {
  saveRecords(mockWith({ 'intake/applications': [{ id: 'made-here' }] }), where);
  const next = mockWith({ 'intake/applications': [{ id: 'seeded' }] });
  assert.equal(restoreRecords(next, where), true);
  assert.deepEqual(ids(next, 'intake/applications'), ['made-here']);
});

test('records saved against other contracts are not restored', () => {
  saveRecords(mockWith({ 'intake/applications': [{ id: 'made-here' }] }), where);
  const next = mockWith({ 'intake/applications': [{ id: 'seeded' }] });
  assert.equal(restoreRecords(next, { ...where, version: 'v2' }), false);
  assert.deepEqual(ids(next, 'intake/applications'), ['seeded']);
});

test('another explorer\'s records are kept apart', () => {
  saveRecords(mockWith({ 'intake/applications': [{ id: 'made-here' }] }), where);
  assert.equal(restoreRecords(mockWith({}), { ...where, scope: 'https://example.org/other/mock/' }), false);
});

test('a collection the saved records lack is emptied, so a page left empty stays empty', () => {
  saveRecords(mockWith({}), where);
  const next = mockWith({ 'intake/applications': [{ id: 'seeded' }] });
  restoreRecords(next, where);
  assert.deepEqual(ids(next, 'intake/applications'), []);
});

test('nothing saved leaves the page as it started', () => {
  const next = mockWith({ 'intake/applications': [{ id: 'seeded' }] });
  assert.equal(restoreRecords(next, where), false);
  assert.deepEqual(ids(next, 'intake/applications'), ['seeded']);
});
