/**
 * Per-item facts: a list fact names its items with `as`, and facts at
 * `list[].name` are computed once for each item.
 *
 *   - path: reviewMonths
 *     as: month
 *     expression: months
 *   - path: reviewMonths[].qualifies
 *     expression: month.hadMedicare || month.meetsHours
 *   - path: qualifyingMonthCount
 *     expression: size(reviewMonths.filter(m, m.qualifies))
 *
 * Covers what core owns: the authored schema, the compiled graph's schema,
 * what the compiler records, and what validation refuses. Evaluation is
 * covered in blueprint-rules-engine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileRuleset } from '../../../src/rules.js';
import { validateRuleset } from '../../../src/validator/rules-validator.js';
import { inputOf } from '../../../src/cel.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaValidator = (file) => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(yaml.load(readFileSync(join(here, '../../../schemas', file), 'utf8')));
};
const rulesSchema = schemaValidator('rules-schema.yaml');
const graphSchema = schemaValidator('graph-schema.yaml');

const MONTH_FIELDS = {
  monthsBefore: { type: 'integer' },
  hadMedicare: { type: 'boolean', default: false },
  hoursWorked: { type: 'number', default: 0 },
  householdIncome: { type: 'number' },
  weeks: { type: 'array', items: { type: 'object', properties: { hours: { type: 'number' } } } },
};

/** A ruleset over a list of months, with the facts and outputs given. */
const ruleset = (facts, outputs = [facts.at(-1).path]) => ({
  endpoint: { path: '/review' },
  inputs: {
    determination: { type: 'object', properties: { kind: { type: 'string' } } },
    months: { type: 'array', items: { type: 'object', properties: MONTH_FIELDS } },
  },
  constants: {
    monthlyHoursRequired: { value: 80 },
    applicationReviewMonths: { value: 1, type: 'integer' },
  },
  outputs: Object.fromEntries(outputs.map((name) => [name, {}])),
  facts,
});

const REVIEW_MONTHS = [
  { path: 'isApplication', expression: "determination.kind == 'application'" },
  {
    path: 'reviewMonths',
    as: 'month',
    expression: 'isApplication ? months.filter(m, m.monthsBefore <= constants.applicationReviewMonths) : months',
  },
  { path: 'reviewMonths[].meetsHours', expression: 'month.hoursWorked >= constants.monthlyHoursRequired' },
  { path: 'reviewMonths[].qualifies', expression: 'month.hadMedicare || month.meetsHours' },
  { path: 'qualifyingMonthCount', expression: 'size(reviewMonths.filter(m, m.qualifies))' },
];

const NESTED = [
  ...REVIEW_MONTHS,
  { path: 'reviewMonths[].reviewWeeks', as: 'week', expression: 'month.weeks' },
  { path: 'reviewMonths[].reviewWeeks[].shareOfMonth', expression: 'week.hours / month.hoursWorked' },
  { path: 'reviewMonths[].everyWeekWorked', expression: 'month.reviewWeeks.all(w, w.hours > 0.0)' },
  { path: 'anyMonthEveryWeekWorked', expression: 'reviewMonths.exists(m, m.everyWeekWorked)' },
];

const rulesFor = (facts) => ({
  $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
  domain: 'eligibility',
  rulesets: { review: ruleset(facts) },
});

const rulesOf = (errors, rule) => errors.filter((e) => e.rule === rule);

// ── The authored schema ───────────────────────────────────────────────────────

test('rules schema — per-item facts', async (t) => {
  await t.test('accepts a list fact with as, and facts on its items at any depth', () => {
    assert.ok(rulesSchema(rulesFor(NESTED)), JSON.stringify(rulesSchema.errors));
  });

  await t.test('refuses a path that is not a fact on a list\'s items', () => {
    for (const path of ['reviewMonths[]', '[].qualifies', 'reviewMonths[]qualifies', 'reviewMonths[][].x']) {
      const facts = [...REVIEW_MONTHS, { path, expression: 'true' }];
      assert.equal(rulesSchema(rulesFor(facts)), false, path);
    }
  });

  await t.test('as is a name an expression can use', () => {
    for (const as of ['2months', 'a.b', 'month[]', '']) {
      const facts = [{ path: 'reviewMonths', as, expression: 'months' }, { path: 'n', expression: 'size(reviewMonths)' }];
      assert.equal(rulesSchema(rulesFor(facts)), false, JSON.stringify(as));
    }
  });
});

// ── The compiled graph ────────────────────────────────────────────────────────

test('compiling per-item facts', async (t) => {
  const graph = compileRuleset('eligibility', 'review', ruleset(NESTED, [
    'qualifyingMonthCount', 'reviewMonths[].qualifies', 'reviewMonths[].reviewWeeks[].shareOfMonth', 'anyMonthEveryWeekWorked',
  ]));
  const deps = (fact) => [...graph.dependencies[fact]].sort();

  await t.test('the graph validates against the graph schema', () => {
    const valid = graphSchema({ $schema: 'https://blueprint.codeforamerica.org/schemas/graph-schema.yaml', ...graph });
    assert.ok(valid, JSON.stringify(graphSchema.errors));
  });

  await t.test('every fact is keyed by its path, per-item facts included', () => {
    assert.deepEqual(Object.keys(graph.facts).sort(), NESTED.map((f) => f.path).sort());
  });

  await t.test('a list fact keeps its as', () => {
    assert.equal(graph.facts.reviewMonths.as, 'month');
    assert.equal(graph.facts['reviewMonths[].reviewWeeks'].as, 'week');
    assert.equal(graph.facts['reviewMonths[].qualifies'].as, undefined);
  });

  await t.test('a per-item fact depends on its list, and on the per-item facts it reads', () => {
    assert.deepEqual(deps('reviewMonths[].meetsHours'), ['reviewMonths']);
    assert.deepEqual(deps('reviewMonths[].qualifies'), ['reviewMonths', 'reviewMonths[].meetsHours']);
  });

  await t.test('an inner per-item fact depends on its own list and on every enclosing list it reads', () => {
    assert.deepEqual(deps('reviewMonths[].reviewWeeks'), ['reviewMonths']);
    assert.deepEqual(deps('reviewMonths[].reviewWeeks[].shareOfMonth'), ['reviewMonths', 'reviewMonths[].reviewWeeks']);
  });

  await t.test('a fact reading a list depends on every per-item fact on it, at every depth', () => {
    assert.deepEqual(deps('qualifyingMonthCount'), [
      'reviewMonths',
      'reviewMonths[].everyWeekWorked',
      'reviewMonths[].meetsHours',
      'reviewMonths[].qualifies',
      'reviewMonths[].reviewWeeks',
      'reviewMonths[].reviewWeeks[].shareOfMonth',
    ]);
    assert.deepEqual(deps('reviewMonths[].everyWeekWorked'), [
      'reviewMonths', 'reviewMonths[].reviewWeeks', 'reviewMonths[].reviewWeeks[].shareOfMonth',
    ]);
  });

  await t.test('a graph with per-item facts is format edition 1.1', () => {
    assert.equal(graph.formatVersion, '1.1');
  });

  await t.test('a graph without them stays at 1.0, so engines that predate them still run it', () => {
    const plain = compileRuleset('eligibility', 'review', ruleset([{ path: 'n', expression: 'size(months)' }]));
    assert.equal(plain.formatVersion, '1.0');
  });

  await t.test('the graph schema accepts an edition as major.minor, and nothing else', () => {
    const at = (formatVersion) => graphSchema({ $schema: 'https://blueprint.codeforamerica.org/schemas/graph-schema.yaml', ...graph, formatVersion });
    assert.ok(at('1.0') && at('1.1') && at('12.3'));
    for (const bad of ['1', '1.1.0', 'v1.1', 1.1]) assert.equal(at(bad), false, String(bad));
  });

  await t.test('per-item facts can be outputs', () => {
    assert.ok(graph.outputs.includes('reviewMonths[].qualifies'));
    assert.ok(graph.outputs.includes('reviewMonths[].reviewWeeks[].shareOfMonth'));
  });
});

// ── Where a list's items come from ────────────────────────────────────────────

test('inputOf — the input a list fact\'s items come from', async (t) => {
  const inputs = Object.fromEntries(['$.months[]', '$.months[].hoursWorked', '$.months[].weeks[]', '$.months[].weeks[].hours', '$.h.months[]', '$.other[]'].map((p) => [p, {}]));
  const of = (expression) => inputOf({ inputs, facts: { reviewMonths: { as: 'month', expression } } }, 'reviewMonths');

  await t.test('an input, or a field holding one', () => {
    assert.equal(of('months'), '$.months[]');
    assert.equal(of('h.months'), '$.h.months[]');
  });

  await t.test('some of an input\'s items, through filter and conditionals whose branches agree', () => {
    assert.equal(of('months.filter(m, m.monthsBefore <= 1)'), '$.months[]');
    assert.equal(of('months.filter(m, m.x).filter(m, m.y)'), '$.months[]');
    assert.equal(of('isApplication ? months.filter(m, m.monthsBefore <= 1) : months'), '$.months[]');
  });

  await t.test('a list inside each item of an enclosing list', () => {
    const facts = {
      reviewMonths: { as: 'month', expression: 'months' },
      'reviewMonths[].reviewWeeks': { as: 'week', expression: 'month.weeks' },
      builtMonths: { as: 'month', expression: 'months.map(m, {"weeks": m.weeks})' },
      'builtMonths[].reviewWeeks': { as: 'week', expression: 'month.weeks' },
    };
    assert.equal(inputOf({ inputs, facts }, 'reviewMonths[].reviewWeeks'), '$.months[].weeks[]');
    assert.equal(inputOf({ inputs, facts }, 'builtMonths[].reviewWeeks'), null);
  });

  await t.test('null for new items, mixed inputs, or anything else', () => {
    for (const expression of [
      'months.map(m, {"hours": m.hoursWorked})', 'c ? months : other', 'months + other',
      'months[0]', 'has(h.months)', 'months.exists(m, m.x)', 'missing', 'not cel (',
    ]) assert.equal(of(expression), null, expression);
    assert.equal(inputOf({ inputs, facts: {} }, 'reviewMonths'), null);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

test('validating per-item facts', async (t) => {
  const check = (facts, outputs) => validateRuleset('eligibility', 'review', ruleset(facts, outputs));

  await t.test('a list fact and facts on its items, two levels deep, validate', () => {
    assert.deepEqual(check(NESTED, ['qualifyingMonthCount', 'anyMonthEveryWeekWorked']), []);
  });

  await t.test('a per-item fact read only through its list is reachable', () => {
    assert.deepEqual(rulesOf(check(REVIEW_MONTHS), 'no-unreachable'), []);
  });

  await t.test('a per-item fact on something that is not a list fact is refused', () => {
    for (const path of ['others[].x', 'isApplication[].x']) {
      const errors = rulesOf(check([...REVIEW_MONTHS, { path, expression: 'true' }]), 'per-item-without-list');
      assert.equal(errors.length, 1, path);
      assert.match(errors[0].message, new RegExp(path.split('[]')[0]));
    }
  });

  await t.test('an inner per-item fact needs its inner list fact', () => {
    const errors = rulesOf(check([...REVIEW_MONTHS, { path: 'reviewMonths[].weeks[].x', expression: 'true' }]), 'per-item-without-list');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /reviewMonths\[\]\.weeks/);
  });

  await t.test('as cannot reuse a name an expression already has', () => {
    const named = (as) => [
      { path: 'isApplication', expression: "determination.kind == 'application'" },
      { path: 'reviewMonths', as, expression: 'months' },
      { path: 'reviewMonths[].x', expression: 'true' },
      { path: 'n', expression: 'size(reviewMonths.filter(m, m.x))' },
    ];
    for (const as of ['months', 'determination', 'isApplication', 'constants', 'reviewMonths']) {
      const errors = rulesOf(check(named(as)), 'as-name-in-use');
      assert.equal(errors.length, 1, as);
      assert.match(errors[0].message, new RegExp(`"${as}"`));
    }
  });

  await t.test('an inner as cannot reuse an enclosing one', () => {
    const errors = rulesOf(check([
      ...REVIEW_MONTHS,
      { path: 'reviewMonths[].reviewWeeks', as: 'month', expression: 'month.weeks' },
      { path: 'reviewMonths[].reviewWeeks[].x', expression: 'true' },
    ]), 'as-name-in-use');
    assert.equal(errors.length, 1);
  });

  await t.test('a per-item fact named like a field the item already has is refused', () => {
    const errors = rulesOf(check([...REVIEW_MONTHS, { path: 'reviewMonths[].hoursWorked', expression: '0.0' }]), 'item-field-name-in-use');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /hoursWorked/);
  });

  await t.test('a per-item fact reading a fact that reads its own list is a cycle', () => {
    const errors = rulesOf(check([
      ...REVIEW_MONTHS,
      { path: 'reviewMonths[].aboveAverage', expression: 'qualifyingMonthCount > 1' },
    ]), 'no-cycles');
    assert.ok(errors.length > 0);
  });
});
