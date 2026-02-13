#!/usr/bin/env node
/**
 * Standalone OpenAPI Validation Script
 * Validates OpenAPI specifications and examples
 */

import { discoverApiSpecs, getExamplesPath } from '../src/validation/openapi-loader.js';
import { validateAll, formatResults } from '../src/validation/openapi-validator.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

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
    console.log('Usage: node scripts/validate-openapi.js --specs=<dir> [options]\n');
    console.log('Flags:');
    console.log('  --specs=<dir>     Path to specs directory (required)');
    console.log('  --skip-examples   Skip example validation (schema-only)');
    console.log('  -d, --detailed    Show all validation errors (default)');
    console.log('  -b, --brief       Show only first 3 errors per example');
    console.log('  -h, --help        Show this help message');
    process.exit(0);
  }

  // Parse --specs flag
  const specsArg = args.find(a => a.startsWith('--specs='));
  if (!specsArg) {
    console.error('Error: --specs=<dir> is required.\n');
    console.error('Usage: node scripts/validate-openapi.js --specs=<dir>');
    process.exit(1);
  }
  const specsDir = resolve(specsArg.split('=')[1]);

  console.log('='.repeat(70));
  console.log('OpenAPI Specification & Examples Validator');
  console.log('='.repeat(70));

  try {
    // Discover API specs
    console.log('\nDiscovering OpenAPI specifications...');
    console.log(`  Specs: ${specsDir}`);
    const apiSpecs = discoverApiSpecs({ specsDir });

    if (apiSpecs.length === 0) {
      console.error('\n❌ No OpenAPI specifications found');
      process.exit(1);
    }

    console.log(`✓ Found ${apiSpecs.length} specification(s)\n`);

    // Add examples paths (unless skipping)
    const specsWithExamples = apiSpecs.map(spec => ({
      ...spec,
      examplesPath: skipExamples ? null : getExamplesPath(spec.name, specsDir)
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
