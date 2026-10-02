#!/usr/bin/env node
/**
 * Regenerate all committed golden outputs for blueprint-harness.
 *
 * Usage:
 *   node packages/blueprint-harness/scripts/regenerate.js
 */

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { mkdirSync, copyFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HARNESS = resolve(__dirname, '..');
const CLI = resolve(__dirname, '../../blueprint-cli/scripts');
const VALIDATE = join(CLI, 'validate.js');

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Regenerating blueprint-harness golden outputs...');

console.log('  [1/8] Resolving contracts...');
run(join(CLI, 'resolve.js'), [
  `--spec=${join(HARNESS, 'contracts')}`,
  `--overlay=${join(HARNESS, 'contracts/overlays')}`,
  `--out=${join(HARNESS, 'generated/resolved')}`,
]);

console.log('  [2/8] Validating resolved contracts...');
run(VALIDATE, [
  `--resolved=${join(HARNESS, 'generated/resolved')}`,
]);

console.log('  [3/8] Bundling contracts...');
run(join(CLI, 'resolve.js'), [
  `--spec=${join(HARNESS, 'contracts')}`,
  `--overlay=${join(HARNESS, 'contracts/overlays')}`,
  `--out=${join(HARNESS, 'generated/bundled')}`,
  '--bundle',
]);

console.log('  [4/8] Generating TypeScript clients...');
run(join(CLI, 'generate-ts-clients.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/clients')}`,
]);

console.log('  [5/8] Building explorer...');
run(join(CLI, 'build-explorer.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/explorer')}`,
  `--config=${join(HARNESS, 'explorer')}`,
  `--clients=${join(HARNESS, 'generated/clients')}`,
]);

console.log('  [6/8] Generating Postman collection...');
run(join(CLI, 'generate-postman-collection.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/postman')}`,
]);

console.log('  [7/8] Exporting JSON schemas...');
run(join(CLI, 'export-schemas.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/schemas')}`,
]);

console.log('  [8/8] Building the browser mock page...');
buildMockPage();

console.log('Done.');

/**
 * The demo page: three static files that run the mock server with no server.
 *
 * `generated/mock/` is what a CDN would serve — GitHub Pages, or anything else
 * that hands over files unchanged (#448):
 *
 *   index.html       authored, copied from mock/
 *   mock.js          the mock server, bundled for the browser
 *   contracts.json   the contract set as data
 *
 * Built from `generated/resolved`, which keeps its `$ref`s. The mock resolves
 * them against the set, so nothing here is dereferenced.
 */
function buildMockPage() {
  const outDir = join(HARNESS, 'generated/mock');
  mkdirSync(outDir, { recursive: true });

  run(join(CLI, 'bundle-contracts.js'), [
    `--spec=${join(HARNESS, 'generated/resolved')}`,
    `--out=${join(outDir, 'contracts.json')}`,
  ]);

  // esbuild rather than a script, because the mock server's browser entry is
  // the thing being bundled and it belongs to another package.
  const entry = resolve(__dirname, '../../blueprint-mock-server/src/browser.js');
  const esbuild = spawnSync('npx', [
    'esbuild', entry,
    '--bundle', '--platform=browser', '--format=esm', '--minify',
    '--log-level=error', `--outfile=${join(outDir, 'mock.js')}`,
  ], { stdio: 'inherit' });
  if (esbuild.status !== 0) process.exit(esbuild.status ?? 1);

  copyFileSync(join(HARNESS, 'mock/index.html'), join(outDir, 'index.html'));
}
