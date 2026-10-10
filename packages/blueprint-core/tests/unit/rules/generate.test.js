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
import { generate } from '../../../src/index.js';
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

test('generateRulesResults — the endpoints are documented in an API document beside the rules file', () => {
  const rulesFiles = [{
    relativePath: 'domains/eligibility/eligibility-rules.yaml',
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
        grossIncome: {
          inputs: { household: { type: 'object', properties: { income: { type: 'number' } } } },
          outputs: { gross: { type: 'number' } },
          facts: [{ path: 'gross', expression: 'household.income' }],
        },
        internalOnly: {
          endpoint: false,
          inputs: { x: { type: 'object', properties: { v: { type: 'number' } } } },
          outputs: { result: { type: 'boolean' } },
          facts: [{ path: 'result', expression: 'x.v > 0' }],
        },
      },
    },
  }];

  const { apis } = generateRulesResults(rulesFiles);
  const api = apis.get('domains/eligibility/eligibility-rules-openapi.yaml');
  assert.ok(api, 'named for the rules file, beside it');

  assert.equal(api.info['x-domain'], 'eligibility');
  assert.deepEqual(api.servers, [{ url: '/eligibility' }], 'served under its domain');

  assert.strictEqual(api.paths['/assess-expedited-snap'].post.operationId, 'assessExpeditedSnap', 'a declared path is used');
  assert.ok(api.paths['/rules/gross-income'].post, 'a ruleset declaring no endpoint gets /rules/{ruleset-name}');
  assert.equal(Object.keys(api.paths).length, 2, 'endpoint: false gives no endpoint');

  assert.ok(api.components.schemas['ExpeditedSnapRequest'], 'request schema added');
  const responseSchema = api.components.schemas['ExpeditedSnapResponse'];
  assert.strictEqual(responseSchema.allOf[0].$ref, 'https://blueprint.codeforamerica.org/base/schemas/rules-evaluation.yaml#/EvaluationResult');
});

test('generateRulesResults — a rules file whose rulesets all opt out documents nothing', () => {
  const { apis } = generateRulesResults([{
    relativePath: 'x-rules.yaml',
    doc: { domain: 'x', rulesets: { a: { endpoint: false, inputs: {}, outputs: {}, facts: [{ path: 'a', expression: 'true' }] } } },
  }]);
  assert.equal(apis.size, 0);
});
});

describe('generateRulesResults — $ref in inputs', () => {
  /**
   * These go through `generate` rather than calling expandInputs with a stub,
   * because the resolver lives in generate.js — it is the only step that sees
   * every document, and unit tests that pass a fake resolver never exercise it.
   */
  const member = {
    type: 'object',
    properties: {
      age: { type: 'integer' },
      citizenshipStatus: { type: 'string', enum: ['us_citizen', 'non_citizen'] },
    },
  };

  const rulesDoc = (items) => ({
    $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
    domain: 'intake',
    rulesets: {
      screening: {
        inputs: {
          household: {
            type: 'object',
            properties: { members: { type: 'array', items } },
          },
        },
        outputs: { hasNonCitizen: { type: 'boolean' } },
        facts: [{
          path: 'hasNonCitizen',
          expression: "household.members.exists(m, m.citizenshipStatus == 'non_citizen')",
          type: 'boolean',
        }],
      },
    },
  });

  test('resolves a ref to another document in the contract set', () => {
    const docs = [
      doc({ $defs: { Member: member } }, { relativePath: 'domains/intake/shared.yaml', type: 'schema' }),
      doc(rulesDoc({ $ref: './shared.yaml#/$defs/Member' }), {
        relativePath: 'domains/intake/intake-rules.yaml', type: 'rules',
      }),
    ];

    const [{ graph }] = generate(docs, 'graph');

    assert.deepStrictEqual(Object.keys(graph.inputs).sort(), [
      '$.household.members[]',
      '$.household.members[].age',
      '$.household.members[].citizenshipStatus',
    ]);
    assert.deepStrictEqual(
      graph.inputs['$.household.members[].citizenshipStatus'].enum,
      ['us_citizen', 'non_citizen']
    );
  });

  test('resolves a ref within the rules document itself', () => {
    const content = rulesDoc({ $ref: '#/$defs/Member' });
    content.$defs = { Member: member };

    const [{ graph }] = generate(
      [doc(content, { relativePath: 'domains/intake/intake-rules.yaml', type: 'rules' })],
      'graph'
    );

    assert.ok('$.household.members[].age' in graph.inputs);
  });

  test('an unresolvable ref leaves the input opaque rather than failing', () => {
    const [{ graph }] = generate(
      [doc(rulesDoc({ $ref: './nowhere.yaml#/$defs/Member' }), {
        relativePath: 'domains/intake/intake-rules.yaml', type: 'rules',
      })],
      'graph'
    );

    assert.deepStrictEqual(graph.inputs, { '$.household.members[]': { type: 'array' } });
  });
});
