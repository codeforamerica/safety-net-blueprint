/**
 * FactGraph translator and parity tests.
 *
 * Tests cover:
 *   - Graph compilation from rules YAML (compileRuleset via toFactGraphXml)
 *   - XML generation from ruleset declarations (toFactGraphXml)
 *   - CEL evaluator vs FactGraph parity: same inputs should produce matching results
 *   - Collection operations: filter, all(), exists(), has()
 *   - Three-state logic: placeholder facts when policy uses schema defaults
 *   - Type errors: wrong-type scalars error in CEL; FactGraph throws at seed time
 *   - Null collections: treated as missing in CEL; FactGraph returns placeholder
 *
 * Fixtures:
 *   tests/fixtures/snap-interview-probes/ — income + filter probes
 *   tests/fixtures/collection-ops/        — all/exists/has with policy defaults
 *
 * Golden files:
 *   *-graph.yaml      — expected compiled graph (compared via deep equal after YAML parse)
 *   *-fact-graph.xml  — expected FactGraph XML (compared as trimmed strings)
 *
 * Parity note:
 *   For scenarios 01–03 the two evaluators must agree exactly on all output facts
 *   (state and value). Scenarios 04–05 cover edge cases where behavior differs by
 *   design and are tested separately.
 *
 *   Scenario 04 (wrong-type scalar): CEL returns structured errors; FactGraph throws at
 *   seed time because the Scala engine rejects the type mismatch. Our evaluator's behavior
 *   is preferable — a thrown exception is a worse API than a structured error result.
 *
 *   Scenario 05 (null collection): CEL returns missing for member-based facts; FactGraph
 *   returns placeholder (empty arrays). FactGraph's seedGraph skips null/non-array values
 *   and the Scala engine evaluates the filter over an empty collection as Placeholder([]).
 *   CEL treats null the same as absent — a missing input, not a placeholder result.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { toFactGraphXml, toGraphWithFactGraph } from '../src/fact-graph.js';
import { toGraph } from '../src/index.js';
import { compileRuleset } from '@codeforamerica/blueprint-core';

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

describe('compileRuleset — snap interview probes', () => {
  const rulesDoc = loadYaml(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-rules.yaml'));
  const expected = loadYaml(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-graph.yaml'));

  it('compiled graph matches golden graph fixture', () => {
    const graph = compileRuleset('eligibility', 'snapInterviewProbes', rulesDoc.rulesets.snapInterviewProbes);
    assert.deepStrictEqual(graph, expected);
  });
});

describe('compileRuleset — collection ops', () => {
  const rulesDoc = loadYaml(join(__dirname, 'fixtures/collection-ops/collection-ops-rules.yaml'));
  const expected = loadYaml(join(__dirname, 'fixtures/collection-ops/collection-ops-graph.yaml'));

  it('compiled graph matches golden graph fixture', () => {
    const graph = compileRuleset('eligibility', 'collectionOps', rulesDoc.rulesets.collectionOps);
    assert.deepStrictEqual(graph, expected);
  });
});

// ── XML generation ─────────────────────────────────────────────────────────────

describe('toFactGraphXml — snap interview probes', () => {
  const rulesDoc = loadYaml(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-rules.yaml'));
  const expectedXml = loadText(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-fact-graph.xml'));

  it('generated XML matches golden fact-graph fixture', () => {
    const xml = toFactGraphXml(rulesDoc).trim();
    assert.strictEqual(xml, expectedXml);
  });
});

describe('toFactGraphXml — collection ops (all/exists/has)', () => {
  const rulesDoc = loadYaml(join(__dirname, 'fixtures/collection-ops/collection-ops-rules.yaml'));
  const expectedXml = loadText(join(__dirname, 'fixtures/collection-ops/collection-ops-fact-graph.xml'));

  it('generated XML matches golden fact-graph fixture', () => {
    const xml = toFactGraphXml(rulesDoc).trim();
    assert.strictEqual(xml, expectedXml);
  });
});

// ── CEL evaluator vs FactGraph parity ─────────────────────────────────────────
//
// Parity assertions compare output facts only — both evaluators must agree on
// state and value for each output fact.

describe('CEL evaluator vs FactGraph — scenarios 01–06 (output parity)', () => {
  const rulesDoc  = loadYaml(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-rules.yaml'));
  const examples  = loadYaml(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-rules-examples.yaml'));
  const scenarios = examples.rulesets.snapInterviewProbes.examples;

  const SCALAR_OUTPUTS = ['incomeGapExists', 'hasUnemployedWorkEligible', 'hasUnemployedAbawdCandidate', 'hasStudentMembers', 'hasNonCitizenMembers', 'hasFelonMembers', 'incomeInconsistencyProbe', 'generalWorkRequirementProbe', 'abawdProbe', 'studentEligibilityProbe', 'immigrationStatusProbe', 'felonComplianceProbe', 'changeVerificationProbe'];

  function assertOutputParity(celResult, fgResult, label) {
    const celOutputs = celResult.filter('output');
    const fgOutputs  = fgResult.filter('output');

    // Same set of output facts
    assert.deepStrictEqual(
      Object.keys(celOutputs.toJSON()).sort(),
      Object.keys(fgOutputs.toJSON()).sort(),
      `${label}: output fact names`
    );

    // Same state and value for each scalar output
    for (const fact of SCALAR_OUTPUTS) {
      const celNode = celOutputs.get(fact);
      const fgNode  = fgOutputs.get(fact);
      if (!celNode) continue;
      assert.strictEqual(celNode.state, fgNode.state, `${label}: ${fact} state`);
      if (celNode.state === 'complete' || celNode.state === 'placeholder') {
        assert.strictEqual(celNode.value, fgNode.value, `${label}: ${fact} value`);
      }
    }
  }

  it('scenario 01: no probes — all facts complete and agree', () => {
    assertOutputParity(
      toGraph(rulesDoc).evaluate(scenarios[0].inputs),
      toGraphWithFactGraph(rulesDoc).evaluate(scenarios[0].inputs),
      'scenario 01'
    );
  });

  it('scenario 02: multiple probes — complete/missing/errors agree', () => {
    assertOutputParity(
      toGraph(rulesDoc).evaluate(scenarios[1].inputs),
      toGraphWithFactGraph(rulesDoc).evaluate(scenarios[1].inputs),
      'scenario 02'
    );
  });

  it('scenario 03: partial inputs — incomeInconsistency missing in both', () => {
    assertOutputParity(
      toGraph(rulesDoc).evaluate(scenarios[2].inputs),
      toGraphWithFactGraph(rulesDoc).evaluate(scenarios[2].inputs),
      'scenario 03'
    );
  });

  it('scenario 04: wrong-type scalar — incomeInconsistency errors, member facts complete in both', () => {
    assertOutputParity(
      toGraph(rulesDoc).evaluate(scenarios[3].inputs),
      toGraphWithFactGraph(rulesDoc).evaluate(scenarios[3].inputs),
      'scenario 04'
    );
  });

  it('scenario 05: null collection — CEL resolves exists() to false; FactGraph returns placeholder (documented divergence)', () => {
    // CEL patches null members → [] and evaluates exists() as false (complete).
    // FactGraph leaves the collection unseeded and returns Placeholder for exists() facts.
    // Only assert agreement on facts that do agree.
    const cel = toGraph(rulesDoc).evaluate(scenarios[4].inputs).filter('output');
    const fg  = toGraphWithFactGraph(rulesDoc).evaluate(scenarios[4].inputs).filter('output');

    // Both agree: no errors, no missing
    assert.deepStrictEqual(cel.collect('error'),   {}, 'scenario 05: CEL errors');
    assert.deepStrictEqual(fg.collect('error'),    {}, 'scenario 05: FG errors');
    assert.deepStrictEqual(cel.collect('missing'), {}, 'scenario 05: CEL missing');
    assert.deepStrictEqual(fg.collect('missing'),  {}, 'scenario 05: FG missing');

    // incomeInconsistencyProbe and changeVerificationProbe agree in both
    assert.strictEqual(cel.get('incomeInconsistencyProbe').state, 'complete', 'CEL: incomeInconsistencyProbe complete');
    assert.strictEqual(fg.get('incomeInconsistencyProbe').state,  'complete', 'FG: incomeInconsistencyProbe complete');
    assert.strictEqual(cel.get('changeVerificationProbe').state,  'complete', 'CEL: changeVerificationProbe complete');
    assert.strictEqual(fg.get('changeVerificationProbe').state,   'complete', 'FG: changeVerificationProbe complete');
  });

  it('scenario 06: wrong-type sub-field — member facts error, scalar fact complete in both', () => {
    assertOutputParity(
      toGraph(rulesDoc).evaluate(scenarios[5].inputs),
      toGraphWithFactGraph(rulesDoc).evaluate(scenarios[5].inputs),
      'scenario 06'
    );
  });
});

// ── collection-ops fixture tests ───────────────────────────────────────────────

describe('evaluator — collection ops (all/exists/has)', () => {
  const rulesDoc = loadYaml(join(__dirname, 'fixtures/collection-ops/collection-ops-rules.yaml'));
  const scenariosDir = join(__dirname, 'fixtures/collection-ops/scenarios');

  it('scenario 01: filter uses policy defaults → placeholder; all/exists/has are complete', () => {
    const { inputs } = loadJson(join(scenariosDir, '01-mixed-ages-inputs.json'));
    const expected = loadJson(join(scenariosDir, '01-mixed-ages-outputs.json'));
    const result = toGraph(rulesDoc).evaluate(inputs).filter('output');
    assert.deepStrictEqual(result.collect('complete'),    expected.complete);
    assert.deepStrictEqual(result.collect('placeholder'), expected.placeholder);
    assert.deepStrictEqual(result.collect('missing'),     expected.missing);
    assert.deepStrictEqual(result.collect('error'),       expected.errors);
  });

  it('scenario 02: all facts are complete when policy is explicitly provided', () => {
    const { inputs } = loadJson(join(scenariosDir, '02-with-policy-inputs.json'));
    const expected = loadJson(join(scenariosDir, '02-with-policy-outputs.json'));
    const result = toGraph(rulesDoc).evaluate(inputs).filter('output');
    assert.deepStrictEqual(result.collect('complete'),    expected.complete);
    assert.deepStrictEqual(result.collect('placeholder'), expected.placeholder);
    assert.deepStrictEqual(result.collect('missing'),     expected.missing);
    assert.deepStrictEqual(result.collect('error'),       expected.errors);
  });
});
