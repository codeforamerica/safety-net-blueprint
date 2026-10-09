/**
 * The platform routes, and the contract overrides.
 *
 * These exist so a browser gets the same control surface a Node process has —
 * stubs, event injection, reset, reseed (#448). The case worth having is the
 * drift one: an override is matched by `operationId`, and nothing fails loudly
 * if the contract stops declaring it, because a smaller contract set is
 * legitimate. So this asserts against the real set.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { discover, load } from '@codeforamerica/blueprint-core';
import { createMemoryStore } from '../../src/stores/memory-store.js';
import { registerPlatformRoutes, contractOverrides } from '../../src/platform-routes.js';
import { registerAllRoutes } from '../../src/route-generator.js';
import { overrideByOperationId, createDispatcher } from '../../src/http/route-table.js';
import { loadAllSpecs } from '../../src/spec-discovery.js';

const contractsArg = process.argv.find((a) => a.startsWith('--contracts='));
const contractsDir = contractsArg?.slice('--contracts='.length);

const quiet = async (fn) => {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
};

function platformTable(store) {
  const routes = new Map();
  registerPlatformRoutes(routes, {
    store,
    apiNames: ['intake'],
    readDocs: () => [],
    configs: [],
    policies: {},
    seeded: false,
  });
  return routes;
}

test('Platform routes', async (t) => {

  await t.test('registers the control surface a page needs', () => {
    const routes = platformTable(createMemoryStore());
    for (const key of [
      'GET /health',
      'POST /mock/stubs/events', 'GET /mock/stubs/events', 'DELETE /mock/stubs/events',
      'DELETE /mock/stubs/events/{id}',
      'POST /mock/stubs/http', 'GET /mock/stubs/http', 'DELETE /mock/stubs/http',
      'DELETE /mock/stubs/http/{id}',
      'POST /mock/reset', 'POST /mock/reseed',
    ]) {
      assert.ok(routes.has(key), `${key} should be registered`);
    }
  });

  await t.test('stubs can be registered, listed and cleared through the routes', async () => {
    const routes = platformTable(createMemoryStore());
    const fetch = createDispatcher(routes);
    const stub = { on: 'thing.happened', response: { type: 'test.other' } };

    const created = await fetch(new Request('http://x/mock/stubs/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stub),
    }));
    assert.strictEqual(created.status, 201);

    const listed = await (await fetch(new Request('http://x/mock/stubs/events'))).json();
    assert.strictEqual(listed.total, 1, 'the stub is listed');

    assert.strictEqual((await fetch(new Request('http://x/mock/stubs/events', { method: 'DELETE' }))).status, 204);
    const empty = await (await fetch(new Request('http://x/mock/stubs/events'))).json();
    assert.strictEqual(empty.total, 0, 'cleared');
  });

  await t.test('reseed reads its documents from the injected supplier', async () => {
    // The point of taking a function: Node re-reads the directory, a page
    // returns the artifact's documents. Neither branches inside the handler.
    let calls = 0;
    const routes = new Map();
    registerPlatformRoutes(routes, {
      store: createMemoryStore(),
      readDocs: () => { calls += 1; return []; },
      seeded: true,
    });
    await quiet(() => createDispatcher(routes)(new Request('http://x/mock/reseed', { method: 'POST' })));
    assert.strictEqual(calls, 1, 'reseed asked the supplier for documents');
  });

  await t.test('every contract override still matches a declared operationId', async (tt) => {
    // The drift case. `overrideByOperationId` only warns when an override
    // matches nothing, because a contract set with no platform domain is
    // legitimate — so the real set is checked here instead.
    if (!contractsDir) {
      tt.skip('needs --contracts=<dir>');
      return;
    }
    const store = createMemoryStore();
    const routes = new Map();
    const specs = await quiet(() => loadAllSpecs({ specsDir: contractsDir }));
    await quiet(() => registerAllRoutes(routes, specs, 'http://x', [], [], [], { store }));

    const overrides = contractOverrides({ store });
    const { applied, unmatched } = overrideByOperationId(routes, overrides);

    assert.deepStrictEqual(unmatched, [],
      'every override must name an operationId the contract set declares');
    assert.strictEqual(applied.length, Object.keys(overrides).length);
  });

  await t.test('the overridden stream route answers as an event stream', async (tt) => {
    if (!contractsDir) {
      tt.skip('needs --contracts=<dir>');
      return;
    }
    const store = createMemoryStore();
    const routes = new Map();
    const specs = await quiet(() => loadAllSpecs({ specsDir: contractsDir }));
    await quiet(() => registerAllRoutes(routes, specs, 'http://x', [], [], [], { store }));
    overrideByOperationId(routes, contractOverrides({ store }));

    const controller = new AbortController();
    const response = await createDispatcher(routes)(
      new Request('http://x/platform/events/stream', { signal: controller.signal })
    );

    assert.strictEqual(response.headers.get('Content-Type'), 'text/event-stream',
      'the generated list handler would have returned JSON');
    controller.abort();
    await response.body?.cancel().catch(() => {});
  });
});
