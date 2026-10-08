#!/usr/bin/env node
/**
 * Mock API Server
 * Dynamic Express server that automatically discovers and serves OpenAPI specifications
 */

import http from 'http';
import { execSync, spawn } from 'child_process';
import { realpathSync, openSync, statSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { performSetup } from '../src/setup.js';
import { subscribeStubDispatch } from '../src/mock-stub-engine.js';
import { createMemoryStore } from '../src/stores/memory-store.js';
import { createSqliteStore } from '../src/stores/sqlite-store.js';
import { registerAllRoutes, registerStateMachineRoutes, registerCompositionRoutes, registerRulesRoutes, buildRulesIndex } from '../src/route-generator.js';
import { createDispatcher, wrapRoute, overrideByOperationId } from '../src/http/route-table.js';
import { registerPlatformRoutes, contractOverrides } from '../src/platform-routes.js';
import { jsonBody, readJsonBody, invalidJson } from '../src/http/request.js';
import { discover, load, extract } from '@codeforamerica/blueprint-core';
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
  --spec=<path>     Directory of contracts, a single spec file, or a contracts.json
                    artifact from blueprint-bundle-contracts (repeatable)
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
    console.error('Error: --spec=<path> is required (a directory of resolved contracts, or a contracts.json artifact)');
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
 * Whether a `--spec` value names a contracts artifact rather than a directory.
 *
 * One JSON file instead of a tree: `blueprint-bundle-contracts` writes it, and
 * booting from it skips the walk entirely — the server gets exactly the
 * documents the artifact was built from rather than whatever is on disk now.
 * The same file a browser boots from (#448).
 *
 * @param {string} value
 * @returns {boolean}
 */
function isArtifactPath(value) {
  return typeof value === 'string' && value.endsWith('.json');
}

/**
 * The documents inside a contracts artifact.
 *
 * Reading and parsing is this command's job; rebuilding the documents is
 * core's, through `extract(artifact, 'docs')`, which also checks the version
 * and shape and puts back the methods JSON could not carry.
 *
 * @param {string} path
 * @returns {import('@codeforamerica/blueprint-core').Doc[]}
 */
function docsFromArtifactFile(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read contracts artifact ${path}: ${error.message}`);
  }
  return extract(parsed, 'docs');
}

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
    // How /mock/reseed gets its documents. A function rather than a value so
    // a directory is re-read on each call, picking up edits since boot. An
    // artifact has nothing to re-read, so it is parsed again instead — which
    // still answers the question honestly: these are the documents this server
    // was started from.
    const readDocs = () => specDirs.flatMap((dir) => (
      isArtifactPath(dir)
        ? docsFromArtifactFile(dir)
        : [...new Set([dir, seedDir].filter(Boolean))].flatMap((d) => discover(d)).map(load)
    ));
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
      const result = isArtifactPath(specsDir)
        ? await performSetup({ docs: docsFromArtifactFile(specsDir), seedDir, verbose: true, store })
        : await performSetup({ specsDir, seedDir, verbose: true, store });
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

    // One route table for the whole server. Registration order is priority:
    // addRoute keeps the first entry for a key, which is what Express's
    // first-match-wins resolution did.
    registerPlatformRoutes(routes, {
      store,
      apiNames: apiSpecs.map((a) => a.name),
      readDocs,
      configs: allConfigs,
      policies: allPolicies,
      seeded: Boolean(seedDir),
    });


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

    // A few contract-declared endpoints cannot be served by generated CRUD.
    // Matched by operationId, so adding a platform endpoint to the contract
    // needs no code here, and an override that stops matching fails at boot.
    const { applied, unmatched } = overrideByOperationId(routes, contractOverrides({ store }));
    for (const key of applied) console.log(`  ${key} - contract route, custom handler`);
    if (unmatched.length > 0) {
      console.warn(`  Note: no contract route declares ${unmatched.join(', ')} — not overridden`);
    }

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
