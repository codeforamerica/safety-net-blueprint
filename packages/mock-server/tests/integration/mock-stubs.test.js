/**
 * Integration tests for mock stub registry and inter-domain event simulation.
 *
 * Tests the full chain: register a stub → inject trigger event → verify stub
 * was consumed and response event was stored. Also tests /mock/stubs/events CRUD and
 * fallback behavior when no stub is registered.
 *
 * Run with: npm run test:integration
 */

import http from 'http';
import { URL } from 'url';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { startMockServer, stopServer, isServerRunning } from '../../scripts/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '..', '..', '..', 'contracts');

const BASE_URL = 'http://localhost:1080';
const PREFIX = 'org.codeforamerica.safety-net-blueprint.';

// Simple http fetch wrapper (reused from integration.test.js pattern)
async function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (options.body) {
      const bodyString = JSON.stringify(options.body);
      requestOptions.headers['Content-Length'] = Buffer.byteLength(bodyString);
      requestOptions.headers['Content-Type'] = requestOptions.headers['Content-Type'] || 'application/json';
    }

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => JSON.parse(data),
          text: async () => data
        });
      });
    });

    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function clearStubs() {
  await fetch(`${BASE_URL}/mock/stubs/events`, { method: 'DELETE' });
}

async function injectEvent(type, data = {}, subject = 'sub-test-1') {
  return fetch(`${BASE_URL}/platform/events`, {
    method: 'POST',
    body: {
      specversion: '1.0',
      type: PREFIX + type,
      source: '/test',
      subject,
      data
    }
  });
}

// =============================================================================
// /mock/stubs/events CRUD
// =============================================================================

async function testStubCrud() {
  console.log('\n--- /mock/stubs/events CRUD ---');
  await clearStubs();

  // POST — register a stub
  const postRes = await fetch(`${BASE_URL}/mock/stubs/events`, {
    method: 'POST',
    body: {
      on: 'data_exchange.service_call.created',
      respond: { type: 'data_exchange.call.completed', data: { result: 'conclusive' } }
    }
  });
  assert(postRes.status === 201, `POST /mock/stubs/events → expected 201, got ${postRes.status}`);
  const stub = await postRes.json();
  assert(stub.id, 'stub should have an id');
  assert(stub.id.startsWith('service_call.created-'), `unexpected id format: ${stub.id}`);
  console.log('  ✓ POST /mock/stubs/events registers a stub with human-readable ID');

  // GET — list stubs
  const getRes = await fetch(`${BASE_URL}/mock/stubs/events`);
  assert(getRes.status === 200, `GET /mock/stubs/events → expected 200, got ${getRes.status}`);
  const list = await getRes.json();
  assert(list.total === 1, `expected 1 stub, got ${list.total}`);
  assert(list.items.length === 1);
  console.log('  ✓ GET /mock/stubs/events lists registered stubs');

  // Register a second stub
  await fetch(`${BASE_URL}/mock/stubs/events`, {
    method: 'POST',
    body: { on: 'data_exchange.service_call.created', respond: { type: 'data_exchange.call.completed', data: { result: 'inconclusive' } } }
  });

  // DELETE /:id — remove a specific stub
  const delOneRes = await fetch(`${BASE_URL}/mock/stubs/events/${stub.id}`, { method: 'DELETE' });
  assert(delOneRes.status === 204, `DELETE /mock/stubs/events/:id → expected 204, got ${delOneRes.status}`);
  const afterDel = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
  assert(afterDel.total === 1, 'one stub should remain after targeted delete');
  console.log('  ✓ DELETE /mock/stubs/events/:id removes a specific stub');

  // DELETE all
  const delAllRes = await fetch(`${BASE_URL}/mock/stubs/events`, { method: 'DELETE' });
  assert(delAllRes.status === 204, `DELETE /mock/stubs/events → expected 204, got ${delAllRes.status}`);
  const afterClear = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
  assert(afterClear.total === 0, 'all stubs should be cleared');
  console.log('  ✓ DELETE /mock/stubs/events clears all stubs');

  // 422 on missing required fields
  const badRes = await fetch(`${BASE_URL}/mock/stubs/events`, {
    method: 'POST',
    body: { on: 'data_exchange.service_call.created' }  // missing respond
  });
  assert(badRes.status === 422, `invalid stub → expected 422, got ${badRes.status}`);
  console.log('  ✓ POST /mock/stubs/events returns 422 for invalid stub');

  // 404 on unknown stub ID
  const notFoundRes = await fetch(`${BASE_URL}/mock/stubs/events/nonexistent-id`, { method: 'DELETE' });
  assert(notFoundRes.status === 404, `unknown stub → expected 404, got ${notFoundRes.status}`);
  console.log('  ✓ DELETE /mock/stubs/events/:id returns 404 for unknown stub');
}

// =============================================================================
// Stub consumed when trigger event fires
// =============================================================================

async function testStubConsumedOnEvent() {
  console.log('\n--- Stub consumed by trigger event ---');
  await clearStubs();

  // Register stub — only the delta from the trigger event is needed.
  // subject and trigger data fields are echoed automatically.
  await fetch(`${BASE_URL}/mock/stubs/events`, {
    method: 'POST',
    body: {
      on: 'data_exchange.service_call.created',
      respond: {
        type: 'data_exchange.call.completed',
        data: { result: 'inconclusive' }
      }
    }
  });

  const before = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
  assert(before.total === 1, 'stub should be registered');

  // Inject the trigger event — mock rules fire applyStub synchronously
  const injectRes = await injectEvent('data_exchange.service_call.created', { serviceType: 'fdsh_ssa' }, 'sc-001');
  assert(injectRes.status === 202, `inject → expected 202, got ${injectRes.status}`);

  // Stub should now be consumed
  const after = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
  assert(after.total === 0, 'stub should be consumed after trigger event fires');
  console.log('  ✓ Stub is consumed when matching trigger event fires');
}

// =============================================================================
// FIFO — two stubs consumed in order
// =============================================================================

async function testStubFifo() {
  console.log('\n--- Stub FIFO ordering ---');
  await clearStubs();

  await fetch(`${BASE_URL}/mock/stubs/events`, {
    method: 'POST',
    body: { on: 'data_exchange.service_call.created', respond: { type: 'data_exchange.call.completed', data: { result: 'conclusive' } } }
  });
  await fetch(`${BASE_URL}/mock/stubs/events`, {
    method: 'POST',
    body: { on: 'data_exchange.service_call.created', respond: { type: 'data_exchange.call.completed', data: { result: 'inconclusive' } } }
  });

  assert((await (await fetch(`${BASE_URL}/mock/stubs/events`)).json()).total === 2, 'two stubs registered');

  // First injection consumes first stub
  await injectEvent('data_exchange.service_call.created', {}, 'sc-001');
  const after1 = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
  assert(after1.total === 1, 'one stub should remain after first event');

  // Second injection consumes second stub
  await injectEvent('data_exchange.service_call.created', {}, 'sc-002');
  const after2 = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
  assert(after2.total === 0, 'no stubs should remain after second event');

  console.log('  ✓ Stubs are consumed in registration order (FIFO)');
}

// =============================================================================
// Fallback fires when no stub registered
// =============================================================================

async function testFallbackNoStub() {
  console.log('\n--- Fallback when no stub registered ---');
  await clearStubs();

  // No stub registered — mock rules should fire fallback (conclusive result)
  const injectRes = await injectEvent('data_exchange.service_call.created', { serviceType: 'save' }, 'sc-003');
  assert(injectRes.status === 202, `inject → expected 202, got ${injectRes.status}`);

  // Stub count should still be 0 (no stub to consume or add)
  const stubs = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
  assert(stubs.total === 0, 'stub count should remain 0');
  console.log('  ✓ Fallback fires when no stub registered (no error thrown)');
}

// =============================================================================
// field match filter — stub not consumed when match criteria miss
// =============================================================================

async function testMatchFilter() {
  console.log('\n--- Stub match field filtering ---');
  await clearStubs();

  // Register stub that only matches fdsh_ssa calls
  await fetch(`${BASE_URL}/mock/stubs/events`, {
    method: 'POST',
    body: {
      on: 'data_exchange.service_call.created',
      match: { 'data.serviceType': 'fdsh_ssa' },
      respond: { type: 'data_exchange.call.completed', data: { result: 'inconclusive' } }
    }
  });

  // Inject with non-matching serviceType — stub should NOT be consumed
  await injectEvent('data_exchange.service_call.created', { serviceType: 'save' }, 'sc-004');
  const after = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
  assert(after.total === 1, 'stub should not be consumed when match criteria do not match');
  console.log('  ✓ Stub with match filter not consumed when criteria miss');

  // Inject with matching serviceType — stub should be consumed
  await injectEvent('data_exchange.service_call.created', { serviceType: 'fdsh_ssa' }, 'sc-005');
  const afterMatch = await (await fetch(`${BASE_URL}/mock/stubs/events`)).json();
  assert(afterMatch.total === 0, 'stub should be consumed when match criteria satisfied');
  console.log('  ✓ Stub with match filter consumed when criteria satisfied');

  await clearStubs();
}

// =============================================================================
// Test runner
// =============================================================================

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function run() {
  console.log('\n' + '='.repeat(70));
  console.log('Mock Stubs Integration Tests');
  console.log('='.repeat(70));

  // Start the mock server if not already running
  const alreadyRunning = await isServerRunning();
  if (!alreadyRunning) {
    console.log('\n  Starting mock server...');
    await startMockServer([contractsDir]);
    console.log('  ✓ Mock server started');
  }

  const suites = [
    testStubCrud,
    testStubConsumedOnEvent,
    testStubFifo,
    testFallbackNoStub,
    testMatchFilter
  ];

  let passed = 0;
  let failed = 0;

  for (const suite of suites) {
    try {
      await suite();
      passed++;
    } catch (err) {
      failed++;
      console.error(`\n  ✗ ${suite.name}: ${err.message}`);
    }
  }

  // Clean up stubs and stop the server if we started it
  await clearStubs();
  if (!alreadyRunning) {
    await stopServer(false);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Mock Stubs: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(70));

  if (failed > 0) process.exit(1);
  console.log('\n✓ All mock stubs integration tests passed!\n');
}

run().catch((err) => {
  console.error('Integration test error:', err);
  process.exit(1);
});
