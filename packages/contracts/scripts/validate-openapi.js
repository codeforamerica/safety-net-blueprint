#!/usr/bin/env node
/**
 * Standalone OpenAPI Validation Script
 * Validates OpenAPI specifications and examples
 */

import { discoverApiSpecs } from '../src/validation/openapi-loader.js';
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
  const brief = args.includes('--brief') || args.includes('-b');

  if (args.includes('--help') || args.includes('-h')) {
    console.log('OpenAPI Specification Validator\n');
    console.log('Usage: node scripts/validate-openapi.js --spec=<file|dir> [options]\n');
    console.log('Flags:');
    console.log('  --spec=<file|dir> Path to spec file or directory (required)');
    console.log('  -d, --detailed    Show all validation errors (default)');
    console.log('  -b, --brief       Show only first 3 errors per spec');
    console.log('  -h, --help        Show this help message');
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a =>
    a !== '--help' && a !== '-h' &&
    a !== '--detailed' && a !== '-d' &&
    a !== '--brief' && a !== '-b' &&
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
  console.log('OpenAPI Specification Validator');
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

    // Validate specs
    console.log('Validating specifications...\n');
    const results = await validateAll(apiSpecs);

    // Display results (detailed by default)
    console.log(formatResults(results, { detailed: !brief }));

    // Determine exit code
    const hasErrors = Object.values(results).some(r => !r.valid);

    if (hasErrors) {
      console.log('\n❌ Validation failed with errors\n');
      process.exit(1);
    } else {
      const hasWarnings = Object.values(results).some(r =>
        r.spec.warnings.length > 0
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
