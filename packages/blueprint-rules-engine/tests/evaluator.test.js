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
import { evaluate } from '../src/index.js';

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
    const result = evaluate(ruleset, scenarios[0].inputs);
    assert.deepStrictEqual(result.errors,      {});
    assert.deepStrictEqual(result.missing,     {});
    assert.deepStrictEqual(result.placeholder, {});
    for (const fact of PROBE_OUTPUTS) {
      assert.strictEqual(result.complete[fact], false, `${fact} should be false`);
    }
  });

  it('scenario 02: income, ABAWD, non-citizen, and changed circumstances probes fire', () => {
    const result = evaluate(ruleset, scenarios[1].inputs);
    assert.deepStrictEqual(result.errors,      {});
    assert.deepStrictEqual(result.missing,     {});
    assert.deepStrictEqual(result.placeholder, {});
    assert.strictEqual(result.complete.incomeInconsistencyProbe,   true);
    assert.strictEqual(result.complete.generalWorkRequirementProbe, true);
    assert.strictEqual(result.complete.abawdProbe,                 true);
    assert.strictEqual(result.complete.immigrationStatusProbe,     true);
    assert.strictEqual(result.complete.changeVerificationProbe,    true);
    assert.strictEqual(result.complete.studentEligibilityProbe,    false);
    assert.strictEqual(result.complete.felonComplianceProbe,       false);
  });

  it('scenario 03: application binding omitted — changeVerificationProbe is missing', () => {
    const result = evaluate(ruleset, scenarios[2].inputs);
    assert.deepStrictEqual(result.errors,      {});
    assert.deepStrictEqual(result.placeholder, {});
    assert.ok('changeVerificationProbe' in result.missing, 'changeVerificationProbe should be missing');
    assert.ok('incomeInconsistencyProbe' in result.complete, 'incomeInconsistencyProbe should still be complete');
  });

  it('scenario 04: type error on monthlyIncome — incomeInconsistencyProbe errors, member-based probes resolve', () => {
    const result = evaluate(ruleset, scenarios[3].inputs);
    assert.deepStrictEqual(result.missing,     {});
    assert.deepStrictEqual(result.placeholder, {});
    // incomeGapExists (intermediate) errors internally; its output probe surfaces as error
    assert.ok('incomeInconsistencyProbe' in result.errors,  'incomeInconsistencyProbe should error');
    assert.ok('abawdProbe' in result.complete,              'abawdProbe should still be complete');
    assert.ok('changeVerificationProbe' in result.complete, 'changeVerificationProbe should still be complete');
  });

  it('scenario 05: null collection — CEL resolves exists() to false; all probes complete', () => {
    // Note: FactGraph diverges here — it returns placeholder for member-based probes because
    // it returns Placeholder for exists() over an unseeded collection. CEL patches null → []
    // and evaluates exists() as false. Placeholder propagation from intermediate facts through
    // to output probes is a known gap in the CEL evaluator.
    const result = evaluate(ruleset, scenarios[4].inputs);
    assert.deepStrictEqual(result.errors,      {});
    assert.deepStrictEqual(result.missing,     {});
    assert.deepStrictEqual(result.placeholder, {});
    for (const fact of PROBE_OUTPUTS) {
      assert.ok(fact in result.complete, `${fact} should be complete`);
    }
    assert.strictEqual(result.complete.changeVerificationProbe, false);
  });

  it('scenario 06: sub-field type error on age — member-based probe outputs error, income and change probes resolve', () => {
    const result = evaluate(ruleset, scenarios[5].inputs);
    assert.deepStrictEqual(result.missing,     {});
    assert.deepStrictEqual(result.placeholder, {});
    // Member-based intermediate facts error; their dependent probe outputs also error
    const memberProbes = ['generalWorkRequirementProbe', 'abawdProbe', 'studentEligibilityProbe', 'immigrationStatusProbe', 'felonComplianceProbe'];
    for (const fact of memberProbes) {
      assert.ok(fact in result.errors, `${fact} should be in errors`);
    }
    assert.ok('incomeInconsistencyProbe' in result.complete,  'incomeInconsistencyProbe should still be complete');
    assert.ok('changeVerificationProbe' in result.complete,   'changeVerificationProbe should still be complete');
  });

});
