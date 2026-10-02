#!/usr/bin/env node
/**
 * Mock API Server
 * Dynamic Express server that automatically discovers and serves OpenAPI specifications
 */

import http from 'http';
import { execSync, spawn } from 'child_process';
import { realpathSync, openSync, statSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { performSetup } from '../src/setup.js';
import { subscribeStubDispatch } from '../src/mock-stub-engine.js';
import { createMemoryStore } from '../src/stores/memory-store.js';
import { createSqliteStore } from '../src/stores/sqlite-store.js';
import { registerAllRoutes, registerStateMachineRoutes, registerCompositionRoutes, registerRulesRoutes, buildRulesIndex } from '../src/route-generator.js';
import { addRoute, createDispatcher, wrapRoute } from '../src/http/route-table.js';
import { jsonBody, readJsonBody, invalidJson } from '../src/http/request.js';
import { createNodeServer } from '../src/http/node-server.js';
import { initRulesIndex } from '../src/state-machine-engine.js';
import { registerEventSubscriptions } from '../src/event-subscription.js';
import { seedAllDatabases } from '../src/seeder.js';
import { createSseHandler } from '../src/handlers/sse-handler.js';
import { emitEventEnvelope } from '../src/emit-event.js';
import { registerStub, registerHttpStub, listStubs, listHttpStubs, removeStub, removeHttpStub, clearStubs, clearHttpStubs, clearAllStubs } from '../src/mock-stub-engine.js';
import { registerConfigManaged } from '../src/config-registry.js';

const HOST = process.env.MOCK_SERVER_HOST || 'localhost';
const PORT = parseInt(process.env.MOCK_SERVER_PORT || '1080', 10);

function showHelp() {
  console.log(`
Mock API Server

Dynamic Express server that discovers and serves OpenAPI specifications.

Usage:
  npm run mock:start [-- --spec=<dir> ...]

Options:
  --spec=<dir>      File or directory containing *-openapi.yaml files (repeatable)
                    Default: packages/contracts
  --seed=<dir>      Directory containing seed data files (default: same as --spec)
                    Override with MOCK_UPLOADS_DIR env var
  --store=<kind>    Where resources are held: sqlite (default) or memory
                    sqlite keeps one .db file per collection, so data survives a
                    restart and can be inspected with the sqlite3 CLI. memory
                    holds nothing after the process exits — faster, and the same
                    store the browser build uses. Note that --detach --store=memory
                    gives a background server whose data disappears with it.
                    Override with MOCK_STORE env var
  --detach          Start server in the background (logs to mock-server.log)
  --log=<path>      Log file or directory for --detach output (default: spec dir)
  --stop            Stop the running mock server
  -h, --help        Show this help message

Environment:
  MOCK_SERVER_HOST    Host to bind to (default: localhost)
  MOCK_SERVER_PORT    Port to listen on (default: 1080)
  MOCK_STORE          sqlite | memory (takes precedence over --store)

Examples:
  npm run mock:start
  npm run mock:start -- --spec=packages/contracts/resolved
  npm run mock:start -- --spec=packages/contracts --spec=/tmp/my-specs
`);
}

function parseSpecDirs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a =>
    a !== '--help' && a !== '-h' &&
    a !== '--detach' && a !== '--stop' &&
    !a.startsWith('--spec=') && !a.startsWith('--seed=') &&
    !a.startsWith('--log=') && !a.startsWith('--store=')
  );
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const specDirs = args
    .filter(a => a.startsWith('--spec='))
    .map(a => resolve(a.split('=')[1]));
  // No default. The previous fallback pointed at packages/contracts, which was
  // renamed long ago, so omitting --spec failed later and obscurely with an
  // empty contract set rather than saying what was missing.
  if (specDirs.length === 0) {
    console.error('Error: --spec=<dir> is required (a directory of resolved contracts)');
    process.exit(1);
  }

  const seedArg = args.find(a => a.startsWith('--seed='));
  const seedDir = seedArg ? resolve(seedArg.split('=')[1]) : null;


  const storeArg = args.find(a => a.startsWith('--store='));
  const storeKind = process.env.MOCK_STORE || (storeArg ? storeArg.split('=')[1] : 'sqlite');
  if (storeKind !== 'sqlite' && storeKind !== 'memory') {
    console.error(`Error: --store must be 'sqlite' or 'memory', got '${storeKind}'`);
    process.exit(1);
  }

  return { specDirs, seedDir, storeKind };
}

let httpServer = null;
/** The store this process is using; closed on shutdown. */
let store = null;

/**
 * Start the mock server
 * @param {string[]|null} specDirs - Spec directories to load. Defaults to parseSpecDirs() (from process.argv).
 * @param {string|null} seedDir - Directory containing seed data files. Defaults to each specDir.
 * @param {'sqlite'|'memory'|null} storeKind - Where resources are held. Defaults to
 *   --store / MOCK_STORE, and to sqlite when neither is given.
 */
async function startMockServer(specDirs = null, seedDir = null, storeKind = null) {
  console.log('='.repeat(70));
  console.log('🚀 Starting Mock API Server');
  console.log('='.repeat(70));

  try {
    // Perform setup (load specs and seed databases) for each spec directory
    if (specDirs === null) {
      const parsed = parseSpecDirs();
      specDirs = parsed.specDirs;
      seedDir = seedDir ?? parsed.seedDir;
      storeKind = storeKind ?? parsed.storeKind;
    }

    // Resolved here as well as in parseSpecDirs, because a caller that passes
    // specDirs explicitly — the test runner does — skips that branch entirely,
    // so MOCK_STORE was being read only when the CLI parsed its own arguments.
    // The whole functional suite appeared to pass against the in-memory store
    // while silently running on SQLite.
    storeKind = process.env.MOCK_STORE || storeKind || 'sqlite';
    if (storeKind !== 'sqlite' && storeKind !== 'memory') {
      throw new Error(`Unknown store '${storeKind}' — expected 'sqlite' or 'memory'`);
    }

    // Choose the store before anything seeds or registers a route. SQLite
    // stays the default so `mock:start` behaves as it always has.
    store = storeKind === 'memory' ? createMemoryStore() : createSqliteStore();
    if (storeKind === 'memory') {
      console.log('  Store: in-memory (data will not survive this process)');
    }
    let apiSpecs = [];
    let allStateMachines = [];
    let allSlaTypes = [];
    let allMetrics = [];
    let allConfigs = [];
    let allCompositions = [];
    let allRulesFiles = [];
    let allGraphs = [];
    let allPolicies = {};
    for (const specsDir of specDirs) {
      const result = await performSetup({ specsDir, seedDir, verbose: true, store });
      apiSpecs = apiSpecs.concat(result.apiSpecs);
      allStateMachines = allStateMachines.concat(result.stateMachines);
      allSlaTypes = allSlaTypes.concat(result.slaTypes);
      allMetrics = allMetrics.concat(result.metrics);
      allConfigs = allConfigs.concat(result.configs || []);
      allCompositions = allCompositions.concat(result.compositions || []);
      allRulesFiles = allRulesFiles.concat(result.rulesFiles || []);
      allGraphs = allGraphs.concat(result.graphs || []);
      Object.assign(allPolicies, result.policies || {});
    }



    // One route table for the whole server. Registration order is priority:
    // addRoute keeps the first entry for a key, which is what Express's
    // first-match-wins resolution did.
    const routes = new Map();

    // Health check endpoint
    addRoute(routes, 'GET', '/health', () =>
      Response.json({ status: 'ok', apis: apiSpecs.map(a => a.name) }));

    // Register SSE stream endpoint before item routes to avoid :id capture
    addRoute(routes, 'GET', '/platform/events/stream', createSseHandler(),
      { description: 'Domain event stream (SSE)' });
    console.log('  GET    /platform/events/stream - Domain event stream (SSE)');

    // Register event injection endpoint — accepts a CloudEvents 1.0 envelope and
    // fires it to the event bus so event-triggered rule sets can respond to it.
    // Useful for simulating events from external domains during integration testing.
    addRoute(routes, 'POST', '/platform/events', async (request) => {
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return invalidJson();
      const event = parsed.value;
      if (!event?.type || !event?.specversion) {
        const missing = ['specversion', 'type'].filter(f => !event?.[f]);
        return Response.json({
          code: 'VALIDATION_ERROR',
          message: 'Request body must be a CloudEvents 1.0 envelope',
          details: missing.map(f => ({ field: f, message: 'required' }))
        }, { status: 422 });
      }
      return Response.json(emitEventEnvelope(event, store), { status: 201 });
    });
    console.log('  POST   /platform/events - Inject external domain event (testing)');

    // Event stub registry — pre-program event responses for integration tests.
    addRoute(routes, 'POST', '/mock/stubs/events', async (request) => {
      try {
        return Response.json(registerStub(await jsonBody(request)), { status: 201 });
      } catch (err) {
        return Response.json({ code: 'VALIDATION_ERROR', message: err.message }, { status: 422 });
      }
    });
    addRoute(routes, 'GET', '/mock/stubs/events', () => {
      const items = listStubs();
      return Response.json({ items, total: items.length });
    });
    addRoute(routes, 'DELETE', '/mock/stubs/events', () => {
      clearStubs();
      return new Response(null, { status: 204 });
    });
    addRoute(routes, 'DELETE', '/mock/stubs/events/{id}', (request, { params }) =>
      removeStub(params.id)
        ? new Response(null, { status: 204 })
        : Response.json({ code: 'NOT_FOUND', message: `Stub "${params.id}" not found` }, { status: 404 }));
    console.log('  POST   /mock/stubs/events - Register an event stub');
    console.log('  GET    /mock/stubs/events - List active event stubs');
    console.log('  DELETE /mock/stubs/events/:id - Remove an event stub');
    console.log('  DELETE /mock/stubs/events - Clear all event stubs');

    // HTTP stub registry — intercept any inbound request and return a pre-programmed response.
    addRoute(routes, 'POST', '/mock/stubs/http', async (request) => {
      try {
        return Response.json(registerHttpStub(await jsonBody(request)), { status: 201 });
      } catch (err) {
        return Response.json({ code: 'VALIDATION_ERROR', message: err.message }, { status: 422 });
      }
    });
    addRoute(routes, 'GET', '/mock/stubs/http', () => {
      const items = listHttpStubs();
      return Response.json({ items, total: items.length });
    });
    addRoute(routes, 'DELETE', '/mock/stubs/http', () => {
      clearHttpStubs();
      return new Response(null, { status: 204 });
    });
    addRoute(routes, 'DELETE', '/mock/stubs/http/{id}', (request, { params }) =>
      removeHttpStub(params.id)
        ? new Response(null, { status: 204 })
        : Response.json({ code: 'NOT_FOUND', message: `Stub "${params.id}" not found` }, { status: 404 }));
    console.log('  POST   /mock/stubs/http - Register an HTTP stub');
    console.log('  GET    /mock/stubs/http - List active HTTP stubs');
    console.log('  DELETE /mock/stubs/http/:id - Remove an HTTP stub');
    console.log('  DELETE /mock/stubs/http - Clear all HTTP stubs');

    // Reset endpoint — clears all runtime data and restores config-managed resources.
    // Config-managed items (queues, services, document types) are restored; all other
    // data is wiped. Useful for putting tests into a known-clean state without restarting.
    addRoute(routes, 'POST', '/mock/reset', () => {
      for (const collection of Object.keys(store.snapshot())) store.clearAll(collection);
      clearAllStubs();
      for (const config of allConfigs) {
        for (const [catalogKey, entries] of Object.entries(config.catalogs)) {
          for (const entry of entries) {
            const data = { ...entry };
            for (const key of Object.keys(data)) {
              if (key.startsWith('x-')) delete data[key];
            }
            store.insertResource(catalogKey, { ...data, source: 'system' });
            registerConfigManaged(catalogKey, data.id);
          }
        }
      }
      for (const [id, policy] of Object.entries(allPolicies)) {
        store.insertResource('registry-policies', { id, ...policy, source: 'system' });
        registerConfigManaged('registry-policies', id);
      }
      return new Response(null, { status: 204 });
    });
    console.log('  POST   /mock/reset - Reset all runtime data (keeps config-managed resources)');

    // Reseed endpoint — re-inserts seed data without clearing anything else.
    // Useful after a reset when tests need baseline data present.
    addRoute(routes, 'POST', '/mock/reseed', () => {
      seedAllDatabases(specDirs, seedDir, store);
      return new Response(null, { status: 204 });
    });
    console.log('  POST   /mock/reseed - Re-seed all collections from seed files');


    // Register event subscriptions
    registerEventSubscriptions(allStateMachines, allSlaTypes, apiSpecs, store);

    // Stub dispatch is subscribed here rather than on import, since firing a
    // stub emits an event and emitting writes through a store.
    subscribeStubDispatch(store);

    // Register API routes dynamically
    const baseUrl = `http://${HOST}:${PORT}`;
    if (allCompositions.length > 0) {
      console.log('\nRegistering composition routes...');
      registerCompositionRoutes(routes, allCompositions, apiSpecs, { store });
    }

    // Register rules evaluation routes and initialize the state machine rules index
    if (allRulesFiles.length > 0) {
      console.log('\nRegistering rules evaluation routes...');
      registerRulesRoutes(routes, allRulesFiles, apiSpecs, allGraphs);
      initRulesIndex(buildRulesIndex(allGraphs));
    }

    const allEndpoints = registerAllRoutes(routes, apiSpecs, baseUrl, allStateMachines, allSlaTypes, allMetrics, { store });

    // Register state machine RPC routes
    const rpcEndpoints = registerStateMachineRoutes(routes, allStateMachines, apiSpecs, allSlaTypes, { store });

    // Service-call creation is enriched with catalog-derived fields: serviceType
    // and callMode come from the referenced ExternalService, and status starts
    // pending. They are server-derived rather than client-provided, so they are
    // passed around the request schema rather than through it.
    //
    // This was Express middleware. It is route-level composition now — wrapping
    // one table entry instead of matching a path prefix — which is both more
    // precise and the same mechanism #283 uses to substitute a real endpoint.
    wrapRoute(routes, 'POST /data-exchange/service-calls', (next) => async (request, ctx) => {
      const body = await jsonBody(request);
      const service = body?.serviceId ? store.findById('services', body.serviceId) : null;
      // The body is already read, so it is handed on through ctx — a Request
      // body cannot be read twice.
      return next(request, {
        ...ctx,
        body,
        enrichmentData: service && {
          serviceType: service.serviceType,
          callMode: body.callMode ?? service.defaultCallMode,
          status: 'pending',
        },
      });
    });

    // The route table is the server. 404 and unhandled-throw live in the
    // dispatcher, so there are no trailing middleware layers to fall through to.
    const server = createNodeServer(createDispatcher(routes));

    // Start the server — if the port is in use, kill the existing process and retry once.
    await new Promise((resolve, reject) => {
      httpServer = server.listen(PORT, HOST, () => {
        console.log('\n' + '='.repeat(70));
        console.log('✓ Mock API Server Started Successfully!');
        console.log('='.repeat(70));
        console.log(`\n📡 Mock Server:    http://${HOST}:${PORT}`);
        console.log(`❤️  Health Check:   http://${HOST}:${PORT}/health`);
        resolve();
      });
      httpServer.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`\nPort ${PORT} is already in use — killing existing process and retrying...`);
          try {
            execSync(`npx kill-port ${PORT}`, { stdio: 'ignore' });
          } catch { /* ignore if nothing to kill */ }
          httpServer = server.listen(PORT, HOST, () => {
            console.log('\n' + '='.repeat(70));
            console.log('✓ Mock API Server Started Successfully!');
            console.log('='.repeat(70));
            console.log(`\n📡 Mock Server:    http://${HOST}:${PORT}`);
            console.log(`❤️  Health Check:   http://${HOST}:${PORT}/health`);
            resolve();
          });
          httpServer.once('error', reject);
        } else {
          reject(err);
        }
      });
    });

    // Display available endpoints
    console.log('\n' + '='.repeat(70));
    console.log('Available Endpoints:');
    console.log('='.repeat(70));

    for (const api of allEndpoints) {
      console.log(`\n${api.title}:`);

      // Group by method
      const byMethod = {};
      for (const endpoint of api.endpoints) {
        if (!byMethod[endpoint.method]) {
          byMethod[endpoint.method] = [];
        }
        byMethod[endpoint.method].push(endpoint);
      }

      // Display in order: GET, POST, PATCH, DELETE
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        if (byMethod[method]) {
          for (const endpoint of byMethod[method]) {
            console.log(`  ${endpoint.method.padEnd(6)} http://${HOST}:${PORT}${endpoint.path}`);
          }
        }
      }
    }

    // Display RPC endpoints (state machine transitions)
    if (rpcEndpoints.length > 0) {
      console.log(`\nState Machine RPC Endpoints:`);
      for (const ep of rpcEndpoints) {
        console.log(`  ${ep.method.padEnd(6)} http://${HOST}:${PORT}${ep.path} - ${ep.description}`);
      }
    }

    // Example curl commands
    console.log('\n' + '='.repeat(70));
    console.log('Example Commands:');
    console.log('='.repeat(70));

    for (const api of allEndpoints) {
      const listEndpoint = api.endpoints.find(e => e.method === 'GET' && !e.path.includes('{'));
      if (listEndpoint) {
        console.log(`  curl http://${HOST}:${PORT}${listEndpoint.path}`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n✓ Server ready to accept requests!\n');

    // The live route table. Returned so a caller can substitute an endpoint —
    // `routes.get('GET /x').handler = fetch` — which is what #283 needs and is
    // the reason handlers have `fetch`'s signature.
    return { routes };

  } catch (error) {
    console.error('\n❌ Failed to start mock server:', error.message);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Stop the server gracefully
 */
async function stopServer(exitProcess = true) {
  console.log('\n\nStopping server...');

  try {
    // Close databases
    store?.close();
    console.log('✓ Databases closed');

    // Stop Express server
    if (httpServer) {
      return new Promise((resolve) => {
        httpServer.close(() => {
          console.log('✓ Mock server stopped');
          httpServer = null;
          resolve();
        });
        // Force-close all open connections so the port is released immediately.
        // Without this, keep-alive connections delay the 'close' event and leave
        // the port bound, causing EADDRINUSE on the next startMockServer call.
        httpServer.closeAllConnections?.();
      });
    }
  } catch (error) {
    console.error('Error stopping server:', error);
  }

  if (exitProcess) {
    process.exit(0);
  }
}

/**
 * Check if server is already running on the specified port
 */
async function isServerRunning(host = HOST, port = PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/`, (res) => {
      resolve(true);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.end();
  });
}

// Export for programmatic use
export { startMockServer, stopServer, isServerRunning };

// Only auto-start if run directly (not imported)
const entryUrl = process.argv[1] ? String(new URL(`file://${realpathSync(process.argv[1])}`)) : '';
if (import.meta.url === entryUrl) {
  const args = process.argv.slice(2);

  if (args.includes('--stop')) {
    try {
      execSync(`npx kill-port ${PORT}`, { stdio: 'inherit' });
      console.log(`Mock server stopped (port ${PORT}).`);
    } catch {
      console.log(`No process running on port ${PORT}.`);
    }
  } else if (args.includes('--detach')) {
    // Re-spawn this script without --detach, fully detached
    const logArg = args.find(a => a.startsWith('--log='))?.split('=')[1];
    const forwardArgs = args.filter(a => a !== '--detach' && !a.startsWith('--log='));
    let logFile;
    if (logArg) {
      const logResolved = resolve(logArg);
      try { logFile = statSync(logResolved).isDirectory() ? resolve(logResolved, 'mock-server.log') : logResolved; }
      catch { logFile = logResolved; }
    } else {
      const specDir = args.find(a => a.startsWith('--spec='))?.split('=')[1] || process.cwd();
      logFile = resolve(specDir, 'mock-server.log');
    }
    const out = openSync(logFile, 'w');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...forwardArgs], {
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
    console.log(`Mock server started in background (pid ${child.pid})`);
    console.log(`Logs: ${logFile}`);
    console.log(`Stop:  npm run mock:stop`);
  } else {
    // Handle graceful shutdown
    process.on('SIGINT', () => stopServer(true));
    process.on('SIGTERM', () => stopServer(true));

    // Start the server
    startMockServer();
  }
}
