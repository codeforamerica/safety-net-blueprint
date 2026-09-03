/**
 * Validate mock data against OpenAPI schemas.
 * Exits with code 1 if any mock data record fails schema validation.
 */

import { resolve } from 'path';
import { loadAllSpecs } from '@codeforamerica/blueprint-core/loader';
import { validateMockData } from '../src/mock-data-validator.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Validate Mock Data

Validates *-mock-data.yaml files against their OpenAPI schemas.
Recursively searches --spec for files matching *-mock-data.yaml.

Usage:
  node scripts/validate-mock-data.js --spec=<dir>

Flags:
  --spec=<dir>  Directory containing contracts and mock data files (required)
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

  console.log('Validating mock data...');
  console.log(`  Specs: ${specsDir}`);

  try {
    const apiSpecs = await loadAllSpecs({ specsDir });
    const errors = validateMockData(specsDir, apiSpecs);

    if (errors.length === 0) {
      console.log('✓ All mock data valid');
      process.exit(0);
    } else {
      console.error(`\n✗ Mock data validation failed (${errors.length} error(s)):`);
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
