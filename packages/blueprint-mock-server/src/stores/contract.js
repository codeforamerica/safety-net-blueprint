/**
 * The store contract.
 *
 * A store holds resources for the life of a session and answers queries about
 * them. It is deliberately *not* responsible for durability: `seeder.js` clears
 * every collection on startup before seeding, so nothing in this package reads
 * state written by an earlier process. The SQLite store's file persistence is
 * incidental rather than relied upon.
 *
 * Every method is **synchronous**. Both implementations that exist are natively
 * synchronous — `better-sqlite3` is a synchronous binding, and the in-memory
 * store is Maps — so promises would buy nothing and would force the engines and
 * every handler to become async. Data that has to be waited for belongs behind
 * an adapter contract rather than behind this interface.
 *
 * ## Status: provisional
 *
 * This interface was extracted from `database-manager.js` rather than designed,
 * so it describes what the engines already do and not what a store ought to
 * offer. It is under-powered in a way the package itself demonstrates:
 * `search-engine.js` and `handlers/search-handler.js` bypass it entirely and
 * build their own SQL, because `findAll`'s flat equality filters and fixed
 * `createdAt DESC` ordering cannot express range comparisons (`q=field:>=value`),
 * array membership, full-text across every value, prefix matching, or a
 * configurable ORDER BY with a tie-breaker.
 *
 * Treat the method names as settled and the query shape as not. The time to
 * revisit it is when the search path stops using raw SQL, since that is the
 * change that will actually need operators and declarative ordering — at which
 * point `@mswjs/data`'s `{ where: { field: { gte } }, orderBy, take, skip }` is
 * the prior art worth comparing against, being the shape the browser-mocking
 * ecosystem already uses. Every package here is 0.x, so widening this later is a
 * minor bump carrying a `**Breaking:**` note.
 *
 * ## Implementing another store
 *
 * The conformance suite (`tests/unit/store-conformance.test.js`) is the
 * executable specification: a new implementation is correct when it passes.
 * Three behaviours are easy to get wrong because they fall out of SQLite's
 * storage model rather than from anything obvious in the method names.
 *
 * 1. **Reads return copies, not references.** The SQLite store round-trips every
 *    record through `JSON.stringify`/`JSON.parse`, so a caller that mutates a
 *    returned object cannot reach stored state. An implementation handing back
 *    its own objects would let callers corrupt the store by accident, and would
 *    also preserve values JSON drops — `undefined`, `Date`, `NaN`.
 *
 * 2. **`findAll` and `search` order by `createdAt` descending** by default, not
 *    by insertion order.
 *
 * 3. **A `null` filter value matches missing *and* null.** SQLite's
 *    `json_extract` returns NULL both for a path that is absent and for a value
 *    that is explicitly null, and `composition-assembler.js` depends on this to
 *    find section-level records that carry no `itemId`.
 *
 * @typedef {Object} Store
 *
 * @property {(collection: string, defaults: Object) => void} registerCollectionDefaults
 *   Default field values applied by `create` to every new record in a
 *   collection. Used so readOnly required fields (`evidence: []`) are present on
 *   creation. Set at startup from response schemas.
 *
 * @property {(collection: string, filters?: Object, options?: StoreQueryOptions) => {items: Object[], total: number}} findAll
 *   Filters are field-path/value pairs; a path may be dotted (`name.firstName`).
 *   An `undefined` value is ignored; `null` matches missing-or-null. `total` is
 *   the count *before* pagination.
 *
 * @property {(collection: string, query: string, searchFields?: string[], options?: StoreQueryOptions) => {items: Object[], total: number}} search
 *   Case-insensitive substring match across any of `searchFields`. With no query
 *   or no fields, delegates to `findAll` with **no filters** — note that any
 *   filters the caller passed are dropped, not applied. Options behave as in
 *   `findAll`, including `limit: null`.
 *
 * @property {(collection: string, id: string) => Object|null} findById
 *
 * @property {(collection: string, data: Object) => Object} create
 *   Mints `id`, `createdAt` and `updatedAt`, applies registered defaults, and
 *   returns the created record.
 *
 * @property {(collection: string, id: string, updates: Object) => Object|null} update
 *   Deep-merges `updates` into the existing record, preserving `id` and
 *   `createdAt`, and refreshes `updatedAt`. Returns null when the id is unknown.
 *
 * @property {(collection: string, id: string) => boolean} deleteResource
 *   True when a record was removed, false when the id was unknown.
 *
 * @property {(collection: string) => void} clearAll
 *   Removes every record from one collection. The collection continues to exist.
 *
 * @property {(collection: string, resource: Object) => void} insertResource
 *   Insert-or-replace at a caller-supplied id, for seeding. Fills in `createdAt`
 *   and `updatedAt` when absent — **by mutating the argument**, which callers in
 *   this package rely on.
 *
 * @property {(collection: string) => number} count
 *   Records in one collection, ignoring filters.
 *
 * @property {() => Object<string, Object[]>} snapshot
 *   Every collection's records, keyed by collection name, as plain data. The
 *   primitive a consumer needs to serialise a session; where the bytes go is the
 *   consumer's business, not the store's.
 *
 * @property {(snapshot: Object<string, Object[]>) => void} restore
 *   Replaces the contents of each named collection wholesale. Collections absent
 *   from the snapshot are left alone.
 *
 * @property {() => void} close
 *   Releases whatever the implementation holds. A no-op for in-memory stores.
 */

/**
 * Options for a read.
 *
 * An options object rather than positional arguments, and **open**: an
 * implementation ignores keys it does not recognise. That is what makes widening
 * this additive — a future `sort` costs no call-site change and breaks no
 * existing store, whereas a fourth positional parameter would do both.
 *
 * @typedef {Object} StoreQueryOptions
 * @property {number|null} [limit=25] - Records to return. `null` means every
 *   matching record, with no offset applied.
 * @property {number} [offset=0]
 */

/**
 * Normalise a filter value to what a stored JSON value can be compared against.
 *
 * SQLite cannot bind a boolean at all — `better-sqlite3` raises "can only bind
 * numbers, strings, bigints, buffers, and null" — and `json_extract` yields 1
 * and 0 for JSON true and false. So a boolean filter used to throw against SQL
 * while matching in memory, and `{ active: 1 }` matched in SQL while missing in
 * memory. Collapsing booleans to 1/0 on both sides is what makes a filter mean
 * the same thing wherever it runs.
 *
 * Applied by every implementation, like `assertSafeFieldName` — a rule only one
 * store follows is not part of a contract.
 *
 * @param {*} value
 * @returns {*} The value as stored comparison semantics see it.
 */
export function normalizeFilterValue(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * Reject a field path that could be interpolated into a query.
 *
 * Filters and search fields reach SQLite inside a `json_extract` path, which is
 * string-interpolated rather than bound, so the allowed character set is the
 * only thing standing between a caller-supplied field name and injection. Every
 * implementation must apply it, not only the SQL one — the guard belongs to the
 * contract, so that a caller cannot pass a field name that one store rejects and
 * another accepts.
 *
 * @param {string} name
 */
export function assertSafeFieldName(name) {
  if (!/^[a-zA-Z0-9_.]+$/.test(name)) {
    throw new Error(`Unsafe field name rejected: ${name}`);
  }
}
