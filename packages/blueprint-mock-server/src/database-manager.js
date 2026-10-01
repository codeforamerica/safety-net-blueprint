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
 * The process-wide store.
 *
 * Mutable, which is the thing injection exists to avoid — so it is deliberately
 * temporary. Every export below reads it at call time, which means `useStore()`
 * can swap it once at startup and the 21 modules still importing these
 * functions pick up the choice without being touched.
 *
 * That is what makes `--store=memory` work before the modules take a store as a
 * parameter, and therefore what lets the whole functional suite run against the
 * in-memory store now rather than after the injection work. It goes away with
 * the shim.
 */
let current = createSqliteStore();

/** @deprecated Reads the process-wide store. Take one as a parameter instead. */
export const defaultStore = { get current() { return current; } };

/**
 * Replace the process-wide store. Call once, before any seeding or routing.
 *
 * @param {import('./stores/contract.js').Store} store
 */
export function useStore(store) {
  current = store;
}

export const registerCollectionDefaults = (...args) => current.registerCollectionDefaults(...args);
export const findAll = (...args) => current.findAll(...args);
export const search = (...args) => current.search(...args);
export const findById = (...args) => current.findById(...args);
export const create = (...args) => current.create(...args);
export const update = (...args) => current.update(...args);
export const deleteResource = (...args) => current.deleteResource(...args);
export const clearAll = (...args) => current.clearAll(...args);
export const insertResource = (...args) => current.insertResource(...args);
export const count = (...args) => current.count(...args);

/**
 * Clear every collection the store has opened.
 *
 * Kept because callers use it; it is `clearAll` across everything rather than a
 * distinct capability, so it is not part of the store contract.
 */
export function clearAllDatabases() {
  for (const collection of Object.keys(current.snapshot())) {
    current.clearAll(collection);
  }
}

export const closeAll = () => current.close();

/**
 * @deprecated Reaches the raw SQLite handle, which only the SQL store has.
 *
 * `search-engine.js` and `handlers/search-handler.js` still use this to build
 * queries the store cannot express — range comparisons, array membership,
 * full-text across every value, a configurable ORDER BY. Those are the last
 * callers, and reconciling them is what decides the store's eventual query
 * shape; see `stores/contract.js`.
 */
export const getDatabase = (resourceName) => sqliteHandle(current, resourceName);
