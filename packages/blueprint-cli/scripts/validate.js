#!/usr/bin/env node
/**
 * Validate resolved contracts.
 *
 * One pass over the document set. Every check lives in blueprint-core's
 * validate(), which needs the whole collection anyway — a state machine's
 * references resolve against schemas in other documents, annotations cite
 * registry entries declared elsewhere, and AJV must register every schema
 * before any document is checked against a sibling's $id.
 *
 * This previously spawned five validator subprocesses, each re-reading and
 * re-parsing the entire directory.
 *
 * Usage: node scripts/validate.js --resolved=<generated-contracts-dir>
 */

import { resolve } from 'path';
import { discover, load, validate } from '@codeforamerica/blueprint-core';

function parseArgs() {
  const options = { resolvedDir: null, help: false, brief: false };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--brief' || arg === '-b') options.brief = true;
    else if (arg.startsWith('--resolved=')) options.resolvedDir = arg.split('=')[1];
    else { console.error(`Error: Unknown argument: ${arg}`); process.exit(1); }
  }

  return options;
}

function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Contract Validator\n');
    console.log('Usage: node scripts/validate.js --resolved=<dir>\n');
    console.log('Options:');
    console.log('  --resolved=<dir>  Path to resolved contracts directory (required)');
    console.log('  -b, --brief       Print counts only, not each finding');
    process.exit(0);
  }

  if (!options.resolvedDir) {
    console.error('Error: --resolved is required');
    process.exit(1);
  }

  const resolvedDir = resolve(options.resolvedDir);

  console.log('='.repeat(70));
  console.log('Contract Validator');
  console.log('='.repeat(70));
  console.log(`\n  Contracts: ${resolvedDir}\n`);

  const docs = discover(resolvedDir).map((file) => load(file.path, file.relativePath));

  if (docs.length === 0) {
    console.error('No contract documents found.');
    process.exit(1);
  }

  const { ok, results, report } = validate(docs);

  if (options.brief) {
    const errors = results.reduce((n, r) => n + r.errors.length, 0);
    const warnings = results.reduce((n, r) => n + r.warnings.length, 0);
    console.log(`  ${results.length} documents — ${errors} error(s), ${warnings} warning(s)`);
  } else {
    console.log(report);
  }

  console.log(ok ? '\n✓ All validations passed\n' : '\n✗ Validation failed\n');
  process.exit(ok ? 0 : 1);
}

main();
