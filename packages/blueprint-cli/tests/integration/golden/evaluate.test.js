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
import { generate, discover, load } from '@codeforamerica/blueprint-core';
import { evaluate } from '@codeforamerica/blueprint-rules-engine';

import { contractsDir, harnessDir } from '../../paths.js';

/**
 * The compiled graph for one ruleset, the way the pipeline compiles it.
 */
function graphFor(rulesDoc, rulesetName) {
  const name = rulesetName ?? Object.keys(rulesDoc.rulesets ?? {})[0];
  const found = compiledGraphs().find(({ graph }) => graph.ruleset === name);
  if (!found) throw new Error(`Ruleset "${name}" produced no graph`);
  return found.graph;
}

/**
 * Every graph in the resolved harness, compiled once. Compiled from the whole
 * set rather than one file, so an input that `$ref`s a shared schema is
 * followed down to its fields — which is what makes a date inside a `$ref`'d
 * household a date.
 */
let graphs;
function compiledGraphs() {
  graphs ??= generate(discover(join(harnessDir, 'generated/resolved')).map(load), 'graph');
  return graphs;
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

  it('a renewal where much has changed and the answers don\'t agree', () => {
    const result = outputValues(evaluate(graph, examples[0].inputs));
    assert.deepEqual(result, {
      'risks.earnedIncomeVaries':                     true,
      'risks.cashOrSelfEmploymentIncome':             true,
      'risks.incomeChangedSincePrevious':             true,
      'risks.householdChangedSincePrevious':          true,
      'risks.shelterCostsCarriedOver':                false,
      'risks.elderlyOrDisabledWithoutMedicalCosts':   true,
      'risks.childrenAndEarnersWithoutDependentCare': true,
      'risks.multipleProgramsApplied':                false,
      'inconsistencies.incomeBelowExpenses':             true,
      'inconsistencies.wagesDifferFromWageRecords':      true,
      'inconsistencies.incomeDiffersFromPayStub':        true,
      'inconsistencies.householdSizeDiffersFromMembers': true,
      'inconsistencies.jobWithoutEarnedIncome':          false,
      'inconsistencies.earnedIncomeWithoutJob':          false,
      'inconsistencies.utilitiesIncludedButBilled':      true,
    });
  });

  it('nothing changed, nothing error-prone, and everything agrees — no flags raised', () => {
    const result = outputValues(evaluate(graph, examples[1].inputs));
    assert.ok(Object.values(result).every((value) => value === false), JSON.stringify(result));
  });

  it('a member with two jobs is checked against the total of both', () => {
    // A wage record covers all of a member's wages, so comparing it with one
    // job at a time flagged anyone with a second job. The partner keeps the
    // clinic (950 semimonthly, 1900 a month) and adds 600 a month at a store;
    // the quarter's record of 7500 is three months of the two together.
    const inputs = structuredClone(examples[1].inputs);
    inputs.current.jobs.push({ id: 'store', memberId: 'partner', employer: 'Corner Store' });
    inputs.current.incomes.push({
      id: 'store-pay', memberId: 'partner', jobId: 'store', source: 'earned',
      amount: 600, frequency: 'monthly', paidInCash: false, amountVaries: false,
    });
    inputs.verified.find((v) => v.kind === 'wage_record').amount = 7500;

    const result = outputValues(evaluate(graph, inputs));
    assert.equal(result['inconsistencies.wagesDifferFromWageRecords'], false);

    inputs.verified.find((v) => v.kind === 'wage_record').amount = 5700;
    assert.equal(outputValues(evaluate(graph, inputs))['inconsistencies.wagesDifferFromWageRecords'], true,
      'a record of only the clinic wages now differs from what the partner reports');
  });
});
