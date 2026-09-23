/**
 * Unit tests for generateRulesResults.
 *
 * A rules contract compiles to two artifacts: a decision graph, and an
 * OpenAPI Overlay adding the endpoint that evaluates it. These cover how
 * declared inputs become JSONPath field paths and what the overlay adds.
 *
 * Moved here from blueprint-cli, which was testing a core function through
 * the CLI's resolve script.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { generateRulesResults } from '../../../src/rules.js';
import { applyOverlays } from '../../../src/resolve/overlays.js';
import { doc } from '../../helpers/docs.js';

describe('generateRulesResults', () => {
test('generateRulesResults — compiles scalar inputs to JSONPath field paths', () => {
  const rulesFiles = [{
    relativePath: 'eligibility-rules.yaml',
    doc: {
      $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
      domain: 'eligibility',
      rulesets: {
        expeditedSnap: {
          inputs: {
            household: {
              type: 'object',
              properties: {
                monthlyGrossIncome: { type: 'number', description: 'Monthly gross income' },
                liquidResources: { type: 'number', description: 'Liquid resources' },
              },
            },
            policy: {
              type: 'object',
              properties: {
                resourceLimit: { type: 'number', default: 100 },
                grossIncomeLimit: { type: 'number', default: 150 },
              },
            },
          },
          outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
          facts: [
            {
              path: 'passesLowIncomeTest',
              expression: 'household.monthlyGrossIncome < policy.grossIncomeLimit && household.liquidResources <= policy.resourceLimit',
              type: { type: 'boolean' },
            },
            {
              path: 'eligible',
              expression: 'passesLowIncomeTest',
              type: { type: 'boolean' },
            },
          ],
        },
      },
    },
  }];

  const { graphs } = generateRulesResults(rulesFiles);
  const graph = graphs.get('eligibility-expeditedSnap-graph.yaml');
  assert.equal(graph.ruleset, 'expeditedSnap', 'graph records the ruleset it came from');

  assert.ok(graph, 'graph file produced');

  // Object containers are not emitted — only leaf fields
  assert.strictEqual(graph.inputs['$.household'], undefined);
  assert.strictEqual(graph.inputs['$.policy'], undefined);

  // Scalar fields are expanded to JSONPath
  assert.ok(graph.inputs['$.household.monthlyGrossIncome']);
  assert.strictEqual(graph.inputs['$.household.monthlyGrossIncome'].type, 'number');
  assert.ok(graph.inputs['$.household.liquidResources']);
  assert.ok(graph.inputs['$.policy.resourceLimit']);
  assert.strictEqual(graph.inputs['$.policy.resourceLimit'].default, 100);
  assert.ok(graph.inputs['$.policy.grossIncomeLimit']);
  assert.strictEqual(graph.inputs['$.policy.grossIncomeLimit'].default, 150);

  // Dependencies reference the expanded JSONPath keys
  assert.ok(graph.dependencies.passesLowIncomeTest.includes('$.household.monthlyGrossIncome'));
  assert.ok(graph.dependencies.passesLowIncomeTest.includes('$.policy.grossIncomeLimit'));
  assert.ok(graph.dependencies.passesLowIncomeTest.includes('$.household.liquidResources'));
  assert.ok(graph.dependencies.passesLowIncomeTest.includes('$.policy.resourceLimit'));

  // Fact-to-fact dependency
  assert.ok(graph.dependencies.eligible.includes('passesLowIncomeTest'));
  assert.ok(!graph.dependencies.eligible.some(d => d.startsWith('$.')));
});

test('generateRulesResults — compiles array inputs to JSONPath with [] notation', () => {
  const rulesFiles = [{
    relativePath: 'intake-rules.yaml',
    doc: {
      $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
      domain: 'intake',
      rulesets: {
        snapProbes: {
          inputs: {
            household: {
              type: 'object',
              properties: {
                monthlyIncome: { type: 'number' },
                monthlyExpenses: { type: 'number' },
                members: {
                  type: 'array',
                  description: 'Household members',
                  items: {
                    type: 'object',
                    properties: {
                      age: { type: 'integer' },
                      employed: { type: 'boolean' },
                      workExempt: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
          outputs: {
            type: 'object',
            properties: {
              incomeInconsistency: { type: 'boolean' },
              abawdMembers: { type: 'array' },
            },
          },
          facts: [
            {
              path: 'incomeInconsistency',
              expression: 'household.monthlyIncome < household.monthlyExpenses',
              type: { type: 'boolean' },
            },
            {
              path: 'abawdMembers',
              expression: 'household.members.filter(m, m.age >= 18 && m.age <= 54 && !m.employed && !m.workExempt)',
              type: { type: 'array' },
            },
          ],
        },
      },
    },
  }];

  const { graphs } = generateRulesResults(rulesFiles);
  const graph = graphs.get('intake-snapProbes-graph.yaml');
  assert.equal(graph.ruleset, 'snapProbes', 'graph records the ruleset it came from');

  assert.ok(graph, 'graph file produced');

  // Array field emitted with type: array
  assert.ok(graph.inputs['$.household.members[]']);
  assert.strictEqual(graph.inputs['$.household.members[]'].type, 'array');

  // Array sub-fields emitted with their own types
  assert.strictEqual(graph.inputs['$.household.members[].age']?.type, 'integer');
  assert.strictEqual(graph.inputs['$.household.members[].employed']?.type, 'boolean');
  assert.strictEqual(graph.inputs['$.household.members[].workExempt']?.type, 'boolean');

  // Object container not emitted
  assert.strictEqual(graph.inputs['$.household'], undefined);

  // incomeInconsistency depends on scalar fields, not members
  assert.ok(graph.dependencies.incomeInconsistency.includes('$.household.monthlyIncome'));
  assert.ok(graph.dependencies.incomeInconsistency.includes('$.household.monthlyExpenses'));
  assert.ok(!graph.dependencies.incomeInconsistency.some(d => d.includes('members')));

  // abawdMembers depends on the array path only — sub-fields are not direct deps
  assert.deepStrictEqual(graph.dependencies.abawdMembers, ['$.household.members[]']);
});

test('generateRulesResults — endpoint overlay adds POST path to OpenAPI spec', () => {
  const rulesFiles = [{
    relativePath: 'eligibility-rules.yaml',
    doc: {
      $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
      domain: 'eligibility',
      rulesets: {
        expeditedSnap: {
          endpoint: { path: '/assess-expedited-snap' },
          inputs: {
            household: {
              type: 'object',
              properties: { monthlyGrossIncome: { type: 'number' } },
            },
          },
          outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
          facts: [
            { path: 'eligible', expression: 'household.monthlyGrossIncome < 150', type: { type: 'boolean' } },
          ],
        },
      },
    },
  }];

  const openApiSpec = {
    openapi: '3.1.0',
    info: { title: 'Eligibility API', version: '1.0.0' },
    paths: {},
    components: { schemas: {} },
  };

  const { overlays } = generateRulesResults(rulesFiles);
  assert.strictEqual(overlays.length, 1);

  // The generator names its target by the stem of its own domain, so point the
  // action at the spec as it actually sits before applying — `generate` does
  // this for real via alignRefs.
  const { overlay } = overlays[0];
  for (const action of overlay.actions ?? []) {
    if (typeof action.file === 'string') action.file = 'eligibility-openapi.yaml';
  }

  const docs = [
    doc(openApiSpec, { relativePath: 'eligibility-openapi.yaml', type: 'openapi' }),
    doc(rulesFiles[0].doc, { relativePath: 'eligibility-rules.yaml', type: 'rules' }),
  ];

  const resolved = applyOverlays(docs, [overlay]).docs[0].content;
  assert.ok(resolved.paths['/assess-expedited-snap'], 'endpoint path added');
  assert.ok(resolved.paths['/assess-expedited-snap'].post, 'POST operation added');
  assert.strictEqual(resolved.paths['/assess-expedited-snap'].post.operationId, 'assessExpeditedSnap');
  assert.ok(resolved.components.schemas['ExpeditedSnapRequest'], 'request schema added');
  assert.ok(resolved.components.schemas['ExpeditedSnapResponse'], 'response schema added');
  const responseSchema = resolved.components.schemas['ExpeditedSnapResponse'];
  assert.ok(responseSchema.allOf, 'response schema uses allOf');
  assert.strictEqual(responseSchema.allOf[0].$ref, 'https://blueprint.codeforamerica.org/base/schemas/rules-evaluation.yaml#/EvaluationResult');
});
});
