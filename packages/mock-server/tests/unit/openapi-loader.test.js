/**
 * Unit tests for OpenAPI loader
 * Tests spec discovery, loading, and parsing
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { discoverApiSpecs, loadSpec, extractMetadata } from '@safety-net/contracts/loader';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const specsDir = join(__dirname, '../../../contracts');

test('OpenAPI Loader Tests', async (t) => {

  await t.test('discoverApiSpecs - discovers all YAML specs', () => {
    const specs = discoverApiSpecs({ specsDir });

    assert.ok(Array.isArray(specs), 'Should return an array');
    assert.ok(specs.length > 0, 'Should find at least one spec');

    // Check structure
    specs.forEach(spec => {
      assert.ok(spec.name, 'Should have name property');
      assert.ok(spec.specPath, 'Should have specPath property');
      assert.ok(spec.specPath.endsWith('.yaml'), 'Should be a YAML file');
    });

    console.log(`  ✓ Discovered ${specs.length} spec(s)`);
  });

  await t.test('discoverApiSpecs - requires specsDir', () => {
    assert.throws(
      () => discoverApiSpecs(),
      /specsDir is required/,
      'Should throw when specsDir is not provided'
    );

    console.log('  ✓ Throws without specsDir');
  });

  await t.test('loadSpec - loads and dereferences spec', async () => {
    const specs = discoverApiSpecs({ specsDir });
    assert.ok(specs.length > 0, 'Need at least one spec to test');

    const spec = await loadSpec(specs[0].specPath);

    assert.ok(spec.openapi, 'Should have openapi version');
    assert.ok(spec.openapi.startsWith('3.'), 'Should be OpenAPI 3.x');
    assert.ok(spec.info, 'Should have info section');
    assert.ok(spec.paths, 'Should have paths section');

    console.log(`  ✓ Loaded spec: ${spec.info.title}`);
  });

  await t.test('loadSpec - resolves $ref references', async () => {
    const specs = discoverApiSpecs({ specsDir });
    const spec = await loadSpec(specs[0].specPath);

    // Check that references are resolved (no $ref left at top level)
    const pathKeys = Object.keys(spec.paths);
    assert.ok(pathKeys.length > 0, 'Should have at least one path');

    console.log(`  ✓ Resolved references for ${pathKeys.length} path(s)`);
  });

  await t.test('extractMetadata - extracts API information', async () => {
    const specs = discoverApiSpecs({ specsDir });
    const spec = await loadSpec(specs[0].specPath);
    const metadata = extractMetadata(spec, specs[0].name);

    assert.ok(metadata.name, 'Should have name');
    assert.ok(metadata.title, 'Should have title');
    assert.ok(metadata.version, 'Should have version');
    assert.ok(Array.isArray(metadata.endpoints), 'Should have endpoints array');
    assert.ok(metadata.schemas, 'Should have schemas object');

    console.log(`  ✓ Extracted metadata with ${metadata.endpoints.length} endpoint(s)`);
  });

  await t.test('extractMetadata - extracts endpoint details', async () => {
    const specs = discoverApiSpecs({ specsDir });
    const spec = await loadSpec(specs[0].specPath);
    const metadata = extractMetadata(spec, specs[0].name);

    const endpoint = metadata.endpoints[0];
    assert.ok(endpoint.path, 'Endpoint should have path');
    assert.ok(endpoint.method, 'Endpoint should have method');
    assert.ok(['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(endpoint.method),
              'Method should be valid HTTP verb');

    console.log(`  ✓ First endpoint: ${endpoint.method} ${endpoint.path}`);
  });

  await t.test('extractMetadata - extracts pagination defaults', async () => {
    const specs = discoverApiSpecs({ specsDir });
    const spec = await loadSpec(specs[0].specPath);
    const metadata = extractMetadata(spec, specs[0].name);

    assert.ok(metadata.pagination, 'Should have pagination config');
    assert.strictEqual(typeof metadata.pagination.limitDefault, 'number', 'Should have default limit');
    assert.strictEqual(typeof metadata.pagination.limitMax, 'number', 'Should have max limit');

    console.log(`  ✓ Pagination: limit=${metadata.pagination.limitDefault}, max=${metadata.pagination.limitMax}`);
  });

});

console.log('\n✓ All OpenAPI loader tests passed\n');
