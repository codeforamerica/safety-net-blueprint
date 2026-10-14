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
// intake — interviewFlags
// ---------------------------------------------------------------------------

describe('evaluate — intake/interviewFlags', () => {
  const { graph, examples } = loadExamplesAndRules('intake', 'interviewFlags');

  it('a recertification where much has changed and the application doesn\'t agree with itself', () => {
    const result = outputValues(evaluate(graph, examples[0].inputs));
    assert.deepEqual(result, {
      'risks.earnedIncomeVaries':                     true,
      'risks.cashOrSelfEmploymentIncome':             true,
      'risks.incomeChangedSinceLastCertification':    true,
      'risks.householdChangedSinceLastCertification': true,
      'risks.shelterCostsCarriedOver':                false,
      'risks.elderlyOrDisabledWithoutMedicalCosts':   true,
      'risks.childrenAndEarnersWithoutDependentCare': true,
      'risks.circumstancesChangedSinceApplying':      true,
      'risks.multipleProgramsApplied':                false,
      'inconsistencies.incomeBelowExpenses':             true,
      'inconsistencies.wagesDifferFromWageRecords':      true,
      'inconsistencies.incomeDiffersFromPayStub':        true,
      'inconsistencies.householdSizeDiffersFromMembers': true,
      'inconsistencies.jobWithoutEarnedIncome':          false,
      'inconsistencies.earnedIncomeWithoutJob':          false,
      'inconsistencies.utilitiesIncludedButClaimed':     true,
    });
  });

  it('nothing changed, nothing error-prone, and everything agrees — no flags raised', () => {
    const result = outputValues(evaluate(graph, examples[1].inputs));
    assert.ok(Object.values(result).every((value) => value === false), JSON.stringify(result));
  });
});
