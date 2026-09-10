/**
 * Unit tests for the rules compiler.
 * Validates expandInputs, extractDeps, compileRuleset, and generateRulesEndpointOverlay.
 * Integration tests (resolver pipeline) are in blueprint-cli/tests/rules-resolver-integration.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandInputs,
  extractDeps,
  compileRuleset,
  generateRulesEndpointOverlay,
  generateRulesResults,
} from '../../src/rules.js';

// ── expandInputs ─────────────────────────────────────────────────────────────

test('expandInputs', async (t) => {

  await t.test('emits scalar fields as leaf nodes', () => {
    const result = expandInputs({
      household: {
        type: 'object',
        properties: {
          monthlyIncome: { type: 'number', description: 'Monthly income' },
          size: { type: 'integer' },
        },
      },
    });
    assert.deepEqual(result['$.household.monthlyIncome'], { type: 'number', description: 'Monthly income' });
    assert.deepEqual(result['$.household.size'], { type: 'integer' });
  });

  await t.test('does not emit the object container itself', () => {
    const result = expandInputs({
      household: {
        type: 'object',
        properties: { size: { type: 'integer' } },
      },
    });
    assert.equal(result['$.household'], undefined);
    assert.ok(result['$.household.size']);
  });

  await t.test('emits array field with type array (not item type)', () => {
    const result = expandInputs({
      household: {
        type: 'object',
        properties: {
          members: {
            type: 'array',
            description: 'Household members',
            items: { type: 'object', properties: { age: { type: 'integer' } } },
          },
        },
      },
    });
    assert.ok(result['$.household.members[]'], 'array node must exist');
    assert.equal(result['$.household.members[]'].type, 'array', 'type must be array not object');
    assert.equal(result['$.household.members[]'].description, 'Household members');
  });

  await t.test('emits sub-fields of array items with their own types', () => {
    const result = expandInputs({
      household: {
        type: 'object',
        properties: {
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                age: { type: 'integer' },
                employed: { type: 'boolean' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
    });
    assert.deepEqual(result['$.household.members[].age'], { type: 'integer' });
    assert.deepEqual(result['$.household.members[].employed'], { type: 'boolean' });
    assert.deepEqual(result['$.household.members[].name'], { type: 'string' });
  });

  await t.test('preserves default values on scalar nodes', () => {
    const result = expandInputs({
      policy: {
        type: 'object',
        properties: {
          resourceLimit: { type: 'number', default: 100, description: 'Federal limit' },
        },
      },
    });
    assert.equal(result['$.policy.resourceLimit'].default, 100);
  });

  await t.test('emits opaque object node for $ref inputs', () => {
    const result = expandInputs({
      person: { $ref: 'https://blueprint.codeforamerica.org/schemas/Person.yaml' },
    });
    assert.deepEqual(result['$.person'], { type: 'object' });
  });

  await t.test('emits object node when no properties declared', () => {
    const result = expandInputs({
      context: { type: 'object', description: 'Opaque context object' },
    });
    assert.deepEqual(result['$.context'], { type: 'object', description: 'Opaque context object' });
  });

  await t.test('handles multiple top-level inputs', () => {
    const result = expandInputs({
      household: { type: 'object', properties: { size: { type: 'integer' } } },
      policy: { type: 'object', properties: { limit: { type: 'number', default: 150 } } },
    });
    assert.ok(result['$.household.size']);
    assert.ok(result['$.policy.limit']);
    assert.equal(result['$.policy.limit'].default, 150);
  });

});

// ── extractDeps ──────────────────────────────────────────────────────────────

test('extractDeps', async (t) => {

  const inputPaths = [
    '$.household.monthlyGrossIncome',
    '$.household.liquidResources',
    '$.household.monthlyHousingCosts',
    '$.policy.resourceLimit',
    '$.policy.grossIncomeLimit',
  ];

  await t.test('finds scalar input dependencies', () => {
    const deps = extractDeps(
      'household.monthlyGrossIncome < policy.grossIncomeLimit && household.liquidResources <= policy.resourceLimit',
      inputPaths,
      [],
    );
    assert.ok(deps.includes('$.household.monthlyGrossIncome'));
    assert.ok(deps.includes('$.household.liquidResources'));
    assert.ok(deps.includes('$.policy.grossIncomeLimit'));
    assert.ok(deps.includes('$.policy.resourceLimit'));
    assert.ok(!deps.includes('$.household.monthlyHousingCosts'), 'unreferenced field excluded');
  });

  await t.test('finds fact-to-fact dependencies', () => {
    const deps = extractDeps(
      'passesLowIncomeTest || passesHousingCostTest || passesMigrantTest',
      inputPaths,
      ['passesLowIncomeTest', 'passesHousingCostTest', 'passesMigrantTest'],
    );
    assert.ok(deps.includes('passesLowIncomeTest'));
    assert.ok(deps.includes('passesHousingCostTest'));
    assert.ok(deps.includes('passesMigrantTest'));
  });

  await t.test('does not include unreferenced facts', () => {
    const deps = extractDeps(
      'household.liquidResources <= policy.resourceLimit',
      inputPaths,
      ['passesLowIncomeTest'],
    );
    assert.ok(!deps.includes('passesLowIncomeTest'));
  });

  await t.test('array path is the only dep for a filter expression — sub-fields are skipped', () => {
    const pathsWithArray = [
      '$.household.members[]',
      '$.household.members[].age',
      '$.household.members[].employed',
    ];
    const deps = extractDeps(
      'household.members.filter(m, m.age >= 18 && !m.employed)',
      pathsWithArray,
      [],
    );
    assert.ok(deps.includes('$.household.members[]'), 'array path must be a dependency');
    assert.ok(!deps.includes('$.household.members[].age'), 'sub-field must not be a direct dependency');
    assert.ok(!deps.includes('$.household.members[].employed'), 'sub-field must not be a direct dependency');
    assert.equal(deps.length, 1, 'exactly one dependency');
  });

  await t.test('returns empty array when no matches', () => {
    const deps = extractDeps('1 == 1', inputPaths, []);
    assert.deepEqual(deps, []);
  });

});

// ── compileRuleset ───────────────────────────────────────────────────────────

test('compileRuleset — scalar inputs (expedited SNAP)', async (t) => {

  const ruleset = {
    inputs: {
      household: {
        type: 'object',
        properties: {
          monthlyGrossIncome: { type: 'number' },
          liquidResources: { type: 'number' },
          isDestituteMigrant: { type: 'boolean' },
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
    outputs: {
      type: 'object',
      properties: { eligible: { type: 'boolean' } },
    },
    facts: [
      {
        path: 'passesLowIncomeTest',
        expression: 'household.monthlyGrossIncome < policy.grossIncomeLimit && household.liquidResources <= policy.resourceLimit',
        type: { type: 'boolean' },
        description: 'Prong 1',
      },
      {
        path: 'passesMigrantTest',
        expression: 'household.isDestituteMigrant && household.liquidResources <= policy.resourceLimit',
        type: { type: 'boolean' },
      },
      {
        path: 'eligible',
        expression: 'passesLowIncomeTest || passesMigrantTest',
        type: { type: 'boolean' },
      },
    ],
  };

  await t.test('produces correct top-level fields', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', ruleset);
    assert.equal(graph.$schema, 'https://blueprint.codeforamerica.org/schemas/graph-schema.yaml');
    assert.equal(graph.domain, 'eligibility');
    assert.equal(graph.ruleset, 'expeditedSnap');
  });

  await t.test('expands object inputs to field paths — no container node emitted', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', ruleset);
    assert.equal(graph.inputs['$.household'], undefined, 'household container not in inputs');
    assert.equal(graph.inputs['$.policy'], undefined, 'policy container not in inputs');
    assert.ok(graph.inputs['$.household.monthlyGrossIncome']);
    assert.ok(graph.inputs['$.household.liquidResources']);
    assert.ok(graph.inputs['$.household.isDestituteMigrant']);
    assert.ok(graph.inputs['$.policy.resourceLimit']);
    assert.ok(graph.inputs['$.policy.grossIncomeLimit']);
  });

  await t.test('preserves defaults on input nodes', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', ruleset);
    assert.equal(graph.inputs['$.policy.resourceLimit'].default, 100);
    assert.equal(graph.inputs['$.policy.grossIncomeLimit'].default, 150);
  });

  await t.test('builds correct input dependencies for passesLowIncomeTest', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', ruleset);
    const deps = graph.dependencies.passesLowIncomeTest;
    assert.ok(deps.includes('$.household.monthlyGrossIncome'));
    assert.ok(deps.includes('$.household.liquidResources'));
    assert.ok(deps.includes('$.policy.grossIncomeLimit'));
    assert.ok(deps.includes('$.policy.resourceLimit'));
  });

  await t.test('builds correct fact-to-fact dependencies for eligible', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', ruleset);
    const deps = graph.dependencies.eligible;
    assert.ok(deps.includes('passesLowIncomeTest'));
    assert.ok(deps.includes('passesMigrantTest'));
    assert.ok(!deps.some(d => d.startsWith('$.')), 'eligible has no direct input deps');
  });

  await t.test('derives outputs from declared outputs properties', () => {
    const graph = compileRuleset('eligibility', 'expeditedSnap', ruleset);
    assert.deepEqual(graph.outputs, ['eligible']);
  });

});

test('compileRuleset — array inputs (SNAP interview probes)', async (t) => {

  const ruleset = {
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
  };

  await t.test('emits array node with type array', () => {
    const graph = compileRuleset('intake', 'snapProbes', ruleset);
    assert.equal(graph.inputs['$.household.members[]']?.type, 'array');
  });

  await t.test('emits array item sub-fields with their own types', () => {
    const graph = compileRuleset('intake', 'snapProbes', ruleset);
    assert.equal(graph.inputs['$.household.members[].age']?.type, 'integer');
    assert.equal(graph.inputs['$.household.members[].employed']?.type, 'boolean');
    assert.equal(graph.inputs['$.household.members[].workExempt']?.type, 'boolean');
  });

  await t.test('does not emit the household container', () => {
    const graph = compileRuleset('intake', 'snapProbes', ruleset);
    assert.equal(graph.inputs['$.household'], undefined);
  });

  await t.test('incomeInconsistency depends on scalar fields only', () => {
    const graph = compileRuleset('intake', 'snapProbes', ruleset);
    const deps = graph.dependencies.incomeInconsistency;
    assert.ok(deps.includes('$.household.monthlyIncome'));
    assert.ok(deps.includes('$.household.monthlyExpenses'));
    assert.ok(!deps.some(d => d.includes('members')), 'members not referenced');
  });

  await t.test('abawdMembers depends on the array path, not sub-fields', () => {
    const graph = compileRuleset('intake', 'snapProbes', ruleset);
    const deps = graph.dependencies.abawdMembers;
    assert.ok(deps.includes('$.household.members[]'), 'array path is the dependency');
    assert.ok(!deps.includes('$.household.members[].age'), 'age sub-field not a direct dep');
    assert.ok(!deps.includes('$.household.members[].employed'), 'employed sub-field not a direct dep');
    assert.equal(deps.length, 1, 'exactly one dependency');
  });

});

// ── generateRulesEndpointOverlay ─────────────────────────────────────────────

test('generateRulesEndpointOverlay', async (t) => {

  const rulesDoc = {
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
        outputs: {
          type: 'object',
          properties: { eligible: { type: 'boolean' } },
        },
        facts: [],
      },
    },
  };

  await t.test('returns null when no rulesets have endpoints', () => {
    const result = generateRulesEndpointOverlay('eligibility', {
      rulesets: { myRuleset: { inputs: {}, outputs: {}, facts: [] } },
    });
    assert.equal(result, null);
  });

  await t.test('produces a valid overlay document', () => {
    const overlay = generateRulesEndpointOverlay('eligibility', rulesDoc);
    assert.ok(overlay);
    assert.equal(overlay.overlay, '1.0.0');
    assert.ok(Array.isArray(overlay.actions));
  });

  await t.test('adds POST endpoint at declared path', () => {
    const overlay = generateRulesEndpointOverlay('eligibility', rulesDoc);
    const pathsAction = overlay.actions.find(a => a.target === '$.paths');
    assert.ok(pathsAction.update['/eligibility/assess-expedited-snap']);
    assert.ok(pathsAction.update['/eligibility/assess-expedited-snap'].post);
    assert.equal(pathsAction.update['/eligibility/assess-expedited-snap'].post.operationId, 'assessExpeditedSnap');
  });

  await t.test('generates request and response schemas', () => {
    const overlay = generateRulesEndpointOverlay('eligibility', rulesDoc);
    const schemasAction = overlay.actions.find(a => a.target === '$.components.schemas');
    assert.ok(schemasAction.update['ExpeditedSnapRequest']);
    assert.ok(schemasAction.update['ExpeditedSnapResponse']);
  });

  await t.test('response schema references EvaluationResult via allOf', () => {
    const overlay = generateRulesEndpointOverlay('eligibility', rulesDoc);
    const schemasAction = overlay.actions.find(a => a.target === '$.components.schemas');
    const response = schemasAction.update['ExpeditedSnapResponse'];
    assert.ok(response.allOf);
    assert.strictEqual(response.allOf[0].$ref, 'https://blueprint.codeforamerica.org/base/schemas/rules-evaluation.yaml#/EvaluationResult');
  });

  await t.test('targets the correct OpenAPI spec file', () => {
    const overlay = generateRulesEndpointOverlay('eligibility', rulesDoc);
    for (const action of overlay.actions) {
      assert.equal(action.file, 'eligibility-openapi.yaml');
    }
  });

});

// ── generateRulesResults ─────────────────────────────────────────────────────

test('generateRulesResults', async (t) => {

  const rulesFiles = [
    {
      relativePath: 'eligibility-rules.yaml',
      doc: {
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
    },
  ];

  await t.test('produces one graph per ruleset', () => {
    const { graphs } = generateRulesResults(rulesFiles);
    assert.ok(graphs.has('eligibility-expeditedSnap-graph.yaml'));
  });

  await t.test('produces overlays for rulesets with endpoints', () => {
    const { overlays } = generateRulesResults(rulesFiles);
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0].domain, 'eligibility');
  });

  await t.test('skips files without domain or rulesets', () => {
    const { graphs, overlays } = generateRulesResults([
      { relativePath: 'bad-rules.yaml', doc: { rulesets: null } },
    ]);
    assert.equal(graphs.size, 0);
    assert.equal(overlays.length, 0);
  });

});
