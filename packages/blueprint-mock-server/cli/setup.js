/**
 * Setup script for mock server
 * Initializes databases and seeds initial data
 */

import { resolve } from 'path';
import { createSqliteStore } from '../src/stores/sqlite-store.js';

// One store for the life of this command.
const store = createSqliteStore();
import { performSetup, displaySetupSummary } from '../src/setup.js';

async function setup() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Setup Mock Server

Initializes databases and seeds initial data from OpenAPI example files.

Usage:
  node scripts/setup.js --spec=<dir> [--seed=<dir>]

Flags:
  --spec=<dir>  Directory containing OpenAPI specs (required)
  --seed=<dir>  Directory containing seed YAML files (default: same as --spec)
  -h, --help    Show this help message
`);
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a => a !== '--help' && a !== '-h' && !a.startsWith('--spec=') && !a.startsWith('--seed='));
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const specArg = args.find(a => a.startsWith('--spec='));
  if (!specArg) {
    console.error('Error: --spec=<dir> is required.\n');
    console.error('Usage: node scripts/setup.js --spec=<dir> [--seed=<dir>]');
    process.exit(1);
  }
  const specsDir = resolve(specArg.split('=')[1]);
  const seedArg = args.find(a => a.startsWith('--seed='));
  const seedDir = seedArg ? resolve(seedArg.split('=')[1]) : undefined;

  console.log('='.repeat(70));
  console.log('Mock Server Setup');
  console.log('='.repeat(70));

  try {
    // Perform setup (load specs and seed databases)
    const { summary } = await performSetup({ specsDir, seedDir, verbose: true, store });
    
    // Display summary
    displaySetupSummary(summary);
    
    console.log('\n✓ Setup complete!');
    console.log('\nStart the mock server with: npm run mock:start\n');
    
    // Close databases
    store.close();
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error);
    store.close();
    process.exit(1);
  }
}

setup();
