#!/usr/bin/env node
/**
 * Build the browser check page.
 *
 * The automated suites prove the in-memory store behaves like the SQLite one,
 * and `tests/unit/store-boundary.test.js` proves its module graph reaches
 * nothing Node-only. Neither can answer the two questions that only a browser
 * can: whether `file://` is a secure context, and therefore whether
 * `crypto.randomUUID` — which the store uses to mint ids — exists at all.
 *
 * So this is deliberately a manual check rather than part of `npm test`: it
 * needs a human to open a file in each browser they care about. Generating it
 * from a template keeps it from drifting out of date, which is what happens to
 * a checked-in HTML file with a bundle pasted into it.
 *
 *   node tests/manual/build-browser-check.js
 *   open tests/manual/generated/store-browser-check.html
 *
 * Last run: 10/10 in Chrome 153 and Safari 27, both off `file://`.
 */

import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const outDir = join(here, 'generated');

const result = await build({
  entryPoints: [join(packageRoot, 'src/stores/memory-store.js')],
  bundle: true,
  format: 'iife',
  globalName: 'StoreBundle',
  write: false,
});

const bundle = result.outputFiles[0].text;
const template = readFileSync(join(here, 'store-browser-check.template.html'), 'utf8');

if (!template.includes('/*__BUNDLE__*/')) {
  throw new Error('the template lost its /*__BUNDLE__*/ placeholder — nothing would be injected');
}

mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'store-browser-check.html');
writeFileSync(outFile, template.replace('/*__BUNDLE__*/', bundle));

console.log(`Wrote ${outFile}`);
console.log(`  store bundle: ${(bundle.length / 1024).toFixed(1)} KB`);
console.log('\nOpen it directly from disk — serving it over http would not test what this tests.');
