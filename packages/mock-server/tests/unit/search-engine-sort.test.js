/**
 * Unit tests for executeSearch's sort handling.
 *
 * Phase 4 of #288. Verifies executeSearch:
 *   - Honors sortConfig.default when ?sort= is absent
 *   - Honors ?sort= when provided and sortConfig allows it
 *   - Appends the configured tieBreaker for stable pagination
 *   - Returns an {error: {code, ...}} shape on parser failure so the
 *     list handler can translate it into a 400 response
 *   - Rejects ?sort= on endpoints without x-sortable
 */

import { test } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { executeSearch } from '../../src/search-engine.js';

function makeDb(records) {
  const db = new Database(':memory:');
  db.prepare('CREATE TABLE resources (id TEXT PRIMARY KEY, data TEXT NOT NULL)').run();
  const insert = db.prepare('INSERT INTO resources (id, data) VALUES (?, ?)');
  for (const r of records) insert.run(r.id, JSON.stringify(r));
  return db;
}

// Fixture: 4 tasks with overlapping priorities and ascending dueDates
const tasks = [
  { id: 'a', priority: 'high', dueDate: '2026-01-01', createdAt: '2026-05-01T00:00:00Z' },
  { id: 'b', priority: 'high', dueDate: '2026-02-01', createdAt: '2026-05-02T00:00:00Z' },
  { id: 'c', priority: 'low',  dueDate: '2026-01-15', createdAt: '2026-05-03T00:00:00Z' },
  { id: 'd', priority: 'low',  dueDate: '2026-03-01', createdAt: '2026-05-04T00:00:00Z' },
];

const sortConfig = {
  fields: ['createdAt', 'priority', 'dueDate'],
  default: '-createdAt',
  tieBreaker: 'id',
};

test('executeSearch — sort handling', async (t) => {
  await t.test('?sort= absent applies sortConfig.default', () => {
    const db = makeDb(tasks);
    const result = executeSearch(db, {}, [], {}, sortConfig);
    assert.ok(result.items, JSON.stringify(result));
    // default: -createdAt → newest first
    assert.deepStrictEqual(result.items.map(r => r.id), ['d', 'c', 'b', 'a']);
    console.log('  ✓ Default sort applied when ?sort= absent');
  });

  await t.test('?sort= overrides sortConfig.default', () => {
    const db = makeDb(tasks);
    const result = executeSearch(db, { sort: 'createdAt' }, [], {}, sortConfig);
    assert.deepStrictEqual(result.items.map(r => r.id), ['a', 'b', 'c', 'd']);
    console.log('  ✓ ?sort= overrides default');
  });

  await t.test('multi-field sort respects declaration order', () => {
    const db = makeDb(tasks);
    const result = executeSearch(db, { sort: 'priority,dueDate' }, [], {}, sortConfig);
    // priority ASC ("high" < "low" alphabetically), then dueDate ASC
    assert.deepStrictEqual(result.items.map(r => r.id), ['a', 'b', 'c', 'd']);
    console.log('  ✓ Multi-field sort works');
  });

  await t.test('tieBreaker (id) keeps pagination stable across pages', () => {
    const db = makeDb(tasks);
    const page1 = executeSearch(db, { sort: 'priority', limit: 2, offset: 0 }, [], { limitDefault: 2 }, sortConfig);
    const page2 = executeSearch(db, { sort: 'priority', limit: 2, offset: 2 }, [], { limitDefault: 2 }, sortConfig);
    const allIds = [...page1.items.map(r => r.id), ...page2.items.map(r => r.id)];
    assert.strictEqual(new Set(allIds).size, 4, 'no duplicates across pages');
    assert.deepStrictEqual(allIds.sort(), ['a', 'b', 'c', 'd'], 'all 4 records present');
    console.log('  ✓ Pagination stable with tieBreaker');
  });

  await t.test('FIELD_NOT_SORTABLE on field outside allowlist', () => {
    const db = makeDb(tasks);
    const result = executeSearch(db, { sort: 'description' }, [], {}, sortConfig);
    assert.ok(result.error, JSON.stringify(result));
    assert.strictEqual(result.error.code, 'FIELD_NOT_SORTABLE');
    assert.strictEqual(result.error.field, 'description');
    console.log('  ✓ Outside-allowlist field returns FIELD_NOT_SORTABLE');
  });

  await t.test('INVALID_SORT_FIELD on hostile input', () => {
    const db = makeDb(tasks);
    const result = executeSearch(db, { sort: "priority'; DROP TABLE x" }, [], {}, sortConfig);
    assert.ok(result.error);
    assert.strictEqual(result.error.code, 'INVALID_SORT_FIELD');
    console.log('  ✓ Hostile input returns INVALID_SORT_FIELD');
  });

  await t.test('endpoint without x-sortable rejects any ?sort= as INVALID_SORT_FIELD', () => {
    const db = makeDb(tasks);
    // No sortConfig passed
    const result = executeSearch(db, { sort: 'createdAt' }, [], {}, undefined);
    assert.ok(result.error);
    assert.strictEqual(result.error.code, 'INVALID_SORT_FIELD');
    console.log('  ✓ Missing x-sortable rejects ?sort=');
  });

  await t.test('endpoint without x-sortable with no ?sort= still returns results', () => {
    const db = makeDb(tasks);
    const result = executeSearch(db, {}, [], {}, undefined);
    assert.ok(result.items);
    assert.strictEqual(result.items.length, 4);
    console.log('  ✓ Missing x-sortable still serves unsorted queries');
  });

  await t.test('endpoint without x-sortable preserves legacy fallback ORDER BY createdAt DESC', () => {
    // Legacy behavior preserved for endpoints that haven't migrated yet
    const db = makeDb(tasks);
    const result = executeSearch(db, {}, [], {}, undefined);
    assert.deepStrictEqual(result.items.map(r => r.id), ['d', 'c', 'b', 'a']);
    console.log('  ✓ Legacy fallback ordering preserved');
  });

  await t.test('default sort applies even when sortConfig.default fields differ from ?sort= absent', () => {
    // Verifies the default is parsed through sort-parser, so its validity
    // is asserted at runtime too (not just at lint time).
    const db = makeDb(tasks);
    const localConfig = { ...sortConfig, default: 'priority,dueDate' };
    const result = executeSearch(db, {}, [], {}, localConfig);
    assert.deepStrictEqual(result.items.map(r => r.id), ['a', 'b', 'c', 'd']);
    console.log('  ✓ Custom default sort applied');
  });

  await t.test('tieBreaker null leaves order non-deterministic but still returns rows', () => {
    const db = makeDb(tasks);
    const localConfig = { fields: ['priority'], tieBreaker: null };
    const result = executeSearch(db, { sort: 'priority' }, [], {}, localConfig);
    assert.strictEqual(result.items.length, 4);
    console.log('  ✓ tieBreaker: null still returns rows');
  });

  await t.test('sort parameter is reserved — not treated as a field filter (regression)', () => {
    // Bug: prior to this guard, buildSearchConditions would iterate
    // queryParams and treat `sort` as an exact-match field filter,
    // adding `WHERE json_extract(data, '$.sort') = 'createdAt'` which
    // matches zero rows. The reserved-param list in buildSearchConditions
    // must include `sort` alongside limit/offset/q/search/page.
    const db = makeDb(tasks);
    const result = executeSearch(db, { sort: 'createdAt' }, [], {}, sortConfig);
    assert.ok(!result.error, JSON.stringify(result));
    assert.strictEqual(result.items.length, 4,
      'sort param must not act as a WHERE filter');
    console.log('  ✓ sort is reserved (not field-filtered)');
  });
});

console.log('\n✓ All executeSearch sort tests passed\n');
