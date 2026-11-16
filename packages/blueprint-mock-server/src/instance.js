/**
 * One mock's own state: everything it holds besides the records in its store.
 *
 * Each mock gets its own, so two in one page or process — the page's client
 * and the server it routes to, or two servers in one test — share nothing: an
 * event one sends isn't heard by the other, a stub registered on one doesn't
 * answer the other, and each validates against its own contracts. It's made
 * once, before anything is seeded or registered, and passed down wherever the
 * store is.
 */

import { createEventBus } from './event-bus.js';
import { createStubs, subscribeStubDispatch } from './mock-stub-engine.js';
import { createSchemaRegistry } from './validator.js';
import { createWs } from './ws.js';
import { createConfigRegistry } from './config-registry.js';
import { resourceIndex, eventOwnersOf } from './spec-loader.js';

/**
 * @param {object} options
 * @param {import('./stores/contract.js').Store} options.store
 * @param {import('@codeforamerica/blueprint-core').Doc[]} [options.docs] - What
 *   requests are validated against; none means schemas are compiled alone
 * @param {object[]} [options.apiSpecs] - Where each resource's records are
 *   kept and read, from apiSpecsFromDocs
 */
export function createInstance({ store, docs = null, apiSpecs = [] }) {
  const instance = {
    store,
    bus: createEventBus(),
    stubs: createStubs(),
    // The WebSockets AsyncAPI documents describe, and their WebSocket stubs (ws.js).
    ws: createWs(docs ?? []),
    schemas: createSchemaRegistry(docs),
    // What the contract set says, kept with the mock that loaded it.
    resources: resourceIndex(apiSpecs),
    eventOwners: eventOwnersOf(apiSpecs),
    configManaged: createConfigRegistry(),
    // The rulesets a state machine's `evaluate:` step runs, by name.
    rulesIndex: {},
    // The state machines' `on:` reactions: the bus listener, and those still
    // running for each partitionkey (event-subscription.js).
    reactions: { dispatch: null, running: new Map() },
    // The records an action or reaction is changing now (record-turns.js).
    changing: new Map(),
    // How each event read from a routed service arrived (routed-events.js).
    arrivals: new Map(),
    // Compositions' parent links, read routes and editable operations
    // (composition-assembler.js, references.js, editable-composition.js).
    parentLinks: new Map(),
    readRoutes: new Map(),
    editableOperations: new Map(),
  };
  // Its stubs answer the events on its own bus, from the start.
  subscribeStubDispatch(instance);
  return instance;
}

/**
 * Point the mock at the contract set it serves, once it's loaded: what
 * requests are validated against, and where each resource is kept.
 *
 * @param {ReturnType<typeof createInstance>} instance
 * @param {{ docs?: import('@codeforamerica/blueprint-core').Doc[], apiSpecs?: object[] }} set
 */
export function loadContracts(instance, { docs, apiSpecs }) {
  if (docs) {
    instance.schemas.load(docs);
    instance.ws = createWs(docs);
  }
  if (apiSpecs) {
    instance.resources = resourceIndex(apiSpecs);
    instance.eventOwners = eventOwnersOf(apiSpecs);
  }
  return instance;
}
