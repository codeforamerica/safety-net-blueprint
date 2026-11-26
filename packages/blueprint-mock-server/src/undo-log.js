/**
 * An undo log for the store: how a database rolls back a transaction.
 *
 * While it's open, every write first records what it's about to lose — the
 * record as it was, or that there was none — and a rollback puts those back,
 * newest first. A commit drops the log. Only the records the writes touched
 * are restored; nothing else is read or copied.
 *
 * An editable composition's patch opens one, so that if any of its changes
 * is refused, the ones already made are undone and nothing is saved. An
 * action or a reaction opens one for its domain's records (transaction.js).
 *
 * The store's write methods are wrapped in place once, since every route
 * holds the same store, and each write is recorded in every log open at the
 * time. So logs can be open together and close in any order, and a log
 * opened inside another — an action called from an action — has its
 * rollback recorded in the outer one too. Writes that other requests make
 * while a log is open are recorded as well, so whatever opens one runs its
 * changes back to back, without waiting on anything outside the mock in
 * between.
 */

const WRITES = ['create', 'update', 'deleteResource', 'insertResource', 'append'];

/** The logs open on each store. */
const openLogs = new WeakMap();

/** Wrap a store's write methods, once, so each write is recorded in every open log. */
function watch(store) {
  if (openLogs.has(store)) return openLogs.get(store);
  const logs = new Set();
  openLogs.set(store, logs);
  const original = Object.fromEntries(WRITES.map((name) => [name, store[name]]));
  const remember = (collection, id, record) => {
    if (id === undefined || id === null) return;
    for (const log of logs) {
      if (log.only(collection, record)) log.entries.push({ collection, id, record: original.findById.call(store, collection, id) });
    }
  };
  original.findById = store.findById;

  store.create = (collection, data) => {
    // A create names a record that didn't exist; the id may be the store's.
    const created = original.create.call(store, collection, data);
    for (const log of logs) {
      if (log.only(collection, created)) log.entries.push({ collection, id: created.id, record: null });
    }
    return created;
  };
  store.update = (collection, id, updates) => {
    remember(collection, id);
    return original.update.call(store, collection, id, updates);
  };
  store.deleteResource = (collection, id) => {
    remember(collection, id);
    return original.deleteResource.call(store, collection, id);
  };
  store.insertResource = (collection, resource) => {
    remember(collection, resource?.id, resource);
    return original.insertResource.call(store, collection, resource);
  };
  if (typeof original.append === 'function') {
    store.append = (collection, record) => {
      remember(collection, record?.id, record);
      return original.append.call(store, collection, record);
    };
  }
  return logs;
}

/**
 * Open an undo log on a store.
 *
 * @param {object} store
 * @param {{ only?: (collection: string, record?: object) => boolean }} [options] -
 *   The writes to record, by collection, and by the record written when the
 *   write carries one; every write when omitted
 * @returns {{ commit: () => void, rollback: () => void }}
 */
export function openUndoLog(store, { only = () => true } = {}) {
  const logs = watch(store);
  const log = { only, entries: [] };
  logs.add(log);

  return {
    commit() {
      logs.delete(log);
    },
    rollback() {
      logs.delete(log);
      for (const { collection, id, record } of log.entries.reverse()) {
        store.deleteResource(collection, id);
        if (record) store.insertResource(collection, structuredClone(record));
      }
    },
  };
}
