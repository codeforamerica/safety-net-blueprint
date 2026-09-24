/**
 * Integration tests for blueprint-evaluate CLI.
 *
 * Runs evaluate against the harness rules examples and asserts that outputs
 * match expected values hardcoded here. No committed golden file needed —
 * the expected values ARE the spec.
 *
 * Inputs: packages/blueprint-harness/contracts/domains/{eligibility,intake}/
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { generate } from '@codeforamerica/blueprint-core';
import { evaluate } from '@codeforamerica/blueprint-rules-engine';

import { contractsDir } from '../../paths.js';

/**
 * Compile one ruleset through `generate`, the way the pipeline does.
 *
 * Kept local to the test rather than importing a compiler: compiling is a
 * build step core performs, not something consumers call.
 */
function graphFor(rulesDoc, rulesetName) {
  const name = rulesetName ?? Object.keys(rulesDoc.rulesets ?? {})[0];
  const graphs = generate([{
    path: 'rules.yaml',
    relativePath: 'rules.yaml',
    type: 'rules',
    domain: rulesDoc.domain ?? null,
    content: rulesDoc,
    refs: () => new Map(),
    model: () => null,
    resolved: false,
    provenance: null,
  }], 'graph');
  const found = graphs.find(({ graph }) => graph.ruleset === name);
  if (!found) throw new Error(`Ruleset "${name}" produced no graph`);
  return found.graph;
}

function loadExamplesAndRules(domain, rulesetName) {
  const examplesPath = join(contractsDir, `domains/${domain}/${domain}-rules-examples.yaml`);
  const rulesPath    = join(contractsDir, `domains/${domain}/${domain}-rules.yaml`);
  const examplesDoc  = yaml.load(readFileSync(examplesPath, 'utf8'));
  const rulesDoc     = yaml.load(readFileSync(rulesPath, 'utf8'));
  const ruleset      = rulesDoc.rulesets[rulesetName];
  const graph        = graphFor(rulesDoc, rulesetName);
  const examples     = examplesDoc.rulesets[rulesetName].examples;
  return { graph, examples };
}

function outputValues(result) {
  return Object.fromEntries(
    Object.entries(result)
      .filter(([, node]) => node.type === 'output')
      .map(([k, node]) => [k, node.value])
  );
}

// ---------------------------------------------------------------------------
// eligibility — expeditedSnap
// ---------------------------------------------------------------------------

describe('evaluate — eligibility/expeditedSnap', () => {
  const { graph, examples } = loadExamplesAndRules('eligibility', 'expeditedSnap');

  it('low income and low resources — qualifies on condition 1', () => {
    const result = outputValues(evaluate(graph, examples[0].inputs));
    assert.equal(result.isExpeditedEligible, true);
  });

  it('income and resources below shelter cost — qualifies on condition 2', () => {
    const result = outputValues(evaluate(graph, examples[1].inputs));
    assert.equal(result.isExpeditedEligible, true);
  });

  it('migrant farmworker with low resources — qualifies on condition 3', () => {
    const result = outputValues(evaluate(graph, examples[2].inputs));
    assert.equal(result.isExpeditedEligible, true);
  });

  it('above all thresholds — does not qualify', () => {
    const result = outputValues(evaluate(graph, examples[3].inputs));
    assert.equal(result.isExpeditedEligible, false);
  });
});

// ---------------------------------------------------------------------------
// intake — interviewPrompts
// ---------------------------------------------------------------------------

describe('evaluate — intake/interviewPrompts', () => {
  const { graph, examples } = loadExamplesAndRules('intake', 'interviewPrompts');

  it('income gap and unemployed members — multiple prompts triggered', () => {
    const result = outputValues(evaluate(graph, examples[0].inputs));
    assert.equal(result.incomeInconsistencyPrompt, true);
    assert.equal(result.workRequirementPrompt,     true);
    assert.equal(result.studentEligibilityPrompt,  false);
    assert.equal(result.immigrationStatusPrompt,   false);
    assert.equal(result.changeVerificationPrompt,  false);
  });

  it('non-citizen student with changed circumstances', () => {
    const result = outputValues(evaluate(graph, examples[1].inputs));
    assert.equal(result.incomeInconsistencyPrompt, false);
    assert.equal(result.workRequirementPrompt,     false);
    assert.equal(result.studentEligibilityPrompt,  true);
    assert.equal(result.immigrationStatusPrompt,   true);
    assert.equal(result.changeVerificationPrompt,  true);
  });

  it('all members employed — no prompts triggered', () => {
    const result = outputValues(evaluate(graph, examples[2].inputs));
    assert.equal(result.incomeInconsistencyPrompt, false);
    assert.equal(result.workRequirementPrompt,     false);
    assert.equal(result.studentEligibilityPrompt,  false);
    assert.equal(result.immigrationStatusPrompt,   false);
    assert.equal(result.changeVerificationPrompt,  false);
  });
});
