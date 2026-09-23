#!/usr/bin/env node
/**
 * Postman Collection Generator
 * Generates a Postman collection from resolved OpenAPI specifications and examples.
 *
 * Usage:
 *   node scripts/generate-postman.js [--spec=<dir>] [--out=<file>]
 *   npm run postman
 *
 * Flags:
 *   --spec=<dir>   Directory containing resolved OpenAPI specs (default: resolved/)
 *   --out=<path>   Output file or directory (default: generated/postman-collection.json)
 *   -h, --help     Show this help message
 */

import { discover, generate, load } from '@codeforamerica/blueprint-core';
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename } from 'path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = process.env.POSTMAN_BASE_URL || 'http://localhost:1080';

/**
 * The contract set, keyed by filename.
 *
 * Every document this generator needs — specs, seed examples, state machines
 * — is already in the set the caller loaded. Looking them up here rather than
 * re-reading them off disk is what lets the generator run on documents in
 * memory.
 *
 * @type {Map<string, object>}
 */
let contracts = new Map();

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    spec: null,
    out: null,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--spec=')) {
      options.spec = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      options.out = arg.split('=')[1];
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}


// =============================================================================
// Main
// =============================================================================

/**
 * Generate Postman collection
 */
async function generatePostmanCollection() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
Postman Collection Generator

Generates a Postman collection from resolved OpenAPI specifications.

Usage:
  node scripts/generate-postman.js [--spec=<dir>] [--out=<file>]

Flags:
  --spec=<dir>   Directory containing resolved OpenAPI specs (default: resolved/)
  --out=<path>   Output file or directory (default: generated/postman-collection.json)
  -h, --help     Show this help message
`);
    process.exit(0);
  }

  if (!options.spec) { console.error('Error: --spec is required'); process.exit(1); }
  if (!options.out) { console.error('Error: --out is required'); process.exit(1); }

  const specsDir = resolve(options.spec);
  const outResolved = resolve(options.out);
  const outputPath = (existsSync(outResolved) && statSync(outResolved).isDirectory())
    ? join(outResolved, 'postman-collection.json')
    : outResolved;
  const outputDir = dirname(outputPath);

  console.log('='.repeat(70));
  console.log('Postman Collection Generator');
  console.log('='.repeat(70));

  // Load API specs
  console.log('\nLoading OpenAPI specifications...');
  console.log(`  Specs directory: ${specsDir}`);
  // One pass over the set: specs, seed examples and state machines all come
  // from here, keyed by filename.
  const docs = discover(specsDir).map(load);
  contracts = new Map(docs.map((doc) => [basename(doc.path), doc.content]));

  // Only name and title are used below, both of which a Doc carries.
  const apiSpecs = docs
    .filter((doc) => doc.type === 'openapi')
    .map((doc) => ({
      name: basename(doc.path, '-openapi.yaml'),
      title: doc.content?.info?.title ?? basename(doc.path, '-openapi.yaml'),
    }));
  console.log(`✓ Loaded ${apiSpecs.length} API(s)`);

  // Check for existing collection to preserve _postman_id
  let existingPostmanId = null;

  if (existsSync(outputPath)) {
    try {
      const existingCollection = JSON.parse(readFileSync(outputPath, 'utf8'));
      existingPostmanId = existingCollection?.info?._postman_id;
      if (existingPostmanId) {
        console.log('✓ Preserving existing Postman collection ID');
      }
    } catch (error) {
      // If we can't read/parse the existing file, just generate a new ID
      console.log('⚠ Could not read existing collection, will generate new ID');
    }
  }

  const collection = generate(docs, 'postman', { baseUrl: BASE_URL, collectionId: existingPostmanId });

  // Write output
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(collection, null, 2));

  console.log('\n' + '='.repeat(70));
  console.log('✓ Postman collection generated successfully!');
  console.log('='.repeat(70));
  console.log(`\nOutput: ${outputPath}`);
  console.log(`\nTotal APIs: ${apiSpecs.length}`);
  console.log(`Total Requests: ${collection.item.reduce((sum, api) => sum + api.item.length, 0)}`);
  console.log(`\nTo import:`);
  console.log(`1. Open Postman`);
  console.log(`2. Click Import`);
  console.log(`3. Select the file: ${outputPath}`);
  console.log(`4. Click Import`);
  console.log(`\nBase URL variable: ${BASE_URL}`);
  console.log('');
}

// Run generator
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  generatePostmanCollection().catch(error => {
    console.error('\n❌ Generation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
}


