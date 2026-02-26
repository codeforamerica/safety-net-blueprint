/**
 * Unit tests for generate-api.js
 * Tests name utilities, argument parsing, and template generators.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseArgs,
  toKebabCase,
  toCamelCase,
  toPascalCase,
  pluralize,
  generateApiSpec,
  generateExamples
} from '../../scripts/generate-api.js';

test('generate-api tests', async (t) => {

  // ===========================================================================
  // toKebabCase
  // ===========================================================================

  await t.test('toKebabCase - converts PascalCase', () => {
    assert.strictEqual(toKebabCase('CaseWorker'), 'case-worker');
  });

  await t.test('toKebabCase - converts camelCase', () => {
    assert.strictEqual(toKebabCase('caseWorker'), 'case-worker');
  });

  await t.test('toKebabCase - passes through already-kebab', () => {
    assert.strictEqual(toKebabCase('case-worker'), 'case-worker');
  });

  await t.test('toKebabCase - converts spaces', () => {
    assert.strictEqual(toKebabCase('Case Worker'), 'case-worker');
  });

  await t.test('toKebabCase - converts underscores', () => {
    assert.strictEqual(toKebabCase('case_worker'), 'case-worker');
  });

  // ===========================================================================
  // toCamelCase
  // ===========================================================================

  await t.test('toCamelCase - converts kebab-case', () => {
    assert.strictEqual(toCamelCase('case-worker'), 'caseWorker');
  });

  await t.test('toCamelCase - converts PascalCase', () => {
    assert.strictEqual(toCamelCase('CaseWorker'), 'caseworker');
  });

  await t.test('toCamelCase - single word lowercased', () => {
    assert.strictEqual(toCamelCase('Benefit'), 'benefit');
  });

  // ===========================================================================
  // toPascalCase
  // ===========================================================================

  await t.test('toPascalCase - converts kebab-case', () => {
    assert.strictEqual(toPascalCase('case-worker'), 'CaseWorker');
  });

  await t.test('toPascalCase - converts underscore_case', () => {
    assert.strictEqual(toPascalCase('case_worker'), 'CaseWorker');
  });

  await t.test('toPascalCase - passes through already-PascalCase single word', () => {
    assert.strictEqual(toPascalCase('Benefit'), 'Benefit');
  });

  // ===========================================================================
  // pluralize
  // ===========================================================================

  await t.test('pluralize - regular noun adds s', () => {
    assert.strictEqual(pluralize('Benefit'), 'Benefits');
  });

  await t.test('pluralize - word ending in y becomes ies', () => {
    assert.strictEqual(pluralize('Category'), 'Categories');
  });

  await t.test('pluralize - word ending in s adds es', () => {
    assert.strictEqual(pluralize('Address'), 'Addresses');
  });

  await t.test('pluralize - word ending in ch adds es', () => {
    assert.strictEqual(pluralize('Match'), 'Matches');
  });

  await t.test('pluralize - word ending in x adds es', () => {
    assert.strictEqual(pluralize('Box'), 'Boxes');
  });

  await t.test('pluralize - word ending in sh adds es', () => {
    assert.strictEqual(pluralize('Wish'), 'Wishes');
  });

  // ===========================================================================
  // parseArgs
  // ===========================================================================

  await t.test('parseArgs - parses --name and --resource', () => {
    const original = process.argv;
    try {
      process.argv = ['node', 'generate-api.js', '--name', 'benefits', '--resource', 'Benefit'];
      const opts = parseArgs();
      assert.strictEqual(opts.name, 'benefits');
      assert.strictEqual(opts.resource, 'Benefit');
      assert.strictEqual(opts.help, false);
    } finally {
      process.argv = original;
    }
  });

  await t.test('parseArgs - parses short flags -n and -r', () => {
    const original = process.argv;
    try {
      process.argv = ['node', 'generate-api.js', '-n', 'benefits', '-r', 'Benefit'];
      const opts = parseArgs();
      assert.strictEqual(opts.name, 'benefits');
      assert.strictEqual(opts.resource, 'Benefit');
    } finally {
      process.argv = original;
    }
  });

  await t.test('parseArgs - parses --out', () => {
    const original = process.argv;
    try {
      process.argv = ['node', 'generate-api.js', '--name', 'x', '--resource', 'X', '--out', '/tmp'];
      const opts = parseArgs();
      assert.strictEqual(opts.out, '/tmp');
    } finally {
      process.argv = original;
    }
  });

  await t.test('parseArgs - parses --help', () => {
    const original = process.argv;
    try {
      process.argv = ['node', 'generate-api.js', '--help'];
      const opts = parseArgs();
      assert.strictEqual(opts.help, true);
    } finally {
      process.argv = original;
    }
  });

  await t.test('parseArgs - falls back to positional args', () => {
    const original = process.argv;
    try {
      process.argv = ['node', 'generate-api.js', 'pizza-shop', 'Pizza'];
      const opts = parseArgs();
      assert.strictEqual(opts.name, 'pizza-shop');
      assert.strictEqual(opts.resource, 'Pizza');
    } finally {
      process.argv = original;
    }
  });

  await t.test('parseArgs - parses --ref', () => {
    const original = process.argv;
    try {
      process.argv = ['node', 'generate-api.js', '--name', 'x', '--resource', 'X', '--ref', '/some/path'];
      const opts = parseArgs();
      assert.strictEqual(opts.ref, '/some/path');
    } finally {
      process.argv = original;
    }
  });

  await t.test('parseArgs - defaults when no args given', () => {
    const original = process.argv;
    try {
      process.argv = ['node', 'generate-api.js'];
      const opts = parseArgs();
      assert.strictEqual(opts.name, null);
      assert.strictEqual(opts.resource, null);
      assert.strictEqual(opts.out, null);
      assert.strictEqual(opts.ref, null);
      assert.strictEqual(opts.help, false);
    } finally {
      process.argv = original;
    }
  });

  // ===========================================================================
  // generateApiSpec
  // ===========================================================================

  await t.test('generateApiSpec - contains expected resource names and paths', () => {
    const spec = generateApiSpec('benefits', 'Benefit');
    assert.ok(spec.includes('title: Benefit API'));
    assert.ok(spec.includes('"/benefits"'));
    assert.ok(spec.includes('"/benefits/{benefitId}"'));
    assert.ok(spec.includes('operationId: listBenefits'));
    assert.ok(spec.includes('operationId: createBenefit'));
    assert.ok(spec.includes('operationId: getBenefit'));
    assert.ok(spec.includes('operationId: updateBenefit'));
    assert.ok(spec.includes('operationId: deleteBenefit'));
  });

  await t.test('generateApiSpec - contains $ref strings', () => {
    const spec = generateApiSpec('benefits', 'Benefit');
    assert.ok(spec.includes('"$ref": "#/components/schemas/Benefit"'));
    assert.ok(spec.includes('"$ref": "#/components/schemas/BenefitList"'));
    assert.ok(spec.includes('"$ref": "#/components/schemas/BenefitCreate"'));
    assert.ok(spec.includes('"$ref": "#/components/schemas/BenefitUpdate"'));
    assert.ok(spec.includes('"$ref": "./components/parameters.yaml#/SearchQueryParam"'));
    assert.ok(spec.includes('"$ref": "./components/responses.yaml#/BadRequest"'));
  });

  await t.test('generateApiSpec - handles multi-word resources', () => {
    const spec = generateApiSpec('case-workers', 'CaseWorker');
    assert.ok(spec.includes('title: CaseWorker API'));
    assert.ok(spec.includes('"/caseworkers"'));
    assert.ok(spec.includes('operationId: listCaseWorkers'));
    assert.ok(spec.includes('"$ref": "#/components/schemas/CaseWorker"'));
  });

  await t.test('generateApiSpec - examples $ref points to examples file', () => {
    const spec = generateApiSpec('benefits', 'Benefit');
    assert.ok(spec.includes('"$ref": "./benefits-openapi-examples.yaml#/BenefitExample1"'));
  });

  await t.test('generateApiSpec - uses default ./components prefix', () => {
    const spec = generateApiSpec('benefits', 'Benefit');
    assert.ok(spec.includes('"$ref": "./components/parameters.yaml#/SearchQueryParam"'));
    assert.ok(spec.includes('"$ref": "./components/responses.yaml#/BadRequest"'));
    assert.ok(spec.includes('"$ref": "./components/responses.yaml#/InternalError"'));
  });

  await t.test('generateApiSpec - uses custom components prefix', () => {
    const spec = generateApiSpec('benefits', 'Benefit', '../../shared/components');
    assert.ok(spec.includes('"$ref": "../../shared/components/parameters.yaml#/SearchQueryParam"'));
    assert.ok(spec.includes('"$ref": "../../shared/components/parameters.yaml#/LimitParam"'));
    assert.ok(spec.includes('"$ref": "../../shared/components/parameters.yaml#/OffsetParam"'));
    assert.ok(spec.includes('"$ref": "../../shared/components/responses.yaml#/BadRequest"'));
    assert.ok(spec.includes('"$ref": "../../shared/components/responses.yaml#/NotFound"'));
    assert.ok(spec.includes('"$ref": "../../shared/components/responses.yaml#/UnprocessableEntity"'));
    assert.ok(spec.includes('"$ref": "../../shared/components/responses.yaml#/InternalError"'));
    // Internal schema $refs should NOT be affected
    assert.ok(spec.includes('"$ref": "#/components/schemas/Benefit"'));
  });

  // ===========================================================================
  // generateExamples
  // ===========================================================================

  await t.test('generateExamples - contains expected example keys', () => {
    const examples = generateExamples('benefits', 'Benefit');
    assert.ok(examples.includes('BenefitExample1:'));
    assert.ok(examples.includes('BenefitExample2:'));
  });

  await t.test('generateExamples - contains resource header', () => {
    const examples = generateExamples('benefits', 'Benefit');
    assert.ok(examples.includes('# Benefit Examples'));
  });

  await t.test('generateExamples - contains expected fields', () => {
    const examples = generateExamples('benefits', 'Benefit');
    assert.ok(examples.includes('name: "Example Benefit 1"'));
    assert.ok(examples.includes('status: "active"'));
    assert.ok(examples.includes('status: "pending"'));
  });

});
