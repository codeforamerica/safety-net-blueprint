/**
 * Reset script for mock server
 * Clears all data and reseeds from example files
 */

import { performSetup, displaySetupSummary } from '../../src/mock-server/setup.js';
import { loadAllSpecs } from '../../src/mock-server/openapi-loader.js';
import { clearAll, closeAll } from '../../src/mock-server/database-manager.js';

async function reset() {
  console.log('='.repeat(70));
  console.log('Mock Server Reset');
  console.log('='.repeat(70));
  
  try {
    // Load all OpenAPI specifications
    console.log('\nDiscovering OpenAPI specifications...');
    const apiSpecs = await loadAllSpecs();
    
    if (apiSpecs.length === 0) {
      throw new Error('No OpenAPI specifications found in openapi/ directory');
    }
    
    console.log(`✓ Discovered ${apiSpecs.length} API(s):`);
    apiSpecs.forEach(api => console.log(`  - ${api.title} (${api.name})`));
    
    // Clear all databases
    console.log('\nClearing all databases...');
    for (const api of apiSpecs) {
      try {
        clearAll(api.name);
        console.log(`  ✓ Cleared ${api.name}`);
      } catch (error) {
        console.warn(`  Warning: Could not clear ${api.name}:`, error.message);
      }
    }
    
    // Reseed databases using shared setup
    const { summary } = await performSetup({ verbose: false });
    
    // Display summary
    console.log('='.repeat(70));
    console.log('Reset Summary:');
    console.log('='.repeat(70));
    
    displaySetupSummary(summary);
    
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
