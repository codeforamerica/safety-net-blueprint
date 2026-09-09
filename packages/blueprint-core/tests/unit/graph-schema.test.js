/**
 * Unit tests for the rule graph schema.
 * Validates structural correctness of compiled *-graph.yaml files.
 * Semantic checks (cycle detection, dependency consistency) are tested
 * in the validate pipeline.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, '../../schemas/graph-schema.yaml');

function makeValidator() {
  const raw = readFileSync(schemaPath, 'utf8');
  const schema = yaml.load(raw);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(schema);
}

function validate(doc) {
  const validator = makeValidator();
  const valid = validator(doc);
  return { valid, errors: validator.errors || [] };
}

function errorPaths(errors) {
  return errors.map(e => `${e.instancePath || '(root)'}: ${e.message}`);
}

const SCHEMA_URI = 'https://blueprint.codeforamerica.org/schemas/graph-schema.yaml';

const base = {
  $schema: SCHEMA_URI,
  domain: 'intake',
  ruleset: 'workRequirements',
  outputs: ['eligible'],
  inputs: {
    '$.person': { type: 'object', description: 'Applicant data' },
  },
  facts: {
    ageVerified: { expression: 'person.age >= 18', type: 'boolean' },
    eligible: { expression: 'ageVerified && person.income < 150', type: 'boolean' },
  },
  dependencies: {
    ageVerified: ['$.person.age'],
    eligible: ['ageVerified', '$.person.income'],
  },
};

// ---------------------------------------------------------------------------
// Structural requirements
// ---------------------------------------------------------------------------

test('graph-schema structural requirements', async (t) => {

  await t.test('accepts a valid graph document', () => {
    const { valid, errors } = validate(base);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('requires $schema', () => {
    const { $schema, ...rest } = base;
    const { valid } = validate(rest);
    assert.ok(!valid);
  });

  await t.test('requires domain', () => {
    const { domain, ...rest } = base;
    const { valid } = validate(rest);
    assert.ok(!valid);
  });

  await t.test('requires ruleset', () => {
    const { ruleset, ...rest } = base;
    const { valid } = validate(rest);
    assert.ok(!valid);
  });

  await t.test('requires inputs', () => {
    const { inputs, ...rest } = base;
    const { valid } = validate(rest);
    assert.ok(!valid);
  });

  await t.test('requires facts', () => {
    const { facts, ...rest } = base;
    const { valid } = validate(rest);
    assert.ok(!valid);
  });

  await t.test('requires dependencies', () => {
    const { dependencies, ...rest } = base;
    const { valid } = validate(rest);
    assert.ok(!valid);
  });

  await t.test('requires outputs', () => {
    const { outputs, ...rest } = base;
    const { valid } = validate(rest);
    assert.ok(!valid);
  });

  await t.test('rejects unknown top-level properties', () => {
    const { valid } = validate({ ...base, unknownProp: true });
    assert.ok(!valid);
  });

  await t.test('requires at least one input', () => {
    const { valid } = validate({ ...base, inputs: {} });
    assert.ok(!valid);
  });

  await t.test('requires at least one fact', () => {
    const { valid } = validate({ ...base, facts: {} });
    assert.ok(!valid);
  });

});

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

test('graph-schema nodes', async (t) => {

  await t.test('accepts input node with $.prefix', () => {
    const { valid, errors } = validate({
      ...base,
      inputs: { '$.person': { type: 'object' } },
      facts: { eligible: { expression: 'person.age >= 18', type: 'boolean' } },
      dependencies: { eligible: ['$.person.age'] },
    });
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('rejects input node key with dot-path after identifier', () => {
    const { valid } = validate({
      ...base,
      inputs: { '$.person.age': { type: 'integer' } },
    });
    assert.ok(!valid);
  });

  await t.test('accepts scalar input node with default value', () => {
    const { valid, errors } = validate({
      ...base,
      inputs: {
        ...base.inputs,
        '$.incomeThreshold': { type: 'number', default: 150 },
      },
    });
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('accepts fact node with expression', () => {
    const { valid, errors } = validate(base);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('accepts scalar input node with enum values', () => {
    const { valid, errors } = validate({
      ...base,
      inputs: {
        ...base.inputs,
        '$.programCode': {
          type: 'string',
          enum: ['snap', 'tanf', 'medicaid'],
          enumDescriptions: ['SNAP', 'TANF', 'Medicaid'],
        },
      },
    });
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('accepts scalar input node with format', () => {
    const { valid, errors } = validate({
      ...base,
      inputs: {
        ...base.inputs,
        '$.certificationDate': { type: 'string', format: 'date' },
      },
    });
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('rejects fact node with empty expression', () => {
    const { valid } = validate({
      ...base,
      facts: {
        ...base.facts,
        badFact: { expression: '' },
      },
    });
    assert.ok(!valid);
  });

  await t.test('rejects unknown fact node properties', () => {
    const { valid } = validate({
      ...base,
      facts: {
        ...base.facts,
        badFact: { expression: '1 == 1', unknownProp: true },
      },
    });
    assert.ok(!valid);
  });

});

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

test('graph-schema dependencies', async (t) => {

  await t.test('accepts dependencies with input node paths', () => {
    const { valid, errors } = validate(base);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('accepts dependencies referencing other derived nodes', () => {
    const { valid, errors } = validate({
      ...base,
      dependencies: {
        ageVerified: ['$.person.age'],
        eligible: ['ageVerified', '$.person.income'],
      },
    });
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('requires at least one dependency per entry', () => {
    const { valid } = validate({
      ...base,
      dependencies: { eligible: [] },
    });
    assert.ok(!valid);
  });

  await t.test('accepts empty dependencies map', () => {
    // A graph with only input nodes and no derived dependencies is valid structurally
    const { valid, errors } = validate({ ...base, dependencies: {} });
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

test('graph-schema outputs', async (t) => {

  await t.test('requires at least one output when declared', () => {
    const { valid } = validate({ ...base, outputs: [] });
    assert.ok(!valid);
  });

  await t.test('outputs must be unique', () => {
    const { valid } = validate({ ...base, outputs: ['eligible', 'eligible'] });
    assert.ok(!valid);
  });

  await t.test('accepts multiple outputs', () => {
    const { valid, errors } = validate({
      ...base,
      outputs: ['ageVerified', 'eligible'],
    });
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});

// ---------------------------------------------------------------------------
// Real-world fixture: expedited SNAP graph
// ---------------------------------------------------------------------------

test('graph-schema expedited SNAP fixture', async (t) => {

  const snapGraph = {
    $schema: SCHEMA_URI,
    domain: 'eligibility',
    ruleset: 'expeditedSnap',
    outputs: ['eligible'],
    inputs: {
      '$.household': { type: 'object', description: 'Household size, income, resources, and housing costs' },
      '$.policy': { type: 'object', description: 'Federal policy parameters with default values' },
    },
    facts: {
      passesLowIncomeTest: {
        expression: 'monthlyGrossIncome < grossIncomeLimit && liquidResources <= resourceLimit',
        type: 'boolean',
        description: 'Prong 1: monthly gross income below $150 AND liquid resources at or below $100',
      },
      passesHousingCostTest: {
        expression: '(monthlyGrossIncome + liquidResources) < monthlyHousingCosts',
        type: 'boolean',
        description: 'Prong 2: combined income and resources less than housing costs',
      },
      passesMigrantTest: {
        expression: 'isDestituteMigrant && liquidResources <= resourceLimit',
        type: 'boolean',
        description: 'Prong 3: destitute migrant with liquid resources at or below $100',
      },
      eligible: {
        expression: 'passesLowIncomeTest || passesHousingCostTest || passesMigrantTest',
        type: 'boolean',
        description: 'Eligible for expedited SNAP if any prong is met',
      },
    },
    dependencies: {
      passesLowIncomeTest: [
        '$.household.monthlyGrossIncome',
        '$.household.liquidResources',
        '$.policy.grossIncomeLimit',
        '$.policy.resourceLimit',
      ],
      passesHousingCostTest: [
        '$.household.monthlyGrossIncome',
        '$.household.liquidResources',
        '$.household.monthlyHousingCosts',
      ],
      passesMigrantTest: [
        '$.household.isDestituteMigrant',
        '$.household.liquidResources',
        '$.policy.resourceLimit',
      ],
      eligible: [
        'passesLowIncomeTest',
        'passesHousingCostTest',
        'passesMigrantTest',
      ],
    },
  };

  await t.test('validates expedited SNAP graph', () => {
    const { valid, errors } = validate(snapGraph);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});
