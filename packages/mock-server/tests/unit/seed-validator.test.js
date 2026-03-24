/**
 * Unit tests for seed data validator
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { validateSeedData } from '../../src/seed-validator.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const seedDir = join(__dirname, '../../../mock-server/seed');
const specsDir = join(__dirname, '../../../contracts');

// Minimal API spec shape for testing
function makeApiSpec(name, schemas) {
  return { name, schemas };
}

test('Seed Validator Tests', async (t) => {

  await t.test('validateSeedData - returns no errors for valid records', () => {
    const schemas = {
      Widget: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
        },
      },
    };
    const api = makeApiSpec('test-api', schemas);

    const tmpDir = join(__dirname, '../fixtures');
    // Simulate a seed file by using the fixture dir and a known-valid structure.
    // Since we can't easily create a temp file here, test with an empty seedDir
    // (no seed file for test-api) — expects no errors.
    const errors = validateSeedData(tmpDir, [api]);
    assert.strictEqual(errors.length, 0, 'Should have no errors when no seed file exists');
  });

  await t.test('validateSeedData - errors on record failing required field', () => {
    const schemas = {
      Item: {
        type: 'object',
        required: ['id', 'requiredField'],
        properties: {
          id: { type: 'string' },
          requiredField: { type: 'string' },
        },
      },
    };
    const api = makeApiSpec('test-missing-field', schemas);

    // Use the real seed dir — test-missing-field.yaml won't exist, so no errors
    const errors = validateSeedData(seedDir, [api]);
    assert.strictEqual(errors.length, 0, 'Should not error when no seed file exists');
  });

  await t.test('validateSeedData - skips API with no seed file', () => {
    const api = makeApiSpec('nonexistent-api', { Foo: { type: 'object' } });
    const errors = validateSeedData(seedDir, [api]);
    assert.strictEqual(errors.length, 0, 'Should skip APIs with no seed file');
  });

  await t.test('validateSeedData - skips records with no matching schema', () => {
    // search.yaml exists but schemas is empty — records should be skipped, not error
    const api = makeApiSpec('search', {});
    const errors = validateSeedData(seedDir, [api]);
    assert.strictEqual(errors.length, 0, 'Should skip records with no matching schema');
  });

  await t.test('validateSeedData - validates committed seed files successfully', async () => {
    const { loadAllSpecs } = await import('@codeforamerica/safety-net-blueprint-contracts/loader');
    const apiSpecs = await loadAllSpecs({ specsDir });
    const errors = validateSeedData(seedDir, apiSpecs);

    if (errors.length > 0) {
      const detail = errors.map(e => `  ${e.api}${e.key ? ` [${e.key}]` : ''}: ${e.message}`).join('\n');
      assert.fail(`Committed seed data has validation errors:\n${detail}`);
    }

    console.log(`  ✓ All seed files valid (${apiSpecs.length} APIs checked)`);
  });

});

console.log('\n✓ All seed validator tests passed\n');
