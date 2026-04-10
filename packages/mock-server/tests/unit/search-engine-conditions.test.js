/**
 * Unit tests for buildSearchConditions
 * Tests field filtering logic including special-case parameters like traceid
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { buildSearchConditions } from '../../src/search-engine.js';

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

  await t.test('skips reserved parameters (limit, offset, page, q, search)', () => {
    const { whereClauses } = buildSearchConditions({ limit: '10', offset: '0', page: '1', q: 'foo', search: 'bar' });

    assert.strictEqual(whereClauses.length, 0, 'Should produce no WHERE clauses for reserved params');
    console.log('  ✓ Skips reserved parameters');
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

console.log('\n✓ All buildSearchConditions tests passed\n');
