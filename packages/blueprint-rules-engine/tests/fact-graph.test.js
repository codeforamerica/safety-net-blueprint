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
 * Parity rule:
 *   FactGraph is the reference implementation. Where the two disagree on the
 *   state or value of a fact, this engine is wrong and gets fixed. Every
 *   scenario asserts full parity across every output fact.
 *
 *   Two earlier entries here claimed scenarios 04 and 05 diverged by design.
 *   Neither survived being measured. Scenario 05 was a genuine defect —
 *   placeholder did not travel from an intermediate fact to the outputs
 *   computed from it — and the note describing CEL's behavior contradicted
 *   the evaluator's own source in the same commit. Scenario 04 claimed
 *   FactGraph throws on a wrong-type scalar; it does not get the chance,
 *   because seedGraph type-checks before seeding. Both are fixed and both now
 *   assert full parity.
 *
 * Deliberate differences, and why:
 *   A difference is only allowed here when it is in how a result reaches the
 *   caller, never in what the result is.
 *
 *   1. A wrong-type input produces an `error` node rather than a thrown
 *      exception. seedGraph records the bad path and findAffectedFacts marks
 *      its dependents. An exception would discard the correctly computed
 *      results of every unaffected fact in the graph, which is strictly less
 *      information for no semantic gain.
 *
 * Not yet settled — do not treat as a deliberate difference:
 *   `missing` nodes carry the list of input paths still unreached, and this
 *   engine computes that list itself. FactGraph models the same thing:
 *   Explanation.solves is a List[List[Path]] of the writable paths that would
 *   resolve a fact, surfaced as graph.explainAndSolve(path). On a writable it
 *   works — explainAndSolve('/household_age') returns [['/household_age']] —
 *   but on our translated derived facts it returns [], so the two cannot be
 *   compared today and this file does not assert on `missing` contents.
 *   Whether that is a gap in how we emit <Derived> or in how solves
 *   aggregates is unknown. Until someone finds out, this is an unverified
 *   area, not a considered choice.
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
