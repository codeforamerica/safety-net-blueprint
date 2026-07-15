#!/usr/bin/env node
/**
 * State Machine Validation Script
 *
 * Validates all *-state-machine.yaml files in a directory.
 *
 * Two modes:
 *   --spec=<dir>              Within-file consistency checks only (no resolved specs needed)
 *   --spec=<dir> --resolved=<dir>  Also runs cross-artifact checks against resolved specs
 *
 * Within-file checks:
 *   - Transition from/to states are declared in the machine's states list
 *   - Guard condition IDs reference declared guards (in the file or its extends chain)
 *   - String-form call: IDs reference declared procedures or actions
 *   - No duplicate state, action, procedure, or guard IDs
 *   - $params.field references in procedures match declared parameters
 *   - Actor role values are valid RoleType enum values
 *
 * Cross-artifact checks (requires --resolved):
 *   - Machine object: names exist in the resolved spec
 *   - Context from: paths resolve to known API endpoints
 *   - $variable.field references exist on the bound schema
 *   - String literals in CEL enum comparisons are valid values for the field
 *   - set: {field:} steps target fields that exist on the machine object schema
 *   - call: {METHOD: path} paths exist in the resolved spec
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import {
  validateWithinFile,
  validateCrossArtifact,
  buildSchemaIndex,
  buildEndpointIndex,
} from '../src/validation/state-machine-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default paths relative to this script (packages/contracts/scripts/)
const DEFAULT_SPEC_DIR = resolve(__dirname, '..');
const DEFAULT_RESOLVED_DIR = resolve(__dirname, '../../resolved');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { specDir: null, resolvedDir: null, help: false };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--spec=')) options.specDir = arg.split('=')[1];
    else if (arg === '--resolved') options.resolvedDir = DEFAULT_RESOLVED_DIR;
    else if (arg.startsWith('--resolved=')) options.resolvedDir = arg.split('=')[1];
    else { console.error(`Error: Unknown argument: ${arg}`); process.exit(1); }
  }

  return options;
}

function discoverStateMachines(specDir) {
  let files;
  try { files = readdirSync(specDir); } catch { return []; }

  const results = [];
  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const filePath = join(specDir, file);
    try {
      const doc = yaml.load(readFileSync(filePath, 'utf8'));
      if (!doc || typeof doc !== 'object') continue;
      // Use $schema as the type discriminator, not the filename convention
      const schemaBasename = doc.$schema?.split('/').pop();
      if (schemaBasename !== 'state-machine-schema.yaml') continue;
      if (doc.machines) results.push({ filePath, file, doc });
    } catch (err) {
      results.push({ filePath, file, parseError: err.message });
    }
  }
  return results;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: node scripts/validate-state-machines.js --spec=<dir> [--resolved=<dir>]');
    process.exit(0);
  }

  const specDir = resolve(options.specDir || DEFAULT_SPEC_DIR);
  const resolvedDir = options.resolvedDir ? resolve(options.resolvedDir) : null;
  const mode = resolvedDir ? 'cross-artifact' : 'within-file';

  console.log('='.repeat(70));
  console.log('State Machine Validator');
  console.log('='.repeat(70));
  console.log(`  Spec dir:     ${specDir}`);
  if (resolvedDir) console.log(`  Resolved dir: ${resolvedDir}`);
  console.log(`  Mode:         ${mode}`);
  console.log('');

  const machines = discoverStateMachines(specDir);

  if (machines.length === 0) {
    console.log('  No state machine files found. Nothing to validate.\n');
    process.exit(0);
  }

  console.log(`  Found ${machines.length} state machine file(s)\n`);

  // Load validator exceptions (fields intentionally absent from schema)
  let exceptions = {};
  const exceptionsPath = join(specDir, 'validator-exceptions.yaml');
  try { exceptions = yaml.load(readFileSync(exceptionsPath, 'utf8')) || {}; } catch { /* none */ }

  // Build indexes once for cross-artifact mode
  let schemaIndex = null;
  let endpointIndex = null;
  if (resolvedDir) {
    schemaIndex = buildSchemaIndex(resolvedDir);
    endpointIndex = buildEndpointIndex(resolvedDir);
    console.log(`  Loaded ${schemaIndex.size} schemas, ${endpointIndex.size} endpoints from resolved specs\n`);
  }

  let totalErrors = 0;

  for (const { filePath, file, doc, parseError } of machines) {
    if (parseError) {
      console.error(`  ✗ ${file}`);
      console.error(`      Parse error: ${parseError}`);
      totalErrors++;
      continue;
    }

    const withinErrors = validateWithinFile(filePath, doc);
    const crossErrors = resolvedDir
      ? validateCrossArtifact(filePath, doc, schemaIndex, endpointIndex, exceptions)
      : [];

    const errors = [...withinErrors, ...crossErrors];

    if (errors.length === 0) {
      console.log(`  ✓ ${file}`);
    } else {
      console.error(`  ✗ ${file}`);
      for (const { rule, message, path } of errors) {
        console.error(`      [${rule}] ${message}`);
        console.error(`        at: ${path}`);
      }
      totalErrors += errors.length;
    }
  }

  console.log('');

  if (totalErrors > 0) {
    console.error(`State machine validation failed with ${totalErrors} error(s).`);
    process.exit(1);
  }

  console.log('State machine validation passed.');
}

main();
