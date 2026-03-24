/**
 * Integration Tests for Mock Server
 *
 * Tests the full stack: fixture data → mock server → HTTP → assertions.
 *
 * Setup:
 *   1. A temp directory is created with base specs + fixture examples overlaid.
 *   2. The mock server is started against that temp directory.
 *   3. A Postman collection is generated from the same temp directory.
 *   4. All tests run against the mock seeded with fixture data.
 *
 * Fixture IDs are stable and namespaced by resource type. See
 * packages/mock-server/tests/fixtures/setup.js for the ID namespace map.
 *
 * Run with: npm run test:integration
 */

import http from 'http';
import { URL } from 'url';
import { execSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import newman from 'newman';
import { setupFixtureDir, teardownFixtureDir } from '../fixtures/setup.js';
import { startMockServer, stopServer, isServerRunning } from '../../scripts/server.js';
import { loadAllSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'http://localhost:1080';
let fixtureDir = null;
let serverStartedByTests = false;

// Simple fetch polyfill using Node.js http module
async function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (options.body) {
      const bodyString = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      requestOptions.headers['Content-Length'] = Buffer.byteLength(bodyString);
      if (!requestOptions.headers['Content-Type']) {
        requestOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          json: async () => JSON.parse(data),
          text: async () => data
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      const bodyString = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(bodyString);
    }

    req.end();
  });
}

/**
 * Load examples for an API from the fixture directory
 */
function loadExamples(apiName) {
  try {
    const examplesPath = join(fixtureDir, `${apiName}.yaml`);
    const content = readFileSync(examplesPath, 'utf8');
    const examples = yaml.load(content) || {};

    return Object.entries(examples)
      .filter(([key, value]) => {
        if (!value || typeof value !== 'object') return false;
        if (value.items && Array.isArray(value.items)) return false;
        if (key.toLowerCase().includes('payload') || key.toLowerCase().includes('list')) return false;
        return value.id;
      })
      .map(([key, value]) => ({ key, data: value }));
  } catch (error) {
    console.log(`    ⚠️  No examples found for ${apiName}`);
    return [];
  }
}

/**
 * Create a valid resource for POST testing by removing readonly fields
 */
function createPostPayload(example) {
  const payload = { ...example };
  delete payload.id;
  delete payload.createdAt;
  delete payload.updatedAt;
  return payload;
}

/**
 * Get singular form of API name (simple heuristic)
 */
function singularize(plural) {
  if (plural.endsWith('ies')) return plural.slice(0, -3) + 'y';
  if (plural.endsWith('ses')) return plural.slice(0, -2);
  if (plural.endsWith('s')) return plural.slice(0, -1);
  return plural;
}

/**
 * Run generic CRUD test suite for an API
 */
async function testApi(api, examples) {
  const apiName = api.name;
  const apiPath = api.baseResource || `/${apiName}`;
  const singularName = singularize(apiPath.slice(1));

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing API: ${apiName}`);
  console.log(`${'='.repeat(70)}`);

  let passed = 0;
  let failed = 0;
  let createdResourceId = null;

  // Test 1: LIST - Get all resources
  try {
    console.log(`\n  1. GET ${apiPath} (list all)`);
    const response = await fetch(`${BASE_URL}${apiPath}`);

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data = await response.json();
    if (data.items && Array.isArray(data.items) && typeof data.total === 'number') {
      console.log(`     ✓ PASS: Returns list with pagination`);
      console.log(`       Items: ${data.items.length}, Total: ${data.total}`);
      passed++;
    } else {
      console.log('     ✗ FAIL: Invalid list response structure');
      failed++;
    }
  } catch (error) {
    console.log(`     ✗ FAIL: ${error.message}`);
    failed++;
  }

  // Test 2: LIST with pagination
  try {
    console.log(`\n  2. GET ${apiPath}?limit=1&offset=0 (pagination)`);
    const response = await fetch(`${BASE_URL}${apiPath}?limit=1&offset=0`);
    const data = await response.json();

    if (data.limit === 1 && data.items.length <= 1) {
      console.log(`     ✓ PASS: Pagination works correctly`);
      passed++;
    } else {
      console.log('     ✗ FAIL: Pagination not working');
      failed++;
    }
  } catch (error) {
    console.log(`     ✗ FAIL: ${error.message}`);
    failed++;
  }

  // Test 3: GET by ID (if examples exist)
  if (examples.length > 0) {
    try {
      console.log(`\n  3. GET ${apiPath}/{id} (get by ID)`);
      const exampleId = examples[0].data.id;
      const response = await fetch(`${BASE_URL}${apiPath}/${exampleId}`);

      if (response.status === 200) {
        const data = await response.json();
        if (data.id === exampleId) {
          console.log(`     ✓ PASS: Returns resource by ID`);
          console.log(`       ID: ${exampleId}`);
          passed++;
        } else {
          console.log('     ✗ FAIL: Returned resource has wrong ID');
          failed++;
        }
      } else {
        console.log(`     ✗ FAIL: Expected 200, got ${response.status}`);
        failed++;
      }
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      failed++;
    }
  } else {
    console.log(`\n  3. GET ${apiPath}/{id} - SKIPPED (no examples)`);
  }

  // Test 4: GET by ID - 404 for unknown ID
  try {
    console.log(`\n  4. GET ${apiPath}/{id} - 404 for unknown ID`);
    const unknownId = '00000000-0000-0000-0000-000000000000';
    const response = await fetch(`${BASE_URL}${apiPath}/${unknownId}`);

    if (response.status === 404) {
      const data = await response.json();
      if (data.code === 'NOT_FOUND') {
        console.log(`     ✓ PASS: Returns 404 with correct error structure`);
        passed++;
      } else {
        console.log('     ✗ FAIL: 404 response structure incorrect');
        failed++;
      }
    } else {
      console.log(`     ✗ FAIL: Expected 404, got ${response.status}`);
      failed++;
    }
  } catch (error) {
    console.log(`     ✗ FAIL: ${error.message}`);
    failed++;
  }

  // Test 5: POST - Create resource (if examples exist)
  if (examples.length > 0) {
    try {
      console.log(`\n  5. POST ${apiPath} (create)`);
      const payload = createPostPayload(examples[0].data);

      const response = await fetch(`${BASE_URL}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.status === 201) {
        const data = await response.json();
        if (data.id && data.createdAt && data.updatedAt) {
          createdResourceId = data.id;
          console.log(`     ✓ PASS: Creates resource with generated fields`);
          console.log(`       ID: ${data.id}`);
          passed++;
        } else {
          console.log('     ✗ FAIL: Created resource missing required fields');
          failed++;
        }
      } else {
        console.log(`     ✗ FAIL: Expected 201, got ${response.status}`);
        const errorData = await response.json();
        if (errorData.details && errorData.details.length > 0) {
          console.log(`       Validation errors:`);
          errorData.details.slice(0, 3).forEach(err => {
            console.log(`         - ${err.field || err.instancePath}: ${err.message}`);
          });
        }
        failed++;
      }
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      failed++;
    }
  } else {
    console.log(`\n  5. POST ${apiPath} - SKIPPED (no examples)`);
  }

  // Test 6: POST - Validation error (422)
  const hasPostEndpoint = api.endpoints.some(e => e.method === 'POST');
  if (hasPostEndpoint) {
    try {
      console.log(`\n  6. POST ${apiPath} - validation error`);
      const response = await fetch(`${BASE_URL}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalidField: 'value' })
      });

      if (response.status === 422) {
        const data = await response.json();
        if (data.code === 'VALIDATION_ERROR' && data.details) {
          console.log(`     ✓ PASS: Returns 422 with validation details`);
          console.log(`       Errors: ${data.details.length}`);
          passed++;
        } else {
          console.log('     ✗ FAIL: 422 response structure incorrect');
          failed++;
        }
      } else {
        console.log(`     ✗ FAIL: Expected 422, got ${response.status}`);
        failed++;
      }
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      failed++;
    }
  } else {
    console.log(`\n  6. POST ${apiPath} - SKIPPED (no POST endpoint)`);
  }

  // Test 7: PATCH - Update resource
  const updateTargetId = createdResourceId || (examples.length > 0 ? examples[0].data.id : null);
  if (updateTargetId) {
    try {
      console.log(`\n  7. PATCH ${apiPath}/{id} (update)`);

      const exampleData = createdResourceId
        ? createPostPayload(examples[0].data)
        : examples[0].data;

      const numericField = Object.keys(exampleData).find(key =>
        typeof exampleData[key] === 'number' && !['id'].includes(key)
      );

      const updatePayload = numericField
        ? { [numericField]: exampleData[numericField] + 100 }
        : { updatedAt: new Date().toISOString() };

      const response = await fetch(`${BASE_URL}${apiPath}/${updateTargetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload)
      });

      if (response.status === 200) {
        const data = await response.json();
        if (data.id === updateTargetId && data.updatedAt) {
          console.log(`     ✓ PASS: Updates resource`);
          console.log(`       Updated: ${Object.keys(updatePayload).join(', ')}`);
          passed++;
        } else {
          console.log('     ✗ FAIL: Update response incorrect');
          failed++;
        }
      } else {
        console.log(`     ✗ FAIL: Expected 200, got ${response.status}`);
        failed++;
      }
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      failed++;
    }
  } else {
    console.log(`\n  7. PATCH ${apiPath}/{id} - SKIPPED (no resource to update)`);
  }

  // Test 8: DELETE - Remove resource (use created resource if available)
  if (createdResourceId) {
    try {
      console.log(`\n  8. DELETE ${apiPath}/{id}`);
      const response = await fetch(`${BASE_URL}${apiPath}/${createdResourceId}`, {
        method: 'DELETE'
      });

      if (response.status === 204) {
        console.log(`     ✓ PASS: Deletes resource (returns 204)`);
        passed++;
      } else {
        console.log(`     ✗ FAIL: Expected 204, got ${response.status}`);
        failed++;
      }
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      failed++;
    }
  } else {
    console.log(`\n  8. DELETE ${apiPath}/{id} - SKIPPED (no resource created)`);
  }

  // Test 9: Search
  if (examples.length > 0) {
    try {
      console.log(`\n  9. GET ${apiPath}?search=... (search)`);

      const exampleData = examples[0].data;
      let searchValue = null;

      if (exampleData.name?.firstName) {
        searchValue = exampleData.name.firstName;
      } else if (exampleData.email) {
        searchValue = exampleData.email.split('@')[0];
      } else if (typeof exampleData.name === 'string') {
        searchValue = exampleData.name.split(' ')[0];
      }

      if (searchValue) {
        const response = await fetch(`${BASE_URL}${apiPath}?search=${searchValue}`);
        const data = await response.json();

        if (response.ok && data.items) {
          console.log(`     ✓ PASS: Search returns results`);
          console.log(`       Query: "${searchValue}", Results: ${data.items.length}`);
          passed++;
        } else {
          console.log('     ✗ FAIL: Search failed or invalid response');
          failed++;
        }
      } else {
        console.log(`     ⚠️  SKIP: No searchable fields found`);
      }
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      failed++;
    }
  } else {
    console.log(`\n  9. GET ${apiPath}?search=... - SKIPPED (no examples)`);
  }

  return { passed, failed, total: passed + failed };
}

/**
 * Run Postman collection tests using Newman.
 * Generates a fresh collection from the fixture directory before running.
 */
async function runPostmanTests() {
  console.log(`\n${'='.repeat(70)}`);
  console.log('Postman Collection Tests (Newman)');
  console.log('='.repeat(70));

  // Generate a fresh Postman collection from the fixture directory
  const tmpCollectionDir = mkdtempSync(join(tmpdir(), 'snb-postman-'));
  const collectionPath = join(tmpCollectionDir, 'postman-collection.json');

  try {
    const generateScript = resolve(__dirname, '../../../contracts/scripts/generate-postman.js');
    console.log('\n  Generating Postman collection from fixture specs...');
    execSync(
      `node "${generateScript}" --spec="${fixtureDir}" --out="${collectionPath}"`,
      { stdio: 'pipe' }
    );
    console.log(`  ✓ Collection generated`);
  } catch (err) {
    console.log(`  ✗ Failed to generate collection: ${err.message}`);
    rmSync(tmpCollectionDir, { recursive: true, force: true });
    return { passed: 0, failed: 1, total: 1, skipped: false };
  }

  console.log(`\n  Collection: ${collectionPath}`);
  console.log(`  Base URL: ${BASE_URL}\n`);

  return new Promise((resolve) => {
    newman.run({
      collection: collectionPath,
      envVar: [
        { key: 'baseUrl', value: BASE_URL }
      ],
      reporters: ['cli'],
      reporter: {
        cli: {
          silent: false,
          noSummary: false
        }
      }
    }, (err, summary) => {
      rmSync(tmpCollectionDir, { recursive: true, force: true });

      if (err) {
        console.log(`  ✗ Newman execution error: ${err.message}`);
        resolve({ passed: 0, failed: 1, total: 1, skipped: false });
        return;
      }

      const stats = summary.run.stats;
      const assertions = stats.assertions || { total: 0, failed: 0 };
      const requests = stats.requests || { total: 0, failed: 0 };

      const passed = requests.total - requests.failed;
      const failed = requests.failed;

      console.log(`\n  ${'─'.repeat(66)}`);
      console.log(`  Newman Summary:`);
      console.log(`    Requests: ${passed}/${requests.total} passed`);
      console.log(`    Assertions: ${assertions.total - assertions.failed}/${assertions.total} passed`);

      if (assertions.failed === 0) {
        console.log(`  ✓ PASS: All Postman assertions passed`);
      } else {
        console.log(`  ✗ FAIL: ${assertions.failed} assertion(s) failed`);
      }

      resolve({
        passed: assertions.failed === 0 ? 1 : 0,
        failed: assertions.failed > 0 ? 1 : 0,
        total: 1,
        skipped: false
      });
    });
  });
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('Integration Tests — Fixture-Based\n');
  console.log('='.repeat(70));

  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;

  // =========================================================================
  // Setup: create fixture dir and start mock server
  // =========================================================================
  console.log('\n📦 Setting up fixture directory...');
  fixtureDir = setupFixtureDir();
  console.log(`  ✓ Fixture dir: ${fixtureDir}`);

  try {
    const isRunning = await isServerRunning();
    if (isRunning) {
      console.log('\n  ⚠️  Mock server already running on port 1080.');
      console.log('      Integration tests require a fixture-seeded server.');
      console.log('      Stop the existing server and re-run, or the tests may');
      console.log('      fail if the server is not seeded with fixture data.');
    } else {
      console.log('\n  Starting mock server with fixture data...');
      await startMockServer([fixtureDir]);
      serverStartedByTests = true;
      await new Promise(res => setTimeout(res, 1000));
      console.log('  ✓ Mock server started');
    }
  } catch (error) {
    console.log(`  ✗ FAIL: Cannot start server: ${error.message}`);
    teardownFixtureDir(fixtureDir);
    process.exit(1);
  }

  // =========================================================================
  // Discover APIs from fixture dir
  // =========================================================================
  console.log('\n🔍 Discovering APIs...');
  const apis = await loadAllSpecs({ specsDir: fixtureDir });

  if (apis.length === 0) {
    console.log('  ⚠️  No APIs found');
    await cleanup();
    process.exit(0);
  }

  console.log(`  ✓ Found ${apis.length} API(s):`);
  apis.forEach(api => console.log(`    - ${api.name}`));

  // =========================================================================
  // CRUD tests for each API
  // =========================================================================
  for (const api of apis) {
    const examples = loadExamples(api.name);
    const results = await testApi(api, examples);

    totalPassed += results.passed;
    totalFailed += results.failed;
    totalTests += results.total;
  }

  // =========================================================================
  // State Machine RPC Tests
  // =========================================================================
  const workflowApi = apis.find(api => api.name === 'workflow');
  if (workflowApi) {
    const taskPath = '/tasks';
    console.log(`\n${'='.repeat(70)}`);
    console.log(`State Machine RPC Tests: ${taskPath}`);
    console.log('='.repeat(70));

    let rpcTaskId = null;

    // RPC-1: Create a pending task
    try {
      console.log('\n  RPC-1. Create a pending task for transition tests');
      const response = await fetch(`${BASE_URL}${taskPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RPC test task', status: 'pending' })
      });

      if (response.status === 201) {
        const data = await response.json();
        rpcTaskId = data.id;
        if (data.status === 'pending') {
          console.log(`     ✓ PASS: Created pending task ${rpcTaskId}`);
          totalPassed++;
        } else {
          console.log(`     ✗ FAIL: Task status is "${data.status}", expected "pending"`);
          totalFailed++;
        }
      } else {
        console.log(`     ✗ FAIL: Expected 201, got ${response.status}`);
        totalFailed++;
      }
      totalTests++;
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      totalFailed++;
      totalTests++;
    }

    // RPC-2: Claim (pending → in_progress)
    if (rpcTaskId) {
      try {
        console.log(`\n  RPC-2. POST ${taskPath}/{id}/claim (pending → in_progress)`);
        const response = await fetch(`${BASE_URL}${taskPath}/${rpcTaskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-aaa' }
        });

        if (response.status === 200) {
          const data = await response.json();
          if (data.status === 'in_progress' && data.assignedToId === 'worker-aaa') {
            console.log('     ✓ PASS: Task claimed, status=in_progress, assignedToId=worker-aaa');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: status=${data.status}, assignedToId=${data.assignedToId}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Expected 200, got ${response.status}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }

    // RPC-3: Claim again → 409 (wrong status)
    if (rpcTaskId) {
      try {
        console.log(`\n  RPC-3. POST ${taskPath}/{id}/claim again → 409`);
        const response = await fetch(`${BASE_URL}${taskPath}/${rpcTaskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-bbb' }
        });

        if (response.status === 409) {
          const data = await response.json();
          if (data.code === 'CONFLICT') {
            console.log('     ✓ PASS: Returns 409 CONFLICT for invalid transition');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: Expected CONFLICT code, got ${data.code}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Expected 409, got ${response.status}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }

    // RPC-4: Complete with wrong worker → 409 (guard fails)
    if (rpcTaskId) {
      try {
        console.log(`\n  RPC-4. POST ${taskPath}/{id}/complete with wrong worker → 409`);
        const response = await fetch(`${BASE_URL}${taskPath}/${rpcTaskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-bbb' },
          body: JSON.stringify({ outcome: 'approved' })
        });

        if (response.status === 409) {
          const data = await response.json();
          if (data.code === 'CONFLICT') {
            console.log('     ✓ PASS: Returns 409 CONFLICT for guard failure');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: Expected CONFLICT code, got ${data.code}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Expected 409, got ${response.status}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }

    // RPC-5: Release (in_progress → pending)
    if (rpcTaskId) {
      try {
        console.log(`\n  RPC-5. POST ${taskPath}/{id}/release (in_progress → pending)`);
        const response = await fetch(`${BASE_URL}${taskPath}/${rpcTaskId}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-aaa' },
          body: JSON.stringify({ reason: 'Integration test release' })
        });

        if (response.status === 200) {
          const data = await response.json();
          if (data.status === 'pending' && data.assignedToId === null) {
            console.log('     ✓ PASS: Task released, status=pending, assignedToId=null');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: status=${data.status}, assignedToId=${data.assignedToId}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Expected 200, got ${response.status}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }

    // RPC-6: Missing X-Caller-Id → 400
    if (rpcTaskId) {
      try {
        console.log(`\n  RPC-6. POST ${taskPath}/{id}/claim without X-Caller-Id → 400`);
        const response = await fetch(`${BASE_URL}${taskPath}/${rpcTaskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.status === 400) {
          const data = await response.json();
          if (data.code === 'BAD_REQUEST') {
            console.log('     ✓ PASS: Returns 400 BAD_REQUEST without X-Caller-Id');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: Expected BAD_REQUEST code, got ${data.code}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Expected 400, got ${response.status}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }

    // =========================================================================
    // Domain Event Integration Tests
    // =========================================================================
    console.log(`\n${'='.repeat(70)}`);
    console.log('Domain Event Integration Tests');
    console.log('='.repeat(70));

    let auditTaskId = null;

    // EVENT-1: Create a fresh task for event testing
    try {
      console.log('\n  EVENT-1. Create a fresh task for domain event tests');
      const response = await fetch(`${BASE_URL}${taskPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Audit test task', status: 'pending' })
      });
      if (response.status === 201) {
        const data = await response.json();
        auditTaskId = data.id;
        console.log(`     ✓ PASS: Created task ${auditTaskId}`);
        totalPassed++;
      } else {
        console.log(`     ✗ FAIL: Expected 201, got ${response.status}`);
        totalFailed++;
      }
      totalTests++;
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      totalFailed++;
      totalTests++;
    }

    // EVENT-2: Claim → verify "claimed" domain event
    if (auditTaskId) {
      try {
        console.log(`\n  EVENT-2. Claim task → verify "claimed" domain event`);
        await fetch(`${BASE_URL}${taskPath}/${auditTaskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-audit-1' }
        });

        const listResponse = await fetch(`${BASE_URL}/events?q=resourceId:${auditTaskId}`);
        const listData = await listResponse.json();

        if (listData.items && listData.items.length === 2) {
          const event = listData.items.find(e => e.action === 'claimed');
          if (event && event.resourceId === auditTaskId && event.performedById === 'worker-audit-1') {
            console.log('     ✓ PASS: "claimed" domain event created with correct fields');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: Domain event fields incorrect: ${JSON.stringify(event)}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Expected 2 domain events, got ${listData.items?.length ?? 0}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }

    // EVENT-3: Release → verify 3 domain events
    if (auditTaskId) {
      try {
        console.log(`\n  EVENT-3. Release task → verify 3 domain events`);
        await fetch(`${BASE_URL}${taskPath}/${auditTaskId}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-audit-1' },
          body: JSON.stringify({ reason: 'Testing domain events' })
        });

        const listResponse = await fetch(`${BASE_URL}/events?q=resourceId:${auditTaskId}`);
        const listData = await listResponse.json();

        if (listData.items && listData.items.length === 3) {
          const actions = listData.items.map(e => e.action).sort();
          if (actions.includes('claimed') && actions.includes('created') && actions.includes('released')) {
            console.log('     ✓ PASS: 3 domain events (created + claimed + released)');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: Unexpected event actions: ${actions.join(', ')}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Expected 3 domain events, got ${listData.items?.length ?? 0}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }

    // EVENT-4: Claim again + complete → verify 5 total domain events
    if (auditTaskId) {
      try {
        console.log(`\n  EVENT-4. Claim + complete → verify 5 total domain events`);
        await fetch(`${BASE_URL}${taskPath}/${auditTaskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-audit-1' }
        });
        await fetch(`${BASE_URL}${taskPath}/${auditTaskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-audit-1' },
          body: JSON.stringify({ outcome: 'approved' })
        });

        const listResponse = await fetch(`${BASE_URL}/events?q=resourceId:${auditTaskId}`);
        const listData = await listResponse.json();

        if (listData.items && listData.items.length === 5) {
          const actions = listData.items.map(e => e.action).sort();
          if (['claimed', 'completed', 'created', 'released'].every(a => actions.includes(a))) {
            console.log('     ✓ PASS: 5 domain events total');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: Unexpected event actions: ${actions.join(', ')}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Expected 5 domain events, got ${listData.items?.length ?? 0}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }

    // EVENT-5: GET single domain event by ID
    if (auditTaskId) {
      try {
        console.log(`\n  EVENT-5. GET single domain event by ID`);
        const listResponse = await fetch(`${BASE_URL}/events?q=resourceId:${auditTaskId}`);
        const listData = await listResponse.json();

        if (listData.items && listData.items.length > 0) {
          const eventId = listData.items[0].id;
          const getResponse = await fetch(`${BASE_URL}/events/${eventId}`);

          if (getResponse.status === 200) {
            const event = await getResponse.json();
            if (event.id === eventId && event.resourceId === auditTaskId && event.occurredAt) {
              console.log(`     ✓ PASS: GET /events/${eventId} returns correct event`);
              totalPassed++;
            } else {
              console.log(`     ✗ FAIL: Event fields incorrect`);
              totalFailed++;
            }
          } else {
            console.log(`     ✗ FAIL: Expected 200, got ${getResponse.status}`);
            totalFailed++;
          }
        } else {
          console.log('     ✗ FAIL: No domain events to test GET by ID');
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }
  }

  // =========================================================================
  // Rule Evaluation Tests
  // =========================================================================
  if (workflowApi) {
    const taskPath = '/tasks';
    console.log(`\n${'='.repeat(70)}`);
    console.log('Rule Evaluation Tests');
    console.log('='.repeat(70));

    let snapTaskId = null;
    let snapIntakeQueueId = null;
    let generalIntakeQueueId = null;

    // Look up fixture queue IDs by name
    try {
      const queuesRes = await fetch(`${BASE_URL}/queues`);
      const queuesData = await queuesRes.json();
      for (const q of queuesData.items) {
        if (q.name === 'snap-intake') snapIntakeQueueId = q.id;
        if (q.name === 'general-intake') generalIntakeQueueId = q.id;
      }
      if (snapIntakeQueueId && generalIntakeQueueId) {
        console.log(`\n  Queues: snap-intake=${snapIntakeQueueId}, general-intake=${generalIntakeQueueId}`);
      } else {
        console.log(`  ⚠️  Could not find required queues. Rule tests may fail.`);
      }
    } catch (error) {
      console.log(`  Could not load queues: ${error.message}`);
    }

    // RULE-1: SNAP + expedited → snap-intake queue, expedited priority
    try {
      console.log('\n  RULE-1. Create SNAP+expedited task → snap-intake, priority=expedited');
      const response = await fetch(`${BASE_URL}${taskPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-rule-1' },
        body: JSON.stringify({ name: 'SNAP expedited task', status: 'pending', programType: 'snap', isExpedited: true })
      });

      if (response.status === 201) {
        const data = await response.json();
        snapTaskId = data.id;
        const issues = [];
        if (data.queueId !== snapIntakeQueueId) issues.push(`queueId=${data.queueId}, expected=${snapIntakeQueueId}`);
        if (data.priority !== 'expedited') issues.push(`priority=${data.priority}, expected=expedited`);

        if (issues.length === 0) {
          console.log('     ✓ PASS: SNAP task → snap-intake queue, expedited priority');
          totalPassed++;
        } else {
          console.log(`     ✗ FAIL: ${issues.join('; ')}`);
          totalFailed++;
        }
      } else {
        const err = await response.json();
        console.log(`     ✗ FAIL: Expected 201, got ${response.status}: ${JSON.stringify(err)}`);
        totalFailed++;
      }
      totalTests++;
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      totalFailed++;
      totalTests++;
    }

    // RULE-2: Non-SNAP → general-intake, priority=normal
    try {
      console.log('\n  RULE-2. Create non-SNAP task → general-intake, priority=normal');
      const response = await fetch(`${BASE_URL}${taskPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-rule-2' },
        body: JSON.stringify({ name: 'Medical Assistance task', status: 'pending', programType: 'medical_assistance', isExpedited: false })
      });

      if (response.status === 201) {
        const data = await response.json();
        const issues = [];
        if (data.queueId !== generalIntakeQueueId) issues.push(`queueId=${data.queueId}, expected=${generalIntakeQueueId}`);
        if (data.priority !== 'normal') issues.push(`priority=${data.priority}, expected=normal`);

        if (issues.length === 0) {
          console.log('     ✓ PASS: Non-SNAP task → general-intake queue, normal priority');
          totalPassed++;
        } else {
          console.log(`     ✗ FAIL: ${issues.join('; ')}`);
          totalFailed++;
        }
      } else {
        console.log(`     ✗ FAIL: Expected 201, got ${response.status}`);
        totalFailed++;
      }
      totalTests++;
    } catch (error) {
      console.log(`     ✗ FAIL: ${error.message}`);
      totalFailed++;
      totalTests++;
    }

    // RULE-3: Claim + release SNAP task → rules re-evaluated
    if (snapTaskId) {
      try {
        console.log('\n  RULE-3. Claim + release SNAP task → rules re-evaluated');
        await fetch(`${BASE_URL}${taskPath}/${snapTaskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-rule-1' }
        });
        const releaseRes = await fetch(`${BASE_URL}${taskPath}/${snapTaskId}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Caller-Id': 'worker-rule-1' },
          body: JSON.stringify({ reason: 'Testing rule re-evaluation' })
        });

        if (releaseRes.status === 200) {
          const data = await releaseRes.json();
          const issues = [];
          if (data.queueId !== snapIntakeQueueId) issues.push(`queueId=${data.queueId}, expected=${snapIntakeQueueId}`);
          if (data.priority !== 'expedited') issues.push(`priority=${data.priority}, expected=expedited`);
          if (data.status !== 'pending') issues.push(`status=${data.status}, expected=pending`);

          if (issues.length === 0) {
            console.log('     ✓ PASS: After release, queueId and priority re-evaluated correctly');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: ${issues.join('; ')}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Release returned ${releaseRes.status}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }

    // RULE-4: Verify "created" domain event from onCreate effects
    if (snapTaskId) {
      try {
        console.log('\n  RULE-4. Verify "created" domain event from onCreate effects');
        const listResponse = await fetch(`${BASE_URL}/events?q=resourceId:${snapTaskId}`);
        const listData = await listResponse.json();

        const createdEvents = listData.items?.filter(e => e.action === 'created') || [];
        if (createdEvents.length >= 1) {
          const event = createdEvents[0];
          if (event.resourceId === snapTaskId && event.occurredAt) {
            console.log('     ✓ PASS: "created" domain event exists with correct fields');
            totalPassed++;
          } else {
            console.log(`     ✗ FAIL: Domain event fields incorrect: ${JSON.stringify(event)}`);
            totalFailed++;
          }
        } else {
          console.log(`     ✗ FAIL: Expected "created" domain event, got ${createdEvents.length}`);
          totalFailed++;
        }
        totalTests++;
      } catch (error) {
        console.log(`     ✗ FAIL: ${error.message}`);
        totalFailed++;
        totalTests++;
      }
    }
  }

  // =========================================================================
  // Cross-API accessibility test
  // =========================================================================
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Cross-API Test: All APIs Accessible`);
  console.log('='.repeat(70));

  try {
    console.log(`\n  Testing all ${apis.length} API(s) are accessible...`);
    const results = await Promise.all(
      apis.map(api => fetch(`${BASE_URL}${api.baseResource || '/' + api.name}`))
    );

    const allOk = results.every(r => r.ok);
    if (allOk) {
      console.log(`  ✓ PASS: All ${apis.length} API(s) accessible`);
      apis.forEach((api, i) => {
        console.log(`    - ${api.baseResource || '/' + api.name}: ${results[i].status}`);
      });
      totalPassed++;
    } else {
      console.log(`  ✗ FAIL: Some APIs not accessible`);
      totalFailed++;
    }
    totalTests++;
  } catch (error) {
    console.log(`  ✗ FAIL: ${error.message}`);
    totalFailed++;
    totalTests++;
  }

  // =========================================================================
  // Postman/Newman tests
  // =========================================================================
  const postmanResults = await runPostmanTests();
  if (!postmanResults.skipped) {
    totalPassed += postmanResults.passed;
    totalFailed += postmanResults.failed;
    totalTests += postmanResults.total;
  }

  // =========================================================================
  // Summary and cleanup
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('Integration Test Summary');
  console.log('='.repeat(70));
  console.log(`APIs tested: ${apis.length}`);
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);

  await cleanup();

  if (totalFailed > 0) {
    console.log('\n❌ Some tests failed\n');
    process.exit(1);
  } else {
    console.log('\n✓ All integration tests passed!\n');
  }
}

async function cleanup() {
  if (serverStartedByTests) {
    console.log('\n🧹 Stopping server...');
    await stopServer(false);
  }
  if (fixtureDir) {
    teardownFixtureDir(fixtureDir);
    fixtureDir = null;
  }
}

runTests().catch(async (error) => {
  console.error('Test runner error:', error);
  await cleanup();
  process.exit(1);
});
