/**
 * SQLite-backed store. One database file per collection, records held as JSON
 * text in a single `data` column so the schema does not have to be declared.
 *
 * This is the behaviour every other implementation is measured against — see
 * `contract.js` for the parts of it that are not obvious from the method names.
 *
 * Node-only: it loads `better-sqlite3`, a native module. Reached through the
 * package root rather than its own export for that reason.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { deepMerge } from '../deep-merge.js';
import { assertSafeFieldName, normalizeFilterValue } from './contract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(__dirname, '../../generated/mock-data');

/**
 * Raw SQLite handles, by store.
 *
 * Deliberately outside the store object. `search-engine.js` and
 * `handlers/search-handler.js` build queries the contract cannot express and
 * need the handle, but putting `getDatabase` on the store would make it look
 * like part of the interface — and the in-memory store could never provide it.
 * Keeping it here means the contract surface stays honest and the escape hatch
 * is visibly an escape hatch. Both callers going away is what retires this.
 */
const handles = new WeakMap();

/**
 * The SQLite handle for one collection, for the two callers that still build
 * their own SQL. Throws for any store that is not SQLite-backed.
 *
 * @deprecated Route the query through the store instead; see `contract.js`.
 */
export function sqliteHandle(store, collection) {
  const getDatabase = handles.get(store);
  if (!getDatabase) {
    throw new Error(
      'sqliteHandle() was given a store that is not SQLite-backed. Raw SQL has no ' +
        'equivalent in an in-memory store — express the query through the store contract.'
    );
  }
  return getDatabase(collection);
}

/**
 * @param {Object} [options]
 * @param {string} [options.dataDir] - Where the `.db` files live.
 * @returns {import('./contract.js').Store}
 */
export function createSqliteStore({ dataDir = DEFAULT_DATA_DIR } = {}) {
  const databases = new Map();
  const collectionDefaults = new Map();

  function getDatabase(collection) {
    if (databases.has(collection)) return databases.get(collection);

    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const db = new Database(join(dataDir, `${collection}.db`));
    db.pragma('journal_mode = WAL');

    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS resources (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
      `);
    } catch (error) {
      console.error(`Failed to create resources table for ${collection}:`, error);
      throw error;
    }

    // Indexes over the fields most often filtered on. Failure is not fatal —
    // a field may be absent from every record in this collection.
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_name_firstName ON resources(json_extract(data, '$.name.firstName'));`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_name_lastName ON resources(json_extract(data, '$.name.lastName'));`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_status ON resources(json_extract(data, '$.status'));`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_email ON resources(json_extract(data, '$.email'));`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_createdAt ON resources(json_extract(data, '$.createdAt'));`);
    } catch (error) {
      console.warn(`Warning: Could not create indexes for ${collection}:`, error.message);
    }

    databases.set(collection, db);
    return db;
  }

  /** Build the WHERE clause and bound parameters for a filter object. */
  function buildWhere(filters) {
    const clauses = [];
    const params = [];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined) continue;
      assertSafeFieldName(key);
      if (value === null) {
        // json_extract yields NULL for an absent path as well as an explicit
        // null, so this matches both. Callers depend on that.
        clauses.push(`json_extract(data, '$.${key}') IS NULL`);
      } else {
        clauses.push(`json_extract(data, '$.${key}') = ?`);
        params.push(normalizeFilterValue(value));
      }
    }

    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  const store = {
    registerCollectionDefaults(collection, defaults) {
      collectionDefaults.set(collection, defaults);
    },

    findAll(collection, filters = {}, options = {}) {
      const db = getDatabase(collection);
      const { limit = 25, offset = 0 } = options;
      // limit: null means every record, with no LIMIT clause at all. Callers
      // that filter or paginate in JS afterwards (the composition assembler)
      // pass null so they see the whole filtered set first.
      // Unrecognised option keys are ignored — see StoreQueryOptions.
      const unlimited = options.limit === null;

      const { where, params } = buildWhere(filters);

      const { count: total } = db
        .prepare(`SELECT COUNT(*) as count FROM resources ${where}`)
        .get(...params);

      const query = unlimited
        ? `SELECT data FROM resources ${where} ORDER BY json_extract(data, '$.createdAt') DESC`
        : `SELECT data FROM resources ${where} ORDER BY json_extract(data, '$.createdAt') DESC LIMIT ? OFFSET ?`;

      const rows = unlimited
        ? db.prepare(query).all(...params)
        : db.prepare(query).all(...params, limit, offset);

      return { items: rows.map((row) => JSON.parse(row.data)), total };
    },

    search(collection, query, searchFields = [], options = {}) {
      const db = getDatabase(collection);
      const { limit = 25, offset = 0 } = options;
      const unlimited = options.limit === null;

      if (!query || searchFields.length === 0) {
        return store.findAll(collection, {}, options);
      }

      const where = `WHERE ${searchFields
        .map((field) => {
          assertSafeFieldName(field);
          return `LOWER(json_extract(data, '$.${field}')) LIKE LOWER(?)`;
        })
        .join(' OR ')}`;

      const params = searchFields.map(() => `%${query}%`);

      const { count: total } = db
        .prepare(`SELECT COUNT(*) as count FROM resources ${where}`)
        .get(...params);

      // limit: null omits the LIMIT clause rather than binding null to it.
      // Binding null raises SQLITE_MISMATCH, which is what this did before the
      // store was extracted — caught by the conformance suite, and safe to fix
      // because nothing called search() with a null limit.
      const sql = unlimited
        ? `SELECT data FROM resources ${where} ORDER BY json_extract(data, '$.createdAt') DESC`
        : `SELECT data FROM resources ${where} ORDER BY json_extract(data, '$.createdAt') DESC LIMIT ? OFFSET ?`;

      const rows = unlimited
        ? db.prepare(sql).all(...params)
        : db.prepare(sql).all(...params, limit, offset);

      return { items: rows.map((row) => JSON.parse(row.data)), total };
    },

    findById(collection, id) {
      const row = getDatabase(collection)
        .prepare('SELECT data FROM resources WHERE id = ?')
        .get(id);
      return row ? JSON.parse(row.data) : null;
    },

    create(collection, data) {
      const db = getDatabase(collection);
      const id = randomUUID();
      const now = new Date().toISOString();

      const resource = {
        ...(collectionDefaults.get(collection) || {}),
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      db.prepare('INSERT INTO resources (id, data) VALUES (?, ?)').run(id, JSON.stringify(resource));
      return resource;
    },

    update(collection, id, updates) {
      const existing = store.findById(collection, id);
      if (!existing) return null;

      const updated = {
        ...deepMerge(existing, updates, ['id', 'createdAt']),
        updatedAt: new Date().toISOString(),
      };

      getDatabase(collection)
        .prepare('UPDATE resources SET data = ? WHERE id = ?')
        .run(JSON.stringify(updated), id);

      return updated;
    },

    deleteResource(collection, id) {
      const result = getDatabase(collection)
        .prepare('DELETE FROM resources WHERE id = ? RETURNING id')
        .get(id);
      return result !== undefined;
    },

    clearAll(collection) {
      getDatabase(collection).prepare('DELETE FROM resources').run();
    },

    insertResource(collection, resource) {
      // Mutates the argument. Callers in this package pass an object they then
      // go on to read the timestamps from, so filling them in on a copy would
      // change behaviour.
      if (!resource.createdAt) resource.createdAt = new Date().toISOString();
      if (!resource.updatedAt) resource.updatedAt = resource.createdAt;

      getDatabase(collection)
        .prepare('INSERT OR REPLACE INTO resources (id, data) VALUES (?, ?)')
        .run(resource.id, JSON.stringify(resource));
    },

    count(collection) {
      const { count } = getDatabase(collection)
        .prepare('SELECT COUNT(*) as count FROM resources')
        .get();
      return count;
    },

    snapshot() {
      const out = {};
      for (const collection of databases.keys()) {
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
      for (const [name, db] of databases.entries()) {
        db.close();
        databases.delete(name);
      }
    },
  };

  handles.set(store, getDatabase);
  return store;
}
