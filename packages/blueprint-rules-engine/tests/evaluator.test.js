/**
 * Evaluator tests for the Blueprint rules engine.
 *
 * These tests define the contract the evaluator must satisfy.
 * They will fail until the evaluator is implemented (Phase 8 of issue #425).
 *
 * Fixtures: tests/fixtures/snap-interview-probes/
 *   - snap-interview-probes-rules.yaml — ruleset definition
 *   - scenarios/01-no-probes.json      — all facts resolve cleanly, no probes fire
 *   - scenarios/02-multiple-probes.json — income inconsistency + ABAWD + non-citizen probes fire
 *   - scenarios/03-partial-inputs.json  — monthlyExpenses missing; array probes still resolve
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

function loadRuleset() {
  const raw = readFileSync(join(fixturesDir, 'snap-interview-probes-rules.yaml'), 'utf8');
  return yaml.load(raw);
}

function loadScenario(filename) {
  return JSON.parse(readFileSync(join(fixturesDir, 'scenarios', filename), 'utf8'));
}

describe('evaluator — snap interview probes', () => {

  const ruleset = loadRuleset();

  it('scenario 01: no probes fire when household is straightforward', () => {
    const { inputs, expected } = loadScenario('01-no-probes.json');
    const result = evaluate(ruleset, inputs);
    assert.deepStrictEqual(result.resolved, expected.resolved);
    assert.deepStrictEqual(result.missing, expected.missing);
    assert.deepStrictEqual(result.errors, expected.errors);
  });

  it('scenario 02: income inconsistency, ABAWD, and non-citizen probes fire with correct members', () => {
    const { inputs, expected } = loadScenario('02-multiple-probes.json');
    const result = evaluate(ruleset, inputs);
    assert.deepStrictEqual(result.resolved, expected.resolved);
    assert.deepStrictEqual(result.missing, expected.missing);
    assert.deepStrictEqual(result.errors, expected.errors);
  });

  it('scenario 03: array probes resolve when monthlyExpenses is missing; incomeInconsistency is unresolvable', () => {
    const { inputs, expected } = loadScenario('03-partial-inputs.json');
    const result = evaluate(ruleset, inputs);
    assert.deepStrictEqual(result.resolved, expected.resolved);
    assert.deepStrictEqual(result.missing, expected.missing);
    assert.deepStrictEqual(result.errors, expected.errors);
  });

});
