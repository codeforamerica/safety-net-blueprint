#!/usr/bin/env node
/**
 * JSON Schema Validation CLI
 *
 * Standalone entry point for validating YAML files against their declared
 * $schema. Loads files from disk and delegates to validateSchemasFromFiles
 * in json-schema-core.js.
 *
 * For in-pipeline validation (the primary use case), the resolve pipeline
 * calls validateSchemas() from json-schema-core.js directly with in-memory
 * specs after overlays are applied. See resolve.js and json-schema-core.js
 * for details on why in-memory validation is necessary.
 *
 * This CLI is useful for:
 *   - Validating blueprint-core schemas in isolation
 *   - Ad-hoc validation of a single file or directory
 *   - Debugging schema issues outside the resolve pipeline
 *
 * Note: When run against source files (pre-overlay), overlay-extended enum
 * values (e.g. RoleType, Domain) will not be present and may produce false
 * negatives. Run against resolved output or use the pipeline for accurate
 * results.
 *
 * Usage: node scripts/validate/json-schema.js --spec=<file|dir>
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { statSync } from 'fs';
import { resolverMap } from '@codeforamerica/blueprint-core';
import { validateSchemasFromFiles, findFiles } from './json-schema-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_SPEC_DIR = resolve(__dirname, '..');

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Schema Validator\n');
    console.log('Usage: node scripts/validate/json-schema.js --spec=<file|dir>\n');
    console.log('Flags:');
    console.log('  --spec=<file|dir>  Path to spec file or directory (required)');
    console.log('  -h, --help         Show this help message');
    process.exit(0);
  }

  const unknown = args.filter(a => a !== '--help' && a !== '-h' && !a.startsWith('--spec='));
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const specArg = args.find(a => a.startsWith('--spec='));
  const specPath = resolve(specArg ? specArg.split('=')[1] : DEFAULT_SPEC_DIR);
  const isSingleFile = statSync(specPath).isFile();
  const specDir = isSingleFile ? dirname(specPath) : specPath;
  const filePaths = isSingleFile ? [specPath] : findFiles(specDir, ['.yaml', '.yml']);

  console.log('='.repeat(70));
  console.log('Schema Validator');
  console.log('='.repeat(70));
  console.log(`\n  ${isSingleFile ? 'File' : 'Directory'}: ${specPath}`);

  const { valid, results } = validateSchemasFromFiles(filePaths, specDir, { resolverMap });

  const filesToValidate = results.length;

  if (filesToValidate === 0) {
    console.log('\n  No files with $schema declarations found. Nothing to validate.\n');
    process.exit(0);
  }

  console.log(`\n  Found ${filesToValidate} file(s) to validate\n`);
  console.log('Validation Results:\n');

  for (const r of results) {
    if (r.valid) {
      console.log(`  ✓ ${r.relativePath}`);
      console.log(`    schema: ${r.schemaRef}`);
    } else {
      console.log(`  ✗ ${r.relativePath}`);
      console.log(`    schema: ${r.schemaRef}`);
      for (const err of r.errors) {
        const path = err.instancePath || '(root)';
        console.log(`    - ${path}: ${err.message}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`\n  Total: ${results.length} file(s), ${results.filter(r => !r.valid).length} error(s)\n`);

  if (!valid) {
    console.log('✗ Schema validation failed\n');
    process.exit(1);
  } else {
    console.log('✓ All schema validations passed!\n');
    process.exit(0);
  }
}

main();
