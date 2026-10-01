/**
 * Which stores can answer a raw SQL query, and how.
 *
 * A raw database handle is deliberately not part of the store contract — an
 * in-memory store could never provide one, so putting it there would make the
 * interface a lie. But `search-engine.js` needs to know whether it can push a
 * query down into SQL or must filter in JS, and it must be able to ask without
 * importing the SQLite store, because importing it would pull `better-sqlite3`
 * into the module graph of every list endpoint and make the search engine
 * unusable in a browser.
 *
 * So the registry lives here, in a module that imports nothing: the SQLite
 * store registers itself, and anything that wants to know asks. Only
 * `sqlite-store.js` depends on the native module.
 *
 * `tests/unit/store-boundary.test.js` is what keeps that true — the first
 * version of this dispatch imported the SQLite store directly into the search
 * engine, which would have been invisible until a browser build failed.
 */

/** @type {WeakMap<object, (collection: string) => unknown>} */
const handles = new WeakMap();

/**
 * Declare that a store can produce a raw SQL handle per collection.
 *
 * @param {object} store
 * @param {(collection: string) => unknown} getHandle
 */
export function registerSqlCapability(store, getHandle) {
  handles.set(store, getHandle);
}

/**
 * The raw SQL handle for a collection, or null when the store has none.
 *
 * Returning null rather than throwing, because "this store has no SQL" is the
 * ordinary case a caller branches on, not an error.
 *
 * @param {object} store
 * @param {string} collection
 * @returns {unknown|null}
 */
export function sqlHandleFor(store, collection) {
  const getHandle = handles.get(store);
  return getHandle ? getHandle(collection) : null;
}

/**
 * Whether a store can answer SQL at all, without opening a collection.
 *
 * @param {object} store
 * @returns {boolean}
 */
export function hasSqlCapability(store) {
  return handles.has(store);
}
