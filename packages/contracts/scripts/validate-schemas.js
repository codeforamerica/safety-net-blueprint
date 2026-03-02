#!/usr/bin/env node
/**
 * Schema Validation Script
 * Discovers YAML files with a $schema field and validates them against the declared schema.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Recursively find all .yaml files in a directory, excluding node_modules.
 */
function findYamlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const fullPath = resolve(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...findYamlFiles(fullPath));
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Schema Validator\n');
    console.log('Usage: node scripts/validate-schemas.js --spec=<file|dir>\n');
    console.log('Discovers YAML files with a $schema field and validates them');
    console.log('against the declared JSON Schema.\n');
    console.log('Flags:');
    console.log('  --spec=<file|dir>  Path to spec file or directory (required)');
    console.log('  -h, --help     Show this help message');
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a => a !== '--help' && a !== '-h' && !a.startsWith('--spec='));
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const specArg = args.find(a => a.startsWith('--spec='));
  if (!specArg) {
    console.error('Error: --spec=<file|dir> is required.\n');
    console.error('Usage: node scripts/validate-schemas.js --spec=<file|dir>');
    process.exit(1);
  }
  const specDir = resolve(specArg.split('=')[1]);
  const isSingleFile = statSync(specDir).isFile();

  console.log('='.repeat(70));
  console.log('Schema Validator');
  console.log('='.repeat(70));

  console.log(`\nValidating YAML files against their declared JSON Schemas...`);
  console.log(`  Looks for YAML files with a $schema field (e.g., state machines)`);
  console.log(`  and validates each file against its referenced JSON Schema.`);
  console.log(`  ${isSingleFile ? 'File' : 'Directory'}: ${specDir}`);

  const yamlFiles = isSingleFile ? [specDir] : findYamlFiles(specDir);
  const filesToValidate = [];

  for (const filePath of yamlFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const doc = yaml.load(content);
      if (doc && typeof doc === 'object' && doc.$schema && !doc.$schema.startsWith('http')) {
        const schemaPath = resolve(dirname(filePath), doc.$schema);
        filesToValidate.push({ filePath, schemaPath, doc });
      }
    } catch {
      // Skip files that fail to parse — they'll be caught by other validators
    }
  }

  if (filesToValidate.length === 0) {
    console.log('\n  No files with $schema declarations found. Nothing to validate.\n');
    process.exit(0);
  }

  console.log(`  Found ${filesToValidate.length} file(s) to validate\n`);

  const ajv = new Ajv2020({ strict: false, allErrors: true });
  let hasErrors = false;
  const results = [];
  const baseDir = isSingleFile ? dirname(specDir) : specDir;

  for (const { filePath, schemaPath, doc } of filesToValidate) {
    const relFile = relative(baseDir, filePath);
    const relSchema = relative(baseDir, schemaPath);

    try {
      const schemaContent = readFileSync(schemaPath, 'utf8');
      const schema = yaml.load(schemaContent);
      const validate = ajv.compile(schema);

      // Remove $schema from doc before validating (it's metadata, not part of the data)
      const { $schema, ...data } = doc;
      const valid = validate(data);

      if (valid) {
        results.push({ relFile, relSchema, valid: true });
      } else {
        hasErrors = true;
        results.push({ relFile, relSchema, valid: false, errors: validate.errors });
      }
    } catch (err) {
      hasErrors = true;
      results.push({ relFile, relSchema, valid: false, errors: [{ message: err.message }] });
    }
  }

  // Display results
  console.log('Validation Results:\n');
  for (const r of results) {
    if (r.valid) {
      console.log(`  ✓ ${r.relFile}`);
      console.log(`    schema: ${r.relSchema}`);
    } else {
      console.log(`  ✗ ${r.relFile}`);
      console.log(`    schema: ${r.relSchema}`);
      for (const err of r.errors) {
        const path = err.instancePath || '(root)';
        console.log(`    - ${path}: ${err.message}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`\n  Total: ${results.length} file(s), ${results.filter(r => !r.valid).length} error(s)\n`);

  if (hasErrors) {
    console.log('✗ Schema validation failed\n');
    process.exit(1);
  } else {
    console.log('✓ All schema validations passed!\n');
    process.exit(0);
  }
}

main();
