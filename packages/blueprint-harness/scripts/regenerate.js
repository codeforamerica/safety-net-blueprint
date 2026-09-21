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

console.log('  [1/7] Resolving contracts...');
run(join(CLI, 'resolve.js'), [
  `--spec=${join(HARNESS, 'contracts')}`,
  `--overlay=${join(HARNESS, 'contracts/overlays')}`,
  `--out=${join(HARNESS, 'generated/resolved')}`,
]);

console.log('  [2/7] Validating resolved contracts...');
run(VALIDATE, [
  `--resolved=${join(HARNESS, 'generated/resolved')}`,
]);

console.log('  [3/7] Bundling contracts...');
run(join(CLI, 'resolve.js'), [
  `--spec=${join(HARNESS, 'contracts')}`,
  `--overlay=${join(HARNESS, 'contracts/overlays')}`,
  `--out=${join(HARNESS, 'generated/bundled')}`,
  '--bundle',
]);

console.log('  [4/7] Generating TypeScript clients...');
run(join(CLI, 'generate-ts-clients.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/clients')}`,
]);

console.log('  [5/7] Building explorer...');
run(join(CLI, 'build-explorer.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/explorer')}`,
  `--config=${join(HARNESS, 'explorer')}`,
  `--clients=${join(HARNESS, 'generated/clients')}`,
]);

console.log('  [6/7] Generating Postman collection...');
run(join(CLI, 'generate-postman-collection.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/postman')}`,
]);

console.log('  [7/7] Exporting JSON schemas...');
run(join(CLI, 'export-schemas.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/schemas')}`,
]);

console.log('Done.');
