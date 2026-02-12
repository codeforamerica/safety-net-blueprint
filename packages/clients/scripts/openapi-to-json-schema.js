#!/usr/bin/env node
/**
 * Convert resolved OpenAPI specs to JSON Schema format.
 * Extracts schema definitions from OpenAPI and outputs pure JSON Schema files.
 *
 * Usage:
 *   openapi-to-json-schema --specs=./resolved --out=./json-schemas
 *   node scripts/openapi-to-json-schema.js --specs=./resolved --out=./json-schemas
 *
 * This script:
 * 1. Discovers all OpenAPI spec files in --specs directory
 * 2. Extracts components.schemas from each spec
 * 3. Converts OpenAPI 3.1 schemas to JSON Schema Draft 2020-12
 * 4. Outputs individual schema files organized by domain
 *
 * Output structure:
 *   {out}/
 *     persons/
 *       Person.json
 *       DemographicInfo.json
 *       CitizenshipInfo.json
 *       ...
 *     applications/
 *       Application.json
 *       HouseholdMember.json
 *       ...
 *     users/
 *       User.json
 *       ...
 */

import { writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = { specs: null, out: null };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--specs=')) {
      args.specs = arg.slice('--specs='.length);
    } else if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: openapi-to-json-schema --specs=<specs-dir> --out=<output-dir>

Options:
  --specs=<dir>   Directory containing resolved OpenAPI spec files (required)
  --out=<dir>     Output directory for JSON Schema files (required)
  --help, -h      Show this help message

Example:
  openapi-to-json-schema --specs=./resolved --out=./json-schemas
      `);
      process.exit(0);
    }
  }

  if (!args.specs) {
    console.error('Error: --specs parameter is required');
    process.exit(1);
  }

  if (!args.out) {
    console.error('Error: --out parameter is required');
    process.exit(1);
  }

  return args;
}

/**
 * Discover all OpenAPI spec files in a directory
 */
function discoverSpecs(specsDir) {
  const specs = [];

  try {
    const entries = readdirSync(specsDir);

    for (const entry of entries) {
      const fullPath = join(specsDir, entry);
      const stat = statSync(fullPath);

      if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (ext === '.yaml' || ext === '.yml' || ext === '.json') {
          // Skip certain files
          const name = basename(entry, ext);
          if (name.includes('-examples') || name.includes('patterns')) {
            continue;
          }

          specs.push({
            path: fullPath,
            name: name,
            ext: ext
          });
        }
      }
    }
  } catch (err) {
    console.error(`Error reading specs directory: ${err.message}`);
    process.exit(1);
  }

  return specs;
}

/**
 * Load and dereference an OpenAPI spec file, resolving all $ref entries.
 */
async function loadSpec(specPath) {
  try {
    const spec = await $RefParser.dereference(specPath, {
      dereference: {
        circular: 'ignore'
      }
    });
    return spec;
  } catch (err) {
    console.error(`Error loading spec ${specPath}: ${err.message}`);
    return null;
  }
}

/**
 * Convert OpenAPI 3.1 schema to JSON Schema.
 * OpenAPI 3.1 schemas are based on JSON Schema Draft 2020-12, so conversion is minimal.
 * We just need to remove OpenAPI-specific keywords and add JSON Schema metadata.
 */
function convertToJsonSchema(schema, schemaName) {
  // Deep clone the schema
  const jsonSchema = JSON.parse(JSON.stringify(schema));

  // Remove OpenAPI-specific properties that aren't valid in JSON Schema
  function removeOpenApiKeywords(obj) {
    if (typeof obj !== 'object' || obj === null) return;

    // Remove OpenAPI-specific keywords
    delete obj.discriminator;
    delete obj.xml;
    delete obj.externalDocs;
    delete obj.example;
    delete obj.deprecated;

    // Remove x- extension properties
    for (const key of Object.keys(obj)) {
      if (key.startsWith('x-')) {
        delete obj[key];
      }
    }

    // Recursively process nested objects
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        removeOpenApiKeywords(obj[key]);
      }
    }
  }

  removeOpenApiKeywords(jsonSchema);

  // Add JSON Schema metadata
  jsonSchema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  jsonSchema.$id = `#/components/schemas/${schemaName}`;

  return jsonSchema;
}

/**
 * Extract and convert schemas from an OpenAPI spec
 */
function extractSchemas(spec, specName) {
  const schemas = {};

  if (spec.components && spec.components.schemas) {
    for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
      try {
        schemas[schemaName] = convertToJsonSchema(schema, schemaName);
      } catch (err) {
        console.error(`Error converting schema ${schemaName} from ${specName}: ${err.message}`);
      }
    }
  }

  return schemas;
}

/**
 * Write schemas to output directory
 */
function writeSchemas(schemas, specName, outDir) {
  const specOutDir = join(outDir, specName);
  mkdirSync(specOutDir, { recursive: true });

  let schemasWritten = 0;

  for (const [schemaName, schema] of Object.entries(schemas)) {
    const schemaPath = join(specOutDir, `${schemaName}.json`);
    try {
      writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
      schemasWritten++;
    } catch (err) {
      console.error(`Error writing schema ${schemaName}: ${err.message}`);
    }
  }

  return schemasWritten;
}

/**
 * Main execution
 */
async function main() {
  const args = parseArgs();

  console.log('OpenAPI to JSON Schema Converter');
  console.log('=================================\n');
  console.log(`Input directory:  ${args.specs}`);
  console.log(`Output directory: ${args.out}\n`);

  // Discover specs
  const specs = discoverSpecs(args.specs);
  console.log(`Found ${specs.length} OpenAPI spec file(s)\n`);

  if (specs.length === 0) {
    console.log('No OpenAPI specs found. Exiting.');
    process.exit(0);
  }

  // Create output directory
  mkdirSync(args.out, { recursive: true });

  // Process each spec
  let totalSchemasWritten = 0;

  for (const spec of specs) {
    console.log(`Processing ${spec.name}${spec.ext}...`);

    const openApiSpec = await loadSpec(spec.path);
    if (!openApiSpec) {
      console.log(`  ⚠️  Skipped (failed to load)\n`);
      continue;
    }

    const schemas = extractSchemas(openApiSpec, spec.name);
    const schemaCount = Object.keys(schemas).length;

    if (schemaCount === 0) {
      console.log(`  ⚠️  No schemas found\n`);
      continue;
    }

    const written = writeSchemas(schemas, spec.name, args.out);
    totalSchemasWritten += written;

    console.log(`  ✓ Extracted ${schemaCount} schema(s)`);
    console.log(`  ✓ Written to ${spec.name}/\n`);
  }

  console.log(`✓ Complete! ${totalSchemasWritten} JSON Schema file(s) generated`);
  console.log(`  Output: ${args.out}`);
}

// Export for testing
export { convertToJsonSchema, parseArgs, discoverSpecs, loadSpec, extractSchemas };

// Only run main if this is the entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
