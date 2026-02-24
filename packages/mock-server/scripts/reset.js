/**
 * Reset script for mock server
 * Clears all data and reseeds from example files
 */

import { resolve } from 'path';
import { performSetup, displaySetupSummary } from '../src/setup.js';
import { loadAllSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';
import { clearAll, closeAll } from '../src/database-manager.js';

function parseSpecsDirs() {
  const args = process.argv.slice(2);
  const specsDirs = args
    .filter(a => a.startsWith('--specs='))
    .map(a => resolve(a.split('=')[1]));
  return specsDirs.length > 0 ? specsDirs : [resolve('../contracts')];
}

async function reset() {
  const specsDirs = parseSpecsDirs();

  console.log('='.repeat(70));
  console.log('Mock Server Reset');
  console.log('='.repeat(70));

  try {
    // Load and clear all OpenAPI specifications from all directories
    for (const specsDir of specsDirs) {
      console.log(`\nDiscovering OpenAPI specifications in ${specsDir}...`);
      const apiSpecs = await loadAllSpecs({ specsDir });

      if (apiSpecs.length === 0) {
        console.log('  No specs found, skipping.');
        continue;
      }

      console.log(`✓ Discovered ${apiSpecs.length} API(s):`);
      apiSpecs.forEach(api => console.log(`  - ${api.title} (${api.name})`));

      // Clear all databases for this directory's specs
      console.log('\nClearing databases...');
      for (const api of apiSpecs) {
        try {
          clearAll(api.name);
          console.log(`  ✓ Cleared ${api.name}`);
        } catch (error) {
          console.warn(`  Warning: Could not clear ${api.name}:`, error.message);
        }
      }
    }

    // Reseed databases using shared setup for each directory
    let combinedSummary = {};
    for (const specsDir of specsDirs) {
      const { summary } = await performSetup({ specsDir, verbose: false });
      Object.assign(combinedSummary, summary);
    }

    // Display summary
    console.log('='.repeat(70));
    console.log('Reset Summary:');
    console.log('='.repeat(70));

    displaySetupSummary(combinedSummary);

    console.log('\n✓ Reset complete!');
    console.log('\nRestart the mock server if it is running.\n');

    // Close databases
    closeAll();

  } catch (error) {
    console.error('\n❌ Reset failed:', error.message);
    console.error(error);
    closeAll();
    process.exit(1);
  }
}

reset();
