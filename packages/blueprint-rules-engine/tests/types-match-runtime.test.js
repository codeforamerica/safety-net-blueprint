/**
 * The declared types and the runtime exports must name the same things.
 *
 * `types.d.ts` is written by hand. Before this, it declared `FactNode` and
 * nothing else — not `evaluate`, the only function the package exports — so
 * the client code blueprint-cli generates, which imports both, could not
 * typecheck against the published package. Nothing caught that, because
 * nothing compared the two.
 *
 * Only value exports are compared. Types have no runtime counterpart, so
 * `Graph`, `FactNode` and friends are expected to appear here and not there.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import * as engine from '../src/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = () => readFileSync(join(packageRoot, 'types.d.ts'), 'utf8');

/** Every value `types.d.ts` declares — functions and constants, not types. */
function declaredValues() {
  const names = new Set();
  for (const m of source().matchAll(/^export declare (?:function|const) ([A-Za-z0-9_]+)/gm)) {
    names.add(m[1]);
  }
  return names;
}

describe('types.d.ts and the runtime surface', () => {
  test('declares every value the package exports', () => {
    const declared = declaredValues();
    const missing = Object.keys(engine).filter((name) => !declared.has(name));

    assert.deepEqual(
      missing,
      [],
      `exported at runtime but undeclared, so TypeScript rejects a working call: ${missing.join(', ')}`
    );
  });

  test('declares no value the package does not export', () => {
    const exported = new Set(Object.keys(engine));
    const phantom = [...declaredValues()].filter((name) => !exported.has(name));

    assert.deepEqual(
      phantom,
      [],
      `declared but undefined at runtime, so TypeScript accepts a call that fails: ${phantom.join(', ')}`
    );
  });

  test('the declarations ship, and the entry points at them', () => {
    // exports.types pointing at a file that `files` omits is the same as
    // having no types at all once installed — which was the case here.
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.exports['.'].types, './types.d.ts');
    assert.ok(pkg.files.includes('types.d.ts'), 'types.d.ts must be published');
  });

  test('the browser bundle is reachable and typed through the global', () => {
    // The IIFE exports nothing importable, so `declare global` is the only
    // way a script-tag consumer gets types.
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    assert.ok(pkg.exports['./browser'], './browser must stay exported');
    assert.match(source(), /declare global/);
    assert.match(source(), /RulesEngine/);
  });
});
