/**
 * The undo log: a commit keeps every write; a rollback puts back what the
 * writes changed and removes what they created, against both stores.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryStore } from '../../src/stores/memory-store.js';
import { createSqliteStore } from '../../src/stores/sqlite-store.js';
import { openUndoLog } from '../../src/undo-log.js';

const C = 'widgets';
const EVENTS = 'events';

const implementations = [
  { name: 'memory', make: () => ({ store: createMemoryStore(), cleanup: () => {} }) },
  {
    name: 'sqlite',
    make: () => {
      const dir = mkdtempSync(join(tmpdir(), 'undo-log-'));
      const store = createSqliteStore({ dataDir: dir });
      return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
    },
  },
];

for (const impl of implementations) {
  describe(`undo log — ${impl.name}`, () => {
    let store;
    let cleanup;

    beforeEach(() => {
      ({ store, cleanup } = impl.make());
      store.insertResource(C, { id: 'kept', name: 'Kept', status: 'open', createdAt: '2024-01-01T00:00:00Z' });
      store.insertResource(C, { id: 'gone', name: 'Gone', status: 'open', createdAt: '2024-01-02T00:00:00Z' });
    });
    afterEach(() => cleanup());

    const writeEverything = () => {
      store.create(C, { id: 'new', name: 'New' });
      store.update(C, 'kept', { name: 'Changed' });
      store.deleteResource(C, 'gone');
      store.insertResource(C, { id: 'inserted', name: 'Inserted' });
      store.append(EVENTS, { id: 'event-1', type: 'x.widget.created' });
    };

    it('a commit keeps every write', () => {
      const undo = openUndoLog(store);
      writeEverything();
      undo.commit();
      assert.strictEqual(store.findById(C, 'new').name, 'New');
      assert.strictEqual(store.findById(C, 'kept').name, 'Changed');
      assert.strictEqual(store.findById(C, 'gone'), null);
      assert.strictEqual(store.findById(C, 'inserted').name, 'Inserted');
      assert.ok(store.findById(EVENTS, 'event-1'));
    });

    it('a rollback restores updated and deleted records, and removes created and appended ones', () => {
      const keptBefore = store.findById(C, 'kept');
      const goneBefore = store.findById(C, 'gone');
      const undo = openUndoLog(store);
      writeEverything();
      undo.rollback();
      assert.deepStrictEqual(store.findById(C, 'kept'), keptBefore);
      assert.deepStrictEqual(store.findById(C, 'gone'), goneBefore);
      assert.strictEqual(store.findById(C, 'new'), null);
      assert.strictEqual(store.findById(C, 'inserted'), null);
      assert.strictEqual(store.findById(EVENTS, 'event-1'), null);
    });

    it('a record written twice is restored to how it was before either write', () => {
      const keptBefore = store.findById(C, 'kept');
      const undo = openUndoLog(store);
      store.update(C, 'kept', { name: 'First' });
      store.update(C, 'kept', { name: 'Second' });
      undo.rollback();
      assert.deepStrictEqual(store.findById(C, 'kept'), keptBefore);
    });

    it('closing the log stops logging: writes after it stay', () => {
      const undo = openUndoLog(store);
      undo.commit();
      store.create(C, { id: 'after', name: 'After' });
      assert.strictEqual(store.findById(C, 'after').name, 'After');
    });
  });
}
