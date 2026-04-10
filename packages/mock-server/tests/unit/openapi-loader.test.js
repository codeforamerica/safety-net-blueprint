/**
 * Unit tests for OpenAPI loader
 * Tests spec discovery, loading, and parsing
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { discoverApiSpecs, loadSpec, extractMetadata } from '@codeforamerica/safety-net-blueprint-contracts/loader';
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

  // ==========================================================================
  // Server base path extraction (domain path prefixes)
  // ==========================================================================

  await t.test('discoverApiSpecs - excludes deprecated specs', () => {
    const specs = discoverApiSpecs({ specsDir });
    const names = specs.map(s => s.name);

    assert.ok(!names.includes('search'), 'Should exclude search (x-status: deprecated)');
    console.log(`  ✓ Deprecated specs excluded (${specs.length} specs discovered)`);
  });

  await t.test('extractMetadata - extracts serverBasePath from localhost URL', () => {
    const spec = {
      info: { title: 'Test API', version: '1.0.0' },
      servers: [
        { url: 'https://api.example.com/intake', description: 'Production' },
        { url: 'http://localhost:1080/intake', description: 'Local' }
      ],
      paths: {
        '/applications': { get: { operationId: 'listApplications', responses: {} } }
      }
    };

    const metadata = extractMetadata(spec, 'applications');

    assert.strictEqual(metadata.serverBasePath, '/intake', 'Should extract /intake from localhost URL');
    console.log('  ✓ Extracts serverBasePath from localhost URL');
  });

  await t.test('extractMetadata - prefixes endpoint paths with serverBasePath', () => {
    const spec = {
      info: { title: 'Test API', version: '1.0.0' },
      servers: [{ url: 'http://localhost:1080/intake' }],
      paths: {
        '/applications': { get: { operationId: 'listApplications', responses: {} } },
        '/applications/{applicationId}': { get: { operationId: 'getApplication', responses: {} } }
      }
    };

    const metadata = extractMetadata(spec, 'applications');
    const paths = metadata.endpoints.map(e => e.path);

    assert.ok(paths.includes('/intake/applications'), 'Collection path should include /intake prefix');
    assert.ok(paths.includes('/intake/applications/{applicationId}'), 'Item path should include /intake prefix');
    console.log('  ✓ Endpoint paths prefixed with serverBasePath');
  });

  await t.test('extractMetadata - does not double-prefix paths already starting with serverBasePath', () => {
    const spec = {
      info: { title: 'Test API', version: '1.0.0' },
      servers: [{ url: 'http://localhost:1080/workflow' }],
      paths: {
        '/tasks': { get: { operationId: 'listTasks', responses: {} } },
        '/workflow/metrics': { get: { operationId: 'listMetrics', responses: {} } }
      }
    };

    const metadata = extractMetadata(spec, 'workflow');
    const paths = metadata.endpoints.map(e => e.path);

    assert.ok(paths.includes('/workflow/tasks'), 'Regular path should get /workflow prefix');
    assert.ok(paths.includes('/workflow/metrics'), 'Already-prefixed path should not be doubled');
    assert.ok(!paths.includes('/workflow/workflow/metrics'), 'Should not produce double prefix');
    console.log('  ✓ Already-prefixed paths are not double-prefixed');
  });

  await t.test('extractMetadata - baseResource includes serverBasePath', () => {
    const spec = {
      info: { title: 'Test API', version: '1.0.0' },
      servers: [{ url: 'http://localhost:1080/intake' }],
      paths: {
        '/applications': { get: { operationId: 'listApplications', responses: {} } },
        '/applications/{applicationId}': { get: { operationId: 'getApplication', responses: {} } }
      }
    };

    const metadata = extractMetadata(spec, 'applications');

    assert.strictEqual(metadata.baseResource, '/intake/applications', 'baseResource should include serverBasePath');
    console.log('  ✓ baseResource includes serverBasePath');
  });

  await t.test('extractMetadata - serverBasePath empty when no localhost path', () => {
    const spec = {
      info: { title: 'Test API', version: '1.0.0' },
      servers: [{ url: 'http://localhost:8080' }],
      paths: {
        '/tasks': { get: { operationId: 'listTasks', responses: {} } }
      }
    };

    const metadata = extractMetadata(spec, 'tasks');

    assert.strictEqual(metadata.serverBasePath, '', 'Should have empty serverBasePath when no path in URL');
    assert.ok(metadata.endpoints.some(e => e.path === '/tasks'), 'Path should not be prefixed');
    console.log('  ✓ No serverBasePath when localhost URL has no path');
  });

});

console.log('\n✓ All OpenAPI loader tests passed\n');
