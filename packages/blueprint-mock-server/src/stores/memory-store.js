/**
 * In-memory store. Records in a Map per collection, no persistence.
 *
 * Runs anywhere — this module imports nothing from Node, which is what lets the
 * engines be exercised in a browser or in a test without a database file. A
 * module-graph test holds that property, because it is the kind that holds on
 * day one and rots silently afterwards.
 *
 * Not persisting is the right behaviour rather than a shortcoming. `seeder.js`
 * clears every collection on startup before seeding, so nothing in this package
 * reads state written by an earlier process; and a prototype should hand a
 * session to `snapshot()` and serialise it deliberately rather than accumulate
 * state nobody asked it to keep.
 */

import { deepMerge } from '../deep-merge.js';
import { assertSafeFieldName, normalizeFilterValue } from './contract.js';

/** A stored record is never handed out by reference. See contract.js. */
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Read a dotted path, the way `json_extract(data, '$.a.b')` does — an absent
 * path yields undefined rather than throwing on a missing intermediate.
 */
function valueAt(record, path) {
  let current = record;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

/** Newest first, matching `ORDER BY json_extract(data, '$.createdAt') DESC`. */
function byCreatedAtDesc(a, b) {
  const av = a.createdAt ?? '';
  const bv = b.createdAt ?? '';
  if (av === bv) return 0;
  return av < bv ? 1 : -1;
}

/**
 * Validate every filter key before matching anything.
 *
 * Done up front rather than per record: inside the match loop the guard is
 * skipped entirely when a collection is empty, so an unsafe field name would be
 * rejected by the SQL store and silently accepted here. The contract says a
 * caller must not be able to pass a name one store refuses and another does not.
 */
function assertSafeFilters(filters) {
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    assertSafeFieldName(key);
  }
}

function matches(record, filters) {
  for (const [key, expected] of Object.entries(filters)) {
    if (expected === undefined) continue;
    const actual = valueAt(record, key);

    if (expected === null) {
      // json_extract returns NULL for an absent path as well as an explicit
      // null, so both match. composition-assembler relies on this.
      if (actual !== null && actual !== undefined) return false;
    } else if (normalizeFilterValue(actual) !== normalizeFilterValue(expected)) {
      // Both sides, so a stored `true` matches a filter of 1 the way
      // json_extract makes it, not only the other way round.
      return false;
    }
  }
  return true;
}

/**
 * @returns {import('./contract.js').Store}
 */
export function createMemoryStore() {
  /** @type {Map<string, Map<string, Object>>} */
  const collections = new Map();
  const collectionDefaults = new Map();

  function getCollection(collection) {
    if (!collections.has(collection)) collections.set(collection, new Map());
    return collections.get(collection);
  }

  /**
   * Matching records, newest first — **not cloned**, so internal only.
   *
   * Cloning happens after pagination rather than before. Cloning first meant
   * returning 25 of 2000 records deep-copied 1000 objects to hand back 25,
   * which measured twice as slow as SQL doing the same query — SQLite filters,
   * sorts and limits in the statement and only parses the rows it returns.
   * Every public path must clone what it hands out; see `page()`.
   */
  function selectMatching(collection, filters) {
    assertSafeFilters(filters);
    return [...getCollection(collection).values()]
      .filter((record) => matches(record, filters))
      .sort(byCreatedAtDesc);
  }

  /**
   * Slice a result set and clone only what is returned.
   *
   * Unrecognised option keys are ignored — see StoreQueryOptions.
   */
  function page(records, options) {
    if (options.limit === null) return records.map(clone);
    const { limit = 25, offset = 0 } = options;
    return records.slice(offset, offset + limit).map(clone);
  }

  const store = {
    registerCollectionDefaults(collection, defaults) {
      collectionDefaults.set(collection, defaults);
    },

    findAll(collection, filters = {}, options = {}) {
      const all = selectMatching(collection, filters);
      return { items: page(all, options), total: all.length };
    },

    search(collection, query, searchFields = [], options = {}) {
      if (!query || searchFields.length === 0) {
        return store.findAll(collection, {}, options);
      }

      for (const field of searchFields) assertSafeFieldName(field);

      const needle = String(query).toLowerCase();
      const all = selectMatching(collection, {}).filter((record) =>
        searchFields.some((field) => {
          const value = valueAt(record, field);
          return value !== null && value !== undefined && String(value).toLowerCase().includes(needle);
        })
      );

      return { items: page(all, options), total: all.length };
    },

    findById(collection, id) {
      return clone(getCollection(collection).get(id)) ?? null;
    },

    create(collection, data) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const resource = {
        ...(collectionDefaults.get(collection) || {}),
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      // Store a copy so a caller mutating the returned object cannot reach it,
      // and round-trip it so values JSON drops are dropped here too.
      getCollection(collection).set(id, clone(resource));
      return resource;
    },

    update(collection, id, updates) {
      const existing = store.findById(collection, id);
      if (!existing) return null;

      const updated = {
        ...deepMerge(existing, updates, ['id', 'createdAt']),
        updatedAt: new Date().toISOString(),
      };

      getCollection(collection).set(id, clone(updated));
      return updated;
    },

    deleteResource(collection, id) {
      return getCollection(collection).delete(id);
    },

    clearAll(collection) {
      getCollection(collection).clear();
    },

    insertResource(collection, resource) {
      // Mutates the argument, as the SQL store does.
      if (!resource.createdAt) resource.createdAt = new Date().toISOString();
      if (!resource.updatedAt) resource.updatedAt = resource.createdAt;

      getCollection(collection).set(resource.id, clone(resource));
    },

    count(collection) {
      return getCollection(collection).size;
    },

    snapshot() {
      const out = {};
      for (const collection of collections.keys()) {
        out[collection] = store.findAll(collection, {}, { limit: null }).items;
      }
      return out;
    },

    restore(snapshot) {
      for (const [collection, records] of Object.entries(snapshot)) {
        store.clearAll(collection);
        for (const record of records) store.insertResource(collection, { ...record });
      }
    },

    close() {
      // Nothing held.
    },
  };

  return store;
}
