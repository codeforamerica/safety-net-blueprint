#!/usr/bin/env node
/**
 * Build the bundle the explorer's pages run: the mock server and what a
 * page reads the contract set with, in one classic script.
 *
 * A classic script defining the `BlueprintMock` global, not a module, because
 * a page opened from disk (`file://`) can load a classic `<script src>` beside
 * it but not import a module. The rules pages load their engine the same way.
 *
 * Built ahead of time and published in `dist/`, so building an explorer does
 * not need esbuild or the mock server's source. npm runs this on `prepare`;
 * after a change to the mock server, run it again (`npm run build:browser`).
 */

import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledPackages, noticeProblems, noticesComment } from '../../../scripts/third-party-notices.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildBrowser(outfile = resolve(rootDir, 'dist/try-it-mock.js')) {
  const { metafile, outputFiles } = await build({
    entryPoints: [resolve(rootDir, 'src/try-it/runtime.js')],
    absWorkingDir: rootDir,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'BlueprintMock',
    minify: true,
    metafile: true,
    write: false,
    outfile,
    logLevel: 'error',
  });
  const packages = bundledPackages(metafile, rootDir);
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, outputFiles[0].text + noticesComment(packages));
  return { outfile, packages };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outfile, packages } = await buildBrowser();
  // To stderr: npm runs this on `prepare`, and `npm pack --json` prints its JSON to stdout.
  console.error(`Wrote ${outfile}, with the notices of ${packages.length} third-party packages.`);
  for (const line of noticeProblems(packages)) console.warn(`Warning: ${line}`);
}
