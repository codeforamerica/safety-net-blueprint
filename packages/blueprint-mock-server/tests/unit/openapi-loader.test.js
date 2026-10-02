/**
 * The server's view of an OpenAPI document.
 *
 * Nothing here dereferences any more. The refs in a contract set name other
 * documents in the same set, so the set is already complete — flattening it
 * only multiplied every shared schema by the number of places referencing it
 * (#448). What is tested instead is that a ref can be *followed*: the two
 * cases below that used to assert `$RefParser` had inlined everything now
 * assert the opposite, and that resolution works anyway.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { discover, load } from '@codeforamerica/blueprint-core';
import { discoverApiSpecs, extractMetadata, apiSpecsFromDocs } from '../../src/spec-loader.js';
import { join } from 'path';

const fixturesArg = process.argv.find(a => a.startsWith('--fixtures='));
if (!fixturesArg) { console.error('--fixtures= is required'); process.exit(1); }
const fixtureSpecDir = join(fixturesArg.slice('--fixtures='.length), 'spec');

/** The server's metadata for every OpenAPI document in the fixture set. */
const apisOf = (dir) => apiSpecsFromDocs(discover(dir).map(load));

test('OpenAPI Loader Tests', async (t) => {

  await t.test('discoverApiSpecs - discovers all YAML specs', () => {
    const specs = discoverApiSpecs({ specsDir: fixtureSpecDir });

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

  await t.test('apiSpecsFromDocs - reads every OpenAPI document in the set', () => {
    const apis = apisOf(fixtureSpecDir);
    assert.ok(apis.length > 0, 'Should read at least one API');

    for (const api of apis) {
      assert.ok(api.name, 'Should have a name');
      assert.ok(api.title, 'Should have a title');
      assert.ok(Array.isArray(api.endpoints), 'Should have endpoints');
      assert.strictEqual(typeof api.resolve.node, 'function',
        'Should carry a resolver bound to its own document');
    }

    console.log(`  ✓ Read ${apis.length} API(s) from documents`);
  });

  await t.test('apiSpecsFromDocs - follows a ref without inlining the document', () => {
    // The point of the change. A dereferenced document has no $ref left to
    // find; this one keeps them, and resolution is a lookup at the moment
    // something needs to see through one.
    const docs = discover(fixtureSpecDir).map(load);
    const [api] = apiSpecsFromDocs(docs);

    const refs = [...docs.find((d) => d.type === 'openapi').refs().keys()];
    assert.ok(refs.length > 0, 'the fixture document should still carry refs');

    const internal = refs.find((r) => r.startsWith('#/components/schemas/'));
    if (internal) {
      const resolved = api.resolve.node(internal);
      assert.ok(resolved && typeof resolved === 'object',
        `${internal} should resolve to the schema it names`);
      assert.ok(!resolved.$ref, 'resolving should return the node, not another pointer');
    }

    console.log(`  ✓ ${refs.length} ref(s) left in place and followable`);
  });

  await t.test('extractMetadata - extracts API information', () => {
    const [metadata] = apisOf(fixtureSpecDir);

    assert.ok(metadata.name, 'Should have name');
    assert.ok(metadata.title, 'Should have title');
    assert.ok(metadata.version, 'Should have version');
    assert.ok(Array.isArray(metadata.endpoints), 'Should have endpoints array');
    assert.ok(metadata.schemas, 'Should have schemas object');

    console.log(`  ✓ Extracted metadata with ${metadata.endpoints.length} endpoint(s)`);
  });

  await t.test('extractMetadata - extracts endpoint details', () => {
    const [metadata] = apisOf(fixtureSpecDir);

    const endpoint = metadata.endpoints[0];
    assert.ok(endpoint.path, 'Endpoint should have path');
    assert.ok(endpoint.method, 'Endpoint should have method');
    assert.ok(['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(endpoint.method),
              'Method should be valid HTTP verb');

    console.log(`  ✓ First endpoint: ${endpoint.method} ${endpoint.path}`);
  });

  await t.test('extractMetadata - extracts pagination defaults', () => {
    const [metadata] = apisOf(fixtureSpecDir);

    assert.ok(metadata.pagination, 'Should have pagination config');
    assert.strictEqual(typeof metadata.pagination.limitDefault, 'number', 'Should have default limit');
    assert.strictEqual(typeof metadata.pagination.limitMax, 'number', 'Should have max limit');

    console.log(`  ✓ Pagination: limit=${metadata.pagination.limitDefault}, max=${metadata.pagination.limitMax}`);
  });

  // ==========================================================================
  // Server base path extraction (domain path prefixes)
  // ==========================================================================

  await t.test('discoverApiSpecs - excludes deprecated specs', () => {
    const specs = discoverApiSpecs({ specsDir: fixtureSpecDir });
    const names = specs.map(s => s.name);

    assert.ok(!names.includes('deprecated'), 'Should exclude deprecated-openapi.yaml (x-status: deprecated)');
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
