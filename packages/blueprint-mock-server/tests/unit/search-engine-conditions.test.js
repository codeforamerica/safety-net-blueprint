/**
 * Unit tests for buildSearchConditions and executeSearch (nested field coverage)
 * Tests field filtering logic including special-case parameters like traceid,
 * and verifies that json_tree() actually finds values in nested JSON fields.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { buildSearchConditions, executeSearch } from '../../src/search-engine.js';

/**
 * Create a minimal in-memory SQLite database seeded with one record.
 * @param {Object} resource - The JSON resource to insert
 * @returns {Database} In-memory database instance
 */
function makeDb(resource) {
  const db = new Database(':memory:');
  db.prepare('CREATE TABLE resources (id TEXT PRIMARY KEY, data TEXT NOT NULL)').run();
  db.prepare('INSERT INTO resources (id, data) VALUES (?, ?)').run(
    resource.id,
    JSON.stringify(resource)
  );
  return db;
}

test('buildSearchConditions', async (t) => {

  // ==========================================================================
  // Standard field filters
  // ==========================================================================

  await t.test('exact match for a simple field', () => {
    const { whereClauses, params } = buildSearchConditions({ source: '/intake' });

    assert.strictEqual(whereClauses.length, 1);
    assert.ok(whereClauses[0].includes("json_extract(data, '$.source')"));
    assert.strictEqual(params[0], '/intake');
    console.log('  ✓ Produces exact-match clause for simple field');
  });

  await t.test('skips pagination parameters (limit, offset, page)', () => {
    const { whereClauses } = buildSearchConditions({ limit: '10', offset: '0', page: '1' });

    assert.strictEqual(whereClauses.length, 0, 'Should produce no WHERE clauses for pagination params');
    console.log('  ✓ Skips pagination parameters');
  });

  await t.test('search parameter produces json_tree clause', () => {
    const { whereClauses, params } = buildSearchConditions({ search: 'bar' });

    assert.strictEqual(whereClauses.length, 1);
    assert.ok(whereClauses[0].includes('json_tree'), 'Should use json_tree for search');
    assert.ok(params[0].includes('bar'), 'Param should contain the search term');
    console.log('  ✓ search parameter produces json_tree clause');
  });

  await t.test('empty value produces no clause', () => {
    const { whereClauses } = buildSearchConditions({ source: '' });

    assert.strictEqual(whereClauses.length, 0);
    console.log('  ✓ Empty value produces no clause');
  });

  // ==========================================================================
  // traceid — special case: match against traceparent field
  // ==========================================================================

  await t.test('traceid produces LIKE clause against traceparent field', () => {
    const { whereClauses, params } = buildSearchConditions({ traceid: '4bf92f3577b34da6a3ce929d0e0e4736' });

    assert.strictEqual(whereClauses.length, 1);
    assert.ok(whereClauses[0].includes("json_extract(data, '$.traceparent')"), 'Clause should reference traceparent');
    assert.ok(whereClauses[0].toLowerCase().includes('like'), 'Clause should use LIKE');
    assert.ok(params[0].includes('4bf92f3577b34da6a3ce929d0e0e4736'), 'Param should contain the trace ID');
    console.log('  ✓ traceid produces LIKE clause against traceparent');
  });

  await t.test('traceid does not produce exact match against traceid field', () => {
    const { whereClauses } = buildSearchConditions({ traceid: '4bf92f3577b34da6a3ce929d0e0e4736' });

    const hasExactTraceidMatch = whereClauses.some(c => c.includes("'$.traceid'"));
    assert.strictEqual(hasExactTraceidMatch, false, 'Should not produce exact match on traceid field');
    console.log('  ✓ traceid does not produce exact match on traceid field');
  });

  await t.test('empty traceid produces no clause', () => {
    const { whereClauses } = buildSearchConditions({ traceid: '' });

    assert.strictEqual(whereClauses.length, 0);
    console.log('  ✓ Empty traceid produces no clause');
  });

  await t.test('traceid and other filters combine correctly', () => {
    const { whereClauses, params } = buildSearchConditions({
      traceid: '4bf92f3577b34da6a3ce929d0e0e4736',
      source: '/intake'
    });

    assert.strictEqual(whereClauses.length, 2);
    assert.ok(whereClauses.some(c => c.includes('traceparent')));
    assert.ok(whereClauses.some(c => c.includes("'$.source'")));
    assert.ok(params.some(p => p.includes('4bf92f3577b34da6a3ce929d0e0e4736')));
    assert.ok(params.some(p => p === '/intake'));
    console.log('  ✓ traceid and other filters combine correctly');
  });

});

// ==========================================================================
// executeSearch — actual SQLite execution with nested JSON
// Verifies that json_tree() finds values at any nesting depth.
// ==========================================================================

test('executeSearch — nested field search', async (t) => {
  const record = {
    id: 'test-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    name: {
      firstName: 'Avery',
      lastName: 'Johnson',
    },
    household: {
      members: [
        { name: { firstName: 'Morgan', lastName: 'Lee' } },
      ],
    },
    status: 'active',
  };

  const db = makeDb(record);

  await t.test('search finds value in top-level nested object (name.firstName)', () => {
    const result = executeSearch(db, { search: 'Avery' }, []);
    assert.strictEqual(result.total, 1, 'Should find record by nested firstName');
    assert.strictEqual(result.items[0].id, 'test-1');
    console.log('  ✓ Finds value in top-level nested object');
  });

  await t.test('search finds value deep in array of objects (household.members[].name.firstName)', () => {
    const result = executeSearch(db, { search: 'Morgan' }, []);
    assert.strictEqual(result.total, 1, 'Should find record by deeply nested firstName');
    assert.strictEqual(result.items[0].id, 'test-1');
    console.log('  ✓ Finds value deep in array of objects');
  });

  await t.test('search is case-insensitive', () => {
    const result = executeSearch(db, { search: 'avery' }, []);
    assert.strictEqual(result.total, 1, 'Search should be case-insensitive');
    console.log('  ✓ Search is case-insensitive');
  });

  await t.test('search returns no results for non-matching term', () => {
    const result = executeSearch(db, { search: 'Nonexistent' }, []);
    assert.strictEqual(result.total, 0, 'Should return no results for non-matching term');
    console.log('  ✓ Returns no results for non-matching term');
  });

  await t.test('q full-text finds value in nested field', () => {
    const result = executeSearch(db, { q: '*Avery*' }, []);
    assert.strictEqual(result.total, 1, 'q full-text should find nested value');
    console.log('  ✓ q full-text finds value in nested field');
  });

  db.close();
});

console.log('\n✓ All buildSearchConditions tests passed\n');
