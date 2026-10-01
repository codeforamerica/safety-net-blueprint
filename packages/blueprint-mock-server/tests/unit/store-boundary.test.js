/**
 * The in-memory store must not reach Node.
 *
 * `./store` exists so a consumer can get a working store without pulling the
 * HTTP shell or a native SQLite module — that is the whole reason it is a
 * separate export. The property is invisible in normal use, because every test
 * and every caller today runs in Node, where importing `fs` works fine. So it
 * holds on the day it is written and then rots the first time someone adds a
 * convenience import, and nothing notices until a browser build fails.
 *
 * This walks the module graph reachable from the `./store` entry point and
 * fails on anything Node-only. It is the test #448 asks for, scoped to what
 * exists now; the same check widens to the `./browser` entry when that lands.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');

/** Bare specifiers that mean "this cannot run in a browser". */
const NODE_ONLY = [
  'node:', 'fs', 'path', 'url', 'crypto', 'os', 'http', 'https', 'child_process',
  'better-sqlite3', 'express', 'multer', 'cors', 'swagger-ui-express',
];

function isNodeOnly(specifier) {
  if (specifier.startsWith('node:')) return true;
  return NODE_ONLY.includes(specifier);
}

/** Every static import specifier in a module, bare or relative. */
function importsOf(file) {
  const source = readFileSync(file, 'utf8');
  const specifiers = [];
  // Static import/export-from only. A dynamic import() behind a runtime branch
  // would not be reached by a bundler targeting the browser either, and this is
  // deliberately a lexical check rather than a resolver.
  for (const match of source.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** Walk from an entry point, returning { module → offending specifier } pairs. */
function findNodeOnlyReachableFrom(entry) {
  const offences = [];
  const seen = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of importsOf(file)) {
      if (isNodeOnly(specifier)) {
        offences.push({ file: file.slice(packageRoot.length + 1), specifier });
        continue;
      }
      if (specifier.startsWith('.')) {
        queue.push(resolve(dirname(file), specifier));
      }
      // A non-relative, non-Node specifier is a third-party package. Whether it
      // is browser-safe is its own business; listing the ones that are not is
      // what NODE_ONLY is for.
    }
  }

  return { offences, visited: seen.size };
}

describe('./store module graph', () => {
  const entry = resolve(packageRoot, 'src/stores/memory-store.js');

  it('reaches nothing Node-only', () => {
    const { offences, visited } = findNodeOnlyReachableFrom(entry);
    assert.deepStrictEqual(
      offences,
      [],
      `Node-only imports reachable from ./store:\n` +
        offences.map((o) => `  ${o.file} imports '${o.specifier}'`).join('\n')
    );
    assert.ok(visited > 1, 'the walk should reach past the entry point itself');
  });

  it('detects a violation, so a passing result means something', () => {
    // Guards the guard: if the walk silently found nothing — a changed path, a
    // regex that stopped matching — the test above would pass for the wrong
    // reason. The SQLite store is the known-positive case.
    const { offences } = findNodeOnlyReachableFrom(resolve(packageRoot, 'src/stores/sqlite-store.js'));
    assert.ok(
      offences.some((o) => o.specifier === 'better-sqlite3'),
      'the walk should find better-sqlite3 reachable from the SQLite store'
    );
  });
});
