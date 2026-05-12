#!/usr/bin/env node
/**
 * Mock API Server
 * Dynamic Express server that automatically discovers and serves OpenAPI specifications
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { execSync, spawn } from 'child_process';
import { realpathSync, openSync, statSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { performSetup } from '../src/setup.js';
import { registerAllRoutes, registerStateMachineRoutes } from '../src/route-generator.js';
import { registerEventSubscriptions } from '../src/event-subscription.js';
import { closeAll } from '../src/database-manager.js';
import { validateJSON } from '../src/validator.js';
import { createSseHandler } from '../src/handlers/sse-handler.js';
import { emitEventEnvelope } from '../src/emit-event.js';
import { registerStub, listStubs, removeStub, clearStubs } from '../src/mock-stub-engine.js';
import { registerTimerStub, listTimerStubs, removeTimerStub, clearTimerStubs, fireNextTimer, fireWithNow } from '../src/timer-stub-engine.js';
import { findById } from '../src/database-manager.js';

const HOST = process.env.MOCK_SERVER_HOST || 'localhost';
const PORT = parseInt(process.env.MOCK_SERVER_PORT || '1080', 10);

function showHelp() {
  console.log(`
Mock API Server

Dynamic Express server that discovers and serves OpenAPI specifications.

Usage:
  npm run mock:start [-- --spec=<dir> ...]

Options:
  --spec=<dir>    File or directory containing *-openapi.yaml files (repeatable)
                  Default: packages/contracts
  --seed=<dir>    Directory containing seed data files (default: same as --spec)
  --detach        Start server in the background (logs to mock-server.log)
  --log=<path>    Log file or directory for --detach output (default: spec dir)
  --stop          Stop the running mock server
  -h, --help      Show this help message

Environment:
  MOCK_SERVER_HOST   Host to bind to (default: localhost)
  MOCK_SERVER_PORT   Port to listen on (default: 1080)

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
    !a.startsWith('--spec=') && !a.startsWith('--seed=') && !a.startsWith('--log=')
  );
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const specDirs = args
    .filter(a => a.startsWith('--spec='))
    .map(a => resolve(a.split('=')[1]));
  if (specDirs.length === 0) {
    specDirs.push(resolve(import.meta.dirname, '..', '..', 'contracts'));
  }

  const seedArg = args.find(a => a.startsWith('--seed='));
  const seedDir = seedArg
    ? resolve(seedArg.split('=')[1])
    : resolve(import.meta.dirname, '..', 'seed');

  return { specDirs, seedDir };
}

let expressServer = null;

/**
 * Start the mock server
 * @param {string[]|null} specDirs - Spec directories to load. Defaults to parseSpecDirs() (from process.argv).
 * @param {string|null} seedDir - Directory containing seed data files. Defaults to each specDir.
 */
async function startMockServer(specDirs = null, seedDir = null) {
  console.log('='.repeat(70));
  console.log('🚀 Starting Mock API Server');
  console.log('='.repeat(70));

  try {
    // Perform setup (load specs and seed databases) for each spec directory
    if (specDirs === null) {
      const parsed = parseSpecDirs();
      specDirs = parsed.specDirs;
      seedDir = seedDir ?? parsed.seedDir;
    }
    let apiSpecs = [];
    let allStateMachines = [];
    let allRules = [];
    let allSlaTypes = [];
    let allMetrics = [];
    for (const specsDir of specDirs) {
      const result = await performSetup({ specsDir, seedDir, verbose: true });
      apiSpecs = apiSpecs.concat(result.apiSpecs);
      allStateMachines = allStateMachines.concat(result.stateMachines);
      allRules = allRules.concat(result.rules);
      allSlaTypes = allSlaTypes.concat(result.slaTypes);
      allMetrics = allMetrics.concat(result.metrics);
    }


    // Create Express app
    const app = express();

    // Middleware
    app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Caller-Id', 'X-Caller-Roles', 'X-Mock-Now', 'traceparent'],
      credentials: true
    }));

    app.use(express.json());

    // JSON parse error handler
    app.use(validateJSON);

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', apis: apiSpecs.map(a => a.name) });
    });

    // Register SSE stream endpoint before item routes to avoid :id capture
    app.get('/platform/events/stream', createSseHandler());
    console.log('  GET    /platform/events/stream - Domain event stream (SSE)');

    // Register event injection endpoint — accepts a CloudEvents 1.0 envelope and
    // fires it to the event bus so event-triggered rule sets can respond to it.
    // Useful for simulating events from external domains during integration testing.
    app.post('/platform/events', (req, res) => {
      const event = req.body;
      if (!event?.type || !event?.specversion) {
        const missing = ['specversion', 'type'].filter(f => !event?.[f]);
        return res.status(422).json({
          code: 'VALIDATION_ERROR',
          message: 'Request body must be a CloudEvents 1.0 envelope',
          details: missing.map(f => ({ field: f, message: 'required' }))
        });
      }
      try {
        const stored = emitEventEnvelope(event);
        res.status(202).json(stored);
      } catch (err) {
        console.error('Failed to emit injected event:', err.message);
        res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [{ message: err.message }] });
      }
    });
    console.log('  POST   /platform/events - Inject external domain event (testing)');

    // Event stub registry — pre-program event responses for integration tests.
    // See packages/mock-server/mock-rules/README.md for full usage documentation.
    app.post('/mock/stubs/events', (req, res) => {
      try {
        const stub = registerStub(req.body);
        res.status(201).json(stub);
      } catch (err) {
        res.status(422).json({ code: 'VALIDATION_ERROR', message: err.message });
      }
    });
    app.get('/mock/stubs/events', (req, res) => {
      const items = listStubs();
      res.json({ items, total: items.length });
    });
    app.delete('/mock/stubs/events', (req, res) => {
      clearStubs();
      res.status(204).end();
    });
    app.delete('/mock/stubs/events/:id', (req, res) => {
      const removed = removeStub(req.params.id);
      if (!removed) return res.status(404).json({ code: 'NOT_FOUND', message: `Stub "${req.params.id}" not found` });
      res.status(204).end();
    });
    console.log('  POST   /mock/stubs/events - Register an event stub');
    console.log('  GET    /mock/stubs/events - List active event stubs');
    console.log('  DELETE /mock/stubs/events/:id - Remove an event stub');
    console.log('  DELETE /mock/stubs/events - Clear all event stubs');

    // Timer stub registry — pre-program mock timestamps for onTimer testing.
    app.post('/mock/stubs/timers', (req, res) => {
      try {
        const stub = registerTimerStub(req.body);
        res.status(201).json(stub);
      } catch (err) {
        res.status(422).json({ code: 'VALIDATION_ERROR', message: err.message });
      }
    });
    app.get('/mock/stubs/timers', (req, res) => {
      const items = listTimerStubs();
      res.json({ items, total: items.length });
    });
    app.delete('/mock/stubs/timers', (req, res) => {
      clearTimerStubs();
      res.status(204).end();
    });
    app.delete('/mock/stubs/timers/:id', (req, res) => {
      const removed = removeTimerStub(req.params.id);
      if (!removed) return res.status(404).json({ code: 'NOT_FOUND', message: `Timer stub "${req.params.id}" not found` });
      res.status(204).end();
    });
    // Fire timers — sweeps all resources for due onTimer entries.
    // Inline: POST /mock/timers/fire { "now": "+72h" }  — no pre-registration needed.
    // Queued: POST /mock/timers/fire (no body)          — pops next registered stub.
    app.post('/mock/timers/fire', (req, res) => {
      const inlineNow = req.body?.now;
      if (inlineNow) {
        try {
          const result = fireWithNow(inlineNow, allStateMachines, allRules, allSlaTypes);
          return res.json(result);
        } catch (err) {
          return res.status(422).json({ code: 'VALIDATION_ERROR', message: err.message });
        }
      }
      const result = fireNextTimer(allStateMachines, allRules, allSlaTypes);
      if (!result) {
        return res.status(422).json({ code: 'NO_TIMER_STUBS', message: 'No timer stubs registered. Use POST /mock/stubs/timers to register one, or pass { "now": "+72h" } in the request body.' });
      }
      res.json(result);
    });
    console.log('  POST   /mock/stubs/timers - Register a timer stub');
    console.log('  GET    /mock/stubs/timers - List active timer stubs');
    console.log('  DELETE /mock/stubs/timers/:id - Remove a timer stub');
    console.log('  DELETE /mock/stubs/timers - Clear all timer stubs');
    console.log('  POST   /mock/timers/fire - Fire next timer stub, sweep all resources');

    // Register event subscriptions (event-triggered rule sets)
    registerEventSubscriptions(allRules, allStateMachines, allSlaTypes, apiSpecs);

    // Enrich service call creation with catalog-derived fields (after schema validation).
    // Copies serviceType and callMode from the referenced ExternalService, sets status to pending.
    // Uses req.enrichmentData so these fields bypass ExternalServiceCallCreate validation
    // (they're server-derived, not client-provided) but are stored in the resource.
    app.post('/data-exchange/service-calls', (req, res, next) => {
      const service = req.body?.serviceId ? findById('services', req.body.serviceId) : null;
      if (service) {
        req.enrichmentData = {
          serviceType: service.serviceType,
          callMode: req.body.callMode ?? service.defaultCallMode,
          status: 'pending',
        };
      }
      next();
    });

    // Register API routes dynamically
    const baseUrl = `http://${HOST}:${PORT}`;
    const allEndpoints = registerAllRoutes(app, apiSpecs, baseUrl, allStateMachines, allRules, allSlaTypes, allMetrics);

    // Register state machine RPC routes
    const rpcEndpoints = registerStateMachineRoutes(app, allStateMachines, apiSpecs, allRules, allSlaTypes);


    // 404 handler for undefined routes
    app.use((req, res) => {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'The requested endpoint does not exist'
      });
    });

    // Global error handler
    app.use((err, req, res, next) => {
      console.error('Unhandled error:', err);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: err.message }]
      });
    });

    // Start Express server
    expressServer = app.listen(PORT, HOST, () => {
      console.log('\n' + '='.repeat(70));
      console.log('✓ Mock API Server Started Successfully!');
      console.log('='.repeat(70));
      console.log(`\n📡 Mock Server:    http://${HOST}:${PORT}`);
      console.log(`❤️  Health Check:   http://${HOST}:${PORT}/health`);
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
    closeAll();
    console.log('✓ Databases closed');

    // Stop Express server
    if (expressServer) {
      return new Promise((resolve) => {
        expressServer.close(() => {
          console.log('✓ Mock server stopped');
          expressServer = null;
          resolve();
        });
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
      const specDir = args.find(a => a.startsWith('--spec='))?.split('=')[1] || 'packages/contracts';
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
