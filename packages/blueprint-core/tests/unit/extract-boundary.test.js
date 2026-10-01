/**
 * `extract` must not reach the filesystem.
 *
 * `discover` reads contracts off disk and `load` parses one file; everything
 * downstream of them operates on documents already in memory. `extract` was
 * the exception by accident: it reaches `resolveSchemaRefs`, which followed a
 * cross-file `$ref` by computing a path and calling `readFileSync`. That made
 * the three functions sitting on it unusable anywhere without a filesystem,
 * for a reason no caller had asked for.
 *
 * The property is invisible in normal use, because every test and every caller
 * today runs in Node, where importing `fs` works fine. So it holds on the day
 * it is written and then rots the first time someone adds a convenience
 * import. This walks the module graph and fails on anything Node-only.
 *
 * Same check, same reasoning as `store-boundary.test.js` in
 * blueprint-mock-server.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');

/** Bare specifiers that mean "this cannot run without Node". */
const NODE_ONLY = ['fs', 'path', 'url', 'crypto', 'os', 'http', 'https', 'child_process'];

function isNodeOnly(specifier) {
  return specifier.startsWith('node:') || NODE_ONLY.includes(specifier);
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

/** Walk from an entry point, returning offending { module, specifier } pairs. */
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
      // is browser-safe is its own business; NODE_ONLY lists the ones that are
      // definitely not.
    }
  }

  return { offences, visited: seen.size };
}

describe('extract module graph', () => {
  const entry = resolve(packageRoot, 'src/extract.js');

  test('reaches nothing Node-only', () => {
    const { offences, visited } = findNodeOnlyReachableFrom(entry);
    assert.deepEqual(
      offences,
      [],
      'Node-only imports reachable from extract:\n' +
        offences.map((o) => `  ${o.file} imports '${o.specifier}'`).join('\n')
    );
    assert.ok(visited > 1, 'the walk should reach past the entry point itself');
  });

  test('detects a violation, so a passing result means something', () => {
    // Guards the guard: if the walk silently found nothing — a changed path, a
    // broken regex — the test above would pass for the wrong reason.
    const { offences } = findNodeOnlyReachableFrom(resolve(packageRoot, 'src/load.js'));
    assert.ok(
      offences.some((o) => o.specifier === 'fs'),
      'the walk should find fs reachable from load, which reads a file by design'
    );
  });
});
