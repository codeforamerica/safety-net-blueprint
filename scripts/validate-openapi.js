#!/usr/bin/env node
/**
 * Standalone OpenAPI Validation Script
 * Validates OpenAPI specifications and examples
 */

import { discoverApiSpecs } from '../src/mock-server/openapi-loader.js';
import { validateAll, formatResults } from '../src/mock-server/openapi-validator.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
    // Discover API specs
    console.log('\nDiscovering OpenAPI specifications...');
    const apiSpecs = discoverApiSpecs();
    
    if (apiSpecs.length === 0) {
      console.error('\n❌ No OpenAPI specifications found in openapi/ directory');
      process.exit(1);
    }
    
    console.log(`✓ Found ${apiSpecs.length} specification(s)\n`);
    
    // Add examples paths
    const specsWithExamples = apiSpecs.map(spec => ({
      ...spec,
      examplesPath: join(__dirname, '../openapi/examples', `${spec.name}.yaml`)
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
