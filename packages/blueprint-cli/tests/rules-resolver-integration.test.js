/**
 * Integration tests for the rules compiler using fixture data.
 * Unit tests for the compiler functions are in blueprint-core/tests/unit/rules-resolver.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileRuleset,
  generateRulesEndpointOverlay,
  generateRulesResults,
} from '@codeforamerica/blueprint-core';

// Inline fixture: expedited SNAP eligibility rules
const FIXTURE_RULES_DOC = {
  $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
  domain: 'eligibility',
  rulesets: {
    expeditedSnap: {
      endpoint: { path: '/assess-expedited-snap' },
      inputs: {
        household: {
          type: 'object',
          properties: {
            monthlyGrossIncome: { type: 'number', description: 'Total monthly gross income' },
            liquidResources: { type: 'number', description: 'Countable liquid resources' },
            monthlyHousingCosts: { type: 'number', description: 'Total monthly housing costs' },
            isDestituteMigrant: { type: 'boolean', description: 'Destitute migrant flag' },
          },
        },
        policy: {
          type: 'object',
          properties: {
            resourceLimit: { type: 'number', default: 100, description: 'Federal resource ceiling' },
            grossIncomeLimit: { type: 'number', default: 150, description: 'Federal income ceiling' },
          },
        },
      },
      outputs: {
        type: 'object',
        properties: { eligible: { type: 'boolean', description: 'Eligible for expedited SNAP' } },
      },
      facts: [
        {
          path: 'passesLowIncomeTest',
          description: 'Prong 1: gross income < $150 AND liquid resources <= $100',
          expression: 'household.monthlyGrossIncome < policy.grossIncomeLimit && household.liquidResources <= policy.resourceLimit',
          type: { type: 'boolean' },
        },
        {
          path: 'passesHousingCostTest',
          description: 'Prong 2: combined income and resources < housing costs',
          expression: '(household.monthlyGrossIncome + household.liquidResources) < household.monthlyHousingCosts',
          type: { type: 'boolean' },
        },
        {
          path: 'passesMigrantTest',
          description: 'Prong 3: destitute migrant with liquid resources <= $100',
          expression: 'household.isDestituteMigrant && household.liquidResources <= policy.resourceLimit',
          type: { type: 'boolean' },
        },
        {
          path: 'eligible',
          description: 'Eligible for expedited SNAP if any prong is met',
          expression: 'passesLowIncomeTest || passesHousingCostTest || passesMigrantTest',
          type: { type: 'boolean' },
        },
      ],
    },
  },
};

test('rules resolver integration — expedited SNAP fixture', async (t) => {

  await t.test('compiles to a valid graph document', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', FIXTURE_RULES_DOC.rulesets.expeditedSnap);
    assert.equal(graph.$schema, 'https://blueprint.codeforamerica.org/schemas/graph-schema.yaml');
    assert.equal(graph.domain, 'eligibility');
    assert.equal(graph.ruleset, 'expeditedSnap');
  });

  await t.test('expands all household and policy input fields', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', FIXTURE_RULES_DOC.rulesets.expeditedSnap);
    assert.ok(graph.inputs['$.household.monthlyGrossIncome']);
    assert.ok(graph.inputs['$.household.liquidResources']);
    assert.ok(graph.inputs['$.household.monthlyHousingCosts']);
    assert.ok(graph.inputs['$.household.isDestituteMigrant']);
    assert.ok(graph.inputs['$.policy.resourceLimit']);
    assert.ok(graph.inputs['$.policy.grossIncomeLimit']);
    assert.equal(graph.inputs['$.policy.resourceLimit'].default, 100);
    assert.equal(graph.inputs['$.policy.grossIncomeLimit'].default, 150);
  });

  await t.test('emits all four facts with expressions', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', FIXTURE_RULES_DOC.rulesets.expeditedSnap);
    assert.ok(graph.facts.passesLowIncomeTest);
    assert.ok(graph.facts.passesHousingCostTest);
    assert.ok(graph.facts.passesMigrantTest);
    assert.ok(graph.facts.eligible);
    assert.equal(graph.facts.passesLowIncomeTest.type, 'boolean');
  });

  await t.test('builds correct input dependencies for passesLowIncomeTest', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', FIXTURE_RULES_DOC.rulesets.expeditedSnap);
    const deps = graph.dependencies.passesLowIncomeTest;
    assert.ok(deps.includes('$.household.monthlyGrossIncome'));
    assert.ok(deps.includes('$.household.liquidResources'));
    assert.ok(deps.includes('$.policy.grossIncomeLimit'));
    assert.ok(deps.includes('$.policy.resourceLimit'));
  });

  await t.test('builds correct fact-to-fact dependencies for eligible', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', FIXTURE_RULES_DOC.rulesets.expeditedSnap);
    const deps = graph.dependencies.eligible;
    assert.ok(deps.includes('passesLowIncomeTest'));
    assert.ok(deps.includes('passesHousingCostTest'));
    assert.ok(deps.includes('passesMigrantTest'));
    assert.ok(!deps.some(d => d.startsWith('$.')), 'eligible has no direct input deps');
  });

  await t.test('declares eligible as the output', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', FIXTURE_RULES_DOC.rulesets.expeditedSnap);
    assert.deepEqual(graph.outputs, ['eligible']);
  });

  await t.test('generateRulesResults produces graph and overlay for the fixture', () => {
    const { graphs, overlays } = generateRulesResults([
      { relativePath: 'eligibility-rules.yaml', doc: FIXTURE_RULES_DOC },
    ]);
    assert.ok(graphs.has('eligibility-expeditedSnap-graph.yaml'), 'graph file produced');
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0].domain, 'eligibility');
  });

  await t.test('generated overlay adds POST endpoint', () => {
    const overlay = generateRulesEndpointOverlay('eligibility', FIXTURE_RULES_DOC);
    const pathsAction = overlay.actions.find(a => a.target === '$.paths');
    assert.ok(pathsAction.update['/assess-expedited-snap']?.post);
  });

});
