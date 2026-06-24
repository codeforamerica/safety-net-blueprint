#!/usr/bin/env node
/**
 * Composition Bind Validator
 *
 * Discovers {domain}-compositions.yaml files, loads the corresponding
 * OpenAPI spec, and validates that all bind fields exist as properties on
 * the referenced resource's schema.
 *
 * Usage:
 *   node scripts/validate-compositions.js --spec=.
 */

import { readFileSync, statSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import {
  discoverCompositions,
  buildResourceSchemaIndex,
  validateBindFields,
  validateSortableConfig
} from '../src/compositions/compositions-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { specDir: null, help: false };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--spec=')) {
      options.specDir = arg.split('=')[1];
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function collectOpenApiFiles(specsDir) {
  const files = [];
  for (const entry of readdirSync(specsDir)) {
    if (!entry.endsWith('-openapi.yaml')) continue;
    const filePath = join(specsDir, entry);
    try {
      const content = readFileSync(filePath, 'utf8');
      const spec = yaml.load(content);
      if (spec && typeof spec === 'object') {
        files.push({ relativePath: entry, spec });
      }
    } catch {
      // skip
    }
  }
  return files;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: node scripts/validate-compositions.js --spec=<dir>');
    console.log('');
    console.log('Validates bind fields in composition files against OpenAPI resource schemas.');
    process.exit(0);
  }

  const specDir = resolve(options.specDir || '.');

  console.log('='.repeat(70));
  console.log('Composition Bind Validator');
  console.log('='.repeat(70));
  console.log('');
  console.log(`  Directory: ${specDir}`);

  const compositionFiles = discoverCompositions(specDir);

  if (compositionFiles.length === 0) {
    console.log('  No composition files found. Nothing to validate.\n');
    process.exit(0);
  }

  console.log(`  Found ${compositionFiles.length} composition file(s)\n`);

  const openApiFiles = collectOpenApiFiles(specDir);
  const resourceSchemaIndex = buildResourceSchemaIndex(openApiFiles);

  let totalErrors = 0;

  for (const compositionFile of compositionFiles) {
    const bindErrors = validateBindFields(compositionFile, resourceSchemaIndex);
    const sortErrors = validateSortableConfig(compositionFile);
    const errors = [...bindErrors, ...sortErrors];
    const label = `${compositionFile.domain}-compositions.yaml`;

    if (errors.length === 0) {
      console.log(`  ✓ ${label}`);
    } else {
      console.log(`  ✗ ${label}`);
      for (const { message, path } of errors) {
        console.error(`      Error: ${message}`);
        console.error(`        at:  ${path}`);
      }
      totalErrors += errors.length;
    }
  }

  console.log('');

  if (totalErrors > 0) {
    console.error(`Bind validation failed with ${totalErrors} error(s).`);
    process.exit(1);
  }

  console.log('Bind validation passed.');
}

main();
