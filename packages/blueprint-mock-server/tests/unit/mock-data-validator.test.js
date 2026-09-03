/**
 * Unit tests for mock data validator
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { validateMockData } from '../../src/mock-data-validator.js';
import { join } from 'path';

const fixturesArg = process.argv.find(a => a.startsWith('--fixtures='));
if (!fixturesArg) { console.error('--fixtures= is required'); process.exit(1); }
const fixtureSpecDir = join(fixturesArg.slice('--fixtures='.length), 'spec');

// Minimal API spec shape for testing
function makeApiSpec(name, schemas) {
  return { name, schemas };
}

test('Mock Data Validator Tests', async (t) => {

  await t.test('validateMockData - returns no errors when no mock data files exist', () => {
    const api = makeApiSpec('test-api', {
      Widget: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
        },
      },
    });
    // fixtureSpecDir has no *-mock-data.yaml files, so no errors expected
    const errors = validateMockData(fixtureSpecDir, [api]);
    assert.strictEqual(errors.length, 0, 'Should have no errors when no mock data files exist');
  });

  await t.test('validateMockData - skips API with no matching mock data file', () => {
    const api = makeApiSpec('nonexistent-api', { Foo: { type: 'object' } });
    const errors = validateMockData(fixtureSpecDir, [api]);
    assert.strictEqual(errors.length, 0, 'Should skip APIs with no mock data file');
  });

  await t.test('validateMockData - validates fixture spec dir successfully', async () => {
    const { loadAllSpecs } = await import('@codeforamerica/blueprint-core/loader');
    const apiSpecs = await loadAllSpecs({ specsDir: fixtureSpecDir });
    const errors = validateMockData(fixtureSpecDir, apiSpecs);

    if (errors.length > 0) {
      const detail = errors.map(e => `  ${e.api}${e.key ? ` [${e.key}]` : ''}: ${e.message}`).join('\n');
      assert.fail(`Mock data has validation errors:\n${detail}`);
    }

    console.log(`  ✓ All mock data valid (${apiSpecs.length} APIs checked)`);
  });

});

console.log('\n✓ All mock data validator tests passed\n');
