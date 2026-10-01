#!/usr/bin/env node
/**
 * Compare store implementations on a workload shaped like the test suite's.
 *
 *   node tests/manual/bench-stores.js
 *
 * Manual rather than part of `npm test`: timings vary by machine and by load,
 * so asserting a threshold would be flaky and would eventually be deleted
 * rather than fixed. This is a diagnostic you run when you want to know.
 *
 * It is worth keeping because it has already earned its place. The in-memory
 * store originally cloned every matching record *before* paginating, so
 * returning 25 rows out of 2,000 deep-copied 1,000 objects — measurably twice
 * as slow as SQL doing the same query, since SQLite filters, sorts and limits in
 * the statement and parses only the rows it returns. Nothing in the conformance
 * suite could see that: both stores returned identical data, just at very
 * different cost. Run this after touching a read path.
 *
 * Measured on an M-series Mac, Node 22, after that fix:
 *
 *   sqlite   seed  132ms   findById  13ms   findAll  88ms   update  31ms   total  265ms
 *   memory   seed    3ms   findById   2ms   findAll  52ms   update   1ms   total   58ms
 *
 * The shape matters more than the absolute numbers: memory wins enormously on
 * writes, and should win modestly on paginated reads. If `findAll` is slower in
 * memory than in SQLite, a read path has started cloning too eagerly again.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSqliteStore } from '../../src/stores/sqlite-store.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';

const COLLECTION = 'bench';
const RECORDS = 2000;
const READS = 2000;
const LISTS = 200;
const UPDATES = 500;

function bench(label, store) {
  store.clearAll(COLLECTION);
  const phases = {};
  let mark = performance.now();
  const lap = (name) => {
    const now = performance.now();
    phases[name] = now - mark;
    mark = now;
  };

  const start = mark;

  for (let i = 0; i < RECORDS; i++) {
    store.insertResource(COLLECTION, {
      id: `r${i}`,
      name: `n${i}`,
      status: i % 2 ? 'open' : 'closed',
      // Spread across time so the createdAt DESC ordering has real work to do.
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
    });
  }
  lap('seed');

  for (let i = 0; i < READS; i++) store.findById(COLLECTION, `r${i}`);
  lap('findById');

  // The shape a list endpoint produces: filtered, ordered, first page only.
  for (let i = 0; i < LISTS; i++) store.findAll(COLLECTION, { status: 'open' }, { limit: 25 });
  lap('findAll');

  for (let i = 0; i < UPDATES; i++) store.update(COLLECTION, `r${i}`, { touched: i });
  lap('update');

  const total = mark - start;
  const ms = (n) => `${n.toFixed(0)}ms`.padStart(6);
  console.log(
    `${label.padEnd(8)} seed ${ms(phases.seed)}  findById ${ms(phases.findById)}  ` +
      `findAll ${ms(phases.findAll)}  update ${ms(phases.update)}  total ${ms(total)}`
  );

  return { total, findAll: phases.findAll };
}

console.log(
  `${RECORDS} inserts, ${READS} findById, ${LISTS} paginated findAll, ${UPDATES} updates\n`
);

const dir = mkdtempSync(join(tmpdir(), 'bench-stores-'));
const sqlite = createSqliteStore({ dataDir: dir });
let sqliteResult;
try {
  sqliteResult = bench('sqlite', sqlite);
} finally {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
}

const memoryResult = bench('memory', createMemoryStore());

console.log(
  `\nmemory is ${(sqliteResult.total / memoryResult.total).toFixed(1)}x faster overall ` +
    `(${(sqliteResult.total - memoryResult.total).toFixed(0)}ms saved)`
);

if (memoryResult.findAll > sqliteResult.findAll) {
  console.log(
    '\n⚠  findAll is SLOWER in memory than in SQLite. That is the signature of a read\n' +
      '   path cloning records before paginating rather than after — see page() in\n' +
      '   memory-store.js. Correctness tests will not catch it; both stores still agree.'
  );
}
