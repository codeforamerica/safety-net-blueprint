/**
 * FactGraph translator and parity tests.
 *
 * Tests cover:
 *   - Graph compilation from rules YAML (via generate, then toFactGraphXml)
 *   - XML generation from ruleset declarations (toFactGraphXml)
 *   - CEL evaluator vs FactGraph parity: same inputs should produce matching results
 *   - Collection operations: filter, all(), exists(), has()
 *   - Placeholder: declared defaults, null collections, and propagation of both
 *     from an intermediate fact to the outputs computed from it
 *   - Type errors: a wrong-type input errors its dependents in both evaluators
 *
 * Fixtures:
 *   tests/fixtures/snap-interview-probes/ — income + filter probes
 *   tests/fixtures/collection-ops/        — all/exists/has with policy defaults
 *
 * Golden files:
 *   *-graph.yaml      — expected compiled graph (compared via deep equal after YAML parse)
 *   *-fact-graph.xml  — expected FactGraph XML (compared as trimmed strings)
 *
 * What these assert:
 *   That the translator produces the XML we expect, and that running the same
 *   graph through both engines produces the same nodes. Disagreement is a
 *   signal to investigate — usually a defect here, occasionally something the
 *   other engine cannot represent. Neither engine is the authority; the
 *   contract is, and it lives in tests/conformance/.
 *
 *   Where the two engines differ, and why, is recorded in CONFORMANCE.md —
 *   not here and not in the contract docs, so there is one place to read it.
 *
 * Coverage limit on `missing`:
 *   An absent collection ($.h.people[]) is not compared. An unseeded
 *   collection produces no Writable node in the Explanation tree, so a fact
 *   blocked on one has nothing on the other side to compare against. See
 *   unresolvedWritables() in tools/fact-graph.js. A field of one item
 *   ($.h.people[1].age) is compared: its item is seeded, and its position
 *   comes from the item's id.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { toFactGraph, toFactGraphXml, toGraphWithFactGraph } from '../tools/fact-graph.js';
import { toGraph } from '../src/evaluator.js';
import { generate, load } from '@codeforamerica/blueprint-core';

/**
 * A rules fixture, loaded the way the pipeline loads a contract.
 *
 * `generate` addresses documents by their position in a contract set and
 * refuses one that has none, so each fixture is loaded as a set of one
 * sitting at its own basename.
 *
 * @param {string} path - Absolute path to a *-rules.yaml fixture
 * @returns {import('@codeforamerica/blueprint-core').Doc}
 */
function rulesContract(path) {
  return load({ path, relativePath: basename(path) });
}

/**
 * Compile one ruleset through `generate`, the way the pipeline does.
 *
 * Kept local to the test rather than importing a compiler: compiling is a
 * build step core performs, not something consumers call.
 */
function graphFor(doc, rulesetName) {
  const name = rulesetName ?? Object.keys(doc.content.rulesets ?? {})[0];
  const found = generate([doc], 'graph').find(({ graph }) => graph.ruleset === name);
  if (!found) throw new Error(`Ruleset "${name}" produced no graph`);
  return found.graph;
}

/**
 * Compile a rules contract into the graph the engine evaluates.
 *
 * The engine itself takes graphs only — compiling is a build step that
 * belongs to blueprint-core. Tests do it here so the fixtures can stay as
 * readable rules YAML rather than checked-in compiled graphs.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc} doc
 * @param {string} [rulesetName] - Defaults to the document's only ruleset
 * @returns {{ graph: object }}
 */
function compile(doc, rulesetName) {
  const rulesets = doc.content?.rulesets ?? {};
  const name = rulesetName ?? Object.keys(rulesets)[0];
  const ruleset = rulesets[name];
  if (!ruleset) throw new Error(`Ruleset "${name}" not found`);
  return { graph: graphFor(doc, name) };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}
function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function loadText(path) {
  return readFileSync(path, 'utf8').trim();
}

// ── Graph compilation ──────────────────────────────────────────────────────────

describe('graph compilation — snap interview probes', () => {
  const rulesDoc = rulesContract(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-rules.yaml'));
  const { graph } = compile(rulesDoc);
  const expected = loadYaml(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-graph.yaml'));

  it('compiled graph matches golden graph fixture', () => {
    const graph = graphFor(rulesDoc, 'snapInterviewProbes');
    assert.deepStrictEqual(graph, expected);
  });
});

describe('graph compilation — collection ops', () => {
  const rulesDoc = rulesContract(join(__dirname, 'fixtures/collection-ops/collection-ops-rules.yaml'));
  const { graph } = compile(rulesDoc);
  const expected = loadYaml(join(__dirname, 'fixtures/collection-ops/collection-ops-graph.yaml'));

  it('compiled graph matches golden graph fixture', () => {
    const graph = graphFor(rulesDoc, 'collectionOps');
    assert.deepStrictEqual(graph, expected);
  });
});

// ── XML generation ─────────────────────────────────────────────────────────────

describe('toFactGraphXml — snap interview probes', () => {
  const rulesDoc = rulesContract(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-rules.yaml'));
  const { graph } = compile(rulesDoc);
  const expectedXml = loadText(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-fact-graph.xml'));

  it('generated XML matches golden fact-graph fixture', () => {
    const xml = toFactGraphXml(graph).trim();
    assert.strictEqual(xml, expectedXml);
  });
});

describe('toFactGraphXml — collection ops (all/exists/has)', () => {
  const rulesDoc = rulesContract(join(__dirname, 'fixtures/collection-ops/collection-ops-rules.yaml'));
  const { graph } = compile(rulesDoc);
  const expectedXml = loadText(join(__dirname, 'fixtures/collection-ops/collection-ops-fact-graph.xml'));

  it('generated XML matches golden fact-graph fixture', () => {
    const xml = toFactGraphXml(graph).trim();
    assert.strictEqual(xml, expectedXml);
  });
});

// ── CEL evaluator vs FactGraph parity ─────────────────────────────────────────

/**
 * FactGraph is the reference implementation: where the two disagree, this
 * engine is wrong, unless the difference is one we have deliberately chosen
 * and recorded in the header above.
 *
 * Every output fact is compared, not a hand-listed subset. The list this used
 * to iterate held only the scalar outputs, and skipped any fact the CEL side
 * had not produced — so a collection output whose value diverged, or a fact
 * one evaluator dropped entirely, passed silently.
 */
/**
 * Every fact in a fixture must reach the FactGraph dictionary.
 *
 * `toFactGraph` skips a fact it cannot translate so the rest of the graph
 * stays comparable. That is the right behaviour, but it degrades parity
 * silently: a skipped fact is simply absent, and the parity assertions above
 * then agree about a graph that is missing the interesting part. Asserting
 * zero skips is what makes a new untranslatable construct fail loudly instead
 * of quietly shrinking what these tests prove.
 */
function assertFullyTranslatable(graph, label) {
  const untranslated = new Map();
  toFactGraph(graph, untranslated);

  assert.deepStrictEqual(
    [...untranslated].map(([fact, why]) => `${fact}: ${why}`),
    [],
    `${label}: facts missing from the FactGraph dictionary, so parity does not cover them`
  );
}

function assertOutputParity(celResult, fgResult, label) {
  const cel = celResult.filter('output').toJSON();
  const fg  = fgResult.filter('output').toJSON();

  assert.deepStrictEqual(
    Object.keys(cel).sort(),
    Object.keys(fg).sort(),
    `${label}: output fact names`
  );

  for (const fact of Object.keys(cel)) {
    assert.strictEqual(cel[fact].state, fg[fact].state, `${label}: ${fact} state`);
    if (cel[fact].state === 'complete' || cel[fact].state === 'placeholder') {
      assert.deepStrictEqual(cel[fact].value, fg[fact].value, `${label}: ${fact} value`);
    }
    if (cel[fact].state === 'missing') {
      // Not a whole collection — see the coverage limit in the header. An
      // absent collection has no Writable in the Explanation tree, so
      // FactGraph cannot report it and comparing it would fail for the wrong
      // reason. A field of one item can be, and is compared by its position.
      const reportable = (paths) => (paths ?? []).filter((p) => !p.endsWith('[]')).sort();
      assert.deepStrictEqual(
        reportable(cel[fact].missing),
        reportable(fg[fact].missing),
        `${label}: ${fact} missing (all but absent collections)`
      );
    }
  }
}

describe('CEL evaluator vs FactGraph — scenarios 01–06 (output parity)', () => {
  const rulesDoc  = rulesContract(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-rules.yaml'));
  const { graph } = compile(rulesDoc);
  const examples  = loadYaml(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-rules-examples.yaml'));
  const scenarios = examples.rulesets.snapInterviewProbes.examples;

  it('every fact reaches the FactGraph dictionary', () => {
    assertFullyTranslatable(graph, 'snap-interview-probes');
  });

  it('scenario 01: no probes — all facts complete and agree', () => {
    assertOutputParity(
      toGraph(graph).evaluate(scenarios[0].inputs),
      toGraphWithFactGraph(graph).evaluate(scenarios[0].inputs),
      'scenario 01'
    );
  });

  it('scenario 02: multiple probes — complete/missing/errors agree', () => {
    assertOutputParity(
      toGraph(graph).evaluate(scenarios[1].inputs),
      toGraphWithFactGraph(graph).evaluate(scenarios[1].inputs),
      'scenario 02'
    );
  });

  it('scenario 03: partial inputs — incomeInconsistency missing in both', () => {
    assertOutputParity(
      toGraph(graph).evaluate(scenarios[2].inputs),
      toGraphWithFactGraph(graph).evaluate(scenarios[2].inputs),
      'scenario 03'
    );
  });

  it('scenario 04: wrong-type scalar — incomeInconsistency errors, member facts complete in both', () => {
    assertOutputParity(
      toGraph(graph).evaluate(scenarios[3].inputs),
      toGraphWithFactGraph(graph).evaluate(scenarios[3].inputs),
      'scenario 04'
    );
  });

  it('scenario 05: null collection — placeholder in both, fact for fact', () => {
    // This was recorded as a permanent divergence: CEL returning missing where
    // FactGraph returned placeholder, justified as CEL treating null as absent.
    // Neither half was true. The evaluator already patched null collections to
    // [], and what actually differed was that placeholder did not travel from
    // an intermediate fact to the outputs computed from it. It does now.
    assertOutputParity(
      toGraph(graph).evaluate(scenarios[4].inputs),
      toGraphWithFactGraph(graph).evaluate(scenarios[4].inputs),
      'scenario 05'
    );
  });

  it('scenario 06: wrong-type sub-field — member facts error, scalar fact complete in both', () => {
    assertOutputParity(
      toGraph(graph).evaluate(scenarios[5].inputs),
      toGraphWithFactGraph(graph).evaluate(scenarios[5].inputs),
      'scenario 06'
    );
  });
});

// ── collection-ops fixture tests ───────────────────────────────────────────────

describe('evaluator — collection ops (all/exists/has)', () => {
  const rulesDoc = rulesContract(join(__dirname, 'fixtures/collection-ops/collection-ops-rules.yaml'));
  const { graph } = compile(rulesDoc);
  const scenariosDir = join(__dirname, 'fixtures/collection-ops/scenarios');

  it('scenario 01: filter uses policy defaults → placeholder; all/exists/has are complete', () => {
    const { inputs } = loadJson(join(scenariosDir, '01-mixed-ages-inputs.json'));
    const expected = loadJson(join(scenariosDir, '01-mixed-ages-outputs.json'));
    const result = toGraph(graph).evaluate(inputs).filter('output');
    assert.deepStrictEqual(result.collect('complete'),    expected.complete);
    assert.deepStrictEqual(result.collect('placeholder'), expected.placeholder);
    assert.deepStrictEqual(result.collect('missing'),     expected.missing);
    assert.deepStrictEqual(result.collect('error'),       expected.errors);
  });

  it('scenario 02: all facts are complete when policy is explicitly provided', () => {
    const { inputs } = loadJson(join(scenariosDir, '02-with-policy-inputs.json'));
    const expected = loadJson(join(scenariosDir, '02-with-policy-outputs.json'));
    const result = toGraph(graph).evaluate(inputs).filter('output');
    assert.deepStrictEqual(result.collect('complete'),    expected.complete);
    assert.deepStrictEqual(result.collect('placeholder'), expected.placeholder);
    assert.deepStrictEqual(result.collect('missing'),     expected.missing);
    assert.deepStrictEqual(result.collect('error'),       expected.errors);
  });

  /**
   * This is the only fixture that declares input defaults, and it was never run
   * through FactGraph — the parity suite above uses the snap fixture, which has
   * none. So the entire defaults mechanism went unchecked against the reference
   * implementation, and the translator silently omitted the defaults from the
   * XML it generated. FactGraph answered from unset inputs and nothing noticed.
   */
  it('every fact reaches the FactGraph dictionary', () => {
    assertFullyTranslatable(graph, 'collection-ops');
  });

  describe('vs FactGraph — arithmetic', () => {
    const arithDoc = rulesContract(join(__dirname, 'fixtures/arithmetic/arithmetic-rules.yaml'));
    const { graph: arith } = compile(arithDoc);

    it('every fact reaches the FactGraph dictionary', () => {
      // Before the translator understood arithmetic its tokenizer threw on
      // '+', and every fact here would have been silently dropped.
      assertFullyTranslatable(arith, 'arithmetic');
    });

    const cases = {
      'combined income under shelter cost': { monthlyGrossIncome: 300, liquidResources: 200, monthlyShelterCost: 600, deduction: 100 },
      'combined income over shelter cost':  { monthlyGrossIncome: 900, liquidResources: 200, monthlyShelterCost: 600, deduction: 100 },
      'exactly at shelter cost':            { monthlyGrossIncome: 400, liquidResources: 200, monthlyShelterCost: 600, deduction: 100 },
      'deductions exceed income':           { monthlyGrossIncome: 100, liquidResources: 0,   monthlyShelterCost: 600, deduction: 400 },
    };

    for (const [label, household] of Object.entries(cases)) {
      it(`${label}: agrees fact for fact`, () => {
        assertOutputParity(
          toGraph(arith).evaluate({ household }),
          toGraphWithFactGraph(arith).evaluate({ household }),
          label
        );
      });
    }

    it('a fact reading a derived fact agrees too', () => {
      // hasNetIncome depends on netIncome, not on an input — the subtraction
      // has to survive one hop for this to hold.
      const household = { monthlyGrossIncome: 100, liquidResources: 0, monthlyShelterCost: 600, deduction: 400 };
      const cel = toGraph(arith).evaluate({ household }).toJSON();
      const fg  = toGraphWithFactGraph(arith).evaluate({ household }).toJSON();

      assert.strictEqual(cel.netIncome.value, -300, 'CEL: subtraction goes negative');
      assert.strictEqual(fg.netIncome.value, -300, 'FactGraph: same');
      assert.strictEqual(cel.hasNetIncome.value, false);
      assert.strictEqual(fg.hasNetIncome.value, false);
    });
  });

  describe('vs FactGraph — defaults', () => {
    const cases = {
      'namespace absent':  '01-mixed-ages-inputs.json',
      'namespace present': '02-with-policy-inputs.json',
    };

    for (const [label, file] of Object.entries(cases)) {
      it(`${label}: agrees fact for fact`, () => {
        const { inputs } = loadJson(join(scenariosDir, file));
        assertOutputParity(
          toGraph(graph).evaluate(inputs),
          toGraphWithFactGraph(graph).evaluate(inputs),
          label
        );
      });
    }

    it('namespace partially supplied: agrees fact for fact', () => {
      // Neither scenario file covers this, and it is the case the old
      // per-namespace defaulting got wrong: supply one field of `policy` and
      // the rest used to be left unset rather than defaulted.
      const { inputs } = loadJson(join(scenariosDir, '01-mixed-ages-inputs.json'));
      const partial = { ...inputs, policy: { minAge: 25 } };
      assertOutputParity(
        toGraph(graph).evaluate(partial),
        toGraphWithFactGraph(graph).evaluate(partial),
        'partial policy'
      );
    });
  });
});

describe('temporal inputs — Day, and what has no FactGraph type at all', () => {
  const dateGraph = (facts, inputs) => ({
    inputs: {
      '$.household.dateOfBirth': { type: 'string', format: 'date' },
      ...inputs,
    },
    facts,
    outputs: Object.keys(facts),
    dependencies: Object.fromEntries(
      Object.keys(facts).map((f) => [f, ['$.household.dateOfBirth']])
    ),
  });

  it('a format: date input is a Day fact, not a String', () => {
    const xml = toFactGraph(dateGraph({}));
    assert.match(xml, /<Fact path="\/household_dateOfBirth">\s*<Writable>\s*<Day\/>/);
  });

  it("timestamp() on a date literal becomes a <Day> constant", () => {
    // CEL has no date literal, so a constant date can only be written as a
    // conversion call. Rejecting the call would make the commonest date rule
    // there is — born before X — untestable across engines.
    const xml = toFactGraph(
      dateGraph({ bornBefore2009: { expression: "household.dateOfBirth < timestamp('2009-01-01T00:00:00Z')" } })
    );
    assert.match(xml, /<Day>2009-01-01<\/Day>/);
  });

  it('a bare date literal works the same as midnight UTC', () => {
    const xml = toFactGraph(
      dateGraph({ bornBefore2009: { expression: "household.dateOfBirth < timestamp('2009-01-01')" } })
    );
    assert.match(xml, /<Day>2009-01-01<\/Day>/);
  });

  it('and the comparison evaluates, agreeing with the reference engine', () => {
    const graph = dateGraph({
      bornBefore2009: { expression: "household.dateOfBirth < timestamp('2009-01-01T00:00:00Z')" },
    });
    const inputs = { household: { dateOfBirth: '1989-03-13' } };
    assert.deepStrictEqual(
      toGraphWithFactGraph(graph).evaluate(inputs).toJSON().bornBefore2009.value,
      toGraph(graph).evaluate(inputs).toJSON().bornBefore2009.value
    );
  });

  it('a timestamp() carrying a time of day is refused, not silently truncated', () => {
    // Day is date-granular. Dropping the time would let the two engines agree
    // on an answer neither was asked for.
    const untranslated = new Map();
    toFactGraph(
      dateGraph({ after: { expression: "household.dateOfBirth < timestamp('2009-01-01T09:30:00Z')" } }),
      untranslated
    );
    assert.match(untranslated.get('after'), /no timestamp type/);
  });

  it('timestamp() on a computed value is still refused', () => {
    const untranslated = new Map();
    toFactGraph(
      dateGraph({ converted: { expression: 'timestamp(household.dateOfBirth)' } }),
      untranslated
    );
    assert.match(untranslated.get('converted'), /no equivalent for 'timestamp\(\)'/);
  });

  it('a fact reading a format: date-time input cannot be expressed', () => {
    const untranslated = new Map();
    const graph = {
      inputs: { '$.application.submittedAt': { type: 'string', format: 'date-time' } },
      facts: { late: { expression: "application.submittedAt < timestamp('2025-01-01')" } },
      outputs: ['late'],
      dependencies: { late: ['$.application.submittedAt'] },
    };
    const xml = toFactGraph(graph, untranslated);
    assert.match(untranslated.get('late'), /no timestamp type/);
    // The input has no fact either — seeding one that is absent from the
    // dictionary reaches a null node and throws NullPointerException.
    assert.doesNotMatch(xml, /application_submittedAt/);
    assert.strictEqual(
      toGraphWithFactGraph(graph).evaluate({ application: { submittedAt: '2024-06-01T00:00:00Z' } })
        .toJSON().late.state,
      'error'
    );
  });

  it('a date sub-field of a collection is a Day too', () => {
    const xml = toFactGraph({
      inputs: {
        '$.h.members[]': { type: 'array' },
        '$.h.members[].dateOfBirth': { type: 'string', format: 'date' },
      },
      facts: {},
      outputs: [],
      dependencies: {},
    });
    assert.match(xml, /<Fact path="\/h_members\/\*\/dateOfBirth">\s*<Writable>\s*<Day\/>/);
  });

  it('an unparseable date is reported rather than thrown', () => {
    const graph = dateGraph({
      bornBefore2009: { expression: "household.dateOfBirth < timestamp('2009-01-01')" },
    });
    const result = toGraphWithFactGraph(graph)
      .evaluate({ household: { dateOfBirth: 'not-a-date' } })
      .toJSON();
    assert.strictEqual(result.bornBefore2009.state, 'error');
  });
});

describe('boolean defaults', () => {
  // `<Boolean>` names FactGraph's type, inside <Writable>; its values are
  // `<True/>` and `<False/>`. The translator used to write a boolean default as
  // `<Boolean>false</Boolean>`, which FactGraph rejected as an unregistered node
  // — and since that fails the dictionary import, no fact in the graph
  // evaluated. No fixture declared a boolean default, so nothing caught it.
  const flagGraph = (dflt) => ({
    outputs: ['answer'],
    inputs: { '$.p.flag': { type: 'boolean', default: dflt }, '$.p.n': { type: 'integer' } },
    facts: { answer: { expression: '!p.flag && p.n > 1' } },
    dependencies: { answer: ['$.p.flag', '$.p.n'] },
  });

  it('a boolean default is written as <True/> or <False/>', () => {
    assert.match(toFactGraph(flagGraph(false)), /<Placeholder>\s*<False\/>\s*<\/Placeholder>/);
    assert.match(toFactGraph(flagGraph(true)), /<Placeholder>\s*<True\/>\s*<\/Placeholder>/);
  });

  for (const dflt of [false, true]) {
    it(`a default of ${dflt}, unsupplied: agrees, as a placeholder`, () => {
      const inputs = { p: { n: 5 } };
      assertOutputParity(
        toGraph(flagGraph(dflt)).evaluate(inputs),
        toGraphWithFactGraph(flagGraph(dflt)).evaluate(inputs),
        `default ${dflt}`,
      );
      assert.strictEqual(toGraphWithFactGraph(flagGraph(dflt)).evaluate(inputs).toJSON().answer.state, 'placeholder');
    });
  }

  it('a supplied value overrides the default: agrees, and is complete', () => {
    const inputs = { p: { flag: true, n: 5 } };
    assertOutputParity(
      toGraph(flagGraph(false)).evaluate(inputs),
      toGraphWithFactGraph(flagGraph(false)).evaluate(inputs),
      'supplied',
    );
    const fg = toGraphWithFactGraph(flagGraph(false)).evaluate(inputs).toJSON();
    assert.deepStrictEqual([fg.answer.state, fg.answer.value], ['complete', false]);
  });
});

describe('facts that read an untranslated fact', () => {
  // `odd` has no FactGraph translation — FactGraph has no modulo — so it is
  // left out of the dictionary.
  // `big` reads it; `unrelated` does not. Emitting `big` anyway made it refer to
  // a path the dictionary lacks, FactGraph rejected the import, and `unrelated`
  // was lost with it. Now `big` is left out too, with the reason, and the rest
  // of the graph evaluates.
  const graph = {
    outputs: ['big', 'unrelated'],
    inputs: { '$.p.m': { type: 'integer' }, '$.p.n': { type: 'integer' } },
    facts: {
      odd: { expression: 'p.m % 2' },
      big: { expression: 'odd > 0' },
      bigger: { expression: 'big && p.n > 1' },
      unrelated: { expression: 'p.n > 1' },
    },
    dependencies: {
      odd: ['$.p.m'],
      big: ['odd'],
      bigger: ['big', '$.p.n'],
      unrelated: ['$.p.n'],
    },
  };
  const inputs = { p: { m: 3, n: 5 } };

  it('the dependents are left out of the dictionary, down the chain, each with its reason', () => {
    const untranslated = new Map();
    const xml = toFactGraph(graph, untranslated);
    assert.deepStrictEqual([...untranslated.keys()].sort(), ['big', 'bigger', 'odd']);
    assert.match(untranslated.get('big'), /reads 'odd'/);
    assert.match(untranslated.get('bigger'), /reads 'big'/);
    assert.doesNotMatch(xml, /path="\/(big|bigger)"/);
    assert.match(xml, /path="\/unrelated"/);
  });

  it('a fact that reads nothing untranslated still evaluates', () => {
    const fg = toGraphWithFactGraph(graph).evaluate(inputs).toJSON();
    assert.deepStrictEqual([fg.unrelated.state, fg.unrelated.value], ['complete', true]);
  });

  it('a dependent reports why it cannot run, rather than failing the whole graph', () => {
    const fg = toGraphWithFactGraph(graph).evaluate(inputs).toJSON();
    assert.strictEqual(fg.big.state, 'error');
    assert.match(fg.big.message, /reads 'odd', which has no FactGraph translation/);
  });
});

describe('number inputs keep their fraction', () => {
  // A `number` used to become FactGraph's Int. A fractional default could not
  // be written ("For input string: \"217.5\"" failed the whole dictionary
  // import), and a fractional value could not be used. It is a Rational now,
  // the type decimal literals in expressions already were.
  const earningsGraph = (dflt) => ({
    outputs: ['aboveMinimum', 'doubled'],
    inputs: {
      '$.w.weekly': { type: 'number' },
      '$.policy.minimum': { type: 'number', default: dflt },
    },
    facts: {
      aboveMinimum: { expression: 'w.weekly >= policy.minimum' },
      doubled: { expression: 'w.weekly * 2.0' },
    },
    dependencies: { aboveMinimum: ['$.w.weekly', '$.policy.minimum'], doubled: ['$.w.weekly'] },
  });

  it('a number is a Rational, and a fractional default an exact fraction', () => {
    const xml = toFactGraph(earningsGraph(217.5));
    assert.match(xml, /<Writable>\s*<Rational\/>\s*<\/Writable>/);
    assert.match(xml, /<Placeholder>\s*<Rational>435\/2<\/Rational>\s*<\/Placeholder>/);
  });

  it('a negative default keeps its sign', () => {
    assert.match(toFactGraph(earningsGraph(-2.5)), /<Rational>-5\/2<\/Rational>/);
  });

  for (const weekly of [217.5, 217.49, 300, 0]) {
    it(`a supplied ${weekly} against a fractional default: agrees fact for fact`, () => {
      const inputs = { w: { weekly } };
      assertOutputParity(
        toGraph(earningsGraph(217.5)).evaluate(inputs),
        toGraphWithFactGraph(earningsGraph(217.5)).evaluate(inputs),
        `weekly ${weekly}`,
      );
    });
  }

  it('a fractional result comes back as a number', () => {
    const fg = toGraphWithFactGraph(earningsGraph(217.5)).evaluate({ w: { weekly: 108.75 } }).toJSON();
    assert.deepStrictEqual([fg.doubled.state, fg.doubled.value], ['complete', 217.5]);
  });
});

describe('constants', () => {
  // A constant is a value no one supplies, so it is a Derived fact holding a
  // literal — not a Writable with a Placeholder, which would make every fact
  // resting on it a placeholder in FactGraph while CEL calls it complete.
  const constantsGraph = (constants) => ({
    outputs: ['monthly', 'isChild', 'tooMuch'],
    inputs: { '$.w.weekly': { type: 'number' }, '$.p.age': { type: 'integer' } },
    constants,
    facts: {
      monthly: { expression: 'w.weekly * constants.weeklyToMonthly' },
      isChild: { expression: 'p.age < constants.childAgeUnder' },
      tooMuch: { expression: 'w.weekly > 100.0 && constants.strict' },
    },
    dependencies: { monthly: ['$.w.weekly'], isChild: ['$.p.age'], tooMuch: ['$.w.weekly'] },
  });
  const graph = constantsGraph({
    weeklyToMonthly: { value: 4.3 },
    childAgeUnder: { value: 13, type: 'integer' },
    strict: { value: true },
  });
  const inputs = { w: { weekly: 250 }, p: { age: 9 } };

  it('each constant is a Derived literal of its type', () => {
    const xml = toFactGraph(graph);
    assert.match(xml, /path="\/constants_weeklyToMonthly">\s*<Derived>\s*<Rational>43\/10<\/Rational>/);
    assert.match(xml, /path="\/constants_childAgeUnder">\s*<Derived>\s*<Int>13<\/Int>/);
    assert.match(xml, /path="\/constants_strict">\s*<Derived>\s*<True\/>/);
  });

  it('agrees fact for fact, and both call the results complete', () => {
    const fg = toGraphWithFactGraph(graph).evaluate(inputs);
    assertOutputParity(toGraph(graph).evaluate(inputs), fg, 'constants');
    const json = fg.toJSON();
    assert.deepStrictEqual(
      ['monthly', 'isChild', 'tooMuch'].map((f) => [json[f].state, json[f].value]),
      [['complete', 1075], ['complete', true], ['complete', true]],
    );
  });

  it('a fact reading a constant FactGraph has no literal for is left out, with its reason', () => {
    const untranslated = new Map();
    toFactGraph(constantsGraph({
      weeklyToMonthly: { value: [4.3] },
      childAgeUnder: { value: 13, type: 'integer' },
      strict: { value: true },
    }), untranslated);
    assert.deepStrictEqual([...untranslated.keys()], ['monthly']);
    assert.match(untranslated.get('monthly'), /no literal for a constant of type array/);
  });

  it('a date constant is a Day, and agrees with CEL', () => {
    const dated = {
      outputs: ['startedBefore'],
      inputs: { '$.d.startedOn': { type: 'string', format: 'date' } },
      constants: { effectiveDate: { value: '2027-01-01', type: 'string', format: 'date' } },
      facts: { startedBefore: { expression: 'd.startedOn < constants.effectiveDate' } },
      dependencies: { startedBefore: ['$.d.startedOn'] },
    };
    assert.match(toFactGraph(dated), /path="\/constants_effectiveDate">\s*<Derived>\s*<Day>2027-01-01<\/Day>/);
    for (const startedOn of ['2026-12-31', '2027-01-01']) {
      assertOutputParity(toGraph(dated).evaluate({ d: { startedOn } }), toGraphWithFactGraph(dated).evaluate({ d: { startedOn } }), startedOn);
    }
  });

  it('a date-time constant is left out, with its reason', () => {
    const untranslated = new Map();
    toFactGraph({
      outputs: ['late'],
      inputs: { '$.d.at': { type: 'string', format: 'date-time' } },
      constants: { cutoff: { value: '2027-01-01T12:00:00Z', type: 'string', format: 'date-time' } },
      facts: { late: { expression: 'constants.cutoff < timestamp("2028-01-01T00:00:00Z")' } },
      dependencies: { late: [] },
    }, untranslated);
    assert.match(untranslated.get('late') ?? '', /no timestamp type/);
  });
});

describe('conditionals, size(), and membership', () => {
  const g = (facts, inputs) => ({
    outputs: Object.keys(facts),
    inputs,
    facts: Object.fromEntries(Object.entries(facts).map(([k, expression]) => [k, { expression }])),
    dependencies: Object.fromEntries(Object.keys(facts).map((k) => [k, Object.keys(inputs)])),
  });
  const parity = (graph, inputs, label) => assertOutputParity(
    toGraph(graph).evaluate(inputs), toGraphWithFactGraph(graph).evaluate(inputs), label);

  it('a chain of conditionals becomes one Switch with a Case each, and an else', () => {
    const graph = g({ band: "h.n > 10 ? 'high' : h.n > 5 ? 'mid' : 'low'" }, { '$.h.n': { type: 'integer' } });
    const xml = toFactGraph(graph);
    assert.strictEqual((xml.match(/<Switch>/g) ?? []).length, 1);
    assert.strictEqual((xml.match(/<Case>/g) ?? []).length, 3);
    for (const n of [12, 7, 1]) parity(graph, { h: { n } }, `n=${n}`);
  });

  it('size(x) translates the same as x.size()', () => {
    // Counting reads the collection, not its members' fields.
    const inputs = { '$.h.people[]': { type: 'array' } };
    const fn = g({ many: 'size(h.people) > 1' }, inputs);
    const method = g({ many: 'h.people.size() > 1' }, inputs);
    assert.strictEqual(toFactGraph(fn), toFactGraph(method));
    parity(fn, { h: { people: [{}, {}] } }, 'two people');
    parity(fn, { h: { people: [{}] } }, 'one person');
  });

  it('membership in a written-out list is a disjunction of equalities', () => {
    const graph = g({ inSet: 'h.n in [1, 3, 5]' }, { '$.h.n': { type: 'integer' } });
    for (const n of [3, 4]) parity(graph, { h: { n } }, `n=${n}`);
  });

  it('a list built in an expression is refused, with the reason', () => {
    const untranslated = new Map();
    toFactGraph(g({ codes: "h.n > 1 ? ['big'] : []" }, { '$.h.n': { type: 'integer' } }), untranslated);
    assert.match(untranslated.get('codes'), /no list value/);
  });

  it('an expression is translated whole or not at all', () => {
    // A parser that stopped at the first thing it did not understand used to
    // translate `h.n` out of `h.n in [...]` and answer with the number.
    const untranslated = new Map();
    toFactGraph(g({ weird: 'h.n h.n' }, { '$.h.n': { type: 'integer' } }), untranslated);
    assert.match(untranslated.get('weird'), /Unexpected/);
  });
});

describe('per-item facts', () => {
  it('are not translated yet, and say so', () => {
    // Fact Graph has them as collection facts (`/h_months/*/qualifies`), so
    // they can be translated; until then each is reported, not dropped.
    const untranslated = new Map();
    toFactGraph({
      formatVersion: '1.1',
      outputs: ['qualifyingMonthCount'],
      inputs: { '$.h.months[]': { type: 'array' }, '$.h.months[].hoursWorked': { type: 'number' } },
      facts: {
        reviewMonths: { as: 'month', expression: 'h.months' },
        'reviewMonths[].qualifies': { expression: 'month.hoursWorked >= 80.0' },
        qualifyingMonthCount: { expression: 'size(reviewMonths.filter(m, m.qualifies))' },
      },
      dependencies: {
        reviewMonths: ['$.h.months[]'],
        'reviewMonths[].qualifies': ['reviewMonths'],
        qualifyingMonthCount: ['reviewMonths', 'reviewMonths[].qualifies'],
      },
    }, untranslated);
    assert.match(untranslated.get('reviewMonths'), /per-item/);
    assert.match(untranslated.get('reviewMonths[].qualifies'), /per-item/);
    assert.ok(untranslated.has('qualifyingMonthCount'));
  });
});
