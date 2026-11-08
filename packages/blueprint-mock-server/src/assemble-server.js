/**
 * The mock server, assembled from a contract set already loaded and seeded.
 *
 * The Node server and a page get their documents differently — directories or
 * an artifact read from disk and validated there, or an artifact a page
 * fetched — and from then on they are the same server. Both used to wire it up
 * themselves and drifted: the Node server registered compositions without the
 * step calls a patch makes its changes through, so every patch that should
 * have saved answered 500 there and nowhere a test looked. So this is the one
 * place it happens.
 *
 * Nothing here touches the filesystem or the network, so it runs in a page.
 */

import { registerPlatformRoutes, contractOverrides, refuseOwnRouteCollisions } from './platform-routes.js';
import {
  registerAllRoutes, registerStateMachineRoutes, registerCompositionRoutes,
  registerRulesRoutes, buildRulesIndex,
} from './route-generator.js';
import { createDispatcher, overrideByOperationId, wrapRoute, routeKey } from './http/route-table.js';
import { jsonBody } from './http/request.js';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { applyRouting } from './routing.js';
import { operationsOf } from './operation-calls.js';
import { registerEventSubscriptions } from './event-subscription.js';
import { subscribeStubDispatch, clearAllStubs } from './mock-stub-engine.js';
import { createStepCalls } from './step-calls.js';
import { initRulesIndex } from './state-machine-engine.js';

/**
 * @param {object} set - What the contract set declares, as `extract` reads it
 * @param {object[]} set.apiSpecs
 * @param {object[]} set.stateMachines
 * @param {object[]} set.slaTypes
 * @param {object[]} set.metrics
 * @param {object[]} set.configs
 * @param {object[]} set.compositions
 * @param {object[]} set.rulesFiles
 * @param {object[]} set.graphs
 * @param {object} set.registries
 * @param {object} options
 * @param {object} options.store - Already seeded
 * @param {() => object[]} options.readDocs - The documents /mock/reseed restores
 * @param {boolean} options.seeded - Whether the store was seeded from mock data
 * @param {string} [options.baseUrl] - Base for Location headers
 * @param {string} [options.basePath] - Path prefix to strip before matching
 * @param {Array} [options.routing] - Domains, APIs and operations something else answers (#283, #520)
 * @returns {{ routes: Map, fetch: Function, endpoints: object[], rpcEndpoints: object[], overridden: { applied: string[], unmatched: string[] }, routed: string[], receives: object[] }}
 * @throws {Error} When a contract route collides with the mock's own, or routing names nothing
 */
export function assembleServer(
  { apiSpecs, stateMachines, slaTypes, metrics, configs, compositions, rulesFiles, graphs, registries },
  { store, readDocs, seeded, baseUrl = '', basePath = '', routing = [] },
) {
  // A step's call to a record — a nested create, an update, another action, a
  // composition's patch — means what the API's route at that method and path
  // means.
  const docs = readDocs();
  const stepCalls = createStepCalls({ apiSpecs, stateMachines, slaTypes, store, docs });
  // Every operation the set has, as core finds them: the events documents'
  // receive operations included, which routing a domain or API covers.
  const operations = extract(docs, 'operations');
  const domainOfFile = new Map(docs.map((doc) => [doc.relativePath, doc.domain]));
  const apiOfFile = new Map((operations?.all ?? []).map((operation) => [operation.file, operation.api]));
  // Filled in once routing is applied, below, before the first request: the
  // received events that go elsewhere, so the reactions to them don't run here.
  const routedEvents = { receives: [], apiOfFile };
  registerEventSubscriptions(stateMachines, slaTypes, apiSpecs, store, stepCalls, routedEvents);
  // Stubs are kept per module, not per server: a new server starts with none,
  // so one registered on the server it replaces cannot answer here.
  clearAllStubs();
  subscribeStubDispatch(store);
  // The rulesets a state machine's `evaluate:` step runs.
  initRulesIndex(buildRulesIndex(graphs));

  // Registration order is priority: addRoute keeps the first entry for a key.
  const routes = new Map();
  registerPlatformRoutes(routes, { store, apiNames: apiSpecs.map((a) => a.name), readDocs, configs, seeded });
  if (compositions.length > 0) registerCompositionRoutes(routes, compositions, apiSpecs, { store, stepCalls });
  if (rulesFiles.length > 0) registerRulesRoutes(routes, rulesFiles, apiSpecs, graphs);
  const endpoints = registerAllRoutes(routes, apiSpecs, baseUrl, stateMachines, slaTypes, metrics, { store });
  const rpcEndpoints = registerStateMachineRoutes(routes, stateMachines, apiSpecs, slaTypes, { store, stepCalls });

  // Each route a contract's operation declares, tagged with the operation and
  // the API it belongs to, wherever it was registered from — routing and the
  // overrides below find routes by them.
  const details = [...operationsOf(apiSpecs)].map(([, operation]) => operation);
  for (const operation of details) {
    const route = routes.get(routeKey(operation.method, operation.path));
    if (!route || route.mock) continue;
    route.api = operation.api ?? null;
    route.operationId ??= operation.id;
  }

  // A few contract-declared endpoints cannot be served by generated CRUD.
  // Matched by operationId, so adding a platform endpoint to the contract
  // needs no code here, and an override that stops matching is reported.
  const overridden = overrideByOperationId(routes, contractOverrides({ store, registries }));

  // Service-call creation is enriched with catalog-derived fields: serviceType
  // and callMode come from the referenced ExternalService, and status starts
  // pending. They are server-derived rather than client-provided, so they are
  // passed around the request schema rather than through it.
  if (routes.has('POST /data-exchange/service-calls')) {
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
  }

  // Last, so a route is routed whatever registered it, and before the
  // dispatcher is built, so the first request is already answered the way
  // the configuration says (#283, #520).
  refuseOwnRouteCollisions(routes, apiSpecs);
  const domainOfApi = new Map((operations?.all ?? []).map((operation) => [operation.api, domainOfFile.get(operation.file)]));
  const byApiAndId = new Map(details.map((operation) => [`${operation.api}#${operation.id}`, operation]));
  const { routed, receives } = applyRouting(routes, routing, {
    operations,
    domainOfApi,
    // What a routed handler's answer is checked against.
    responseSchema: (route, status) => {
      const operation = byApiAndId.get(`${route.api}#${route.operationId}`);
      const response = operation && operation.follow(operation.responses?.[status] ?? operation.responses?.default);
      const schema = response?.content?.['application/json']?.schema;
      return schema ? { schema: operation.follow(schema), key: `${operation.api}-${operation.id}-response-${status}` } : null;
    },
  });
  routedEvents.receives = receives;

  // An action calling an operation as its caller sends the call through here.
  stepCalls.serve(createDispatcher(routes));
  return { routes, fetch: createDispatcher(routes, { basePath }), endpoints, rpcEndpoints, overridden, routed, receives };
}
