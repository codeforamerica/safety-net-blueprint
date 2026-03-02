#!/usr/bin/env node
/**
 * Standalone OpenAPI Validation Script
 * Validates OpenAPI specifications and examples
 */

import { discoverApiSpecs, getExamplesPath } from '../src/validation/openapi-loader.js';
import { validateAll, formatResults } from '../src/validation/openapi-validator.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main validation function
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const detailed = args.includes('--detailed') || args.includes('-d');
  const brief = args.includes('--brief') || args.includes('-b');
  const skipExamples = args.includes('--skip-examples');

  if (args.includes('--help') || args.includes('-h')) {
    console.log('OpenAPI Specification & Examples Validator\n');
    console.log('Usage: node scripts/validate-openapi.js --spec=<file|dir> [options]\n');
    console.log('Flags:');
    console.log('  --spec=<file|dir> Path to spec file or directory (required)');
    console.log('  --skip-examples   Skip example validation (schema-only)');
    console.log('  -d, --detailed    Show all validation errors (default)');
    console.log('  -b, --brief       Show only first 3 errors per example');
    console.log('  -h, --help        Show this help message');
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a =>
    a !== '--help' && a !== '-h' &&
    a !== '--detailed' && a !== '-d' &&
    a !== '--brief' && a !== '-b' &&
    a !== '--skip-examples' &&
    !a.startsWith('--spec=')
  );
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  // Parse --spec flag
  const specArg = args.find(a => a.startsWith('--spec='));
  if (!specArg) {
    console.error('Error: --spec=<file|dir> is required.\n');
    console.error('Usage: node scripts/validate-openapi.js --spec=<file|dir>');
    process.exit(1);
  }
  const specDir = resolve(specArg.split('=')[1]);
  const isSingleFile = statSync(specDir).isFile();

  console.log('='.repeat(70));
  console.log('OpenAPI Specification & Examples Validator');
  console.log('='.repeat(70));

  try {
    // Discover API specs
    console.log('\nDiscovering OpenAPI specifications...');
    console.log(`  Specs: ${specDir}`);
    const apiSpecs = isSingleFile
      ? [{ name: specDir.replace(/-openapi\.yaml$/, '').split(/[\\/]/).pop(), specPath: specDir }]
      : discoverApiSpecs({ specsDir: specDir });

    if (apiSpecs.length === 0) {
      console.error('\n❌ No OpenAPI specifications found');
      process.exit(1);
    }

    console.log(`✓ Found ${apiSpecs.length} specification(s)\n`);

    // Add examples paths (unless skipping)
    const specsWithExamples = apiSpecs.map(spec => ({
      ...spec,
      examplesPath: skipExamples ? null : getExamplesPath(spec.name, isSingleFile ? dirname(specDir) : specDir)
    }));

    // Validate specs (and examples unless --skip-examples)
    console.log(`Validating specifications${skipExamples ? '' : ' and examples'}...\n`);
    const results = await validateAll(specsWithExamples);

    // Display results (detailed by default)
    console.log(formatResults(results, { detailed: !brief }));

    // Determine exit code
    const hasErrors = Object.values(results).some(r => !r.valid);

    if (hasErrors) {
      console.log('\n❌ Validation failed with errors\n');
      process.exit(1);
    } else {
      const hasWarnings = Object.values(results).some(r =>
        r.spec.warnings.length > 0 || r.examples.warnings.length > 0
      );

      if (hasWarnings) {
        console.log('\n⚠️  Validation passed with warnings\n');
      } else {
        console.log('\n✓ All validations passed!\n');
      }
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ Validation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run validation
main();
