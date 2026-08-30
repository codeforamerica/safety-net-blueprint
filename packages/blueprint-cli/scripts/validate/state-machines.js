#!/usr/bin/env node
/**
 * State Machine Validation Script
 *
 * Validates all *-state-machine.yaml files in a directory against resolved specs.
 *
 * Usage: node scripts/validate/state-machines.js --spec=<dir> --resolved=<dir>
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

import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'fs';
import { resolve, join, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import {
  validateWithinFile,
  validateCrossArtifact,
  buildSchemaIndex,
  buildEndpointIndex,
} from '@codeforamerica/blueprint-core/state-machine-validator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


function parseArgs() {
  const args = process.argv.slice(2);
  const options = { specDir: null, resolvedDir: null, help: false };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--spec=')) options.specDir = arg.split('=')[1];
    else if (arg.startsWith('--resolved=')) options.resolvedDir = arg.split('=')[1];
    else { console.error(`Error: Unknown argument: ${arg}`); process.exit(1); }
  }

  return options;
}

/**
 * Search the resolved directory for a RoleType enum definition.
 * Fails loudly if not found — role validation requires it.
 *
 * @param {string} resolvedDir - Path to the resolved specs directory
 * @returns {Set<string>}
 */
function loadValidRoles(resolvedDir) {
  for (const filePath of walkYaml(resolvedDir)) {
    try {
      const doc = yaml.load(readFileSync(filePath, 'utf8'));
      const roleEnum = doc?.$defs?.RoleType?.enum;
      if (Array.isArray(roleEnum) && roleEnum.length > 0) {
        return new Set(roleEnum);
      }
    } catch { /* skip unparseable files */ }
  }
  console.error('Error: No RoleType enum found in resolved directory. Run resolve first.');
  process.exit(1);
}

function walkYaml(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) results.push(...walkYaml(fullPath));
    else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) results.push(fullPath);
  }
  return results;
}

function discoverStateMachines(specDir) {
  const results = [];
  for (const filePath of walkYaml(specDir)) {
    const file = filePath.split('/').pop();
    try {
      const doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA });
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
    console.log('Usage: node scripts/validate-state-machines.js --spec=<dir> --resolved=<dir>');
    process.exit(0);
  }

  if (!options.specDir) { console.error('Error: --spec is required'); process.exit(1); }
  if (!options.resolvedDir) { console.error('Error: --resolved is required'); process.exit(1); }
  const specDir = resolve(options.specDir);
  const resolvedDir = resolve(options.resolvedDir);

  console.log('='.repeat(70));
  console.log('State Machine Validator');
  console.log('='.repeat(70));
  console.log(`  Spec dir:     ${specDir}`);
  console.log(`  Resolved dir: ${resolvedDir}`);
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

  // Build indexes for cross-artifact validation
  const schemaIndex = buildSchemaIndex(resolvedDir);
  const endpointIndex = buildEndpointIndex(resolvedDir);
  console.log(`  Loaded ${schemaIndex.size} schemas, ${endpointIndex.size} endpoints from resolved specs\n`);

  // Load valid roles from the resolved enums (fails loudly if RoleType is not found)
  const validRoles = loadValidRoles(resolvedDir);

  let totalErrors = 0;

  for (const { filePath, file, doc, parseError } of machines) {
    if (parseError) {
      console.error(`  ✗ ${file}`);
      console.error(`      Parse error: ${parseError}`);
      totalErrors++;
      continue;
    }

    const withinErrors = validateWithinFile(filePath, doc, { validRoles });
    const crossErrors = validateCrossArtifact(filePath, doc, schemaIndex, endpointIndex, exceptions);
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

export { loadValidRoles, discoverStateMachines };

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main();
}
