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
run(join(__dirname, 'build-mock-page.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/mock')}`,
]);

console.log('Done.');


