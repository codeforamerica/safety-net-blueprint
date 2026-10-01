/**
 * Module-level SQLite store, kept as a shim.
 *
 * This file used to *be* the store. Its behaviour now lives in
 * `stores/sqlite-store.js` behind the interface in `stores/contract.js`, so a
 * second implementation can be substituted — see `stores/memory-store.js`.
 *
 * It survives as a shim so the modules that import these functions directly can
 * move to an injected store without a flag day. Every export delegates to one
 * process-wide store instance, which is what the previous module-level state
 * amounted to.
 *
 * **Do not add to this file.** New code takes a store as a parameter. This goes
 * away once nothing imports it.
 *
 * @deprecated Use the `Store` passed in by the caller.
 */

import { createSqliteStore, sqliteHandle } from './stores/sqlite-store.js';

/**
 * The process-wide store. Exported so that code being migrated can hand the
 * same instance to something that now expects a store parameter, rather than
 * creating a second one over the same files.
 */
export const defaultStore = createSqliteStore();

export const registerCollectionDefaults = (...args) => defaultStore.registerCollectionDefaults(...args);
export const findAll = (...args) => defaultStore.findAll(...args);
export const search = (...args) => defaultStore.search(...args);
export const findById = (...args) => defaultStore.findById(...args);
export const create = (...args) => defaultStore.create(...args);
export const update = (...args) => defaultStore.update(...args);
export const deleteResource = (...args) => defaultStore.deleteResource(...args);
export const clearAll = (...args) => defaultStore.clearAll(...args);
export const insertResource = (...args) => defaultStore.insertResource(...args);
export const count = (...args) => defaultStore.count(...args);

/**
 * Clear every collection the store has opened.
 *
 * Kept because callers use it; it is `clearAll` across everything rather than a
 * distinct capability, so it is not part of the store contract.
 */
export function clearAllDatabases() {
  for (const collection of Object.keys(defaultStore.snapshot())) {
    defaultStore.clearAll(collection);
  }
}

export const closeAll = () => defaultStore.close();

/**
 * @deprecated Reaches the raw SQLite handle, which only the SQL store has.
 *
 * `search-engine.js` and `handlers/search-handler.js` still use this to build
 * queries the store cannot express — range comparisons, array membership,
 * full-text across every value, a configurable ORDER BY. Those are the last
 * callers, and reconciling them is what decides the store's eventual query
 * shape; see `stores/contract.js`.
 */
export const getDatabase = (resourceName) => sqliteHandle(defaultStore, resourceName);
