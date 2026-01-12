/**
 * Dynamic Integration Tests for Mock Server
 * 
 * Auto-discovers all APIs and runs generic CRUD tests against each.
 * Tests adapt to each API's schema and examples automatically.
 * 
 * Run with: npm run test:integration
 */

import http from 'http';
import { URL } from 'url';
import { startMockServer, stopServer, isServerRunning } from '../../scripts/server.js';
import { discoverApiSpecs } from '@safety-net/schemas/loader';
import { clearAll } from '../../src/database-manager.js';
import { seedDatabase } from '../../src/seeder.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import newman from 'newman';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'http://localhost:1080';
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
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const response = {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          json: async () => JSON.parse(data),
          text: async () => data
        };
        resolve(response);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (options.body) {
      const bodyString = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(bodyString);
    }

    req.end();
  });
}

/**
 * Load examples for an API
 */
function loadExamples(apiName) {
  try {
    const examplesPath = join(__dirname, '../../../openapi/examples', `${apiName}.yaml`);
    const content = readFileSync(examplesPath, 'utf8');
    const examples = yaml.load(content) || {};
    
    // Extract individual resource examples (skip list examples)
    return Object.entries(examples)
      .filter(([key, value]) => {
        if (!value || typeof value !== 'object') return false;
        if (value.items && Array.isArray(value.items)) return false; // Skip list examples
        if (key.toLowerCase().includes('payload') || key.toLowerCase().includes('list')) return false;
        return value.id; // Only resources with IDs
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
  const apiPath = `/${apiName}`;
  const singularName = singularize(apiName);
  const idParam = `${singularName}Id`;
  
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
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
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
  
  // Test 7: PATCH - Update resource (use existing example or created resource)
  const updateTargetId = createdResourceId || (examples.length > 0 ? examples[0].data.id : null);
  if (updateTargetId) {
    try {
      console.log(`\n  7. PATCH ${apiPath}/{id} (update)`);
      
      // Find a numeric field to update
      const exampleData = createdResourceId 
        ? createPostPayload(examples[0].data)
        : examples[0].data;
      
      const numericField = Object.keys(exampleData).find(key => 
        typeof exampleData[key] === 'number' && !['id'].includes(key)
      );
      
      const updatePayload = numericField 
        ? { [numericField]: exampleData[numericField] + 100 }
        : { updatedAt: new Date().toISOString() }; // Fallback update
      
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
  
  // Test 9: Search (if examples exist and have searchable fields)
  if (examples.length > 0) {
    try {
      console.log(`\n  9. GET ${apiPath}?search=... (search)`);
      
      // Try to find a searchable string field
      const exampleData = examples[0].data;
      let searchValue = null;
      
      // Look for common searchable fields
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
 * Run Postman collection tests using Newman
 */
async function runPostmanTests() {
  const collectionPath = join(__dirname, '../../../clients/generated/postman-collection.json');

  console.log(`\n${'='.repeat(70)}`);
  console.log('Postman Collection Tests (Newman)');
  console.log('='.repeat(70));

  if (!existsSync(collectionPath)) {
    console.log('\n  ⚠️  Postman collection not found. Run "npm run postman:generate" first.');
    console.log(`     Expected: ${collectionPath}`);
    return { passed: 0, failed: 0, total: 0, skipped: true };
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

      if (failed === 0) {
        console.log(`  ✓ PASS: All Postman requests succeeded`);
      } else {
        console.log(`  ✗ FAIL: ${failed} request(s) failed`);
      }

      resolve({
        passed: failed === 0 ? 1 : 0,
        failed: failed > 0 ? 1 : 0,
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
  console.log('Dynamic Integration Tests - Auto-Discovery\n');
  console.log('='.repeat(70));
  
  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;
  
  // Start server if needed
  try {
    console.log('\n🔍 Checking if mock server is running...');
    const isRunning = await isServerRunning();
    
    if (isRunning) {
      console.log('  ✓ Mock server already running');
    } else {
      console.log('  ⚠️  Mock server not running, starting it now...\n');
      await startMockServer();
      serverStartedByTests = true;
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('  ✓ Mock server started successfully');
    }
  } catch (error) {
    console.log(`  ✗ FAIL: Cannot start server`);
    console.log(`    Error: ${error.message}`);
    process.exit(1);
  }
  
  // Discover all APIs
  console.log('\n🔍 Discovering APIs...');
  const apis = discoverApiSpecs();
  
  if (apis.length === 0) {
    console.log('  ⚠️  No APIs found');
    process.exit(0);
  }
  
  console.log(`  ✓ Found ${apis.length} API(s):`);
  apis.forEach(api => console.log(`    - ${api.name}`));
  
  // Reset databases with fresh data
  console.log('\n🔄 Resetting databases with clean example data...');
  for (const api of apis) {
    try {
      clearAll(api.name);
      const count = seedDatabase(api.name);
      console.log(`  ✓ ${api.name}: ${count} resources`);
    } catch (error) {
      console.log(`  ⚠️  ${api.name}: ${error.message}`);
    }
  }
  console.log('  ✓ All databases reset');
  
  // Test each API
  for (const api of apis) {
    const examples = loadExamples(api.name);
    const results = await testApi(api, examples);
    
    totalPassed += results.passed;
    totalFailed += results.failed;
    totalTests += results.total;
  }
  
  // Multi-API test: Verify all APIs are accessible
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Cross-API Test: All APIs Accessible`);
  console.log('='.repeat(70));

  try {
    console.log(`\n  Testing all ${apis.length} API(s) are accessible...`);
    const results = await Promise.all(
      apis.map(api => fetch(`${BASE_URL}/${api.name}`))
    );

    const allOk = results.every(r => r.ok);
    if (allOk) {
      console.log(`  ✓ PASS: All ${apis.length} API(s) accessible`);
      apis.forEach((api, i) => {
        console.log(`    - /${api.name}: ${results[i].status}`);
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

  // Postman collection tests
  const postmanResults = await runPostmanTests();
  if (!postmanResults.skipped) {
    totalPassed += postmanResults.passed;
    totalFailed += postmanResults.failed;
    totalTests += postmanResults.total;
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('Integration Test Summary');
  console.log('='.repeat(70));
  console.log(`APIs tested: ${apis.length}`);
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  
  // Cleanup
  if (serverStartedByTests) {
    console.log('\n🧹 Cleaning up (stopping server started by tests)...\n');
    await stopServer(false);
  }
  
  if (totalFailed > 0) {
    console.log('\n❌ Some tests failed\n');
    process.exit(1);
  } else {
    console.log('\n✓ All integration tests passed!\n');
  }
}

runTests().catch(async (error) => {
  console.error('Test runner error:', error);
  
  if (serverStartedByTests) {
    console.log('\n🧹 Cleaning up (stopping server started by tests)...\n');
    await stopServer(false);
  }
  
  process.exit(1);
});
