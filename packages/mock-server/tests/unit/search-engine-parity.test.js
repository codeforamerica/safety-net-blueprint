/**
 * Parity tests: SQL path (executeSearch) vs JS path (filterItems + paginateItems).
 *
 * Each case runs the same query through both pipelines against identical data and
 * asserts that the resulting item IDs match. This is the living contract that
 * prevents the two implementations from diverging silently.
 *
 * SQL path:  executeSearch(db, queryParams, searchableFields, paginationDefaults)
 * JS path:   filterItems(items, queryParams)  +  paginateItems(filtered, queryParams)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { executeSearch, filterItems, paginateItems } from '../../src/search-engine.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Records are ordered oldest→newest so that SQL's ORDER BY createdAt DESC
// produces a predictable reverse order. Pagination parity tests rely on this.
const RECORDS = [
  {
    id: '1', name: 'Alice', status: 'active', age: 30,
    programs: ['snap', 'tanf'], city: 'Denver',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: '2', name: 'Bob', status: 'inactive', age: 25,
    programs: ['snap'], city: 'Austin',
    traceparent: '00-abc123abc123abc1-00f067aa0ba902b7-01',
    createdAt: '2024-01-02T00:00:00Z',
  },
  {
    id: '3', name: 'Carol', status: 'active', age: 40,
    programs: ['tanf'], city: 'Denver',
    createdAt: '2024-01-03T00:00:00Z',
  },
  {
    id: '4', name: 'Dave', status: 'pending', age: 35,
    programs: ['medicaid'], city: 'Austin',
    createdAt: '2024-01-04T00:00:00Z',
  },
  {
    id: '5', name: 'Eve', status: 'active', age: 28,
    createdAt: '2024-01-05T00:00:00Z',
  },
  // Frank has no status, age, programs, city, or traceparent — tests absent-field behavior.
  { id: '6', name: 'Frank', createdAt: '2024-01-06T00:00:00Z' },
];

function makeDb(records) {
  const db = new Database(':memory:');
  db.prepare('CREATE TABLE resources (id TEXT PRIMARY KEY, data TEXT NOT NULL)').run();
  for (const record of records) {
    db.prepare('INSERT INTO resources (id, data) VALUES (?, ?)').run(record.id, JSON.stringify(record));
  }
  return db;
}

// SQL orders createdAt DESC; pre-sort the JS array the same way so pagination
// slices land on the same items.
const RECORDS_DESC = [...RECORDS].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

function sortedIds(items) {
  return [...items].map(i => i.id).sort();
}

/**
 * Run a query through both pipelines and assert the resulting IDs match.
 * searchableFields defaults to [] (no restriction) to match what compositions use.
 */
function parity(label, queryParams, searchableFields = []) {
  test(label, () => {
    const db = makeDb(RECORDS);
    const sqlResult = executeSearch(db, queryParams, searchableFields, { limit: 100 });
    assert.ok(!sqlResult.error, `SQL error: ${JSON.stringify(sqlResult.error)}`);

    const jsFiltered = filterItems(RECORDS, queryParams);

    assert.deepStrictEqual(
      sortedIds(sqlResult.items),
      sortedIds(jsFiltered),
      `SQL=[${sortedIds(sqlResult.items)}] JS=[${sortedIds(jsFiltered)}]`
    );
  });
}

// ---------------------------------------------------------------------------
// q= token types
// ---------------------------------------------------------------------------

describe('parity — q= EXACT', () => {
  parity('matches a simple scalar field', { q: 'status:active' });
  parity('no match returns empty', { q: 'status:nonexistent' });
  parity('absent field — item excluded (SQL NULL = value → false)', { q: 'city:Denver' });
});

describe('parity — q= NOT_EQUAL', () => {
  // SQL emits `IS NULL OR != ?` so absent-field items are INCLUDED.
  parity('excludes matching items, includes absent-field items', { q: '-status:active' });
});

describe('parity — q= range operators', () => {
  parity('greater-than', { q: 'age:>30' });
  parity('greater-than-or-equal', { q: 'age:>=35' });
  parity('less-than', { q: 'age:<30' });
  parity('less-than-or-equal', { q: 'age:<=28' });
  parity('absent numeric field — excluded', { q: 'age:>0' });
});

describe('parity — q= IN / NOT_IN (comma-separated)', () => {
  // IN uses json_each in SQL, so it correctly matches array field values.
  parity('IN matches array field values', { q: 'programs:snap,tanf' });
  parity('NOT_IN — absent field included (SQL IS NULL OR NOT IN)', { q: '-programs:snap,tanf' });
});

describe('parity — q= EXISTS / NOT_EXISTS', () => {
  parity('EXISTS: items with field present', { q: 'status:*' });
  parity('NOT_EXISTS: items with field absent', { q: '-status:*' });
  parity('EXISTS on array field', { q: 'programs:*' });
});

describe('parity — q= multi-term AND', () => {
  parity('status:active AND age>28', { q: 'status:active age:>28' });
});

describe('parity — q= full-text', () => {
  parity('full-text match on name field value', { q: 'carol' });
});

// ---------------------------------------------------------------------------
// Plain field=value params
// ---------------------------------------------------------------------------

describe('parity — plain field=value', () => {
  parity('scalar field exact match', { status: 'active' });
  parity('absent field — item excluded', { city: 'Denver' });
  // SQL json_extract for array fields returns the JSON string (e.g. '["snap"]').
  // Scalar query: '["snap"]' = 'snap' → false → no match. Both SQL and JS exclude.
  parity('scalar query against array field — no match (SQL json_extract != scalar)', { programs: 'snap' });
  // Array query: SQL uses json_each, JS uses intersection check.
  parity('array query against array field — intersection match', { programs: ['snap'] });
});

describe('parity — traceid param', () => {
  parity('maps to traceparent LIKE %-{traceid}-%', { traceid: '4bf92f3577b34da6a3ce929d0e0e4736' });
  parity('non-matching traceid returns empty', { traceid: 'doesnotexist00000000000000000000' });
  parity('absent traceparent — excluded', { traceid: 'abc123abc123abc1' });
});

// ---------------------------------------------------------------------------
// Pagination parity
// ---------------------------------------------------------------------------

describe('parity — pagination', () => {
  test('limit+offset produce the same slice from the filtered set', () => {
    const queryParams = { q: 'status:active', limit: '2', offset: '0' };
    const db = makeDb(RECORDS);

    // SQL path
    const sqlResult = executeSearch(db, queryParams, [], { limit: 100 });
    assert.ok(!sqlResult.error);

    // JS path — items pre-sorted createdAt DESC to match SQL ORDER BY
    const jsFiltered = filterItems(RECORDS_DESC, queryParams);
    const jsPaginated = paginateItems(jsFiltered, queryParams);

    assert.deepStrictEqual(sortedIds(sqlResult.items), sortedIds(jsPaginated.items));
    assert.strictEqual(sqlResult.total, jsPaginated.total);
    assert.strictEqual(sqlResult.limit, jsPaginated.limit);
    assert.strictEqual(sqlResult.offset, jsPaginated.offset);
    assert.strictEqual(sqlResult.hasNext, jsPaginated.hasNext);
  });

  test('second page (offset=2) matches between SQL and JS', () => {
    const queryParams = { q: 'status:active', limit: '2', offset: '2' };
    const db = makeDb(RECORDS);

    const sqlResult = executeSearch(db, queryParams, [], { limit: 100 });
    assert.ok(!sqlResult.error);

    const jsFiltered = filterItems(RECORDS_DESC, queryParams);
    const jsPaginated = paginateItems(jsFiltered, queryParams);

    assert.deepStrictEqual(sortedIds(sqlResult.items), sortedIds(jsPaginated.items));
    assert.strictEqual(sqlResult.total, jsPaginated.total);
    assert.strictEqual(sqlResult.hasNext, jsPaginated.hasNext);
  });
});
