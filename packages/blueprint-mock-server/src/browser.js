/**
 * The mock server, without a server.
 *
 * Hand it a contracts artifact and it returns the same route table the Node
 * process builds, plus a `fetch` that serves it. No HTTP, no filesystem, no
 * native module — the handlers were always ordinary JavaScript; what bound
 * them to Node was the shell around them (#448).
 *
 *   import { createMockServer } from '@codeforamerica/blueprint-mock-server/browser';
 *
 *   const contracts = await (await fetch('./contracts.json')).json();
 *   const mock = await createMockServer({ contracts });
 *
 *   const response = await mock.fetch(new Request('/intake/applications'));
 *
 * `mock.fetch` has `fetch`'s signature, so it can be handed to MSW, called
 * directly, or used to replace `window.fetch` outright.
 */

import { createMemoryStore } from './stores/memory-store.js';
import { apiSpecsFromDocs } from './spec-loader.js';
import { registerPlatformRoutes, contractOverrides } from './platform-routes.js';
import {
  registerAllRoutes, registerStateMachineRoutes, registerCompositionRoutes,
  registerRulesRoutes, buildRulesIndex,
} from './route-generator.js';
import { createDispatcher, overrideByOperationId } from './http/route-table.js';
import { seedAllDatabases } from './seeder.js';
import { registerEventSubscriptions } from './event-subscription.js';
import { subscribeStubDispatch } from './mock-stub-engine.js';
import { registerConfigManaged } from './config-registry.js';
import { initSchemaRegistry } from './validator.js';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { contractsOfType, graphsOf, unresolvedRulesWarning } from './contract-views.js';



/**
 * Build a mock server from a contracts artifact.
 *
 * @param {object} options
 * @param {object} options.contracts - Parsed output of `blueprint-bundle-contracts`
 * @param {object} [options.store] - Defaults to a fresh in-memory store
 * @param {string} [options.baseUrl] - Base for Location headers
 * @param {string} [options.basePath] - Path prefix to strip before matching,
 *   for a page served from a subdirectory. On GitHub Pages this is the project
 *   path: `basePath: location.pathname.replace(/\/[^/]*$/, '')`
 * @param {boolean} [options.seed] - Seed from the artifact's mock-data documents
 * @param {boolean} [options.verifyHash] - Check the payload against its hash
 * @returns {Promise<{ fetch: (request: Request) => Promise<Response>, routes: Map, store: object, endpoints: object[] }>}
 */
export async function createMockServer({
  contracts,
  store = createMemoryStore(),
  baseUrl = '',
  basePath = '',
  seed = true,
} = {}) {
  // Core owns the artifact format, both halves: `generate(docs, 'artifact')`
  // wrote this and `extract(artifact, 'docs')` reads it back, rebuilding each
  // document's methods — which JSON cannot carry and which `extract(docs,
  // 'relationships')` and the schema walkers need. It also checks the version
  // and shape, so there is nothing left for this entry to assert (#448).
  const docs = extract(contracts, 'docs');

  // The request validator resolves $refs against the set, same as in Node.
  initSchemaRegistry(docs);

  // From the documents, not a separate `specs` key. The artifact used to carry
  // the OpenAPI documents twice — once with refs, once dereferenced — which is
  // most of why it was 3.95 MB rather than 0.67 MB.
  const apiSpecs = apiSpecsFromDocs(docs);

  const stateMachines = extract(docs, 'state-machines');
  const slaTypes = extract(docs, 'sla-types');
  const metrics = extract(docs, 'metrics');
  const configs = extract(docs, 'config');
  const compositions = contractsOfType(docs, 'compositions', 'compositions');
  const rulesFiles = contractsOfType(docs, 'rules', 'rulesets');
  const graphs = graphsOf(docs);
  const unresolved = unresolvedRulesWarning(rulesFiles, graphs);
  if (unresolved) console.warn(`Warning: ${unresolved}`);
  const policies = extract(docs, 'registries').policies ?? {};

  // Seed before routing so a list endpoint answers on the first request.
  if (seed) seedAllDatabases(docs, store, { seeded: true });

  for (const config of configs) {
    for (const [catalogKey, entries] of Object.entries(config.catalogs)) {
      for (const entry of entries) {
        const data = { ...entry };
        for (const key of Object.keys(data)) if (key.startsWith('x-')) delete data[key];
        store.insertResource(catalogKey, { ...data, source: 'system' });
        registerConfigManaged(catalogKey, data.id);
      }
    }
  }
  for (const [id, policy] of Object.entries(policies)) {
    store.insertResource('registry-policies', { id, ...policy, source: 'system' });
    registerConfigManaged('registry-policies', id);
  }

  registerEventSubscriptions(stateMachines, slaTypes, apiSpecs, store);
  subscribeStubDispatch(store);
  if (rulesFiles.length > 0) buildRulesIndex(rulesFiles, graphs);

  // Registration order is priority — the same order the Node server uses.
  const routes = new Map();
  registerPlatformRoutes(routes, {
    store,
    apiNames: apiSpecs.map((a) => a.name),
    // A page has no directory to re-read, so reseed restores the documents the
    // artifact carries. Node passes a function that walks the directory again.
    readDocs: () => docs,
    configs,
    policies,
    seeded: seed,
  });
  if (compositions.length > 0) registerCompositionRoutes(routes, compositions, apiSpecs, { store });
  if (rulesFiles.length > 0) registerRulesRoutes(routes, rulesFiles, apiSpecs, graphs);
  const endpoints = registerAllRoutes(routes, apiSpecs, baseUrl, stateMachines, slaTypes, metrics, { store });
  registerStateMachineRoutes(routes, stateMachines, apiSpecs, slaTypes, { store });
  overrideByOperationId(routes, contractOverrides({ store }));

  return { fetch: createDispatcher(routes, { basePath }), routes, store, endpoints };
}
