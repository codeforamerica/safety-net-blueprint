/**
 * Evaluating per-item facts.
 *
 * A list fact names its items with `as`; a fact at `list[].name` is computed
 * once for each item and attached to it, so a later expression reads it as a
 * field — `reviewMonths.filter(m, m.qualifies)`.
 *
 * A per-item fact's node has the shape every node has. Its `value` has one
 * entry per item, in the list's order, null where that item is unresolved;
 * a fact on an inner list nests the same way, one list per outer item.
 * `missing` names each unresolved item by its position in the input:
 * `$.months[1].hoursWorked`.
 *
 * The conformance corpus pins the contract another engine must meet; these
 * cover this engine more closely.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate } from '../src/index.js';
import { generate } from '@codeforamerica/blueprint-core';

/** Compile one ruleset through `generate`, the way the pipeline does. */
function graphFor(ruleset) {
  const [{ graph }] = generate([{
    path: 'rules.yaml',
    relativePath: 'rules.yaml',
    type: 'rules',
    domain: 'eligibility',
    content: { domain: 'eligibility', rulesets: { review: ruleset } },
    refs: () => new Map(),
    model: () => null,
    resolved: false,
    provenance: null,
  }], 'graph');
  return graph;
}

const MONTH = {
  type: 'object',
  properties: {
    monthsBefore: { type: 'integer' },
    hadMedicare: { type: 'boolean', default: false },
    hoursWorked: { type: 'number' },
    householdIncome: { type: 'number' },
    weeks: { type: 'array', items: { type: 'object', properties: { hours: { type: 'number' } } } },
  },
};

const review = (facts, outputs) => graphFor({
  endpoint: { path: '/review' },
  inputs: {
    determination: { type: 'object', properties: { kind: { type: 'string' } } },
    months: { type: 'array', items: MONTH },
  },
  constants: {
    monthlyHoursRequired: { value: 80 },
    incomeRequired: { value: 580 },
    applicationReviewMonths: { value: 1, type: 'integer' },
  },
  outputs: Object.fromEntries(outputs.map((name) => [name, {}])),
  facts,
});

const MONTHS = [
  { path: 'isApplication', expression: "determination.kind == 'application'" },
  {
    path: 'reviewMonths',
    as: 'month',
    expression: 'isApplication ? months.filter(m, m.monthsBefore <= constants.applicationReviewMonths) : months',
  },
  { path: 'reviewMonths[].meetsHours', expression: 'month.hoursWorked >= constants.monthlyHoursRequired' },
  { path: 'reviewMonths[].meetsIncome', expression: 'month.householdIncome >= constants.incomeRequired' },
  { path: 'reviewMonths[].qualifies', expression: 'month.hadMedicare || month.meetsHours || month.meetsIncome' },
  {
    path: 'reviewMonths[].qualifiesBy',
    expression: "month.hadMedicare ? 'medicare' : month.meetsIncome ? 'income' : month.meetsHours ? 'hours' : 'none'",
  },
  { path: 'qualifyingMonthCount', expression: 'size(reviewMonths.filter(m, m.qualifies))' },
  { path: 'anyMonthQualifies', expression: 'reviewMonths.exists(m, m.qualifies)' },
];
const graph = review(MONTHS, ['reviewMonths[].qualifies', 'reviewMonths[].qualifiesBy', 'qualifyingMonthCount', 'anyMonthQualifies']);

const renewal = (months) => ({ determination: { kind: 'renewal' }, months });
const settled = (node) => [node.state, node.value];

describe('per-item facts — every item answered', () => {
  const nodes = evaluate(graph, renewal([
    { monthsBefore: 1, hadMedicare: false, hoursWorked: 20, householdIncome: 300 },
    { monthsBefore: 2, hadMedicare: false, hoursWorked: 82, householdIncome: 300 },
    { monthsBefore: 3, hadMedicare: false, hoursWorked: 10, householdIncome: 600 },
  ]));

  it('each item gets its own value, in the list\'s order', () => {
    assert.deepStrictEqual(settled(nodes['reviewMonths[].qualifies']), ['complete', [false, true, true]]);
    assert.deepStrictEqual(nodes['reviewMonths[].qualifiesBy'].value, ['none', 'hours', 'income']);
  });

  it('the node has the shape every node has', () => {
    assert.deepStrictEqual(Object.keys(nodes['reviewMonths[].qualifies']).sort(), ['state', 'type', 'value']);
  });

  it('a later fact reads per-item facts as fields of each item', () => {
    assert.deepStrictEqual(settled(nodes.qualifyingMonthCount), ['complete', 2]);
  });

  it('a per-item fact declared an output is typed output, one that is not is intermediate', () => {
    assert.strictEqual(nodes['reviewMonths[].qualifies'].type, 'output');
    assert.strictEqual(nodes['reviewMonths[].meetsHours'].type, 'intermediate');
  });

  it('the list fact\'s value is the items as sent, without the facts computed on them', () => {
    assert.deepStrictEqual(nodes.reviewMonths.value.map((m) => m.monthsBefore), [1, 2, 3]);
    assert.strictEqual(nodes.reviewMonths.value[0].qualifies, undefined);
  });
});

describe('per-item facts — over a filtered list', () => {
  it('are computed only for the items the list fact keeps', () => {
    const nodes = evaluate(graph, {
      determination: { kind: 'application' },
      months: [
        { monthsBefore: 1, hadMedicare: false, hoursWorked: 90, householdIncome: 0 },
        { monthsBefore: 2, hadMedicare: false, hoursWorked: 0, householdIncome: 0 },
      ],
    });
    assert.deepStrictEqual(nodes['reviewMonths[].qualifies'].value, [true]);
    assert.strictEqual(nodes.qualifyingMonthCount.value, 1);
  });

  it('a missing answer is named at the item\'s position in the input, not in the list fact', () => {
    const nodes = evaluate(graph, {
      determination: { kind: 'application' },
      months: [
        { monthsBefore: 3, hadMedicare: false, hoursWorked: 90, householdIncome: 0 },
        { monthsBefore: 1, hadMedicare: false, householdIncome: 0 },
      ],
    });
    assert.deepStrictEqual(nodes['reviewMonths[].qualifies'].value, [null]);
    assert.deepStrictEqual(nodes['reviewMonths[].qualifies'].missing, ['$.months[1].hoursWorked']);
  });

  it('an empty list gives an empty list, complete', () => {
    const nodes = evaluate(graph, renewal([]));
    assert.deepStrictEqual(settled(nodes['reviewMonths[].qualifies']), ['complete', []]);
    assert.strictEqual(nodes.qualifyingMonthCount.value, 0);
  });
});

describe('per-item facts — an item missing an answer', () => {
  const nodes = evaluate(graph, renewal([
    { monthsBefore: 1, hadMedicare: false, hoursWorked: 20, householdIncome: 300 },
    { monthsBefore: 2, hadMedicare: false, hoursWorked: 82, householdIncome: 300 },
    { monthsBefore: 3, hadMedicare: false, hoursWorked: 10 },
  ]));
  const qualifies = nodes['reviewMonths[].qualifies'];

  it('only that item is unresolved; the others keep their values', () => {
    assert.deepStrictEqual(settled(qualifies), ['missing', [false, true, null]]);
  });

  it('names that item and the answer it needs', () => {
    assert.deepStrictEqual(qualifies.missing, ['$.months[2].householdIncome']);
  });

  it('an answer an item does not need is not asked for', () => {
    // The month qualifies on hours; its income is never needed.
    const n = evaluate(graph, renewal([{ monthsBefore: 2, hadMedicare: false, hoursWorked: 82 }]));
    assert.deepStrictEqual(settled(n['reviewMonths[].qualifies']), ['complete', [true]]);
    assert.strictEqual(n['reviewMonths[].qualifies'].missing, undefined);
  });

  it('two items missing different answers are each named', () => {
    const n = evaluate(graph, renewal([
      { monthsBefore: 1, hadMedicare: false, hoursWorked: 20 },
      { monthsBefore: 2, hadMedicare: false, householdIncome: 0 },
    ]));
    assert.deepStrictEqual(
      [...n['reviewMonths[].qualifies'].missing].sort(),
      ['$.months[0].householdIncome', '$.months[1].hoursWorked'],
    );
  });

  it('a later fact another item already settles is settled', () => {
    assert.deepStrictEqual(settled(nodes.anyMonthQualifies), ['complete', true]);
  });

  it('a later fact the unresolved item could change carries the same path', () => {
    assert.strictEqual(nodes.qualifyingMonthCount.state, 'missing');
    assert.deepStrictEqual(nodes.qualifyingMonthCount.missing, ['$.months[2].householdIncome']);
  });
});

describe('per-item facts — a default on an item\'s field', () => {
  it('fills an unanswered field, and a result resting on it is a placeholder', () => {
    // No hadMedicare: false by default. Nothing else qualifies the month, so
    // the answer rests on the default.
    const nodes = evaluate(graph, renewal([{ monthsBefore: 1, hoursWorked: 10, householdIncome: 100 }]));
    assert.deepStrictEqual(settled(nodes['reviewMonths[].qualifies']), ['placeholder', [false]]);
  });

  it('is not needed when another condition settles the item', () => {
    const nodes = evaluate(graph, renewal([{ monthsBefore: 1, hoursWorked: 90, householdIncome: 100 }]));
    assert.deepStrictEqual(settled(nodes['reviewMonths[].qualifies']), ['complete', [true]]);
  });

  it('applies inside a plain macro over the input too, not only through a list fact', () => {
    const plain = review([{ path: 'anyMedicare', expression: 'months.exists(m, m.hadMedicare)' }], ['anyMedicare']);
    assert.deepStrictEqual(settled(evaluate(plain, { months: [{ monthsBefore: 1 }] }).anyMedicare), ['placeholder', false]);
  });
});

describe('per-item facts — a list built of new values', () => {
  const built = review([
    { path: 'reviewMonths', as: 'month', expression: 'months.map(m, {"hours": m.hoursWorked})' },
    { path: 'reviewMonths[].long', expression: 'month.hours > 100.0' },
    { path: 'reviewMonths[].veryLong', expression: 'month.overtime > 20.0' },
  ], ['reviewMonths[].long', 'reviewMonths[].veryLong']);

  it('per-item facts read the built items', () => {
    const nodes = evaluate(built, { months: [{ hoursWorked: 120 }, { hoursWorked: 50 }] });
    assert.deepStrictEqual(nodes['reviewMonths[].long'].value, [true, false]);
  });

  it('a field the built items lack is named on the list fact, at the item\'s position in it, since no input holds it', () => {
    const nodes = evaluate(built, { months: [{ hoursWorked: 120 }] });
    assert.strictEqual(nodes['reviewMonths[].veryLong'].state, 'missing');
    assert.deepStrictEqual(nodes['reviewMonths[].veryLong'].missing, ['reviewMonths[0].overtime']);
  });
});

describe('per-item facts — two levels deep', () => {
  const nested = review([
    { path: 'reviewMonths', as: 'month', expression: 'months' },
    { path: 'reviewMonths[].reviewWeeks', as: 'week', expression: 'month.weeks' },
    { path: 'reviewMonths[].reviewWeeks[].worked', expression: 'week.hours > 0.0' },
    { path: 'reviewMonths[].reviewWeeks[].shareOfMonth', expression: 'week.hours / month.hoursWorked' },
    { path: 'reviewMonths[].everyWeekWorked', expression: 'month.reviewWeeks.all(w, w.worked)' },
    { path: 'anyMonthEveryWeekWorked', expression: 'reviewMonths.exists(m, m.everyWeekWorked)' },
  ], ['reviewMonths[].reviewWeeks[].shareOfMonth', 'reviewMonths[].everyWeekWorked', 'anyMonthEveryWeekWorked']);

  const inputs = {
    months: [
      { hoursWorked: 40, weeks: [{ hours: 10 }, { hours: 30 }] },
      { hoursWorked: 20, weeks: [{ hours: 20 }, { hours: 0 }] },
    ],
  };

  it('an inner per-item fact is a list per outer item, and reads both items by name', () => {
    assert.deepStrictEqual(evaluate(nested, inputs)['reviewMonths[].reviewWeeks[].shareOfMonth'].value, [[0.25, 0.75], [1, 0]]);
  });

  it('an outer per-item fact reads the inner ones through its own list', () => {
    const nodes = evaluate(nested, inputs);
    assert.deepStrictEqual(nodes['reviewMonths[].everyWeekWorked'].value, [true, false]);
    assert.deepStrictEqual(settled(nodes.anyMonthEveryWeekWorked), ['complete', true]);
  });

  it('a missing inner answer names both positions, and leaves the other items settled', () => {
    const nodes = evaluate(nested, {
      months: [
        { hoursWorked: 40, weeks: [{ hours: 10 }, {}] },
        { hoursWorked: 20, weeks: [{ hours: 20 }] },
      ],
    });
    const worked = nodes['reviewMonths[].reviewWeeks[].worked'];
    assert.deepStrictEqual(worked.value, [[true, null], [true]]);
    assert.deepStrictEqual(worked.missing, ['$.months[0].weeks[1].hours']);
    assert.deepStrictEqual(nodes['reviewMonths[].everyWeekWorked'].value, [null, true]);
    assert.deepStrictEqual(settled(nodes.anyMonthEveryWeekWorked), ['complete', true]);
  });
});

describe('per-item facts — a wrong-type answer on an item', () => {
  it('errors the list fact and every fact on its items, as a wrong-type item errors any fact reading the list', () => {
    const nodes = evaluate(graph, renewal([
      { monthsBefore: 1, hadMedicare: false, hoursWorked: 90, householdIncome: 0 },
      { monthsBefore: 2, hadMedicare: false, hoursWorked: 'many', householdIncome: 0 },
    ]));
    assert.strictEqual(nodes.reviewMonths.state, 'error');
    assert.strictEqual(nodes['reviewMonths[].meetsHours'].state, 'error');
    assert.strictEqual(nodes.qualifyingMonthCount.state, 'error');
  });
});

describe('per-item facts — an item an expression fails on', () => {
  const failing = review([
    { path: 'reviewMonths', as: 'month', expression: 'months' },
    { path: 'reviewMonths[].meetsHours', expression: 'month.hoursWorked >= constants.monthlyHoursRequired' },
    { path: 'reviewMonths[].monthsPerYear', expression: '12 / month.monthsBefore' },
    { path: 'reviewMonths[].shortReview', expression: 'month.monthsPerYear > 6' },
    { path: 'meetsHoursCount', expression: 'size(reviewMonths.filter(m, m.meetsHours))' },
    { path: 'anyShortReview', expression: 'reviewMonths.exists(m, m.monthsPerYear > 6)' },
    { path: 'everyEarlierMonthCounted', expression: 'reviewMonths.filter(m, m.monthsBefore > 0).all(m, m.monthsPerYear >= 1)' },
  ], ['meetsHoursCount', 'anyShortReview', 'everyEarlierMonthCounted']);

  // 12 / 0 fails on the first and third months.
  const nodes = evaluate(failing, renewal([
    { monthsBefore: 0, hoursWorked: 90 },
    { monthsBefore: 1, hoursWorked: 40 },
    { monthsBefore: 0, hoursWorked: 85 },
  ]));

  it('a fact that does not read it still answers', () => {
    assert.deepStrictEqual(settled(nodes.meetsHoursCount), ['complete', 2]);
  });

  it('a fact that reads it only on items it did not fail on still answers', () => {
    assert.deepStrictEqual(settled(nodes.everyEarlierMonthCounted), ['complete', true]);
  });

  it('errors, naming every item it failed on', () => {
    const node = nodes['reviewMonths[].monthsPerYear'];
    assert.deepStrictEqual(settled(node), ['error', null]);
    assert.match(node.message, /int divide by zero \(on reviewMonths\[0\], reviewMonths\[2\]\)$/);
  });

  it('a per-item fact reading it errors on the same items', () => {
    const node = nodes['reviewMonths[].shortReview'];
    assert.strictEqual(node.state, 'error');
    assert.match(node.message, /^Dependency error: 'reviewMonths\[\]\.monthsPerYear' — .* \(on reviewMonths\[0\], reviewMonths\[2\]\)$/);
  });

  it('a fact reading it across the items errors, naming an item it failed on', () => {
    const node = nodes.anyShortReview;
    assert.strictEqual(node.state, 'error');
    assert.match(node.message, /^Dependency error: 'reviewMonths\[\]\.monthsPerYear' — .* \(on reviewMonths\[0\]\)$/);
  });

  it('an inner list that fails on one outer item errors what reads it there, and nothing else', () => {
    const nested = review([
      { path: 'reviewMonths', as: 'month', expression: 'months' },
      { path: 'reviewMonths[].meetsHours', expression: 'month.hoursWorked >= constants.monthlyHoursRequired' },
      { path: 'reviewMonths[].reviewWeeks', as: 'week', expression: 'month.weeks.filter(w, 12 / month.monthsBefore > 0)' },
      { path: 'reviewMonths[].reviewWeeks[].worked', expression: 'week.hours > 0.0' },
      { path: 'reviewMonths[].everyWeekWorked', expression: 'month.reviewWeeks.all(w, w.worked)' },
    ], ['reviewMonths[].meetsHours', 'reviewMonths[].everyWeekWorked']);
    const result = evaluate(nested, renewal([
      { monthsBefore: 0, hoursWorked: 90, weeks: [{ hours: 10 }] },
      { monthsBefore: 1, hoursWorked: 40, weeks: [{ hours: 10 }] },
    ]));
    assert.match(result['reviewMonths[].reviewWeeks'].message, /\(on reviewMonths\[0\]\)$/);
    assert.match(result['reviewMonths[].reviewWeeks[].worked'].message, /^Dependency error: 'reviewMonths\[\]\.reviewWeeks' — .* \(on reviewMonths\[0\]\)$/);
    assert.match(result['reviewMonths[].everyWeekWorked'].message, /^Dependency error: 'reviewMonths\[\]\.reviewWeeks' — .* \(on reviewMonths\[0\]\)$/);
    assert.deepStrictEqual(settled(result['reviewMonths[].meetsHours']), ['complete', [true, false]]);
  });
});

describe('per-item facts — the caller\'s input', () => {
  it('is left untouched: computed facts are not written onto the caller\'s items', () => {
    const months = [{ monthsBefore: 1, hadMedicare: false, hoursWorked: 90, householdIncome: 0 }];
    evaluate(graph, renewal(months));
    assert.deepStrictEqual(Object.keys(months[0]).sort(), ['hadMedicare', 'hoursWorked', 'householdIncome', 'monthsBefore']);
  });
});

describe('the graph format version', () => {
  // A graph says which edition of the graph format it is written in, as
  // major.minor. A minor edition adds; a major edition would change meaning.
  // An engine runs any edition up to the one it knows, and refuses the rest
  // rather than ignore what it doesn't understand.
  const plain = { outputs: ['f'], inputs: { '$.h.n': { type: 'integer' } }, facts: { f: { expression: 'h.n > 1' } }, dependencies: { f: ['$.h.n'] } };

  it('per-item facts compile to edition 1.1', () => {
    assert.strictEqual(graph.formatVersion, '1.1');
  });

  it('a graph using nothing newer compiles to edition 1.0, so older engines still run it', () => {
    assert.strictEqual(review([{ path: 'n', expression: 'size(months)' }], ['n']).formatVersion, '1.0');
  });

  it('a graph with no edition is read as 1.0', () => {
    assert.strictEqual(evaluate(plain, { h: { n: 2 } }).f.value, true);
  });

  it('an edition this engine knows is run', () => {
    for (const formatVersion of ['1.0', '1.1']) {
      assert.strictEqual(evaluate({ ...plain, formatVersion }, { h: { n: 2 } }).f.value, true, formatVersion);
    }
  });

  it('a later minor edition is refused, naming both editions', () => {
    assert.throws(() => evaluate({ ...plain, formatVersion: '1.9' }, {}), /1\.9.*1\.1|1\.1.*1\.9/);
  });

  it('another major edition is refused', () => {
    assert.throws(() => evaluate({ ...plain, formatVersion: '2.0' }, {}), /2\.0/);
  });
});
