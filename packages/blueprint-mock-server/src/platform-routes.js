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
import { seedConfigs } from './config-registry.js';
import { seedAllDatabases } from './seeder.js';
import { addRoute, routeKey, tagRoutesAddedBy } from './http/route-table.js';
import { jsonBody, readJsonBody, invalidJson } from './http/request.js';

/**
 * Register the routes the mock serves itself, tagged so nothing mistakes them
 * for ones a contract declares: forwarding refuses them, and a contract that
 * declares one of their paths is refused at boot.
 *
 * @param {Map<string, object>} routes
 * @param {object} deps - As `registerOwnRoutes` takes them
 */
export function registerPlatformRoutes(routes, deps) {
  tagRoutesAddedBy(routes, { mock: true }, () => registerOwnRoutes(routes, deps));
}

/**
 * Refuse a contract that declares a path the mock serves itself.
 *
 * The mock's own routes are registered first and first registration wins, so
 * a contract declaring `/mock/stubs/http` or `/health` would be shadowed:
 * declared, listed in Swagger, and never served. Detected from the routes
 * rather than a list of reserved prefixes, so a route the mock adds later is
 * covered without anyone remembering to add it. The mock's own OpenAPI
 * document is the likeliest cause — it describes these routes for Swagger,
 * and passed to the mock as a contract it would collide with every one.
 *
 * @param {Map<string, object>} routes
 * @param {Array} apiSpecs - As `apiSpecsFromDocs` returns them
 */
export function refuseOwnRouteCollisions(routes, apiSpecs) {
  const collisions = [];
  for (const spec of apiSpecs) {
    for (const endpoint of spec.endpoints ?? []) {
      const key = routeKey(endpoint.method, endpoint.path);
      if (routes.get(key)?.mock) collisions.push(`${key} (${spec.relativePath ?? spec.name})`);
    }
  }
  if (collisions.length === 0) return;
  throw new Error(
    'These contract routes are ones the mock serves itself, so they would never be reached:\n  '
    + collisions.join('\n  ')
    + '\nThe mock\'s own OpenAPI document is for Swagger; do not pass it to the mock as a contract.',
  );
}

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
 * @param {boolean} [deps.seeded] - Whether seed data was supplied at boot
 */
function registerOwnRoutes(routes, { store, apiNames = [], readDocs, configs = [], seeded = true }) {
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
    seedConfigs(configs, store);
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

  // Each by the operationId contracts/mock-openapi.yaml gives it, so a
  // scenario can call the mock's own routes as it calls an API's.
  for (const [key, operationId] of Object.entries(CONTROL_OPERATIONS)) {
    const route = routes.get(key);
    if (route) route.operationId = operationId;
  }
}

/** The mock's own routes, by the operationIds contracts/mock-openapi.yaml declares. */
export const CONTROL_OPERATIONS = {
  'GET /health': 'getHealth',
  'POST /mock/stubs/events': 'registerEventStub',
  'GET /mock/stubs/events': 'listEventStubs',
  'DELETE /mock/stubs/events': 'clearEventStubs',
  'DELETE /mock/stubs/events/{id}': 'removeEventStub',
  'POST /mock/stubs/http': 'registerHttpStub',
  'GET /mock/stubs/http': 'listHttpStubs',
  'DELETE /mock/stubs/http': 'clearHttpStubs',
  'DELETE /mock/stubs/http/{id}': 'removeHttpStub',
  'POST /mock/reset': 'resetMock',
  'POST /mock/reseed': 'reseedMock',
};

/**
 * Handlers for endpoints the contract declares but generated CRUD cannot serve.
 *
 * Keyed by `operationId` and applied with `overrideByOperationId` once the
 * contract routes exist. Adding a platform endpoint to the contract needs
 * nothing here — only an endpoint whose *behavior* is special does, and an
 * override naming an operationId the contract no longer has fails at boot
 * rather than leaving a route quietly served by the generated handler.
 *
 * @param {{ store: object, registries?: Record<string, Record<string, object>> }} deps
 *   `registries` is `extract(docs, 'registries')`: each type's entries, every file combined
 * @returns {Record<string, Function>}
 */
export function contractOverrides({ store, registries = {} }) {
  return {
    // Registries are read from the contracts themselves, never stored: a
    // registry is part of what the contracts declare, so a reset has nothing
    // to restore and a new registry type needs no handler.
    ...registryHandlers(registries),

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

/**
 * Handlers for the framework's registry endpoints, by operationId.
 *
 * @param {Record<string, Record<string, object>>} registries
 * @returns {Record<string, Function>}
 */
function registryHandlers(registries) {
  const notFound = (message) => Response.json({ code: 'NOT_FOUND', message }, { status: 404 });

  // The list conventions every collection follows: `q`, `sort` on the one
  // field, `limit` and `offset`.
  const page = (request, items, field, matches) => {
    const query = new URL(request.url).searchParams;
    const q = query.get('q')?.toLowerCase();
    const found = q ? items.filter((item) => matches(item, q)) : items;
    const descending = query.get('sort') === `-${field}`;
    found.sort((a, b) => (descending ? -1 : 1) * a[field].localeCompare(b[field]));
    const limit = Math.max(1, Math.min(parseInt(query.get('limit'), 10) || 25, 100));
    const offset = Math.max(0, parseInt(query.get('offset'), 10) || 0);
    return Response.json({ items: found.slice(offset, offset + limit), total: found.length, limit, offset, hasNext: offset + limit < found.length });
  };

  return {
    listRegistryTypes: (request) => page(request,
      Object.keys(registries).map((type) => ({ type, total: Object.keys(registries[type]).length })),
      'type', (item, q) => item.type.toLowerCase().includes(q)),

    listRegistryEntries: (request, { params }) => {
      if (!registries[params.type]) return notFound(`No registry of type "${params.type}"`);
      return page(request,
        Object.entries(registries[params.type]).map(([id, entry]) => ({ id, ...entry })),
        'id', (item, q) => item.id.toLowerCase().includes(q) || String(item.description ?? '').toLowerCase().includes(q));
    },

    getRegistryEntry: (request, { params }) => {
      const entry = registries[params.type]?.[params.entryId];
      if (!entry) return notFound(`No entry "${params.entryId}" in registry "${params.type}"`);
      return Response.json({ id: params.entryId, ...entry });
    },
  };
}

