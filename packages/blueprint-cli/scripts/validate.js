#!/usr/bin/env node
/**
 * Consolidated Validation Script
 *
 * Runs all validators against the resolved contracts directory:
 *   1. OpenAPI spec validation
 *   2. Fragment $ref validation
 *   3. State machine validation (uses resolved dir for both discovery and cross-artifact checks)
 *   4. Annotation validation
 *
 * Usage: node scripts/validate.js --resolved=<generated-contracts-dir>
 */

import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { resolvedDir: null, help: false };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--resolved=')) options.resolvedDir = arg.split('=')[1];
    else { console.error(`Error: Unknown argument: ${arg}`); process.exit(1); }
  }

  return options;
}

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  return result.status ?? 1;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: node scripts/validate.js --resolved=<dir>');
    console.log('');
    console.log('Options:');
    console.log('  --resolved=<dir>  Path to resolved/generated contracts directory (required)');
    process.exit(0);
  }

  if (!options.resolvedDir) { console.error('Error: --resolved is required'); process.exit(1); }

  const resolvedDir = resolve(options.resolvedDir);
  const validateDir = join(__dirname, 'validate');

  const steps = [
    { label: 'OpenAPI', script: join(validateDir, 'openapi.js'), args: [`--spec=${resolvedDir}`] },
    { label: 'Refs', script: join(validateDir, 'refs.js'), args: [`--spec=${resolvedDir}`] },
    { label: 'Annotations', script: join(validateDir, 'annotations.js'), args: [`--spec=${resolvedDir}`] },
    {
      label: 'State machines',
      script: join(validateDir, 'state-machines.js'),
      args: [`--spec=${resolvedDir}`, `--resolved=${resolvedDir}`],
    },
  ];

  let failed = false;

  for (const { label, script, args } of steps) {
    const code = run(script, args);
    if (code !== 0) {
      console.error(`\n${label} validation failed.\n`);
      failed = true;
      break;
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
