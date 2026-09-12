/**
 * Evaluator tests for the Blueprint rules engine.
 *
 * These tests define the contract the evaluator must satisfy.
 *
 * Fixtures: tests/fixtures/snap-interview-probes/
 *   - snap-interview-probes-rules.yaml         — ruleset definition
 *   - snap-interview-probes-rules-examples.yaml — scenarios (inputs only; outputs asserted inline)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { toGraph } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures/snap-interview-probes');

function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

const ruleset  = loadYaml(join(fixturesDir, 'snap-interview-probes-rules.yaml'));
const examples = loadYaml(join(fixturesDir, 'snap-interview-probes-rules-examples.yaml'));
const scenarios = examples.rulesets.snapInterviewProbes.examples;

const PROBE_OUTPUTS = ['incomeInconsistencyProbe', 'generalWorkRequirementProbe', 'abawdProbe', 'studentEligibilityProbe', 'immigrationStatusProbe', 'felonComplianceProbe', 'changeVerificationProbe'];

describe('evaluator — snap interview probes', () => {

  it('scenario 01: no probes fire when household is straightforward', () => {
    const result = toGraph(ruleset).evaluate(scenarios[0].inputs).filter('output');
    assert.deepStrictEqual(result.collect('error'),       {});
    assert.deepStrictEqual(result.collect('missing'),     {});
    assert.deepStrictEqual(result.collect('placeholder'), {});
    for (const fact of PROBE_OUTPUTS) {
      assert.strictEqual(result.get(fact).value, false, `${fact} should be false`);
    }
  });

  it('scenario 02: income, ABAWD, non-citizen, and changed circumstances probes fire', () => {
    const result = toGraph(ruleset).evaluate(scenarios[1].inputs).filter('output');
    assert.deepStrictEqual(result.collect('error'),       {});
    assert.deepStrictEqual(result.collect('missing'),     {});
    assert.deepStrictEqual(result.collect('placeholder'), {});
    assert.strictEqual(result.get('incomeInconsistencyProbe').value,   true);
    assert.strictEqual(result.get('generalWorkRequirementProbe').value, true);
    assert.strictEqual(result.get('abawdProbe').value,                 true);
    assert.strictEqual(result.get('immigrationStatusProbe').value,     true);
    assert.strictEqual(result.get('changeVerificationProbe').value,    true);
    assert.strictEqual(result.get('studentEligibilityProbe').value,    false);
    assert.strictEqual(result.get('felonComplianceProbe').value,       false);
  });

  it('scenario 03: application binding omitted — changeVerificationProbe is missing', () => {
    const result = toGraph(ruleset).evaluate(scenarios[2].inputs).filter('output');
    assert.deepStrictEqual(result.collect('error'),       {});
    assert.deepStrictEqual(result.collect('placeholder'), {});
    assert.ok('changeVerificationProbe' in result.collect('missing'), 'changeVerificationProbe should be missing');
    assert.ok(result.get('incomeInconsistencyProbe').state === 'complete', 'incomeInconsistencyProbe should still be complete');
  });

  it('scenario 04: type error on monthlyIncome — incomeInconsistencyProbe errors, member-based probes resolve', () => {
    const result = toGraph(ruleset).evaluate(scenarios[3].inputs).filter('output');
    assert.deepStrictEqual(result.collect('missing'),     {});
    assert.deepStrictEqual(result.collect('placeholder'), {});
    // incomeGapExists (intermediate) errors internally; its output probe surfaces as error
    assert.ok('incomeInconsistencyProbe' in result.collect('error'),  'incomeInconsistencyProbe should error');
    assert.strictEqual(result.get('abawdProbe').state,              'complete', 'abawdProbe should still be complete');
    assert.strictEqual(result.get('changeVerificationProbe').state, 'complete', 'changeVerificationProbe should still be complete');
  });

  it('scenario 05: null collection — CEL resolves exists() to false; all probes complete', () => {
    // Note: FactGraph diverges here — it returns placeholder for member-based probes because
    // it returns Placeholder for exists() over an unseeded collection. CEL patches null → []
    // and evaluates exists() as false. Placeholder propagation from intermediate facts through
    // to output probes is a known gap in the CEL evaluator.
    const result = toGraph(ruleset).evaluate(scenarios[4].inputs).filter('output');
    assert.deepStrictEqual(result.collect('error'),       {});
    assert.deepStrictEqual(result.collect('missing'),     {});
    assert.deepStrictEqual(result.collect('placeholder'), {});
    for (const fact of PROBE_OUTPUTS) {
      assert.strictEqual(result.get(fact).state, 'complete', `${fact} should be complete`);
    }
    assert.strictEqual(result.get('changeVerificationProbe').value, false);
  });

  it('scenario 06: sub-field type error on age — member-based probe outputs error, income and change probes resolve', () => {
    const result = toGraph(ruleset).evaluate(scenarios[5].inputs).filter('output');
    assert.deepStrictEqual(result.collect('missing'),     {});
    assert.deepStrictEqual(result.collect('placeholder'), {});
    // Member-based intermediate facts error; their dependent probe outputs also error
    const memberProbes = ['generalWorkRequirementProbe', 'abawdProbe', 'studentEligibilityProbe', 'immigrationStatusProbe', 'felonComplianceProbe'];
    for (const fact of memberProbes) {
      assert.strictEqual(result.get(fact).state, 'error', `${fact} should be in errors`);
    }
    assert.strictEqual(result.get('incomeInconsistencyProbe').state,  'complete', 'incomeInconsistencyProbe should still be complete');
    assert.strictEqual(result.get('changeVerificationProbe').state,   'complete', 'changeVerificationProbe should still be complete');
  });

});
