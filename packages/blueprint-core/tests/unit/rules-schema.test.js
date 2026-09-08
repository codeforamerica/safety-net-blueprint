/**
 * Unit tests for the domain rules schema.
 * Validates structural correctness by running inline fixtures through the JSON Schema.
 * Cross-artifact semantic checks (cycle detection, $ref resolution, CEL validity)
 * are tested in the validate pipeline.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, '../../schemas/rules-schema.yaml');

function makeValidator() {
  const raw = readFileSync(schemaPath, 'utf8');
  const schema = yaml.load(raw);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(schema);
}

const SCHEMA_URI = 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml';

function validate(doc) {
  const validator = makeValidator();
  const valid = validator(doc);
  return { valid, errors: validator.errors || [] };
}

/** Wrap a rulesets map in a valid top-level document. */
function doc(rulesets, extra = {}) {
  return { $schema: SCHEMA_URI, domain: 'intake', rulesets, ...extra };
}

function errorPaths(errors) {
  return errors.map(e => `${e.instancePath || '(root)'}: ${e.message}`);
}

// ---------------------------------------------------------------------------
// Minimal valid document
// ---------------------------------------------------------------------------

const minimalRuleset = {
  inputs: {
    person: {
      type: 'object',
      properties: {
        age: { type: 'integer' },
      },
    },
  },
  facts: [
    { path: 'eligible', expression: 'person.age >= 18' },
  ],
};

const base = {
  $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
  domain: 'intake',
  rulesets: {
    ageCheck: minimalRuleset,
  },
};

test('rules-schema structural requirements', async (t) => {

  await t.test('accepts minimal valid document', () => {
    const { valid, errors } = validate(base);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('requires $schema', () => {
    const { $schema, ...withoutSchema } = base;
    const { valid } = validate(withoutSchema);
    assert.ok(!valid);
  });

  await t.test('requires domain', () => {
    const { domain, ...withoutDomain } = base;
    const { valid } = validate(withoutDomain);
    assert.ok(!valid);
  });

  await t.test('requires rulesets', () => {
    const { rulesets, ...withoutRulesets } = base;
    const { valid } = validate(withoutRulesets);
    assert.ok(!valid);
  });

  await t.test('requires at least one ruleset', () => {
    const { valid } = validate({ ...base, rulesets: {} });
    assert.ok(!valid);
  });

  await t.test('rejects unknown top-level properties', () => {
    const { valid } = validate({ ...base, unknownProp: true });
    assert.ok(!valid);
  });

});

// ---------------------------------------------------------------------------
// Ruleset structure
// ---------------------------------------------------------------------------

test('rules-schema ruleset structure', async (t) => {

  await t.test('requires inputs', () => {
    const { valid } = validate(doc({ test: { facts: [{ path: 'x', expression: '1' }] } }));
    assert.ok(!valid);
  });

  await t.test('requires facts', () => {
    const { valid } = validate(doc({ test: { inputs: { x: { type: 'number' } } } }));
    assert.ok(!valid);
  });

  await t.test('requires at least one fact', () => {
    const { valid } = validate(doc({ test: { inputs: { x: { type: 'number' } }, facts: [] } }));
    assert.ok(!valid);
  });

  await t.test('accepts outputs as inline schema', () => {
    const { valid, errors } = validate(doc({
      test: {
        ...minimalRuleset,
        outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
      },
    }));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('accepts outputs as $ref', () => {
    const { valid, errors } = validate(doc({
      test: {
        ...minimalRuleset,
        outputs: { $ref: 'https://blueprint.codeforamerica.org/schemas/Result.yaml' },
      },
    }));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('rejects unknown ruleset properties', () => {
    const { valid } = validate(doc({ test: { ...minimalRuleset, unknownProp: true } }));
    assert.ok(!valid);
  });

});

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

test('rules-schema facts', async (t) => {

  await t.test('requires path and expression on each fact', () => {
    const { valid } = validate(doc({
      test: {
        inputs: { x: { type: 'number' } },
        facts: [{ path: 'eligible' }], // missing expression
      },
    }));
    assert.ok(!valid);
  });

  await t.test('accepts fact with description', () => {
    const { valid, errors } = validate(doc({
      test: {
        ...minimalRuleset,
        facts: [{
          path: 'eligible',
          expression: 'person.age >= 18',
          description: 'Whether the applicant meets the age requirement',
        }],
      },
    }));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('accepts fact with type declaration', () => {
    const { valid, errors } = validate(doc({
      test: {
        ...minimalRuleset,
        facts: [{ path: 'eligible', expression: 'person.age >= 18', type: { type: 'boolean' } }],
      },
    }));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('accepts multiple facts', () => {
    const { valid, errors } = validate(doc({
      test: {
        inputs: {
          person: {
            type: 'object',
            properties: { age: { type: 'integer' }, income: { type: 'number' } },
          },
        },
        facts: [
          { path: 'ageVerified', expression: 'person.age >= 18' },
          { path: 'incomeVerified', expression: 'person.income < 150' },
          { path: 'eligible', expression: 'ageVerified && incomeVerified' },
        ],
      },
    }));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('rejects empty expression', () => {
    const { valid } = validate(doc({
      test: {
        inputs: { x: { type: 'number' } },
        facts: [{ path: 'eligible', expression: '' }],
      },
    }));
    assert.ok(!valid);
  });

});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

test('rules-schema inputs', async (t) => {

  await t.test('accepts $ref inputs', () => {
    const { valid, errors } = validate(doc({
      test: {
        inputs: { person: { $ref: 'https://blueprint.codeforamerica.org/schemas/Person.yaml' } },
        facts: [{ path: 'eligible', expression: 'person.age >= 18' }],
      },
    }));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('accepts inline object schema inputs', () => {
    const { valid, errors } = validate(doc({
      test: {
        inputs: {
          policy: {
            type: 'object',
            properties: { incomeThreshold: { type: 'number', default: 150 } },
          },
        },
        facts: [{ path: 'eligible', expression: 'policy.incomeThreshold > 0' }],
      },
    }));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('requires at least one input', () => {
    const { valid } = validate(doc({
      test: {
        inputs: {},
        facts: [{ path: 'eligible', expression: '1 == 1' }],
      },
    }));
    assert.ok(!valid);
  });

});

// ---------------------------------------------------------------------------
// Endpoint block
// ---------------------------------------------------------------------------

test('rules-schema endpoint block', async (t) => {

  await t.test('accepts ruleset with endpoint', () => {
    const { valid, errors } = validate(doc({
      workRequirements: { ...minimalRuleset, endpoint: { path: '/assess-work-requirements' } },
    }));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('endpoint path must start with /', () => {
    const { valid } = validate(doc({ test: { ...minimalRuleset, endpoint: { path: 'assess-work-requirements' } } }));
    assert.ok(!valid);
  });

  await t.test('endpoint requires path', () => {
    const { valid } = validate(doc({ test: { ...minimalRuleset, endpoint: {} } }));
    assert.ok(!valid);
  });

  await t.test('endpoint rejects unknown properties', () => {
    const { valid } = validate(doc({ test: { ...minimalRuleset, endpoint: { path: '/assess', unknownProp: true } } }));
    assert.ok(!valid);
  });

});


// ---------------------------------------------------------------------------
// Multiple rulesets
// ---------------------------------------------------------------------------

test('rules-schema multiple rulesets', async (t) => {

  await t.test('accepts multiple rulesets in one file', () => {
    const { valid, errors } = validate(doc({
      ageCheck: {
        inputs: { person: { type: 'object', properties: { age: { type: 'integer' } } } },
        facts: [{ path: 'ageVerified', expression: 'person.age >= 18' }],
      },
      incomeCheck: {
        inputs: { person: { type: 'object', properties: { income: { type: 'number' } } } },
        facts: [{ path: 'incomeVerified', expression: 'person.income < 150' }],
      },
    }));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});
