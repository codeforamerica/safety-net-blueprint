/**
 * FactGraph translator tests.
 *
 * Tests cover:
 *   - Graph compilation from rules YAML (compileRuleset via toFactGraphXml)
 *   - XML generation from ruleset declarations (toFactGraphXml)
 *   - FactGraph evaluation matching CEL evaluation (evaluateWithFactGraph)
 *   - Collection operations: filter, all(), exists(), has()
 *   - Three-state logic: placeholder facts when policy uses schema defaults
 *
 * Fixtures:
 *   tests/fixtures/snap-interview-probes/ — income + filter probes
 *   tests/fixtures/collection-ops/        — all/exists/has with policy defaults
 *
 * Golden files:
 *   *-graph.yaml      — expected compiled graph (compared via deep equal after YAML parse)
 *   *-fact-graph.xml  — expected FactGraph XML (compared as trimmed strings)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { toFactGraphXml, evaluateWithFactGraph } from '../src/fact-graph.js';
import { evaluate } from '../src/index.js';
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
    const graph = compileRuleset('intake', 'snapInterviewProbes', rulesDoc.rulesets.snapInterviewProbes);
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

// ── FactGraph evaluation vs CEL evaluation ─────────────────────────────────────

describe('evaluateWithFactGraph — snap interview probes vs CEL', () => {
  const rulesDoc = loadYaml(join(__dirname, 'fixtures/snap-interview-probes/snap-interview-probes-rules.yaml'));
  const scenariosDir = join(__dirname, 'fixtures/snap-interview-probes/scenarios');

  it('scenario 01: FactGraph scalar result matches CEL for incomeInconsistency', () => {
    const { inputs } = loadJson(join(scenariosDir, '01-no-probes-inputs.json'));
    const celResult = evaluate(rulesDoc, inputs);
    const fgResult = evaluateWithFactGraph(rulesDoc, inputs);
    assert.strictEqual(
      fgResult.complete.incomeInconsistency,
      celResult.complete.incomeInconsistency,
      'incomeInconsistency should match between CEL and FactGraph',
    );
  });

  it('scenario 02: FactGraph scalar result matches CEL for income inconsistency', () => {
    const { inputs } = loadJson(join(scenariosDir, '02-multiple-probes-inputs.json'));
    const celResult = evaluate(rulesDoc, inputs);
    const fgResult = evaluateWithFactGraph(rulesDoc, inputs);
    assert.strictEqual(
      fgResult.complete.incomeInconsistency,
      celResult.complete.incomeInconsistency,
      'income inconsistency (true when income < expenses) should match',
    );
  });

  it('scenario 02: FactGraph filter result matches CEL for abawdMembers count', () => {
    const { inputs } = loadJson(join(scenariosDir, '02-multiple-probes-inputs.json'));
    const celResult = evaluate(rulesDoc, inputs);
    const fgResult = evaluateWithFactGraph(rulesDoc, inputs);
    const celIds = (celResult.complete.abawdMembers ?? []).map(m => m.id).sort();
    const fgIds = (fgResult.complete.abawdMembers ?? []).map(m => m.id).sort();
    assert.deepStrictEqual(fgIds, celIds, 'abawdMembers should contain same member ids');
  });

  it('scenario 03: FactGraph marks incomeInconsistency as missing when monthlyExpenses absent', () => {
    const { inputs } = loadJson(join(scenariosDir, '03-partial-inputs-inputs.json'));
    const fgResult = evaluateWithFactGraph(rulesDoc, inputs);
    assert.ok(
      'incomeInconsistency' in fgResult.missing || 'incomeInconsistency' in fgResult.errors,
      'incomeInconsistency should be missing or errored when monthlyExpenses is absent',
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
    const result = evaluate(rulesDoc, inputs);
    assert.deepStrictEqual(result.complete, expected.complete);
    assert.deepStrictEqual(result.placeholder, expected.placeholder);
    assert.deepStrictEqual(result.missing, expected.missing);
    assert.deepStrictEqual(result.errors, expected.errors);
  });

  it('scenario 02: all facts are complete when policy is explicitly provided', () => {
    const { inputs } = loadJson(join(scenariosDir, '02-with-policy-inputs.json'));
    const expected = loadJson(join(scenariosDir, '02-with-policy-outputs.json'));
    const result = evaluate(rulesDoc, inputs);
    assert.deepStrictEqual(result.complete, expected.complete);
    assert.deepStrictEqual(result.placeholder, expected.placeholder);
    assert.deepStrictEqual(result.missing, expected.missing);
    assert.deepStrictEqual(result.errors, expected.errors);
  });
});
