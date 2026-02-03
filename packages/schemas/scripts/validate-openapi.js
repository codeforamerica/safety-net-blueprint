#!/usr/bin/env node
/**
 * Standalone OpenAPI Validation Script
 * Validates OpenAPI specifications and examples
 *
 * If STATE env var is set, resolves overlays first then validates state-specific specs.
 * Otherwise validates base specs.
 */

import { discoverApiSpecs, getExamplesPath } from '../src/validation/openapi-loader.js';
import { validateAll, formatResults } from '../src/validation/openapi-validator.js';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve overlay for a state (creates resolved specs)
 */
function resolveOverlay(state) {
  console.log(`\nResolving overlay for: ${state}`);
  const result = spawnSync('node', [join(__dirname, 'resolve-overlay.js')], {
    env: { ...process.env, STATE: state },
    stdio: 'pipe',
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    console.error(`Failed to resolve overlay for ${state}`);
    console.error(result.stderr || result.stdout);
    return false;
  }

  // Print overlay output (includes warnings)
  if (result.stdout) {
    const lines = result.stdout.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
  }

  return true;
}

/**
 * Main validation function
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const detailed = args.includes('--detailed') || args.includes('-d');
  const brief = args.includes('--brief') || args.includes('-b');
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('OpenAPI Specification & Examples Validator\n');
    console.log('Usage: npm run validate [options]\n');
    console.log('Options:');
    console.log('  -d, --detailed    Show all validation errors (default)');
    console.log('  -b, --brief       Show only first 3 errors per example');
    console.log('  -h, --help        Show this help message');
    process.exit(0);
  }
  
  console.log('='.repeat(70));
  console.log('OpenAPI Specification & Examples Validator');
  console.log('='.repeat(70));
  
  try {
    // If STATE is set, resolve overlay first
    const state = process.env.STATE;
    if (state) {
      if (!resolveOverlay(state)) {
        process.exit(1);
      }
    }

    // Discover API specs (uses resolved specs if STATE is set)
    console.log('\nDiscovering OpenAPI specifications...');
    if (state) {
      console.log(`  State: ${state}`);
    }
    const apiSpecs = discoverApiSpecs();

    if (apiSpecs.length === 0) {
      console.error('\n❌ No OpenAPI specifications found in openapi/ directory');
      process.exit(1);
    }

    console.log(`✓ Found ${apiSpecs.length} specification(s)\n`);

    // Add examples paths (uses state-specific if STATE env var is set)
    const specsWithExamples = apiSpecs.map(spec => ({
      ...spec,
      examplesPath: getExamplesPath(spec.name)
    }));
    
    // Validate all specs and examples
    console.log('Validating specifications and examples...\n');
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
