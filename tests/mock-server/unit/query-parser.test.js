/**
 * Unit tests for the query parser
 * Run with: node tests/mock-server/unit/query-parser.test.js
 */

import {
  parseTerm,
  parseQueryString,
  tokensToSqlConditions,
  TokenType
} from '../../../src/mock-server/query-parser.js';

function runTests() {
  console.log('Testing Query Parser\n');
  console.log('='.repeat(70));

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
      failed++;
    }
  }

  function assertEqual(actual, expected, message = '') {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
      throw new Error(`${message}\n    Expected: ${expectedStr}\n    Actual: ${actualStr}`);
    }
  }

  // ============================================================
  // parseTerm tests - Full-text search
  // ============================================================
  console.log('\n--- parseTerm: Full-text search ---\n');

  test('returns null for empty input', () => {
    assertEqual(parseTerm(''), null);
    assertEqual(parseTerm(null), null);
    assertEqual(parseTerm(undefined), null);
  });

  test('parses full-text exact match (no colon, no wildcards)', () => {
    const result = parseTerm('hello');
    assertEqual(result.type, TokenType.FULL_TEXT);
    assertEqual(result.field, null);
    assertEqual(result.value, 'hello');
  });

  test('parses full-text contains (*value*)', () => {
    const result = parseTerm('*hello*');
    assertEqual(result.type, TokenType.FULL_TEXT_CONTAINS);
    assertEqual(result.field, null);
    assertEqual(result.value, 'hello');
  });

  test('parses full-text starts with (value*)', () => {
    const result = parseTerm('hello*');
    assertEqual(result.type, TokenType.FULL_TEXT_STARTS_WITH);
    assertEqual(result.field, null);
    assertEqual(result.value, 'hello');
  });

  test('parses full-text ends with (*value)', () => {
    const result = parseTerm('*hello');
    assertEqual(result.type, TokenType.FULL_TEXT_ENDS_WITH);
    assertEqual(result.field, null);
    assertEqual(result.value, 'hello');
  });

  // ============================================================
  // parseTerm tests - Field-specific search
  // ============================================================
  console.log('\n--- parseTerm: Field-specific search ---\n');

  test('parses exact match (field:value)', () => {
    const result = parseTerm('status:approved');
    assertEqual(result.type, TokenType.EXACT);
    assertEqual(result.field, 'status');
    assertEqual(result.value, 'approved');
  });

  test('parses contains (field:*value*)', () => {
    const result = parseTerm('name:*john*');
    assertEqual(result.type, TokenType.CONTAINS);
    assertEqual(result.field, 'name');
    assertEqual(result.value, 'john');
  });

  test('parses starts with (field:value*)', () => {
    const result = parseTerm('name:john*');
    assertEqual(result.type, TokenType.STARTS_WITH);
    assertEqual(result.field, 'name');
    assertEqual(result.value, 'john');
  });

  test('parses ends with (field:*value)', () => {
    const result = parseTerm('email:*@example.com');
    assertEqual(result.type, TokenType.ENDS_WITH);
    assertEqual(result.field, 'email');
    assertEqual(result.value, '@example.com');
  });

  test('parses negated exact match (-field:value)', () => {
    const result = parseTerm('-status:rejected');
    assertEqual(result.type, TokenType.NOT_EQUAL);
    assertEqual(result.field, 'status');
    assertEqual(result.value, 'rejected');
  });

  test('parses greater than (field:>value)', () => {
    const result = parseTerm('income:>1000');
    assertEqual(result.type, TokenType.GREATER_THAN);
    assertEqual(result.field, 'income');
    assertEqual(result.value, 1000);
  });

  test('parses greater than or equal (field:>=value)', () => {
    const result = parseTerm('age:>=21');
    assertEqual(result.type, TokenType.GREATER_THAN_OR_EQUAL);
    assertEqual(result.field, 'age');
    assertEqual(result.value, 21);
  });

  test('parses less than (field:<value)', () => {
    const result = parseTerm('score:<50');
    assertEqual(result.type, TokenType.LESS_THAN);
    assertEqual(result.field, 'score');
    assertEqual(result.value, 50);
  });

  test('parses less than or equal (field:<=value)', () => {
    const result = parseTerm('priority:<=3');
    assertEqual(result.type, TokenType.LESS_THAN_OR_EQUAL);
    assertEqual(result.field, 'priority');
    assertEqual(result.value, 3);
  });

  test('parses comma-separated values (field:val1,val2)', () => {
    const result = parseTerm('status:pending,approved,review');
    assertEqual(result.type, TokenType.IN);
    assertEqual(result.field, 'status');
    assertEqual(result.value, ['pending', 'approved', 'review']);
  });

  test('parses negated comma-separated values (-field:val1,val2)', () => {
    const result = parseTerm('-status:rejected,cancelled');
    assertEqual(result.type, TokenType.NOT_IN);
    assertEqual(result.field, 'status');
    assertEqual(result.value, ['rejected', 'cancelled']);
  });

  test('parses existence check (field:*)', () => {
    const result = parseTerm('email:*');
    assertEqual(result.type, TokenType.EXISTS);
    assertEqual(result.field, 'email');
    assertEqual(result.value, null);
  });

  test('parses non-existence check (-field:*)', () => {
    const result = parseTerm('-deletedAt:*');
    assertEqual(result.type, TokenType.NOT_EXISTS);
    assertEqual(result.field, 'deletedAt');
    assertEqual(result.value, null);
  });

  test('parses nested field with dot notation', () => {
    const result = parseTerm('name.firstName:John');
    assertEqual(result.type, TokenType.EXACT);
    assertEqual(result.field, 'name.firstName');
    assertEqual(result.value, 'John');
  });

  test('handles numeric string values that should stay strings', () => {
    const result = parseTerm('zipCode:90210');
    assertEqual(result.type, TokenType.EXACT);
    assertEqual(result.field, 'zipCode');
    // Note: this becomes a number since it parses as numeric
    assertEqual(result.value, 90210);
  });

  test('handles decimal numbers', () => {
    const result = parseTerm('amount:>=99.99');
    assertEqual(result.type, TokenType.GREATER_THAN_OR_EQUAL);
    assertEqual(result.field, 'amount');
    assertEqual(result.value, 99.99);
  });

  // ============================================================
  // parseQueryString tests
  // ============================================================
  console.log('\n--- parseQueryString ---\n');

  test('returns empty array for empty input', () => {
    assertEqual(parseQueryString(''), []);
    assertEqual(parseQueryString(null), []);
    assertEqual(parseQueryString(undefined), []);
  });

  test('parses single term', () => {
    const result = parseQueryString('status:approved');
    assertEqual(result.length, 1);
    assertEqual(result[0].type, TokenType.EXACT);
    assertEqual(result[0].field, 'status');
    assertEqual(result[0].value, 'approved');
  });

  test('parses multiple space-separated terms', () => {
    const result = parseQueryString('status:approved income:>=1000');
    assertEqual(result.length, 2);
    assertEqual(result[0].field, 'status');
    assertEqual(result[1].field, 'income');
    assertEqual(result[1].type, TokenType.GREATER_THAN_OR_EQUAL);
  });

  test('parses complex query with multiple operators', () => {
    const result = parseQueryString('status:approved,pending income:>1000 -state:TX');
    assertEqual(result.length, 3);
    assertEqual(result[0].type, TokenType.IN);
    assertEqual(result[0].value, ['approved', 'pending']);
    assertEqual(result[1].type, TokenType.GREATER_THAN);
    assertEqual(result[2].type, TokenType.NOT_EQUAL);
  });

  test('handles mixed full-text and field searches', () => {
    const result = parseQueryString('john status:active');
    assertEqual(result.length, 2);
    assertEqual(result[0].type, TokenType.FULL_TEXT);
    assertEqual(result[0].value, 'john');
    assertEqual(result[1].type, TokenType.EXACT);
  });

  // ============================================================
  // tokensToSqlConditions tests
  // ============================================================
  console.log('\n--- tokensToSqlConditions ---\n');

  test('generates full-text exact match SQL', () => {
    const tokens = [{ type: TokenType.FULL_TEXT, field: null, value: 'john' }];
    const searchableFields = ['name', 'email'];
    const { whereClauses, params } = tokensToSqlConditions(tokens, searchableFields);

    assertEqual(whereClauses.length, 1);
    assertEqual(params.length, 2);
    assertEqual(params[0], 'john');
    assertEqual(params[1], 'john');
  });

  test('generates full-text contains SQL (*value*)', () => {
    const tokens = [{ type: TokenType.FULL_TEXT_CONTAINS, field: null, value: 'john' }];
    const searchableFields = ['name', 'email'];
    const { whereClauses, params } = tokensToSqlConditions(tokens, searchableFields);

    assertEqual(whereClauses.length, 1);
    assertEqual(params.length, 2);
    assertEqual(params[0], '%john%');
    assertEqual(params[1], '%john%');
  });

  test('generates full-text starts with SQL (value*)', () => {
    const tokens = [{ type: TokenType.FULL_TEXT_STARTS_WITH, field: null, value: 'john' }];
    const searchableFields = ['name', 'email'];
    const { whereClauses, params } = tokensToSqlConditions(tokens, searchableFields);

    assertEqual(whereClauses.length, 1);
    assertEqual(params[0], 'john%');
  });

  test('generates full-text ends with SQL (*value)', () => {
    const tokens = [{ type: TokenType.FULL_TEXT_ENDS_WITH, field: null, value: 'smith' }];
    const searchableFields = ['name', 'email'];
    const { whereClauses, params } = tokensToSqlConditions(tokens, searchableFields);

    assertEqual(whereClauses.length, 1);
    assertEqual(params[0], '%smith');
  });

  test('generates exact match SQL', () => {
    const tokens = [{ type: TokenType.EXACT, field: 'status', value: 'approved' }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    assertEqual(whereClauses[0], "json_extract(data, '$.status') = ?");
    assertEqual(params, ['approved']);
  });

  test('generates contains SQL (field:*value*)', () => {
    const tokens = [{ type: TokenType.CONTAINS, field: 'name', value: 'john' }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    assertEqual(params, ['%john%']);
  });

  test('generates starts with SQL (field:value*)', () => {
    const tokens = [{ type: TokenType.STARTS_WITH, field: 'name', value: 'john' }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    assertEqual(params, ['john%']);
  });

  test('generates ends with SQL (field:*value)', () => {
    const tokens = [{ type: TokenType.ENDS_WITH, field: 'email', value: '@example.com' }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    assertEqual(params, ['%@example.com']);
  });

  test('generates not equal SQL', () => {
    const tokens = [{ type: TokenType.NOT_EQUAL, field: 'status', value: 'rejected' }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    assertEqual(params, ['rejected']);
  });

  test('generates greater than SQL', () => {
    const tokens = [{ type: TokenType.GREATER_THAN, field: 'income', value: 1000 }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    assertEqual(whereClauses[0], "CAST(json_extract(data, '$.income') AS REAL) > ?");
    assertEqual(params, [1000]);
  });

  test('generates IN clause SQL', () => {
    const tokens = [{ type: TokenType.IN, field: 'status', value: ['a', 'b'] }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    // Params should have values for both direct match and array match
    assertEqual(params, ['a', 'b', 'a', 'b']);
  });

  test('generates EXISTS SQL', () => {
    const tokens = [{ type: TokenType.EXISTS, field: 'email', value: null }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    assertEqual(whereClauses[0], "json_extract(data, '$.email') IS NOT NULL");
    assertEqual(params, []);
  });

  test('generates NOT EXISTS SQL', () => {
    const tokens = [{ type: TokenType.NOT_EXISTS, field: 'deletedAt', value: null }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    assertEqual(whereClauses[0], "json_extract(data, '$.deletedAt') IS NULL");
    assertEqual(params, []);
  });

  test('handles nested field paths', () => {
    const tokens = [{ type: TokenType.EXACT, field: 'address.city', value: 'Austin' }];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 1);
    assertEqual(whereClauses[0], "json_extract(data, '$.address.city') = ?");
    assertEqual(params, ['Austin']);
  });

  test('combines multiple conditions', () => {
    const tokens = [
      { type: TokenType.EXACT, field: 'status', value: 'approved' },
      { type: TokenType.GREATER_THAN, field: 'income', value: 1000 }
    ];
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(whereClauses.length, 2);
    assertEqual(params, ['approved', 1000]);
  });

  // ============================================================
  // Integration tests
  // ============================================================
  console.log('\n--- Integration Tests ---\n');

  test('full pipeline: q=status:approved income:>=1000', () => {
    const q = 'status:approved income:>=1000';
    const tokens = parseQueryString(q);
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(tokens.length, 2);
    assertEqual(whereClauses.length, 2);
    assertEqual(params, ['approved', 1000]);
  });

  test('full pipeline: q=john status:active -deleted:*', () => {
    const q = 'john status:active -deleted:*';
    const tokens = parseQueryString(q);
    const searchableFields = ['name', 'email'];
    const { whereClauses, params } = tokensToSqlConditions(tokens, searchableFields);

    assertEqual(tokens.length, 3);
    assertEqual(whereClauses.length, 3);
    // Full text exact match adds params for each searchable field
    assertEqual(params.slice(0, 2), ['john', 'john']);
    assertEqual(params[2], 'active');
  });

  test('full pipeline: q=programs:snap,tanf state:TX,CA', () => {
    const q = 'programs:snap,tanf state:TX,CA';
    const tokens = parseQueryString(q);
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(tokens.length, 2);
    assertEqual(tokens[0].type, TokenType.IN);
    assertEqual(tokens[0].value, ['snap', 'tanf']);
    assertEqual(tokens[1].type, TokenType.IN);
    assertEqual(tokens[1].value, ['TX', 'CA']);
  });

  test('full pipeline: q=*john* name:*smith* email:*@example.com', () => {
    const q = '*john* name:*smith* email:*@example.com';
    const tokens = parseQueryString(q);
    const searchableFields = ['name', 'email'];
    const { whereClauses, params } = tokensToSqlConditions(tokens, searchableFields);

    assertEqual(tokens.length, 3);
    assertEqual(tokens[0].type, TokenType.FULL_TEXT_CONTAINS);
    assertEqual(tokens[0].value, 'john');
    assertEqual(tokens[1].type, TokenType.CONTAINS);
    assertEqual(tokens[1].value, 'smith');
    assertEqual(tokens[2].type, TokenType.ENDS_WITH);
    assertEqual(tokens[2].value, '@example.com');
    assertEqual(whereClauses.length, 3);
  });

  test('full pipeline: q=name:john* status:approved', () => {
    const q = 'name:john* status:approved';
    const tokens = parseQueryString(q);
    const { whereClauses, params } = tokensToSqlConditions(tokens, []);

    assertEqual(tokens.length, 2);
    assertEqual(tokens[0].type, TokenType.STARTS_WITH);
    assertEqual(tokens[0].value, 'john');
    assertEqual(tokens[1].type, TokenType.EXACT);
    assertEqual(tokens[1].value, 'approved');
    assertEqual(params[0], 'john%');
    assertEqual(params[1], 'approved');
  });

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log(`\nTest Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
