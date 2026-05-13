/**
 * Unit tests for the runtime sort parser.
 *
 * Two pure functions tested in isolation:
 *   - parseSortString(raw, sortConfig) → discriminated union
 *       success: { ok: true, fields: [{ name, descending }] }
 *       failure: { ok: false, code, message, field? }
 *   - buildOrderByClause(parsedFields, sortConfig) → SQL fragment string
 *
 * Phase 3 of #288. The parser is the runtime gatekeeper — every field name
 * that reaches buildOrderByClause must have been validated here against
 * BOTH the lexical regex (defense in depth — A03:2025, A05:2025) AND the
 * per-endpoint sortConfig.fields allowlist. maxFields gets an implicit
 * ceiling of 5 when omitted by the spec (A04:2025, A10:2025).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseSortString, buildOrderByClause, DEFAULT_MAX_FIELDS, SORTABLE_FIELD_REGEX } from '../../src/sort-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const baseConfig = {
  fields: ['createdAt', 'priority', 'dueDate', 'status', 'name.lastName'],
};

// =============================================================================
// parseSortString — happy paths
// =============================================================================

test('parseSortString — happy paths', async (t) => {
  await t.test('single ascending field', () => {
    const result = parseSortString('createdAt', baseConfig);
    assert.deepStrictEqual(result, {
      ok: true,
      fields: [{ name: 'createdAt', descending: false }],
    });
    console.log('  ✓ Single ascending field');
  });

  await t.test('single descending field', () => {
    const result = parseSortString('-createdAt', baseConfig);
    assert.deepStrictEqual(result, {
      ok: true,
      fields: [{ name: 'createdAt', descending: true }],
    });
    console.log('  ✓ Single descending field');
  });

  await t.test('multi-field with mixed directions', () => {
    const result = parseSortString('-priority,dueDate,status', baseConfig);
    assert.deepStrictEqual(result, {
      ok: true,
      fields: [
        { name: 'priority', descending: true },
        { name: 'dueDate', descending: false },
        { name: 'status', descending: false },
      ],
    });
    console.log('  ✓ Multi-field with mixed directions');
  });

  await t.test('nested-field via dot-notation', () => {
    const result = parseSortString('name.lastName', baseConfig);
    assert.deepStrictEqual(result, {
      ok: true,
      fields: [{ name: 'name.lastName', descending: false }],
    });
    console.log('  ✓ Nested field accepted');
  });

  await t.test('leading and trailing whitespace per field is trimmed', () => {
    const result = parseSortString('  -priority  ,  dueDate  ', baseConfig);
    assert.deepStrictEqual(result, {
      ok: true,
      fields: [
        { name: 'priority', descending: true },
        { name: 'dueDate', descending: false },
      ],
    });
    console.log('  ✓ Whitespace trimmed');
  });
});

// =============================================================================
// parseSortString — validation errors (FIELD_NOT_SORTABLE)
// =============================================================================

test('parseSortString — FIELD_NOT_SORTABLE (allowlist enforcement)', async (t) => {
  await t.test('field absent from sortConfig.fields rejected', () => {
    const result = parseSortString('description', baseConfig);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'FIELD_NOT_SORTABLE');
    assert.strictEqual(result.field, 'description');
    console.log('  ✓ Unallowed field rejected with FIELD_NOT_SORTABLE');
  });

  await t.test('descending prefix does not bypass allowlist', () => {
    const result = parseSortString('-description', baseConfig);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'FIELD_NOT_SORTABLE');
    console.log('  ✓ -description rejected too');
  });

  await t.test('endpoint without x-sortable (no fields config) rejects any sort', () => {
    const result = parseSortString('createdAt', {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'INVALID_SORT_FIELD');
    console.log('  ✓ Missing config rejects all sorts as INVALID_SORT_FIELD');
  });

  await t.test('empty fields array rejects any sort', () => {
    const result = parseSortString('createdAt', { fields: [] });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'INVALID_SORT_FIELD');
    console.log('  ✓ Empty fields rejects all sorts');
  });
});

// =============================================================================
// parseSortString — defense-in-depth lexical validation (A03/A05)
// =============================================================================

test('parseSortString — defense-in-depth lexical validation', async (t) => {
  // Even if a misconfigured spec somehow gets a malformed field name into
  // sortConfig.fields (the linter should have caught it at lint time), the
  // runtime parser MUST reject the request rather than pass it to SQL.
  const hostile = [
    "createdAt; DROP TABLE x",
    "createdAt'",
    'createdAt"',
    'created`At',
    'created[At]',
    'created\\At',
    'created At',
    'created\tAt',
    'createdÄt',
    '0startsWithDigit',
    'a..b',
    '.leadingDot',
    'trailingDot.',
  ];

  for (const bad of hostile) {
    await t.test(`hostile field ${JSON.stringify(bad)} rejected even if in fields[]`, () => {
      const result = parseSortString(bad, { fields: [bad] });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'INVALID_SORT_FIELD',
        `expected INVALID_SORT_FIELD for ${JSON.stringify(bad)}, got ${result.code}`);
    });
  }

  await t.test('field that looks fine but isn\'t in fields[] returns FIELD_NOT_SORTABLE not INVALID_SORT_FIELD', () => {
    // Distinguishes the two error codes: INVALID means the name is shaped
    // wrong (lexical), FIELD_NOT_SORTABLE means the name is fine but the
    // endpoint doesn't allow it.
    const result = parseSortString('looksFineButNotAllowed', baseConfig);
    assert.strictEqual(result.code, 'FIELD_NOT_SORTABLE');
    console.log('  ✓ Error code distinguishes lexical vs. allowlist failures');
  });
});

// =============================================================================
// parseSortString — duplicate detection
// =============================================================================

test('parseSortString — duplicate detection', async (t) => {
  await t.test('same field twice same direction rejected', () => {
    const result = parseSortString('priority,priority', baseConfig);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'INVALID_SORT_FIELD');
    console.log('  ✓ Same field twice rejected');
  });

  await t.test('same field twice different direction rejected', () => {
    const result = parseSortString('-priority,priority', baseConfig);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'INVALID_SORT_FIELD');
    console.log('  ✓ Same field with different directions rejected');
  });

  await t.test('different fields not flagged as duplicates', () => {
    const result = parseSortString('priority,dueDate', baseConfig);
    assert.strictEqual(result.ok, true);
    console.log('  ✓ Different fields pass');
  });
});

// =============================================================================
// parseSortString — maxFields enforcement (A04/A10)
// =============================================================================

test('parseSortString — maxFields enforcement', async (t) => {
  await t.test('declared maxFields enforces hard cap', () => {
    const config = { fields: ['a', 'b', 'c', 'd'], maxFields: 2 };
    const result = parseSortString('a,b,c', config);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'INVALID_SORT_FIELD');
    console.log('  ✓ maxFields cap enforced when declared');
  });

  await t.test('at the cap is allowed', () => {
    const config = { fields: ['a', 'b'], maxFields: 2 };
    const result = parseSortString('a,b', config);
    assert.strictEqual(result.ok, true);
    console.log('  ✓ At the cap is allowed');
  });

  await t.test(`missing maxFields applies implicit ceiling of ${DEFAULT_MAX_FIELDS}`, () => {
    const fields = Array.from({ length: DEFAULT_MAX_FIELDS + 2 }, (_, i) => `f${i}`);
    const config = { fields };  // no maxFields
    const overCap = fields.slice(0, DEFAULT_MAX_FIELDS + 1).join(',');
    const result = parseSortString(overCap, config);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'INVALID_SORT_FIELD');
  });

  await t.test(`at the implicit ceiling (${DEFAULT_MAX_FIELDS}) is allowed`, () => {
    const fields = Array.from({ length: DEFAULT_MAX_FIELDS }, (_, i) => `f${i}`);
    const config = { fields };
    const result = parseSortString(fields.join(','), config);
    assert.strictEqual(result.ok, true);
  });
});

// =============================================================================
// parseSortString — empty / null input
// =============================================================================

test('parseSortString — missing sortConfig', async (t) => {
  await t.test('null sortConfig rejects any non-empty sort', () => {
    const result = parseSortString('createdAt', null);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'INVALID_SORT_FIELD');
    console.log('  ✓ null sortConfig rejects');
  });

  await t.test('undefined sortConfig rejects any non-empty sort', () => {
    const result = parseSortString('createdAt', undefined);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'INVALID_SORT_FIELD');
    console.log('  ✓ undefined sortConfig rejects');
  });

  await t.test('null sortConfig with empty sort returns ok with no fields', () => {
    // Caller may invoke parseSortString on an endpoint without x-sortable
    // when ?sort= is omitted. Should not error; caller falls through to default.
    const result = parseSortString('', null);
    assert.deepStrictEqual(result, { ok: true, fields: [] });
    console.log('  ✓ null sortConfig with empty input does not error');
  });
});

test('parseSortString — empty input', async (t) => {
  await t.test('empty string returns ok with no fields', () => {
    const result = parseSortString('', baseConfig);
    assert.deepStrictEqual(result, { ok: true, fields: [] });
    console.log('  ✓ Empty string returns no fields');
  });

  await t.test('whitespace-only string returns ok with no fields', () => {
    const result = parseSortString('   ', baseConfig);
    assert.deepStrictEqual(result, { ok: true, fields: [] });
    console.log('  ✓ Whitespace-only returns no fields');
  });

  await t.test('comma-only string returns ok with no fields', () => {
    const result = parseSortString(',,,', baseConfig);
    assert.deepStrictEqual(result, { ok: true, fields: [] });
    console.log('  ✓ Comma-only returns no fields');
  });

  await t.test('undefined raw input returns ok with no fields', () => {
    const result = parseSortString(undefined, baseConfig);
    assert.deepStrictEqual(result, { ok: true, fields: [] });
    console.log('  ✓ Undefined returns no fields');
  });
});

// =============================================================================
// buildOrderByClause
// =============================================================================

test('buildOrderByClause', async (t) => {
  await t.test('single ascending field builds COALESCE expression with nulls last', () => {
    const sql = buildOrderByClause(
      [{ name: 'createdAt', descending: false }],
      { fields: ['createdAt'], tieBreaker: 'id' }
    );
    // Nulls-last ascending → null records sort to the end
    assert.match(sql, /json_extract\(data, '\$\.createdAt'\) IS NULL/);
    assert.match(sql, /json_extract\(data, '\$\.createdAt'\) ASC/);
    assert.match(sql, /json_extract\(data, '\$\.id'\) ASC/); // tieBreaker
    console.log('  ✓ Single ascending field with tieBreaker');
  });

  await t.test('single descending field — nulls first', () => {
    const sql = buildOrderByClause(
      [{ name: 'createdAt', descending: true }],
      { fields: ['createdAt'], tieBreaker: 'id' }
    );
    assert.match(sql, /json_extract\(data, '\$\.createdAt'\) IS NULL/);
    assert.match(sql, /json_extract\(data, '\$\.createdAt'\) DESC/);
    console.log('  ✓ Single descending field — nulls first');
  });

  await t.test('nested-field path becomes json_extract($.path.to.field)', () => {
    const sql = buildOrderByClause(
      [{ name: 'name.lastName', descending: false }],
      { fields: ['name.lastName'], tieBreaker: 'id' }
    );
    assert.match(sql, /json_extract\(data, '\$\.name\.lastName'\)/);
    console.log('  ✓ Nested path interpolated correctly');
  });

  await t.test('multi-field preserves declaration order', () => {
    const sql = buildOrderByClause(
      [
        { name: 'priority', descending: true },
        { name: 'dueDate', descending: false },
      ],
      { fields: ['priority', 'dueDate'], tieBreaker: 'id' }
    );
    const priorityIdx = sql.indexOf("'$.priority'");
    const dueDateIdx = sql.indexOf("'$.dueDate'");
    const idIdx = sql.indexOf("'$.id'");
    assert.ok(priorityIdx >= 0 && dueDateIdx >= 0 && idIdx >= 0, sql);
    assert.ok(priorityIdx < dueDateIdx, 'priority must come before dueDate');
    assert.ok(dueDateIdx < idIdx, 'tieBreaker must come last');
    console.log('  ✓ Multi-field order preserved; tieBreaker appended');
  });

  await t.test('tieBreaker defaults to id when sortConfig.tieBreaker is undefined', () => {
    const sql = buildOrderByClause(
      [{ name: 'createdAt', descending: false }],
      { fields: ['createdAt'] }  // no tieBreaker key
    );
    assert.match(sql, /json_extract\(data, '\$\.id'\) ASC/);
    console.log('  ✓ tieBreaker defaults to id');
  });

  await t.test('tieBreaker: null skips the tie-breaker', () => {
    const sql = buildOrderByClause(
      [{ name: 'createdAt', descending: false }],
      { fields: ['createdAt'], tieBreaker: null }
    );
    assert.doesNotMatch(sql, /json_extract\(data, '\$\.id'\)/);
    console.log('  ✓ tieBreaker: null disables append');
  });

  await t.test('starts with ORDER BY', () => {
    const sql = buildOrderByClause(
      [{ name: 'createdAt', descending: false }],
      { fields: ['createdAt'], tieBreaker: 'id' }
    );
    assert.match(sql, /^ORDER BY /);
    console.log('  ✓ Result starts with ORDER BY');
  });

  await t.test('empty parsedFields with tieBreaker yields only the tie-breaker', () => {
    const sql = buildOrderByClause([], { fields: ['createdAt'], tieBreaker: 'id' });
    assert.match(sql, /^ORDER BY json_extract\(data, '\$\.id'\) ASC$/);
    console.log('  ✓ Empty parsed fields with tieBreaker → tie-breaker only');
  });

  await t.test('empty parsedFields with tieBreaker: null yields empty string', () => {
    const sql = buildOrderByClause([], { fields: ['createdAt'], tieBreaker: null });
    assert.strictEqual(sql, '');
    console.log('  ✓ Empty parsed fields with no tieBreaker → empty string');
  });
});

// =============================================================================
// buildOrderByClause — invariant enforcement (defense in depth, A03/A05:2025)
// =============================================================================

test('buildOrderByClause — invariant: every name must match SORTABLE_FIELD_REGEX', async (t) => {
  // The file header invariant is "every name reaching buildOrderByClause has
  // been validated." If a caller violates that (bug or untrusted source),
  // the function must raise loudly rather than silently interpolate unsafe
  // SQL. These tests document the contract.

  await t.test('hostile parsedFields[].name throws RangeError', () => {
    assert.throws(
      () => buildOrderByClause(
        [{ name: "createdAt; DROP TABLE x", descending: false }],
        { fields: ['createdAt'], tieBreaker: 'id' }
      ),
      RangeError
    );
    console.log('  ✓ Hostile parsedFields name throws');
  });

  await t.test('hostile tieBreaker throws RangeError', () => {
    assert.throws(
      () => buildOrderByClause(
        [{ name: 'createdAt', descending: false }],
        { fields: ['createdAt'], tieBreaker: "id'; --" }
      ),
      RangeError
    );
    console.log('  ✓ Hostile tieBreaker throws');
  });

  await t.test('quoted tieBreaker throws RangeError', () => {
    assert.throws(
      () => buildOrderByClause(
        [{ name: 'createdAt', descending: false }],
        { fields: ['createdAt'], tieBreaker: 'id"' }
      ),
      RangeError
    );
    console.log('  ✓ Quoted tieBreaker throws');
  });
});

// =============================================================================
// Drift guard: SORTABLE_FIELD_REGEX matches the validator's source
// =============================================================================

test('SORTABLE_FIELD_REGEX matches pattern-validator literal', async (t) => {
  await t.test('the two regex literals are character-identical', () => {
    const validatorPath = join(
      __dirname, '..', '..', '..', '..',
      'packages', 'contracts', 'src', 'validation', 'pattern-validator.js'
    );
    const src = readFileSync(validatorPath, 'utf8');
    // Capture the exact source from `export const SORTABLE_FIELD_REGEX = /.../;`
    const match = src.match(/export const SORTABLE_FIELD_REGEX\s*=\s*(\/[^\n;]+\/[a-z]*)\s*;/);
    assert.ok(match, 'could not locate SORTABLE_FIELD_REGEX in pattern-validator.js');
    // Extract just the body of the regex literal (between the slashes) for comparison
    const validatorBody = match[1];
    const ours = `/${SORTABLE_FIELD_REGEX.source}/${SORTABLE_FIELD_REGEX.flags}`;
    assert.strictEqual(ours, validatorBody,
      `Regex drift detected. sort-parser.js: ${ours}\n  pattern-validator.js: ${validatorBody}`);
    console.log('  ✓ Regex literals are in sync');
  });
});

console.log('\n✓ All sort-parser tests passed\n');
