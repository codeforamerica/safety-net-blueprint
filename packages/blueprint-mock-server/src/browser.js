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
import { assertArtifact, verifyIntegrity, specsFromArtifact } from './contracts.js';
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
import { extract, generate } from '@codeforamerica/blueprint-core';

/** Documents the mock server's registry helper, kept in step with setup.js. */
function registryEntries(docs, type) {
  const merged = {};
  for (const doc of docs) {
    if (doc.type !== 'registry' || doc.content?.type !== type) continue;
    Object.assign(merged, doc.content.entries ?? {});
  }
  return merged;
}

/** Documents of one contract type carrying a given section, as setup.js reads them. */
function contractsOfType(docs, type, section) {
  return docs
    .filter((doc) => doc.type === type && doc.content?.[section])
    .map((doc) => ({ filePath: doc.path, domain: doc.content.domain, doc: doc.content }));
}

/**
 * Build a mock server from a contracts artifact.
 *
 * @param {object} options
 * @param {object} options.contracts - Parsed output of `blueprint-bundle-contracts`
 * @param {object} [options.store] - Defaults to a fresh in-memory store
 * @param {string} [options.baseUrl] - Base for Location headers
 * @param {boolean} [options.seed] - Seed from the artifact's mock-data documents
 * @param {boolean} [options.verifyHash] - Check the payload against its hash
 * @returns {Promise<{ fetch: (request: Request) => Promise<Response>, routes: Map, store: object, endpoints: object[] }>}
 */
export async function createMockServer({
  contracts,
  store = createMemoryStore(),
  baseUrl = '',
  seed = true,
  verifyHash = true,
} = {}) {
  assertArtifact(contracts);

  if (verifyHash) {
    const { ok, expected, actual } = await verifyIntegrity(contracts);
    if (!ok) {
      throw new Error(
        `Contracts artifact failed its integrity check (expected ${expected?.slice(0, 16)}…, ` +
        `got ${actual.slice(0, 16)}…). It was modified after being built, so the claim that ` +
        'it was validated no longer holds. Rebuild it with blueprint-bundle-contracts.'
      );
    }
  }

  const docs = contracts.docs;
  const apiSpecs = specsFromArtifact(contracts);

  const stateMachines = extract(docs, 'state-machines');
  const slaTypes = extract(docs, 'sla-types');
  const metrics = extract(docs, 'metrics');
  const configs = extract(docs, 'config');
  const compositions = contractsOfType(docs, 'compositions', 'compositions');
  const rulesFiles = contractsOfType(docs, 'rules', 'rulesets');
  const graphs = rulesFiles.length > 0 ? generate(docs, 'graph').map(({ graph }) => graph) : [];
  const policies = registryEntries(docs, 'policies');

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

  return { fetch: createDispatcher(routes), routes, store, endpoints };
}
