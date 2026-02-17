/**
 * Shared setup functionality for mock server
 * Handles loading specs and seeding databases
 */

import { loadAllSpecs, discoverApiSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';
import { seedAllDatabases } from './seeder.js';
import { validateAll, getValidationStatus } from '@codeforamerica/safety-net-blueprint-contracts/validation';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Perform setup: load specs and seed databases
 * @param {Object} options - Setup options
 * @param {string} options.specsDir - Path to specs directory (required)
 * @param {boolean} options.verbose - Show detailed output
 * @param {boolean} options.skipValidation - Skip validation step
 * @returns {Promise<Object>} Setup result with apiSpecs and summary
 */
export async function performSetup({ specsDir, verbose = true, skipValidation = false } = {}) {
  if (!specsDir) {
    throw new Error('specsDir is required — pass --specs <dir> to specify the specs directory');
  }
  // Check environment variable for skip validation
  if (process.env.SKIP_VALIDATION === 'true') {
    skipValidation = true;
  }
  if (verbose) {
    console.log('\nDiscovering OpenAPI specifications...');
    console.log(`  Specs: ${specsDir}`);
  }

  const apiSpecs = await loadAllSpecs({ specsDir });
  
  if (apiSpecs.length === 0) {
    throw new Error('No OpenAPI specifications found in specs directory');
  }
  
  if (verbose) {
    console.log(`✓ Discovered ${apiSpecs.length} API(s):`);
    apiSpecs.forEach(api => console.log(`  - ${api.title} (${api.name})`));
  }
  
  // Validate specs and examples (unless skipped)
  if (!skipValidation) {
    if (verbose) {
      console.log('\nValidating specifications and examples...');
    }
    
    const discoveredSpecs = discoverApiSpecs({ specsDir });
    const specsWithExamples = discoveredSpecs.map(spec => ({
      ...spec,
      examplesPath: join(specsDir, `${spec.name}-openapi-examples.yaml`)
    }));
    
    const validationResults = await validateAll(specsWithExamples);
    
    // Check for validation errors
    const hasErrors = Object.values(validationResults).some(r => !r.valid);
    
    if (verbose) {
      for (const [apiName, result] of Object.entries(validationResults)) {
        const status = getValidationStatus(result.spec);
        const examplesStatus = getValidationStatus(result.examples);
        
        console.log(`  ${status.emoji} ${apiName}: ${status.message}`);
        if (result.examples.warnings.length > 0 || result.examples.errors.length > 0) {
          console.log(`    Examples: ${examplesStatus.message}`);
        }
      }
    }
    
    if (hasErrors) {
      throw new Error('Validation failed. Run "npm run validate" for detailed errors.');
    }
    
    if (verbose) {
      console.log('✓ Validation passed');
    }
  }
  
  // Seed databases from example files
  const summary = seedAllDatabases(apiSpecs, specsDir);
  
  return { apiSpecs, summary };
}

/**
 * Display setup summary
 * @param {Object} summary - Seeding summary
 */
export function displaySetupSummary(summary) {
  console.log('='.repeat(70));
  console.log('Setup Summary:');
  console.log('='.repeat(70));
  
  for (const [apiName, count] of Object.entries(summary)) {
    console.log(`  ${apiName}: ${count} resources`);
  }
}


