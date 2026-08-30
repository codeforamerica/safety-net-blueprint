/**
 * Runtime sort parser for the ?sort= query parameter.
 *
 * Two pure functions, no DB or Express imports — safe to unit-test in isolation:
 *
 *   parseSortString(raw, sortConfig)
 *     Tokenizes the comma-separated sort expression, validates every field
 *     name against BOTH the lexical identifier regex (defense in depth) AND
 *     the per-endpoint sortConfig.fields allowlist, and enforces the maxFields
 *     ceiling. Returns a discriminated union:
 *       success: { ok: true, fields: [{ name, descending }] }
 *       failure: { ok: false, code, message, field? }
 *     where `code` is INVALID_SORT_FIELD (lexical, missing config, duplicate,
 *     over-cap) or FIELD_NOT_SORTABLE (field exists on the schema but isn't
 *     in the allowlist).
 *
 *   buildOrderByClause(parsedFields, sortConfig)
 *     Builds the SQL `ORDER BY ...` fragment from the parsed fields plus the
 *     configured tieBreaker. INVARIANT: every field name passed to this
 *     function has already been validated against the lexical regex and the
 *     per-endpoint allowlist by parseSortString. This function does no
 *     further validation and trusts its inputs — a bug elsewhere must not
 *     compromise SQL safety, so callers are responsible for never invoking
 *     this with unvalidated field names. See A03:2025 in the plan.
 *
 * Phase 3 of #288.
 */

/**
 * Lexical rule for sort-field names. Must match the validator's
 * SORTABLE_FIELD_REGEX exactly. Enforced here as defense in depth — if a
 * misconfigured spec gets past the linter, the runtime parser still rejects.
 *
 * Kept in sync with packages/contracts/src/validation/pattern-validator.js by
 * a unit-test assertion that compares the two literals (drift guard). If you
 * change the regex here, update that file and vice versa.
 */
export const SORTABLE_FIELD_REGEX = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * Implicit cap on the number of fields a client may include in `?sort=`
 * when the spec does not declare its own maxFields. Bounds query cost
 * (A04:2025, A10:2025).
 */
export const DEFAULT_MAX_FIELDS = 5;

/**
 * Build an error result for parseSortString.
 */
function fail(code, message, field) {
  const result = { ok: false, code, message };
  if (field !== undefined) result.field = field;
  return result;
}

/**
 * Parse the `?sort=` query parameter into a validated, normalized field list.
 *
 * @param {string|undefined} raw - The raw value of the sort query parameter
 * @param {Object} sortConfig - Parsed x-sortable extension from the endpoint
 * @param {string[]} sortConfig.fields - Allowlist of sortable field names
 * @param {number} [sortConfig.maxFields] - Optional hard cap; defaults to DEFAULT_MAX_FIELDS
 * @returns {{ ok: true, fields: Array<{name: string, descending: boolean}> }
 *          | { ok: false, code: string, message: string, field?: string }}
 */
export function parseSortString(raw, sortConfig) {
  // Empty / absent input: caller decides what to do (typically apply default sort)
  if (raw === undefined || raw === null) return { ok: true, fields: [] };
  if (typeof raw !== 'string') {
    return fail('INVALID_SORT_FIELD', 'sort parameter must be a string');
  }

  const tokens = raw
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (tokens.length === 0) return { ok: true, fields: [] };

  // No sortConfig.fields → no field can satisfy the allowlist
  const allowlist = Array.isArray(sortConfig?.fields) ? sortConfig.fields : null;
  if (!allowlist || allowlist.length === 0) {
    return fail(
      'INVALID_SORT_FIELD',
      'this endpoint does not declare any sortable fields',
      tokens[0].replace(/^-/, '')
    );
  }

  const maxFields = Number.isInteger(sortConfig?.maxFields) && sortConfig.maxFields > 0
    ? sortConfig.maxFields
    : DEFAULT_MAX_FIELDS;

  if (tokens.length > maxFields) {
    return fail(
      'INVALID_SORT_FIELD',
      `sort accepts at most ${maxFields} field(s); received ${tokens.length}`
    );
  }

  const seen = new Set();
  const fields = [];

  for (const token of tokens) {
    const descending = token.startsWith('-');
    const name = descending ? token.slice(1).trim() : token;

    // Defense-in-depth lexical check — the linter should have caught this
    // at spec-load time, but if a misconfigured allowlist somehow contains a
    // malformed name, reject the request rather than passing it to SQL.
    if (!SORTABLE_FIELD_REGEX.test(name)) {
      return fail(
        'INVALID_SORT_FIELD',
        `sort field "${name}" is not a valid identifier`,
        name
      );
    }

    // Duplicate detection — regardless of direction prefix
    if (seen.has(name)) {
      return fail(
        'INVALID_SORT_FIELD',
        `sort field "${name}" appears more than once`,
        name
      );
    }
    seen.add(name);

    // Allowlist enforcement
    if (!allowlist.includes(name)) {
      return fail(
        'FIELD_NOT_SORTABLE',
        `field "${name}" does not support sorting on this endpoint`,
        name
      );
    }

    fields.push({ name, descending });
  }

  return { ok: true, fields };
}

/**
 * Build the SQL `ORDER BY ...` fragment from a list of parsed fields plus
 * the configured tieBreaker. Returns an empty string when there is nothing
 * to sort by (no parsed fields and tieBreaker explicitly null).
 *
 * Null-value ordering:
 *   ascending  → nulls last  (col IS NULL ASC, col ASC)
 *   descending → nulls first (col IS NULL DESC, col DESC)
 *
 * Tie-breaker:
 *   sortConfig.tieBreaker === undefined → defaults to 'id' (always ASC)
 *   sortConfig.tieBreaker === null      → no tie-breaker is appended
 *   sortConfig.tieBreaker === '<name>'  → that field is appended ASC
 *
 * @param {Array<{name: string, descending: boolean}>} parsedFields
 * @param {Object} sortConfig
 * @returns {string} The SQL fragment, including the leading "ORDER BY", or
 *                   the empty string if there is nothing to sort by.
 */
export function buildOrderByClause(parsedFields, sortConfig) {
  // INVARIANT: every name interpolated into SQL must match SORTABLE_FIELD_REGEX.
  // parseSortString enforces this on client-supplied fields; the pattern
  // validator enforces it on every name in `fields`, `default`, and
  // `tieBreaker` at spec-load time. We re-test here as defense in depth so
  // a caller bug (e.g., handing us an unvalidated tieBreaker) raises loudly
  // rather than silently composing unsafe SQL. Throws RangeError on violation.
  const assertSafeName = (name, source) => {
    if (typeof name !== 'string' || !SORTABLE_FIELD_REGEX.test(name)) {
      throw new RangeError(
        `buildOrderByClause: ${source} "${name}" violates SORTABLE_FIELD_REGEX. ` +
        `This is a caller-side invariant violation — every name reaching ` +
        `buildOrderByClause must have been validated by parseSortString or the pattern validator.`
      );
    }
  };

  const segments = [];

  for (const { name, descending } of parsedFields ?? []) {
    assertSafeName(name, 'parsedFields[].name');
    const path = `json_extract(data, '$.${name}')`;
    const dir = descending ? 'DESC' : 'ASC';
    // Null-value ordering matches the documented behavior in api-patterns.yaml
    segments.push(`${path} IS NULL ${dir}`);
    segments.push(`${path} ${dir}`);
  }

  const tieBreaker = sortConfig?.tieBreaker === undefined ? 'id' : sortConfig.tieBreaker;
  if (typeof tieBreaker === 'string' && tieBreaker.length > 0) {
    assertSafeName(tieBreaker, 'sortConfig.tieBreaker');
    segments.push(`json_extract(data, '$.${tieBreaker}') ASC`);
  }

  if (segments.length === 0) return '';
  return `ORDER BY ${segments.join(', ')}`;
}
