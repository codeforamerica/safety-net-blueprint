/**
 * The executable form of the store contract.
 *
 * Every case runs against both implementations, so "the memory store behaves
 * like the SQLite one" is asserted rather than hoped for. A new store is correct
 * when it passes this file.
 *
 * Most of what is pinned here is not obvious from the method names — it falls
 * out of SQLite's storage model, and an in-memory store written from the
 * signatures alone would get it wrong in three specific ways: handing out
 * references instead of copies, ordering by insertion instead of `createdAt`,
 * and treating a null filter as "explicitly null" rather than "null or absent".
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryStore } from '../../src/stores/memory-store.js';
import { createSqliteStore } from '../../src/stores/sqlite-store.js';

const C = 'widgets';

/** Seed three records with known, deliberately out-of-order createdAt values. */
function seedThree(store) {
  store.insertResource(C, { id: 'b', name: 'Beta', status: 'open', createdAt: '2024-02-01T00:00:00Z' });
  store.insertResource(C, { id: 'a', name: 'Alpha', status: 'open', createdAt: '2024-03-01T00:00:00Z' });
  store.insertResource(C, { id: 'c', name: 'Gamma', status: 'closed', createdAt: '2024-01-01T00:00:00Z' });
}

/**
 * The method names the contract declares.
 *
 * Kept as data rather than inferred from one implementation, so that dropping a
 * method from both stores at once still fails. A JSDoc typedef is not enforced
 * at runtime, so without this the only thing catching a missing method is some
 * other test happening to call it.
 */
const CONTRACT_METHODS = [
  'registerCollectionDefaults',
  'findAll',
  'search',
  'findById',
  'create',
  'update',
  'deleteResource',
  'clearAll',
  'insertResource',
  'count',
  'snapshot',
  'restore',
  'close',
];

const implementations = [
  {
    name: 'memory',
    make: () => ({ store: createMemoryStore(), cleanup: () => {} }),
  },
  {
    name: 'sqlite',
    make: () => {
      const dir = mkdtempSync(join(tmpdir(), 'store-conf-'));
      const store = createSqliteStore({ dataDir: dir });
      return {
        store,
        cleanup: () => {
          store.close();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
];

for (const impl of implementations) {
  describe(`store contract — ${impl.name}`, () => {
    let store;
    let cleanup;

    before(() => {
      ({ store, cleanup } = impl.make());
    });
    after(() => cleanup());
    beforeEach(() => store.clearAll(C));

    describe('reads return copies, not references', () => {
      it('mutating a findById result cannot reach stored state', () => {
        store.insertResource(C, { id: 'x', name: 'original' });
        const first = store.findById(C, 'x');
        first.name = 'mutated';
        first.nested = { added: true };

        assert.strictEqual(store.findById(C, 'x').name, 'original');
        assert.strictEqual(store.findById(C, 'x').nested, undefined);
      });

      it('mutating a findAll item cannot reach stored state', () => {
        store.insertResource(C, { id: 'x', tags: ['one'] });
        store.findAll(C).items[0].tags.push('two');
        assert.deepStrictEqual(store.findAll(C).items[0].tags, ['one']);
      });

      it('mutating the object passed to insertResource cannot reach stored state', () => {
        const record = { id: 'x', name: 'original' };
        store.insertResource(C, record);
        record.name = 'mutated';
        assert.strictEqual(store.findById(C, 'x').name, 'original');
      });

      it('drops what JSON drops', () => {
        // Not a nicety — the SQL store round-trips through JSON, so any store
        // that preserved these would diverge the moment a caller relied on it.
        store.insertResource(C, { id: 'x', gone: undefined, when: new Date('2024-01-01T00:00:00Z') });
        const read = store.findById(C, 'x');
        assert.ok(!('gone' in read), 'undefined is not stored');
        assert.strictEqual(typeof read.when, 'string', 'a Date comes back as a string');
      });
    });

    describe('ordering', () => {
      it('findAll returns newest first by createdAt, not insertion order', () => {
        seedThree(store);
        assert.deepStrictEqual(
          store.findAll(C, {}, { limit: null }).items.map((r) => r.id),
          ['a', 'b', 'c']
        );
      });

      it('search returns newest first too', () => {
        seedThree(store);
        assert.deepStrictEqual(
          store.search(C, 'a', ['name']).items.map((r) => r.id),
          ['a', 'b', 'c']  // Alpha, Beta and Gamma all contain an "a"
        );
      });
    });

    describe('filters', () => {
      it('matches on an exact value', () => {
        seedThree(store);
        assert.deepStrictEqual(
          store.findAll(C, { status: 'open' }, { limit: null }).items.map((r) => r.id),
          ['a', 'b']
        );
      });

      it('ignores an undefined filter value rather than matching on it', () => {
        seedThree(store);
        assert.strictEqual(store.findAll(C, { status: undefined }, { limit: null }).items.length, 3);
      });

      it('a null filter matches records where the field is absent', () => {
        // The case composition-assembler depends on: section-level records
        // carry no itemId at all, and must be found by filtering itemId: null.
        store.insertResource(C, { id: 'section', createdAt: '2024-01-01T00:00:00Z' });
        store.insertResource(C, { id: 'item', itemId: 'i-1', createdAt: '2024-01-02T00:00:00Z' });

        const found = store.findAll(C, { itemId: null }, { limit: null }).items;
        assert.deepStrictEqual(found.map((r) => r.id), ['section']);
      });

      it('a null filter also matches an explicit null', () => {
        store.insertResource(C, { id: 'explicit', itemId: null, createdAt: '2024-01-01T00:00:00Z' });
        assert.strictEqual(store.findAll(C, { itemId: null }, { limit: null }).items.length, 1);
      });

      it('matches on a dotted path', () => {
        store.insertResource(C, { id: 'x', name: { firstName: 'Ada' }, createdAt: '2024-01-01T00:00:00Z' });
        store.insertResource(C, { id: 'y', name: { firstName: 'Bo' }, createdAt: '2024-01-02T00:00:00Z' });
        assert.deepStrictEqual(
          store.findAll(C, { 'name.firstName': 'Ada' }, { limit: null }).items.map((r) => r.id),
          ['x']
        );
      });

      it('a dotted path through a missing intermediate does not throw', () => {
        store.insertResource(C, { id: 'x', createdAt: '2024-01-01T00:00:00Z' });
        assert.strictEqual(store.findAll(C, { 'name.firstName': 'Ada' }, { limit: null }).items.length, 0);
      });

      it('treats a boolean filter the same way in both stores', () => {
        // SQLite cannot bind a boolean, and json_extract yields 1/0 for JSON
        // true/false — so before normalisation a boolean filter threw against
        // SQL while matching in memory, and { active: 1 } matched in SQL while
        // missing in memory. Both are collapsed to 1/0 on each side now.
        store.insertResource(C, { id: 'on', active: true, createdAt: '2024-01-02T00:00:00Z' });
        store.insertResource(C, { id: 'off', active: false, createdAt: '2024-01-01T00:00:00Z' });

        const ids = (f) => store.findAll(C, f, { limit: null }).items.map((r) => r.id);
        assert.deepStrictEqual(ids({ active: true }), ['on']);
        assert.deepStrictEqual(ids({ active: 1 }), ['on'], 'a filter of 1 matches a stored true');
        assert.deepStrictEqual(ids({ active: false }), ['off']);
        assert.deepStrictEqual(ids({ active: 0 }), ['off'], 'a filter of 0 matches a stored false');
      });

      it('does not coerce across string and number', () => {
        store.insertResource(C, { id: 'n', n: 5, s: '5', createdAt: '2024-01-01T00:00:00Z' });
        assert.strictEqual(store.findAll(C, { n: '5' }, { limit: null }).items.length, 0);
        assert.strictEqual(store.findAll(C, { s: 5 }, { limit: null }).items.length, 0);
      });

      it('rejects an unsafe field name', () => {
        assert.throws(() => store.findAll(C, { "a' OR '1'='1": 'x' }), /Unsafe field name/);
      });
    });

    describe('pagination', () => {
      it('defaults to 25 and reports the pre-pagination total', () => {
        for (let i = 0; i < 30; i++) {
          store.insertResource(C, { id: `r${i}`, createdAt: `2024-01-01T00:00:${String(i).padStart(2, '0')}Z` });
        }
        const page = store.findAll(C);
        assert.strictEqual(page.items.length, 25);
        assert.strictEqual(page.total, 30);
      });

      it('honours limit and offset', () => {
        seedThree(store);
        const page = store.findAll(C, {}, { limit: 1, offset: 1 });
        assert.deepStrictEqual(page.items.map((r) => r.id), ['b']);
        assert.strictEqual(page.total, 3);
      });

      it('limit: null returns every record', () => {
        for (let i = 0; i < 30; i++) store.insertResource(C, { id: `r${i}` });
        assert.strictEqual(store.findAll(C, {}, { limit: null }).items.length, 30);
      });

      it('ignores an option key it does not recognise', () => {
        // The documented extensibility guarantee: a future `sort` must be
        // addable without breaking an existing store, which only holds if
        // unknown keys are ignored rather than rejected. Untested, that claim
        // would rot the first time someone added validation here.
        seedThree(store);
        const withUnknown = store.findAll(C, {}, { limit: null, sort: 'name', notAThing: true });
        assert.deepStrictEqual(withUnknown.items.map((r) => r.id), ['a', 'b', 'c']);
        assert.strictEqual(withUnknown.total, 3);
      });

      it('search honours limit: null too', () => {
        // Before the store was extracted this raised SQLITE_MISMATCH, from
        // binding null to `LIMIT ?`. Found by running this suite against both
        // implementations; safe to fix because search() had no callers.
        for (let i = 0; i < 30; i++) store.insertResource(C, { id: `r${i}`, name: `match ${i}` });
        assert.strictEqual(store.search(C, 'match', ['name'], { limit: null }).items.length, 30);
      });

      it('search with no query delegates to findAll and drops filters', () => {
        seedThree(store);
        assert.strictEqual(store.search(C, '', ['name'], { limit: null }).items.length, 3);
        assert.strictEqual(store.search(C, 'open', [], { limit: null }).items.length, 3);
      });
    });

    describe('search matching', () => {
      it('is a case-insensitive substring match', () => {
        store.insertResource(C, { id: 'x', name: 'Alphabet' });
        assert.strictEqual(store.search(C, 'PHAB', ['name']).items.length, 1);
      });

      it('matches when any one field matches', () => {
        store.insertResource(C, { id: 'x', name: 'nope', status: 'findme' });
        assert.strictEqual(store.search(C, 'findme', ['name', 'status']).items.length, 1);
      });

      it('rejects an unsafe search field', () => {
        store.insertResource(C, { id: 'x', name: 'a' });
        assert.throws(() => store.search(C, 'a', ["name') OR 1=1 --"]), /Unsafe field name/);
      });
    });

    describe('create', () => {
      it('mints id, createdAt and updatedAt', () => {
        const created = store.create(C, { name: 'New' });
        assert.ok(created.id);
        assert.ok(created.createdAt);
        assert.strictEqual(created.updatedAt, created.createdAt);
        assert.strictEqual(store.findById(C, created.id).name, 'New');
      });

      it('applies registered collection defaults', () => {
        store.registerCollectionDefaults(C, { evidence: [] });
        const created = store.create(C, { name: 'New' });
        assert.deepStrictEqual(created.evidence, []);
      });

      it('lets supplied data override a default', () => {
        store.registerCollectionDefaults(C, { status: 'draft' });
        assert.strictEqual(store.create(C, { status: 'open' }).status, 'open');
      });
    });

    describe('update', () => {
      it('deep merges rather than replacing', () => {
        store.insertResource(C, { id: 'x', name: { firstName: 'Ada', lastName: 'L' } });
        const updated = store.update(C, 'x', { name: { firstName: 'Grace' } });
        assert.strictEqual(updated.name.firstName, 'Grace');
        assert.strictEqual(updated.name.lastName, 'L', 'untouched subfield survives');
      });

      it('preserves id and createdAt, refreshes updatedAt', () => {
        store.insertResource(C, { id: 'x', createdAt: '2020-01-01T00:00:00Z' });
        const updated = store.update(C, 'x', { id: 'hacked', createdAt: '1999-01-01T00:00:00Z', n: 1 });
        assert.strictEqual(updated.id, 'x');
        assert.strictEqual(updated.createdAt, '2020-01-01T00:00:00Z');
        assert.notStrictEqual(updated.updatedAt, '2020-01-01T00:00:00Z');
      });

      it('returns null for an unknown id', () => {
        assert.strictEqual(store.update(C, 'nope', { n: 1 }), null);
      });
    });

    describe('delete, clear and count', () => {
      it('reports whether a record was removed', () => {
        store.insertResource(C, { id: 'x' });
        assert.strictEqual(store.deleteResource(C, 'x'), true);
        assert.strictEqual(store.deleteResource(C, 'x'), false);
        assert.strictEqual(store.findById(C, 'x'), null);
      });

      it('counts, ignoring filters', () => {
        seedThree(store);
        assert.strictEqual(store.count(C), 3);
      });

      it('clearAll empties one collection and leaves it usable', () => {
        seedThree(store);
        store.clearAll(C);
        assert.strictEqual(store.count(C), 0);
        store.insertResource(C, { id: 'after' });
        assert.strictEqual(store.count(C), 1);
      });

      it('clearAll does not touch another collection', () => {
        store.insertResource(C, { id: 'x' });
        store.insertResource('others', { id: 'y' });
        store.clearAll(C);
        assert.strictEqual(store.count('others'), 1);
        store.clearAll('others');
      });
    });

    describe('insertResource', () => {
      it('replaces at the same id rather than duplicating', () => {
        store.insertResource(C, { id: 'x', v: 1 });
        store.insertResource(C, { id: 'x', v: 2 });
        assert.strictEqual(store.count(C), 1);
        assert.strictEqual(store.findById(C, 'x').v, 2);
      });

      it('fills in timestamps on the argument when absent', () => {
        const record = { id: 'x' };
        store.insertResource(C, record);
        assert.ok(record.createdAt, 'mutates the caller’s object — callers rely on this');
        assert.strictEqual(record.updatedAt, record.createdAt);
      });

      it('leaves supplied timestamps alone', () => {
        store.insertResource(C, { id: 'x', createdAt: '2020-01-01T00:00:00Z' });
        assert.strictEqual(store.findById(C, 'x').createdAt, '2020-01-01T00:00:00Z');
      });
    });

    describe('snapshot and restore', () => {
      it('round-trips a session', () => {
        seedThree(store);
        const taken = store.snapshot();
        store.clearAll(C);
        assert.strictEqual(store.count(C), 0);

        store.restore(taken);
        assert.deepStrictEqual(
          store.findAll(C, {}, { limit: null }).items.map((r) => r.id),
          ['a', 'b', 'c']
        );
      });

      it('snapshots every collection', () => {
        store.insertResource(C, { id: 'x' });
        store.insertResource('others', { id: 'y' });
        const taken = store.snapshot();
        assert.deepStrictEqual(Object.keys(taken).sort(), [C, 'others'].sort());
        store.clearAll('others');
      });

      it('restore replaces rather than merges', () => {
        store.insertResource(C, { id: 'keep' });
        store.restore({ [C]: [{ id: 'only', createdAt: '2024-01-01T00:00:00Z' }] });
        assert.deepStrictEqual(store.findAll(C, {}, { limit: null }).items.map((r) => r.id), ['only']);
      });

      it('leaves collections absent from the snapshot alone', () => {
        store.insertResource(C, { id: 'x' });
        store.insertResource('others', { id: 'y' });
        store.restore({ [C]: [] });
        assert.strictEqual(store.count('others'), 1);
        store.clearAll('others');
      });
    });
  });
}

describe('both stores expose exactly the contract surface', () => {
  for (const impl of implementations) {
    it(`${impl.name} implements every method and adds none`, () => {
      const { store, cleanup } = impl.make();
      try {
        const actual = Object.keys(store).filter((k) => typeof store[k] === 'function');
        assert.deepStrictEqual(
          actual.sort(),
          [...CONTRACT_METHODS].sort(),
          'an extra method here is a method consumers will use and the other store will not have'
        );
      } finally {
        cleanup();
      }
    });
  }
});

describe('the two stores hold identical data', () => {
  it('a snapshot taken from sqlite restores into memory unchanged', () => {
    // Stronger than both passing the same assertions: it compares the actual
    // contents, so any divergence in what is stored shows up as one failure
    // rather than as a gap in coverage.
    const dir = mkdtempSync(join(tmpdir(), 'store-conf-x-'));
    const sqlite = createSqliteStore({ dataDir: dir });
    const memory = createMemoryStore();

    try {
      sqlite.clearAll(C);
      seedThree(sqlite);
      sqlite.insertResource(C, { id: 'nested', name: { firstName: 'Ada' }, tags: ['x'], createdAt: '2024-04-01T00:00:00Z' });

      const taken = sqlite.snapshot();
      memory.restore(taken);

      assert.deepStrictEqual(memory.snapshot(), taken);
      assert.deepStrictEqual(
        memory.findAll(C, {}, { limit: null }).items,
        sqlite.findAll(C, {}, { limit: null }).items
      );
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
