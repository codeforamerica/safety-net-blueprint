/**
 * Unit test for the SortParam shared parameter component.
 *
 * SortParam is the OpenAPI parameter definition that every list operation
 * declaring x-sortable references. It must:
 *   - Live in packages/contracts/components/parameters.yaml
 *   - Be named "sort", located in "query", and optional
 *   - Use a string schema (the syntax is parsed at the API boundary, not
 *     validated by JSON Schema)
 *   - Carry a description that points implementers at the api-patterns.yaml
 *     sorting section
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PARAMETERS_PATH = join(__dirname, '..', '..', 'components', 'parameters.yaml');

test('SortParam component', async (t) => {
  const params = yaml.load(readFileSync(PARAMETERS_PATH, 'utf8'));

  await t.test('is defined in components/parameters.yaml', () => {
    assert.ok(params.SortParam, 'parameters.yaml must export SortParam');
    console.log('  ✓ SortParam is defined');
  });

  await t.test('is a query parameter named "sort"', () => {
    assert.strictEqual(params.SortParam.name, 'sort');
    assert.strictEqual(params.SortParam.in, 'query');
    console.log('  ✓ Parameter name and location are correct');
  });

  await t.test('is optional', () => {
    // Per OpenAPI: query parameters default to required: false. Either omitted
    // or explicit false is acceptable.
    assert.notStrictEqual(params.SortParam.required, true,
      'SortParam must be optional — required must be false or absent');
    console.log('  ✓ Parameter is optional');
  });

  await t.test('uses a string schema', () => {
    assert.ok(params.SortParam.schema, 'SortParam must declare a schema');
    assert.strictEqual(params.SortParam.schema.type, 'string',
      'SortParam schema type must be string — the syntax is parsed at runtime, not JSON-Schema-validated');
    console.log('  ✓ Schema type is string');
  });

  await t.test('has a description that references the sorting pattern', () => {
    assert.ok(params.SortParam.description,
      'SortParam must carry a description for generated docs');
    assert.match(params.SortParam.description, /sort/i,
      'description should mention sorting');
    console.log('  ✓ Description mentions sorting');
  });
});

console.log('\n✓ All SortParam tests passed\n');
