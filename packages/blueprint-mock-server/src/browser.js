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
import { seedAllDatabases } from './seeder.js';
import { seedConfigs } from './config-registry.js';
import { initSchemaRegistry } from './validator.js';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { graphsOf, unresolvedRulesWarning } from './contract-views.js';
import { assembleServer } from './assemble-server.js';
export { runScenario, startScenario, operationIndex, controlOperations } from './arazzo.js';



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
 * @param {Array} [options.routing] - Domains, APIs and operations something
 *   else answers — a service at a URL, or a `handler` function this page
 *   passes — as `schemas/routing-schema.json` describes the entries.
 *   Configuration for this page, not part of the contract set.
 * @returns {Promise<{ fetch: (request: Request) => Promise<Response>, routes: Map, store: object, endpoints: object[] }>}
 */
export async function createMockServer({
  contracts,
  store = createMemoryStore(),
  baseUrl = '',
  basePath = '',
  seed = true,
  routing = [],
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
  const compositions = extract(docs, 'compositions');
  const rulesFiles = extract(docs, 'rules');
  const graphs = graphsOf(docs);
  const unresolved = unresolvedRulesWarning(rulesFiles, graphs);
  if (unresolved) console.warn(`Warning: ${unresolved}`);
  // Served from the contracts, not stored. Read here so a duplicate entry id
  // fails at boot.
  const registries = extract(docs, 'registries');

  // Seed before routing so a list endpoint answers on the first request.
  if (seed) seedAllDatabases(docs, store, { seeded: true });

  seedConfigs(configs, store);

  // From here on, the same server the Node process builds.
  const { fetch, routes, endpoints, routed } = assembleServer(
    { apiSpecs, stateMachines, slaTypes, metrics, configs, compositions, rulesFiles, graphs, registries },
    // A page has no directory to re-read, so reseed restores the documents the
    // artifact carries. Node passes a function that walks the directory again.
    { store, readDocs: () => docs, seeded: seed, baseUrl, basePath, routing },
  );
  for (const key of routed) console.log(`  ROUTE ${key}`);
  return { fetch, routes, store, endpoints, routed };
}
