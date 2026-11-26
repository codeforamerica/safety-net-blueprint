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
 * With --routing, also checks a routing file against its schema and against
 * these contracts (core's validateRouting): routing is configuration, not part
 * of the contract set, so it's named separately.
 *
 * Usage: node scripts/validate.js --resolved=<generated-contracts-dir> [--routing=<file>]
 */

import { resolve, dirname } from 'path';
import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import { discover, load, validate, validateRouting } from '@codeforamerica/blueprint-core';

function parseArgs() {
  const options = { resolvedDir: null, routing: null, help: false, brief: false };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--brief' || arg === '-b') options.brief = true;
    else if (arg.startsWith('--resolved=')) options.resolvedDir = arg.split('=')[1];
    else if (arg.startsWith('--routing=')) options.routing = arg.split('=')[1];
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
    console.log('  --routing=<file>  A routing file to check against them too');
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

  const docs = discover(resolvedDir).map(load);

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

  const routingOk = options.routing ? checkRouting(resolve(options.routing), docs) : true;
  const passed = ok && routingOk;
  console.log(passed ? '\n✓ All validations passed\n' : '\n✗ Validation failed\n');
  process.exit(passed ? 0 : 1);
}

/**
 * Check a routing file against the contracts, and that each handler module it
 * names exists, beside the file. Prints what's wrong; true when nothing is.
 */
function checkRouting(file, docs) {
  console.log(`\n  Routing: ${file}\n`);
  const text = readFileSync(file, 'utf8');
  const document = file.endsWith('.json') ? JSON.parse(text) : yaml.load(text);
  const { errors, warnings } = validateRouting(document, docs);
  for (const entry of Array.isArray(document?.routing) ? document.routing : []) {
    if (typeof entry?.handler === 'string' && !existsSync(resolve(dirname(file), entry.handler))) {
      errors.push(`Routing names handler ${entry.handler}, which doesn't exist beside ${file}`);
    }
  }
  for (const error of errors) console.log(`    error   ${error}`);
  for (const warning of warnings) console.log(`    warning ${warning}`);
  if (!errors.length && !warnings.length) console.log('    ✓ routing checks out');
  return errors.length === 0;
}

try {
  main();
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
