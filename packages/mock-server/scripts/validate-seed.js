/**
 * Validate seed data against OpenAPI schemas.
 * Exits with code 1 if any seed record fails schema validation.
 */

import { resolve } from 'path';
import { loadAllSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';
import { validateSeedData } from '../src/seed-validator.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Validate Seed Data

Validates seed YAML files against their OpenAPI schemas.

Usage:
  node scripts/validate-seed.js --spec=<dir> [--seed=<dir>]

Flags:
  --spec=<dir>  Directory containing OpenAPI specs (required)
  --seed=<dir>  Directory containing seed files (default: packages/mock-server/seed)
  -h, --help    Show this help message
`);
    process.exit(0);
  }

  const specArg = args.find(a => a.startsWith('--spec='));
  if (!specArg) {
    console.error('Error: --spec=<dir> is required.');
    process.exit(1);
  }
  const specsDir = resolve(specArg.split('=')[1]);

  const seedArg = args.find(a => a.startsWith('--seed='));
  const seedDir = seedArg ? resolve(seedArg.split('=')[1]) : specsDir;

  console.log('Validating seed data...');
  console.log(`  Specs: ${specsDir}`);
  console.log(`  Seed:  ${seedDir}`);

  try {
    const apiSpecs = await loadAllSpecs({ specsDir });
    const errors = validateSeedData(seedDir, apiSpecs);

    if (errors.length === 0) {
      console.log('✓ All seed data valid');
      process.exit(0);
    } else {
      console.error(`\n✗ Seed data validation failed (${errors.length} error(s)):`);
      for (const err of errors) {
        const keyStr = err.key ? ` [${err.key}]` : '';
        console.error(`  ${err.api}${keyStr}: ${err.message}`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
