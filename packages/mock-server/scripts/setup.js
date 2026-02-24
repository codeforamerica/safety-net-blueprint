/**
 * Setup script for mock server
 * Initializes databases and seeds initial data
 */

import { resolve } from 'path';
import { performSetup, displaySetupSummary } from '../src/setup.js';
import { closeAll } from '../src/database-manager.js';

async function setup() {
  const args = process.argv.slice(2);
  const specsDirs = args
    .filter(a => a.startsWith('--specs='))
    .map(a => resolve(a.split('=')[1]));
  if (specsDirs.length === 0) {
    specsDirs.push(resolve('../contracts'));
  }

  console.log('='.repeat(70));
  console.log('Mock Server Setup');
  console.log('='.repeat(70));

  try {
    // Perform setup for each specs directory
    let combinedSummary = {};
    for (const specsDir of specsDirs) {
      const { summary } = await performSetup({ specsDir, verbose: true });
      Object.assign(combinedSummary, summary);
    }

    // Display summary
    displaySetupSummary(combinedSummary);

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
