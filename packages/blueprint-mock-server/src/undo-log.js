/**
 * An undo log for the store: how a database rolls back a transaction.
 *
 * While it's open, every write first records what it's about to lose — the
 * record as it was, or that there was none — and a rollback puts those back,
 * newest first. A commit drops the log. Only the records the writes touched
 * are restored; nothing else is read or copied.
 *
 * An editable composition's patch opens one, so that if any of its changes
 * is refused, the ones already made are undone and nothing is saved.
 *
 * It wraps the store's write methods in place, since every route holds the
 * same store. Writes that other requests make while it's open would be logged
 * too, so a patch runs its changes back to back, without waiting on anything
 * outside the mock in between.
 */

const WRITES = ['create', 'update', 'deleteResource', 'insertResource', 'append'];

/**
 * Open an undo log on a store.
 *
 * @param {object} store
 * @returns {{ commit: () => void, rollback: () => void }}
 */
export function openUndoLog(store) {
  const original = Object.fromEntries(WRITES.map((name) => [name, store[name]]));
  const log = [];
  const remember = (collection, id) => {
    if (id !== undefined && id !== null) log.push({ collection, id, record: store.findById(collection, id) });
  };

  store.create = (collection, data) => {
    // A create names a record that didn't exist; the id may be the store's.
    const created = original.create.call(store, collection, data);
    log.push({ collection, id: created.id, record: null });
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
    remember(collection, resource?.id);
    return original.insertResource.call(store, collection, resource);
  };
  if (typeof original.append === 'function') {
    store.append = (collection, record) => {
      remember(collection, record?.id);
      return original.append.call(store, collection, record);
    };
  }

  const close = () => {
    for (const name of WRITES) {
      if (original[name] === undefined) delete store[name];
      else store[name] = original[name];
    }
  };

  return {
    commit() {
      close();
    },
    rollback() {
      close();
      for (const { collection, id, record } of log.reverse()) {
        store.deleteResource(collection, id);
        if (record) store.insertResource(collection, structuredClone(record));
      }
    },
  };
}
