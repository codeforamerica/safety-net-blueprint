/**
 * Setup script for mock server
 * Initializes databases and seeds initial data
 */

import { resolve } from 'path';
import { performSetup, displaySetupSummary } from '../src/setup.js';
import { closeAll } from '../src/database-manager.js';

async function setup() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Setup Mock Server

Initializes databases and seeds initial data from OpenAPI example files.

Usage:
  node scripts/setup.js --spec=<dir> [--spec=<dir2> ...]

Flags:
  --spec=<dir>  Directory containing OpenAPI specs (required, repeatable)
  -h, --help    Show this help message
`);
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a => a !== '--help' && a !== '-h' && !a.startsWith('--spec='));
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const specsDirs = args
    .filter(a => a.startsWith('--spec='))
    .map(a => resolve(a.split('=')[1]));
  if (specsDirs.length === 0) {
    console.error('Error: --spec=<dir> is required.\n');
    console.error('Usage: node scripts/setup.js --spec=<dir> [--spec=<dir2> ...]');
    process.exit(1);
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
