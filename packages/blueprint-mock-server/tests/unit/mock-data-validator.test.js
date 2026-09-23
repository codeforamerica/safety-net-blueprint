/**
 * Unit tests for mock data validator
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { validateMockData } from '../../src/mock-data-validator.js';
import { join } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fixturesArg = process.argv.find(a => a.startsWith('--fixtures='));
if (!fixturesArg) { console.error('--fixtures= is required'); process.exit(1); }
const fixtureSpecDir = join(fixturesArg.slice('--fixtures='.length), 'spec');

// Minimal API spec shape for testing
function makeApiSpec(name, schemas) {
  return { name, schemas };
}

test('Mock Data Validator Tests', async (t) => {

  // A contract set of one API, written to a temp dir, so the validator sees
  // the same shape it sees in production: specs plus mock data on disk.
  async function contractSet(mockData) {
    const { mkdtempSync, writeFileSync } = require('fs');
    const { tmpdir } = require('os');
    const yaml = (await import('js-yaml')).default;
    const { loadAllSpecs } = await import('../../src/spec-loader.js');

    const dir = mkdtempSync(join(tmpdir(), 'mock-data-'));
    writeFileSync(join(dir, 'platform-openapi.yaml'), yaml.dump({
      openapi: '3.1.0',
      info: { title: 'Platform', version: '1.0.0', 'x-domain': 'platform' },
      servers: [{ url: 'http://localhost:1080/platform' }],
      paths: {
        '/events': {
          get: {
            operationId: 'listEvents',
            responses: { 200: { description: 'ok', content: { 'application/json': {
              schema: { type: 'object', properties: { items: { type: 'array',
                items: { $ref: '#/components/schemas/Event' } } } } } } } },
          },
        },
      },
      components: { schemas: { Event: {
        type: 'object', properties: { id: { type: 'string' } },
        required: ['id'], additionalProperties: false } } },
    }));
    writeFileSync(join(dir, 'platform-mock-data.yaml'), yaml.dump(mockData));
    return { dir, apiSpecs: await loadAllSpecs({ specsDir: dir }) };
  }

  await t.test('validateMockData - reports a key that belongs to no collection', async () => {
    // The failure this exists for: a platform event sat in the workflow seed
    // file keyed DomainEventExample1 while the schema is Event. It matched no
    // collection, was seeded nowhere, and nothing said so.
    const { dir, apiSpecs } = await contractSet({
      DomainEventExample1: { id: '0000000a-0000-4000-8000-000000000001' },
    });
    const errors = validateMockData(dir, apiSpecs);

    assert.strictEqual(errors.length, 1, 'the orphaned key must be reported');
    assert.strictEqual(errors[0].key, 'DomainEventExample1');
    assert.match(errors[0].message, /belongs to no collection/);
  });

  await t.test('validateMockData - validates against the schema the collection holds', async () => {
    // Not against a schema named after the key. `/registry/policies` is
    // collection `registry-policies`, keyed RegistryPolicyExample1, schema
    // `Policy` — a key-derived lookup finds nothing and skips silently.
    const { dir, apiSpecs } = await contractSet({
      EventExample1: { id: 'e1', bogusField: 1 },
    });
    const errors = validateMockData(dir, apiSpecs);

    assert.strictEqual(errors.length, 1, 'the record must be checked against Event');
    assert.strictEqual(errors[0].key, 'EventExample1');
    assert.match(errors[0].message, /additional properties/);
  });

  await t.test('validateMockData - accepts a conforming record', async () => {
    const { dir, apiSpecs } = await contractSet({ EventExample1: { id: 'e1' } });
    assert.deepStrictEqual(validateMockData(dir, apiSpecs), []);
  });

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
    const { loadAllSpecs } = await import('../../src/spec-loader.js');
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
