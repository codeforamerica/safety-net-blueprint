#!/usr/bin/env node
/**
 * Rules Contract Validator
 *
 * Validates *-rules.yaml files in a directory:
 *   - Cycle detection: no fact depends on itself directly or transitively
 *   - Unreachable nodes: facts not in outputs and not depended on by any other fact
 *   - CEL expression syntax: expressions are parseable
 *   - $ref resolution: input and output $refs resolve to known blueprint schemas
 *
 * Schema correctness (required fields, types, patterns) is handled by the
 * JSON Schema validator via each file's $schema declaration.
 *
 * Usage: node scripts/validate/rules.js --spec=<dir>
 */

import { readFileSync, readdirSync, statSync, realpathSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { validateRulesDoc } from '@codeforamerica/blueprint-core/rules-validator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { specDir: null, help: false };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--spec=')) options.specDir = arg.split('=')[1];
    else { console.error(`Error: Unknown argument: ${arg}`); process.exit(1); }
  }

  return options;
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
    else if (entry.endsWith('-rules.yaml')) results.push(fullPath);
  }
  return results;
}

function discoverRulesFiles(specDir) {
  const results = [];
  for (const filePath of walkYaml(specDir)) {
    try {
      const doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA });
      if (!doc || typeof doc !== 'object') continue;
      // Use $schema as the type discriminator
      if (!doc.$schema?.includes('rules-schema.yaml')) continue;
      if (doc.rulesets) results.push({ filePath, file: filePath.split('/').pop(), doc });
    } catch (err) {
      results.push({ filePath, file: filePath.split('/').pop(), parseError: err.message });
    }
  }
  return results;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: node scripts/validate/rules.js --spec=<dir>');
    console.log('');
    console.log('Options:');
    console.log('  --spec=<dir>  Path to contracts directory (required)');
    process.exit(0);
  }

  if (!options.specDir) { console.error('Error: --spec is required'); process.exit(1); }

  const specDir = resolve(options.specDir);

  console.log('='.repeat(70));
  console.log('Rules Validator');
  console.log('='.repeat(70));
  console.log(`  Spec dir: ${specDir}`);
  console.log('');

  const rulesFiles = discoverRulesFiles(specDir);

  if (rulesFiles.length === 0) {
    console.log('  No *-rules.yaml files found. Nothing to validate.\n');
    process.exit(0);
  }

  console.log(`  Found ${rulesFiles.length} rules file(s)\n`);

  let totalErrors = 0;

  for (const { filePath, file, doc, parseError } of rulesFiles) {
    if (parseError) {
      console.error(`  ✗ ${file}`);
      console.error(`      Parse error: ${parseError}`);
      totalErrors++;
      continue;
    }

    const errors = validateRulesDoc(doc);

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
    console.error(`Rules validation failed with ${totalErrors} error(s).`);
    process.exit(1);
  }

  console.log('Rules validation passed.');
}

export { discoverRulesFiles };

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main();
}
