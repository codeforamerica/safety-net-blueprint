/**
 * The parts of the SQLite store that are not contract behaviour.
 *
 * Everything the store contract requires is asserted in
 * `store-conformance.test.js`, against both implementations. What is left here
 * is SQLite's own: that it creates the file and table it needs, and that closing
 * releases the handles. Those were the only two cases in the old
 * `database-manager.test.js` that the conformance suite did not already cover,
 * so they moved here when that file — a test of a deprecated shim — was deleted.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSqliteStore, sqliteHandle } from '../../src/stores/sqlite-store.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';

function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-'));
  const store = createSqliteStore({ dataDir: dir });
  try {
    run(store, dir);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('sqlite store', () => {
  it('creates a database file per collection on first use', () => {
    withStore((store, dir) => {
      store.insertResource('widgets', { id: 'w1' });
      assert.ok(existsSync(join(dir, 'widgets.db')), 'widgets.db should exist');

      store.insertResource('gadgets', { id: 'g1' });
      const dbs = readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
      assert.deepStrictEqual(dbs, ['gadgets.db', 'widgets.db']);
    });
  });

  it('creates the resources table, so a read on a fresh collection works', () => {
    withStore((store) => {
      // Would throw "no such table" if the schema were not created on open.
      assert.deepStrictEqual(store.findAll('never-written-to'), { items: [], total: 0 });
    });
  });

  it('reuses one handle per collection rather than reopening', () => {
    withStore((store) => {
      store.insertResource('widgets', { id: 'w1' });
      assert.strictEqual(sqliteHandle(store, 'widgets'), sqliteHandle(store, 'widgets'));
    });
  });

  it('close releases every handle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-'));
    const store = createSqliteStore({ dataDir: dir });
    try {
      store.insertResource('widgets', { id: 'w1' });
      const handle = sqliteHandle(store, 'widgets');
      assert.strictEqual(handle.open, true);

      store.close();
      assert.strictEqual(handle.open, false, 'the handle should be closed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('data written before close is still there after reopening the same directory', () => {
    // Not a behaviour anything relies on — the server clears and reseeds every
    // collection at startup — but it is the one thing this store does that the
    // in-memory one cannot, so it is worth pinning that it actually does it.
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-'));
    try {
      const first = createSqliteStore({ dataDir: dir });
      first.insertResource('widgets', { id: 'w1', name: 'kept' });
      first.close();

      const second = createSqliteStore({ dataDir: dir });
      assert.strictEqual(second.findById('widgets', 'w1')?.name, 'kept');
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sqliteHandle refuses a store that has no SQL', () => {
    assert.throws(
      () => sqliteHandle(createMemoryStore(), 'widgets'),
      /not SQLite-backed/
    );
  });
});
