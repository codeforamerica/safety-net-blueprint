/**
 * Resolves `{{...}}` date tokens in seed YAML values into absolute ISO
 * datetimes at seed-load time.
 *
 * Issue #302. The token's inner expression is passed verbatim to chrono-node
 * — a natural-language date parser — with the seed-load instant as the
 * reference time. That gives us, for free:
 *
 *   {{now}}                       → seed-load instant T
 *   {{now + 1 hour}}              → T + 1 hour
 *   {{now + 7 days}}              → T + 7 days
 *   {{now - 2 days}}              → T - 2 days
 *   {{in 7 days}}, {{2 days ago}} → chrono idiom
 *   {{tomorrow at 09:30}}         → calendar-aware
 *   {{next monday at 2pm}}        → named days
 *   {{2026-06-15T09:30:00Z}}      → absolute ISO
 *   {{June 15 2026 9:30am}}       → absolute natural language
 *
 * A token must occupy the whole field — mixed strings like
 * "starts at {{now}}" are rejected. Anything chrono can't parse cleanly
 * throws SeedTemplateError so seed bugs surface at load time.
 *
 * Tokens reference only `now` (the seed-load instant) — no inter-field
 * refs, so resolution is order-independent.
 */

import * as chrono from 'chrono-node';

const TOKEN_RE = /^\s*\{\{\s*(.+?)\s*\}\}\s*$/;

/**
 * Thrown when a seed template token can't be parsed. Distinct so the seeder
 * can re-raise template errors past its per-record / per-API catches and
 * abort the load (the issue's fail-loud requirement) without aborting on
 * benign per-record issues like a missing FK.
 */
export class SeedTemplateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedTemplateError';
  }
}

/**
 * Resolve every `{{...}}` token in a value against the supplied instant.
 *
 * Walks strings, arrays, and plain objects. Non-string/array/object values
 * and strings without a token pass through unchanged.
 *
 * @param {*} value - Value to resolve. Mutates nothing.
 * @param {Date} now - The seed-load instant. Every token in one call sees this.
 * @param {string} [path] - Dotted path used in error messages.
 * @returns {*} Resolved copy of `value`.
 * @throws {SeedTemplateError} On any token chrono can't parse cleanly.
 */
export function resolveTemplates(value, now, path = '') {
  if (typeof value === 'string') {
    const match = value.match(TOKEN_RE);
    if (!match) {
      // Guard against half-templated strings — if the field contains `{{`
      // but isn't a clean whole-string token, the author probably wanted
      // interpolation we don't support. Surface that loudly rather than
      // leaving the raw braces in the persisted record.
      if (value.includes('{{')) {
        throw new SeedTemplateError(
          `Seed template token must be the entire field value at ${path || '(root)'}: ` +
          `got ${JSON.stringify(value)}. Move literal text out of the field.`
        );
      }
      return value;
    }
    return resolveExpression(match[1], now, value, path);
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => resolveTemplates(item, now, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = resolveTemplates(v, now, path ? `${path}.${key}` : key);
    }
    return out;
  }
  return value;
}

function resolveExpression(expr, now, originalString, path) {
  // Use chrono.parse() (not parseDate) so we can verify chrono consumed the
  // entire input. chrono silently degrades on partial matches — e.g. it
  // parses "now + 7 dasys" as just "now" because it can't make sense of
  // "dasys" but happily falls back to what it could match. We require a
  // single match whose text equals the input so silent degradation surfaces
  // as an error.
  const results = chrono.parse(expr, now);
  if (results.length !== 1 || results[0].text !== expr) {
    throw new SeedTemplateError(
      `Unparseable seed template token "{{${expr}}}" at ${path || '(root)'}: ` +
      `value was ${JSON.stringify(originalString)}. ` +
      `Tokens are parsed by chrono-node — try expressions like ` +
      `"{{now + 7 days}}", "{{in 1 hour}}", "{{tomorrow at 09:30}}", ` +
      `or an absolute ISO datetime.`
    );
  }
  return results[0].start.date().toISOString();
}
