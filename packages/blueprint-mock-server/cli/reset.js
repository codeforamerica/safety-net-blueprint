/**
 * Reset script for mock server
 * Clears all data and reseeds from example files
 */

import { resolve } from 'path';
import { performSetup, displaySetupSummary } from '../src/setup.js';
import { loadAllSpecs } from '@codeforamerica/blueprint-core/loader';
import { clearAll, closeAll } from '../src/database-manager.js';

function parseSpecDir() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Reset Mock Server

Clears all data and reseeds databases from example files.

Usage:
  node scripts/reset.js --spec=<dir>

Flags:
  --spec=<dir>  Directory containing OpenAPI specs (required)
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

  const specArg = args.find(a => a.startsWith('--spec='));
  if (!specArg) {
    console.error('Error: --spec=<dir> is required.\n');
    console.error('Usage: node scripts/reset.js --spec=<dir>');
    process.exit(1);
  }
  return resolve(specArg.split('=')[1]);
}

async function reset() {
  const specsDir = parseSpecDir();

  console.log('='.repeat(70));
  console.log('Mock Server Reset');
  console.log('='.repeat(70));

  try {
    // Load all OpenAPI specifications
    console.log('\nDiscovering OpenAPI specifications...');
    const apiSpecs = await loadAllSpecs({ specsDir });
    
    if (apiSpecs.length === 0) {
      throw new Error('No OpenAPI specifications found in specs directory');
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
    const { summary } = await performSetup({ specsDir, verbose: false });
    
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
