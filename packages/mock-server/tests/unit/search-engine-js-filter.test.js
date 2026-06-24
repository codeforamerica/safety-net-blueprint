/**
 * Unit tests for JS-native collection utilities: filterItems and paginateItems.
 * These functions operate on in-memory JS arrays (assembled composition results)
 * rather than SQL — they are the correct layer for filtering composed resources.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { filterItems, paginateItems, sortItems } from '../../src/search-engine.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ITEMS = [
  { id: '1', firstName: 'Alice', lastName: 'Smith', status: 'active', age: 30, address: { city: 'Denver' } },
  { id: '2', firstName: 'Bob',   lastName: 'Jones', status: 'inactive', age: 25, address: { city: 'Austin' } },
  { id: '3', firstName: 'Carol', lastName: 'Smith', status: 'active', age: 40, address: { city: 'Denver' } },
  { id: '4', firstName: 'Dave',  lastName: 'Brown', status: 'pending', age: 35, address: { city: 'Austin' } },
  { id: '5', firstName: 'Eve',   lastName: 'Jones', status: 'active', age: 28, address: { city: 'Denver' } },
];

// ---------------------------------------------------------------------------
// filterItems — q= syntax
// ---------------------------------------------------------------------------

describe('filterItems — q= syntax', () => {
  test('q= exact field match returns matching items', () => {
    const result = filterItems(ITEMS, { q: 'status:active' });
    assert.strictEqual(result.length, 3);
    assert.ok(result.every(i => i.status === 'active'));
  });

  test('q= negation excludes matching items', () => {
    const result = filterItems(ITEMS, { q: '-status:active' });
    assert.strictEqual(result.length, 2);
    assert.ok(result.every(i => i.status !== 'active'));
  });

  test('q= range operator greater-than', () => {
    const result = filterItems(ITEMS, { q: 'age:>30' });
    assert.ok(result.every(i => i.age > 30));
    assert.ok(result.some(i => i.id === '3'));
    assert.ok(result.some(i => i.id === '4'));
  });

  test('q= multi-term ANDs conditions', () => {
    // Alice (id:1) and Carol (id:3) are both active Smiths
    const result = filterItems(ITEMS, { q: 'status:active lastName:Smith' });
    assert.strictEqual(result.length, 2);
    assert.ok(result.every(i => i.status === 'active' && i.lastName === 'Smith'));
  });

  test('q= OR values (comma-separated)', () => {
    const result = filterItems(ITEMS, { q: 'lastName:Smith,Jones' });
    assert.strictEqual(result.length, 4);
  });

  test('q= dot-notation nested field', () => {
    const result = filterItems(ITEMS, { q: 'address.city:Denver' });
    assert.strictEqual(result.length, 3);
    assert.ok(result.every(i => i.address.city === 'Denver'));
  });

  test('q= on field absent from items — item excluded (matches SQL NULL behavior)', () => {
    const result = filterItems(ITEMS, { q: 'nonexistentField:whatever' });
    assert.strictEqual(result.length, 0);
  });

  test('q= exists check (field:*)', () => {
    const partial = [
      { id: 'a', name: 'With status', status: 'active' },
      { id: 'b', name: 'Without status' },
    ];
    const result = filterItems(partial, { q: 'status:*' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'a');
  });
});

// ---------------------------------------------------------------------------
// filterItems — search= (legacy full-text)
// ---------------------------------------------------------------------------

describe('filterItems — search= legacy full-text', () => {
  test('search= matches substring anywhere in item JSON', () => {
    const result = filterItems(ITEMS, { search: 'alice' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].firstName, 'Alice');
  });

  test('search= is case-insensitive', () => {
    const result = filterItems(ITEMS, { search: 'SMITH' });
    assert.strictEqual(result.length, 2);
  });
});

// ---------------------------------------------------------------------------
// filterItems — plain field=value params
// ---------------------------------------------------------------------------

describe('filterItems — plain field=value params', () => {
  test('exact field match filters correctly', () => {
    const result = filterItems(ITEMS, { status: 'active' });
    assert.strictEqual(result.length, 3);
  });

  test('field absent on item — excluded (matches SQL NULL behavior)', () => {
    const partial = [
      { id: 'a', name: 'Has status', status: 'active' },
      { id: 'b', name: 'No status field' },
    ];
    const result = filterItems(partial, { status: 'active' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'a');
  });

  test('dot-notation nested field', () => {
    const result = filterItems(ITEMS, { 'address.city': 'Denver' });
    assert.strictEqual(result.length, 3);
  });

  test('reserved params are not treated as field filters', () => {
    // If limit/offset were treated as field filters they would match nothing (no `limit` field)
    // and return all items — but that's because the field is absent (condition ignored).
    // The real test: reserved keys don't end up in field-filter loop.
    const result = filterItems(ITEMS, { limit: '10', offset: '0' });
    assert.strictEqual(result.length, ITEMS.length, 'reserved params do not reduce results');
  });

  test('plain field params are skipped when q= is also present', () => {
    // q= takes precedence; lastName is not applied as an additional exact filter
    const result = filterItems(ITEMS, { q: 'status:active', lastName: 'Smith' });
    // Only q= is applied → 3 active items (not just 1)
    assert.strictEqual(result.length, 3);
  });
});

// ---------------------------------------------------------------------------
// filterItems — edge cases
// ---------------------------------------------------------------------------

describe('filterItems — edge cases', () => {
  test('empty items array returns same empty array', () => {
    const result = filterItems([], { q: 'status:active' });
    assert.deepStrictEqual(result, []);
  });

  test('null items returns null', () => {
    const result = filterItems(null, { q: 'status:active' });
    assert.strictEqual(result, null);
  });

  test('no queryParams returns all items', () => {
    const result = filterItems(ITEMS, {});
    assert.strictEqual(result.length, ITEMS.length);
  });
});

// ---------------------------------------------------------------------------
// paginateItems
// ---------------------------------------------------------------------------

describe('paginateItems', () => {
  test('returns correct slice for first page', () => {
    const result = paginateItems(ITEMS, { limit: '2', offset: '0' });
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0].id, '1');
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.limit, 2);
    assert.strictEqual(result.offset, 0);
    assert.strictEqual(result.hasNext, true);
  });

  test('returns correct slice for second page', () => {
    const result = paginateItems(ITEMS, { limit: '2', offset: '2' });
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0].id, '3');
    assert.strictEqual(result.hasNext, true);
  });

  test('last page sets hasNext false', () => {
    const result = paginateItems(ITEMS, { limit: '3', offset: '3' });
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.hasNext, false);
  });

  test('uses default limit when not specified', () => {
    const result = paginateItems(ITEMS, {}, { limit: 10 });
    assert.strictEqual(result.limit, 10);
    assert.strictEqual(result.total, 5);
  });

  test('total reflects pre-pagination item count', () => {
    const result = paginateItems(ITEMS, { limit: '2' });
    assert.strictEqual(result.total, 5);
  });

  test('offset beyond total returns empty items with hasNext false', () => {
    const result = paginateItems(ITEMS, { limit: '10', offset: '100' });
    assert.deepStrictEqual(result.items, []);
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.hasNext, false);
  });

  test('returns all items when limit exceeds total', () => {
    const result = paginateItems(ITEMS, { limit: '100' });
    assert.strictEqual(result.items.length, 5);
    assert.strictEqual(result.hasNext, false);
  });
});

// ---------------------------------------------------------------------------
// sortItems
// ---------------------------------------------------------------------------

const SORT_CONFIG = { fields: ['firstName', 'lastName', 'age', 'address.city'] };

describe('sortItems — no sortConfig', () => {
  test('no ?sort= with no sortConfig — returns items unchanged', () => {
    const result = sortItems(ITEMS, {}, undefined);
    assert.ok(!result.error);
    assert.strictEqual(result.items.length, ITEMS.length);
  });

  test('?sort= with no sortConfig — returns INVALID_SORT_FIELD error', () => {
    const result = sortItems(ITEMS, { sort: 'firstName:asc' }, undefined);
    assert.ok(result.error);
    assert.strictEqual(result.error.code, 'INVALID_SORT_FIELD');
  });
});

describe('sortItems — sort direction', () => {
  test('ascending sort by firstName', () => {
    const result = sortItems(ITEMS, { sort: 'firstName' }, SORT_CONFIG);
    assert.ok(!result.error);
    const names = result.items.map(i => i.firstName);
    assert.deepStrictEqual(names, [...names].sort());
  });

  test('descending sort by firstName', () => {
    const result = sortItems(ITEMS, { sort: '-firstName' }, SORT_CONFIG);
    assert.ok(!result.error);
    const names = result.items.map(i => i.firstName);
    assert.deepStrictEqual(names, [...names].sort().reverse());
  });

  test('default sort expression applied when no ?sort=', () => {
    const config = { ...SORT_CONFIG, default: 'firstName' };
    const result = sortItems(ITEMS, {}, config);
    assert.ok(!result.error);
    const names = result.items.map(i => i.firstName);
    assert.deepStrictEqual(names, [...names].sort());
  });
});

describe('sortItems — null ordering', () => {
  test('null values sort last for ASC', () => {
    const items = [
      { id: '1', age: null },
      { id: '2', age: 10 },
      { id: '3', age: 5 },
    ];
    const result = sortItems(items, { sort: 'age' }, { fields: ['age'] });
    assert.ok(!result.error);
    assert.strictEqual(result.items[0].id, '3');
    assert.strictEqual(result.items[1].id, '2');
    assert.strictEqual(result.items[2].id, '1');
  });

  test('null values sort first for DESC', () => {
    const items = [
      { id: '1', age: 10 },
      { id: '2', age: null },
      { id: '3', age: 5 },
    ];
    const result = sortItems(items, { sort: '-age' }, { fields: ['age'] });
    assert.ok(!result.error);
    assert.strictEqual(result.items[0].id, '2');
  });
});

describe('sortItems — tieBreaker', () => {
  test('defaults to id ASC when tieBreaker not set', () => {
    const items = [
      { id: 'b', status: 'active' },
      { id: 'a', status: 'active' },
    ];
    const result = sortItems(items, {}, { fields: ['status'], default: 'status' });
    assert.ok(!result.error);
    assert.strictEqual(result.items[0].id, 'a');
  });

  test('tieBreaker: null disables tie-breaking', () => {
    const items = [
      { id: 'b', status: 'active' },
      { id: 'a', status: 'active' },
    ];
    const result = sortItems(items, {}, { fields: ['status'], default: 'status', tieBreaker: null });
    assert.ok(!result.error);
    assert.strictEqual(result.items.length, 2);
  });
});

describe('sortItems — validation errors', () => {
  test('unknown sort field returns FIELD_NOT_SORTABLE', () => {
    const result = sortItems(ITEMS, { sort: 'unknownField' }, SORT_CONFIG);
    assert.ok(result.error);
    assert.strictEqual(result.error.code, 'FIELD_NOT_SORTABLE');
  });

  test('empty items returns empty result without error', () => {
    const result = sortItems([], { sort: 'firstName' }, SORT_CONFIG);
    assert.ok(!result.error);
    assert.deepStrictEqual(result.items, []);
  });
});
