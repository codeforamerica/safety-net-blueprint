/**
 * The declared types and the runtime exports must name the same things.
 *
 * `types.d.ts` is written by hand, so nothing stops it drifting from
 * `src/index.js` — and it had. It declared `extractRefName` and
 * `loadExternalRefs`, both removed when the surface collapsed, so TypeScript
 * accepted a call that was `undefined` at runtime. It also omitted
 * `generate(docs, 'examples')`, making a working call a type error.
 *
 * Over-declaring is the dangerous direction: a type error caught at compile
 * time costs a minute, and one that compiles and fails in a state's pipeline
 * costs considerably more.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import * as core from '../../src/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every name `types.d.ts` declares at the top level. */
function declaredNames() {
  const source = readFileSync(join(packageRoot, 'types.d.ts'), 'utf8');
  const names = new Set();

  for (const match of source.matchAll(/^export (?:declare )?(?:function|const) ([A-Za-z0-9_]+)/gm)) {
    names.add(match[1]);
  }

  return names;
}

describe('types.d.ts and the runtime surface', () => {
  test('declares every name the package exports', () => {
    const declared = declaredNames();
    const missing = Object.keys(core).filter((name) => !declared.has(name));

    assert.deepEqual(
      missing,
      [],
      `exported at runtime but not declared, so TypeScript rejects a working call: ${missing.join(', ')}`
    );
  });

  test('declares nothing the package does not export', () => {
    const exported = new Set(Object.keys(core));
    const phantom = [...declaredNames()].filter((name) => !exported.has(name));

    assert.deepEqual(
      phantom,
      [],
      `declared but undefined at runtime, so TypeScript accepts a call that fails: ${phantom.join(', ')}`
    );
  });

  test('the package entry points at the file this checks', () => {
    // A types path that does not resolve would make the two sets agree
    // vacuously, since no consumer would be reading this file at all.
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.exports['.'].types, './types.d.ts');
    assert.ok(pkg.files.includes('types.d.ts'), 'types.d.ts must ship with the package');
  });
});
