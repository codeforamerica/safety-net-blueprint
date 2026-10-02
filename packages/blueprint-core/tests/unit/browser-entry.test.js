/**
 * The `/browser` entry stays free of Node.
 *
 * This is the enforcement for a cross-cutting property that no directory
 * convention can hold: every module reachable from `./browser.js` must import
 * nothing but other local modules and browser-safe packages (#448).
 *
 * It is a real guard rather than a style check. A bundler resolves an entire
 * module graph before it tree-shakes, so one `import { readFileSync } from 'fs'`
 * anywhere in that graph breaks a page build — even if nothing calls it, and
 * even if the import is five modules away from anything the mock server uses.
 * That failure surfaces as a bundler error in a downstream package, which is a
 * long way from the line that caused it.
 *
 * Two checks, because they catch different mistakes: the graph walk names the
 * offending file and its importer, and the esbuild run proves the property
 * against the tool that actually has to do it.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const browserEntry = resolve(packageRoot, 'src/browser.js');

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * Every local module reachable from an entry, and every bare specifier it
 * imports, by the file that imports it.
 *
 * Deliberately a text scan rather than a real parse: it needs to see what the
 * bundler sees, which is the static import statements, and a dependency on a
 * parser would be a dependency this test could outgrow.
 */
function importGraph(entry) {
  const modules = new Set();
  const bare = new Map();

  function walk(file) {
    if (modules.has(file)) return;
    modules.add(file);

    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      assert.fail(`${relative(packageRoot, file)} is imported but does not exist`);
    }

    const statements = source.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gm);
    for (const [, specifier] of statements) {
      if (specifier.startsWith('.')) {
        walk(resolve(dirname(file), specifier));
        continue;
      }
      if (!bare.has(specifier)) bare.set(specifier, new Set());
      bare.get(specifier).add(relative(packageRoot, file));
    }
  }

  walk(entry);
  return { modules, bare };
}

test('The /browser entry', async (t) => {

  await t.test('imports no Node builtin, anywhere in its module graph', () => {
    const { modules, bare } = importGraph(browserEntry);

    const offenders = [...bare]
      .filter(([specifier]) => BUILTINS.has(specifier))
      .map(([specifier, importers]) => `  ${specifier} — imported by ${[...importers].join(', ')}`);

    assert.deepStrictEqual(offenders, [],
      `The /browser entry must not reach a Node builtin, but does:\n${offenders.join('\n')}\n\n` +
      'A browser build resolves this whole graph, so this breaks a page even if nothing calls it. ' +
      'Either the import belongs behind the Node-only entry, or it has a portable equivalent — ' +
      '`fileNameOf` in contract-types.js replaced `basename` for exactly this reason.');

    // A floor, so the test cannot pass by the graph walk silently finding
    // nothing. Both of the portable exports pull in more than a few modules.
    assert.ok(modules.size > 10,
      `only ${modules.size} modules walked, so the graph scan is not seeing the real graph`);
  });

  await t.test('bundles for the browser platform', () => {
    // The property as the bundler sees it. esbuild resolves before it shakes,
    // so this fails on an unreachable `fs` import the same way a real build
    // would — which is the behaviour the check above exists to protect.
    const result = execFileSync('npx', [
      'esbuild', browserEntry,
      '--bundle', '--platform=browser', '--format=esm', '--log-level=error',
      '--outfile=' + resolve(packageRoot, 'node_modules/.cache/browser-entry-check.js'),
    ], { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    assert.strictEqual(result.trim(), '', 'esbuild reported problems bundling the browser entry');
  });

  await t.test('exports exactly the portable surface', async () => {
    const browser = await import('../../src/browser.js');
    assert.deepStrictEqual(Object.keys(browser).sort(), ['extract', 'generate'],
      'Adding an export here is additive and fine — update this list. Removing one is breaking.');
  });

  await t.test('is re-exported by the main entry, rather than duplicated', async () => {
    // The two entries are one list: index.js does `export * from './browser.js'`.
    // Were it to grow its own copy, a portable export added here could go
    // missing from the package's main entry.
    const [browser, index] = await Promise.all([
      import('../../src/browser.js'),
      import('../../src/index.js'),
    ]);
    for (const name of Object.keys(browser)) {
      assert.strictEqual(index[name], browser[name],
        `${name} must be the same binding in both entries`);
    }
  });
});
