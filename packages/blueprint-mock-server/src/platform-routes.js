/**
 * The routes the mock server provides itself, as opposed to the ones generated
 * from contracts.
 *
 * Health, the event stream, event injection, the stub registry, reset and
 * reseed. These used to be written inline in `cli/server.js`, which meant a
 * browser could never have them — and they are exactly what makes a page
 * useful for testing: stub an external service, inject an event, reset to a
 * known state (#448).
 *
 * Everything here is injected rather than reached for: the store, the clock's
 * worth of contract documents, the list of API names. That is what lets the
 * same registrations serve a Node process and a page, with no branch inside a
 * handler deciding which it is in.
 */

import { createSseHandler } from './handlers/sse-handler.js';
import { emitEventEnvelope } from './emit-event.js';
import {
  registerStub, listStubs, removeStub, clearStubs, clearAllStubs,
  registerHttpStub, listHttpStubs, removeHttpStub, clearHttpStubs,
} from './mock-stub-engine.js';
import { registerConfigManaged } from './config-registry.js';
import { seedAllDatabases } from './seeder.js';
import { addRoute } from './http/route-table.js';
import { jsonBody, readJsonBody, invalidJson } from './http/request.js';

/**
 * Register the platform routes into a table.
 *
 * @param {Map<string, object>} routes
 * @param {object} deps
 * @param {object} deps.store
 * @param {string[]} deps.apiNames - Reported by /health
 * @param {() => import('@codeforamerica/blueprint-core').Doc[]} deps.readDocs -
 *   Supplies the documents /mock/reseed seeds from. A function, not a value, so
 *   Node can re-read the directory on each call while a page returns the
 *   documents its contracts artifact carries.
 * @param {object[]} deps.configs - Config catalogs restored by /mock/reset
 * @param {Record<string, object>} deps.policies - Registry entries restored by /mock/reset
 * @param {boolean} [deps.seeded] - Whether seed data was supplied at boot
 */
export function registerPlatformRoutes(routes, { store, apiNames = [], readDocs, configs = [], policies = {}, seeded = true }) {
  // Health check endpoint
  addRoute(routes, 'GET', '/health', () =>
    Response.json({ status: 'ok', apis: apiNames }));

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
    for (const config of configs) {
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
    for (const [id, policy] of Object.entries(policies)) {
      store.insertResource('registry-policies', { id, ...policy, source: 'system' });
      registerConfigManaged('registry-policies', id);
    }
    return new Response(null, { status: 204 });
  });
  console.log('  POST   /mock/reset - Reset all runtime data (keeps config-managed resources)');

  // Reseed endpoint — re-inserts seed data without clearing anything else.
  // Useful after a reset when tests need baseline data present.
  // Re-reads the contracts from disk rather than reusing the documents from
  // boot, so editing a mock-data file and reseeding shows the edit. The
  // browser hands the same handler a function returning the artifact's
  // documents instead — the source is injected, the handler is identical.
  addRoute(routes, 'POST', '/mock/reseed', () => {
    seedAllDatabases(readDocs(), store, { seeded });
    return new Response(null, { status: 204 });
  });
  console.log('  POST   /mock/reseed - Re-seed all collections from seed files');
}

/**
 * Handlers for endpoints the contract declares but generated CRUD cannot serve.
 *
 * Keyed by `operationId` and applied with `overrideByOperationId` once the
 * contract routes exist. Adding a platform endpoint to the contract needs
 * nothing here — only an endpoint whose *behavior* is special does, and an
 * override naming an operationId the contract no longer has fails at boot
 * rather than leaving a route quietly served by the generated handler.
 *
 * @param {{ store: object }} deps
 * @returns {Record<string, Function>}
 */
export function contractOverrides({ store }) {
  return {
    // A stream, not a collection read.
    streamEvents: createSseHandler(),

    // Publishing fires the event bus so event-triggered rules respond to it,
    // which is the point of injecting one — storing a row would not. Accepts a
    // CloudEvents 1.0 envelope.
    publishEvent: async (request) => {
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return invalidJson();

      const event = parsed.value;
      if (!event?.type || !event?.specversion) {
        const missing = ['specversion', 'type'].filter((f) => !event?.[f]);
        return Response.json({
          code: 'VALIDATION_ERROR',
          message: 'Request body must be a CloudEvents 1.0 envelope',
          details: missing.map((f) => ({ field: f, message: 'required' })),
        }, { status: 422 });
      }

      return Response.json(emitEventEnvelope(event, store), { status: 201 });
    },
  };
}
