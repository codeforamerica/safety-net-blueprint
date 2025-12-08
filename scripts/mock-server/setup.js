/**
 * Setup script for mock server
 * Initializes databases and seeds initial data
 */

import { performSetup, displaySetupSummary } from '../../src/mock-server/setup.js';
import { closeAll } from '../../src/mock-server/database-manager.js';

async function setup() {
  console.log('='.repeat(70));
  console.log('Mock Server Setup');
  console.log('='.repeat(70));
  
  try {
    // Perform setup (load specs and seed databases)
    const { summary } = await performSetup({ verbose: true });
    
    // Display summary
    displaySetupSummary(summary);
    
    console.log('\n✓ Setup complete!');
    console.log('\nStart the mock server with: npm run mock:start\n');
    
    // Close databases
    closeAll();
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error);
    closeAll();
    process.exit(1);
  }
}

setup();
