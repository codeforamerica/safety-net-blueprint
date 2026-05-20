/**
 * Unit tests for the seed-template resolver (#302).
 *
 * Mirrors the smoke probe we ran against chrono-node, plus the integration
 * concerns specific to this resolver: recursion through arrays/objects,
 * passthrough on literals, fail-loud on partial-match degradation, half-
 * templated strings, and consistency within a single load.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { resolveTemplates } from '../../src/seed-template-resolver.js';

// Fix `now` to a known instant so assertions are deterministic. UTC noon on
// a date that doesn't straddle DST in most reasonable timezones.
const NOW = new Date('2026-06-15T12:00:00.000Z'); // Monday

test('resolveTemplates — issue grammar', async (t) => {
  await t.test('{{now}} resolves to the seed-load instant', () => {
    assert.strictEqual(resolveTemplates('{{now}}', NOW), '2026-06-15T12:00:00.000Z');
  });

  await t.test('{{now + 1 hour}} adds one hour', () => {
    assert.strictEqual(resolveTemplates('{{now + 1 hour}}', NOW), '2026-06-15T13:00:00.000Z');
  });

  await t.test('{{now + 8 hours}} adds eight hours', () => {
    assert.strictEqual(resolveTemplates('{{now + 8 hours}}', NOW), '2026-06-15T20:00:00.000Z');
  });

  await t.test('{{now + 7 days}} adds seven days, same time-of-day', () => {
    assert.strictEqual(resolveTemplates('{{now + 7 days}}', NOW), '2026-06-22T12:00:00.000Z');
  });

  await t.test('{{now - 2 days}} subtracts two days', () => {
    assert.strictEqual(resolveTemplates('{{now - 2 days}}', NOW), '2026-06-13T12:00:00.000Z');
  });

  await t.test('{{now + 1 day}} (singular) works', () => {
    assert.strictEqual(resolveTemplates('{{now + 1 day}}', NOW), '2026-06-16T12:00:00.000Z');
  });
});

test('resolveTemplates — chrono idiom', async (t) => {
  await t.test('{{in 1 hour}}', () => {
    assert.strictEqual(resolveTemplates('{{in 1 hour}}', NOW), '2026-06-15T13:00:00.000Z');
  });

  await t.test('{{in 8 hours}}', () => {
    assert.strictEqual(resolveTemplates('{{in 8 hours}}', NOW), '2026-06-15T20:00:00.000Z');
  });

  await t.test('{{in 7 days}}', () => {
    assert.strictEqual(resolveTemplates('{{in 7 days}}', NOW), '2026-06-22T12:00:00.000Z');
  });

  await t.test('{{2 days ago}}', () => {
    assert.strictEqual(resolveTemplates('{{2 days ago}}', NOW), '2026-06-13T12:00:00.000Z');
  });
});

test('resolveTemplates — calendar-aware', async (t) => {
  await t.test('{{tomorrow}} lands on the next day', () => {
    const out = resolveTemplates('{{tomorrow}}', NOW);
    assert.match(out, /^2026-06-16T/);
  });

  await t.test('{{tomorrow at 09:30}} produces local 09:30', () => {
    const parsed = new Date(resolveTemplates('{{tomorrow at 09:30}}', NOW));
    assert.strictEqual(parsed.getHours(), 9);
    assert.strictEqual(parsed.getMinutes(), 30);
  });

  await t.test('{{next monday}} lands on a Monday', () => {
    const parsed = new Date(resolveTemplates('{{next monday}}', NOW));
    assert.strictEqual(parsed.getDay(), 1);
  });

  await t.test('{{next friday at 2pm}} lands on a Friday at local 14:00', () => {
    const parsed = new Date(resolveTemplates('{{next friday at 2pm}}', NOW));
    assert.strictEqual(parsed.getDay(), 5);
    assert.strictEqual(parsed.getHours(), 14);
  });

  await t.test('{{last tuesday}} lands on a Tuesday in the past', () => {
    const parsed = new Date(resolveTemplates('{{last tuesday}}', NOW));
    assert.strictEqual(parsed.getDay(), 2);
    assert.ok(parsed.getTime() < NOW.getTime(), 'should be before NOW');
  });
});

test('resolveTemplates — absolute', async (t) => {
  await t.test('ISO datetime with Z', () => {
    assert.strictEqual(
      resolveTemplates('{{2026-06-15T09:30:00Z}}', NOW),
      '2026-06-15T09:30:00.000Z'
    );
  });

  await t.test('ISO datetime without TZ (interpreted as local)', () => {
    const parsed = new Date(resolveTemplates('{{2026-06-15T09:30:00}}', NOW));
    assert.strictEqual(parsed.getHours(), 9);
    assert.strictEqual(parsed.getMinutes(), 30);
  });

  await t.test('date-only string', () => {
    const out = resolveTemplates('{{2026-06-15}}', NOW);
    assert.match(out, /^2026-06-15T/);
  });

  await t.test('natural-language absolute', () => {
    const parsed = new Date(resolveTemplates('{{June 15 2026 9:30am}}', NOW));
    assert.strictEqual(parsed.getFullYear(), 2026);
    assert.strictEqual(parsed.getMonth(), 5); // June (0-indexed)
    assert.strictEqual(parsed.getDate(), 15);
    assert.strictEqual(parsed.getHours(), 9);
    assert.strictEqual(parsed.getMinutes(), 30);
  });
});

test('resolveTemplates — recursion', async (t) => {
  await t.test('walks plain objects and replaces nested tokens', () => {
    const input = {
      id: 'abc',
      startAt: '{{now}}',
      meta: { dueAt: '{{now + 7 days}}', label: 'kept literal' },
    };
    const out = resolveTemplates(input, NOW);
    assert.deepStrictEqual(out, {
      id: 'abc',
      startAt: '2026-06-15T12:00:00.000Z',
      meta: { dueAt: '2026-06-22T12:00:00.000Z', label: 'kept literal' },
    });
  });

  await t.test('walks arrays', () => {
    const out = resolveTemplates(
      ['{{now}}', { at: '{{now + 1 hour}}' }, 'literal'],
      NOW
    );
    assert.deepStrictEqual(out, [
      '2026-06-15T12:00:00.000Z',
      { at: '2026-06-15T13:00:00.000Z' },
      'literal',
    ]);
  });

  await t.test('does not mutate the input', () => {
    const input = { startAt: '{{now}}' };
    const snapshot = { startAt: '{{now}}' };
    resolveTemplates(input, NOW);
    assert.deepStrictEqual(input, snapshot);
  });
});

test('resolveTemplates — passthrough', async (t) => {
  await t.test('literal strings are returned unchanged', () => {
    assert.strictEqual(resolveTemplates('2024-01-01T00:00:00.000Z', NOW), '2024-01-01T00:00:00.000Z');
    assert.strictEqual(resolveTemplates('plain text', NOW), 'plain text');
  });

  await t.test('non-string/array/object values are returned unchanged', () => {
    assert.strictEqual(resolveTemplates(42, NOW), 42);
    assert.strictEqual(resolveTemplates(null, NOW), null);
    assert.strictEqual(resolveTemplates(true, NOW), true);
    assert.strictEqual(resolveTemplates(undefined, NOW), undefined);
  });

  await t.test('strings with unrelated braces pass through', () => {
    assert.strictEqual(resolveTemplates('this {is} fine', NOW), 'this {is} fine');
  });
});

test('resolveTemplates — fail loud', async (t) => {
  // chrono silently degrades on partial input — e.g. "now + 7 dasys" parses
  // as just "now". The resolver requires chrono to consume the entire
  // expression so silent degradation surfaces as an error at load time.

  await t.test('throws on a typo in the unit (chrono only matches the prefix)', () => {
    assert.throws(
      () => resolveTemplates('{{now + 7 dasys}}', NOW),
      /Unparseable seed template token/
    );
  });

  await t.test('throws on completely unrecognized input', () => {
    assert.throws(
      () => resolveTemplates('{{gibberish}}', NOW),
      /Unparseable seed template token/
    );
  });

  await t.test('throws on bare typo "{{7 dasys}}"', () => {
    assert.throws(
      () => resolveTemplates('{{7 dasys}}', NOW),
      /Unparseable seed template token/
    );
  });

  await t.test('throws on empty token "{{}}"', () => {
    assert.throws(
      () => resolveTemplates('{{}}', NOW),
      /Unparseable seed template token|must be the entire field/
    );
  });

  await t.test('throws when chrono produces multiple disjoint matches', () => {
    // "now at 09:30" → chrono returns two matches ("now" + "09:30") rather
    // than one combined parse, so we treat it as ambiguous.
    assert.throws(
      () => resolveTemplates('{{now at 09:30}}', NOW),
      /Unparseable seed template token/
    );
  });

  await t.test('throws on missing whitespace around the operator', () => {
    // "now+1 hour" → chrono only matches "now" and drops "+1 hour".
    assert.throws(
      () => resolveTemplates('{{now+1 hour}}', NOW),
      /Unparseable seed template token/
    );
  });

  await t.test('throws on out-of-range time override', () => {
    // chrono may accept this and produce a misparse, or reject. Either way
    // we want it loud — out-of-range is a typo.
    assert.throws(
      () => resolveTemplates('{{now at 25:00}}', NOW),
      /Unparseable seed template token/
    );
  });

  await t.test('throws on half-templated string', () => {
    assert.throws(
      () => resolveTemplates('starts at {{now}}', NOW),
      /must be the entire field value/
    );
  });

  await t.test('error message includes the field path', () => {
    assert.throws(
      () => resolveTemplates({ outer: { inner: '{{bogus}}' } }, NOW),
      /at outer\.inner/
    );
  });

  await t.test('error message includes the offending value', () => {
    assert.throws(
      () => resolveTemplates({ startAt: '{{now + 7 dasys}}' }, NOW),
      /"\{\{now \+ 7 dasys\}\}"/
    );
  });
});

test('resolveTemplates — consistency within a single load', async (t) => {
  await t.test('every reference to {{now}} in one call sees the same instant', () => {
    const out = resolveTemplates(
      { a: '{{now}}', b: '{{now}}', c: { d: '{{now}}' } },
      NOW
    );
    assert.strictEqual(out.a, out.b);
    assert.strictEqual(out.a, out.c.d);
  });
});

console.log('\n✓ All seed-template-resolver tests passed\n');
