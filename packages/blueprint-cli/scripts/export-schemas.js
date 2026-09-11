#!/usr/bin/env node
/**
 * Generate JSON Schema files from resolved OpenAPI specs.
 * Extracts schema definitions from OpenAPI and outputs pure JSON Schema files.
 *
 * Usage:
 *   blueprint-export-schemas --spec=./resolved --out=./json-schemas
 *   node scripts/export-schemas.js --spec=./resolved --out=./json-schemas
 *
 * This script:
 * 1. Discovers all OpenAPI spec files in --spec file or directory
 * 2. Extracts components.schemas from each spec
 * 3. Converts OpenAPI 3.1 schemas to JSON Schema Draft 2020-12
 * 4. Outputs individual .json schema files organized by domain
 *
 * Output structure:
 *   {out}/
 *     {domain}/
 *       Application.json
 *       HouseholdMember.json
 *       ...
 *
 * The output directory name is taken from info.x-domain in the spec if present,
 * falling back to the filename slug (e.g. intake from intake-openapi.yaml).
 */

import { writeFileSync, mkdirSync, readdirSync, statSync, realpathSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = { spec: null, out: null };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--spec=')) {
      args.spec = arg.slice('--spec='.length);
    } else if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: blueprint-export-schemas --spec=<file-or-dir> --out=<output-dir>

Options:
  --spec=<file-or-dir>   Path to resolved spec file or directory (required)
  --out=<dir>            Output directory for JSON Schema files (required)
  --help, -h             Show this help message

Example:
  blueprint-export-schemas --spec=./resolved --out=./json-schemas
      `);
      process.exit(0);
    }
  }

  if (!args.spec) {
    console.error('Error: --spec parameter is required');
    process.exit(1);
  }

  if (!args.out) {
    console.error('Error: --out parameter is required');
    process.exit(1);
  }

  return args;
}

function discoverSpecs(specsDir) {
  const specs = [];

  try {
    const entries = readdirSync(specsDir);

    for (const entry of entries) {
      const fullPath = join(specsDir, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && entry.endsWith('-openapi.yaml')) {
        specs.push({
          path: fullPath,
          fileSlug: basename(entry, '-openapi.yaml'),
        });
      }
    }
  } catch (err) {
    console.error(`Error reading specs directory: ${err.message}`);
    process.exit(1);
  }

  return specs;
}

async function loadSpec(specPath) {
  try {
    const spec = await $RefParser.dereference(specPath, {
      dereference: { circular: 'ignore' },
    });
    return spec;
  } catch (err) {
    console.error(`Error loading spec ${specPath}: ${err.message}`);
    return null;
  }
}

/**
 * Convert OpenAPI 3.1 schema to JSON Schema Draft 2020-12.
 * OAS 3.1 is already based on JSON Schema 2020-12 — conversion mainly strips
 * OpenAPI-specific keywords that are not valid in pure JSON Schema.
 */
function convertToJsonSchema(schema, schemaName) {
  const jsonSchema = JSON.parse(JSON.stringify(schema));

  function removeOpenApiKeywords(obj) {
    if (typeof obj !== 'object' || obj === null) return;
    delete obj.discriminator;
    delete obj.xml;
    delete obj.externalDocs;
    delete obj.example;
    delete obj.deprecated;
    for (const key of Object.keys(obj)) {
      if (key.startsWith('x-')) delete obj[key];
    }
    for (const key in obj) {
      if (typeof obj[key] === 'object') removeOpenApiKeywords(obj[key]);
    }
  }

  removeOpenApiKeywords(jsonSchema);
  jsonSchema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  jsonSchema.$id = `#/components/schemas/${schemaName}`;

  return jsonSchema;
}

function extractSchemas(spec, fileSlug) {
  const schemas = {};

  if (spec.components && spec.components.schemas) {
    for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
      try {
        schemas[schemaName] = convertToJsonSchema(schema, schemaName);
      } catch (err) {
        console.error(`Error converting schema ${schemaName} from ${fileSlug}: ${err.message}`);
      }
    }
  }

  return schemas;
}

function writeSchemas(schemas, domainName, outDir) {
  const domainDir = join(outDir, domainName);
  mkdirSync(domainDir, { recursive: true });

  let schemasWritten = 0;

  for (const [schemaName, schema] of Object.entries(schemas)) {
    const schemaPath = join(domainDir, `${schemaName}.json`);
    try {
      writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
      schemasWritten++;
    } catch (err) {
      console.error(`Error writing schema ${schemaName}: ${err.message}`);
    }
  }

  return schemasWritten;
}

async function main() {
  const args = parseArgs();

  console.log('Blueprint JSON Schema Generator');
  console.log('================================\n');
  console.log(`Input:            ${args.spec}`);
  console.log(`Output directory: ${args.out}\n`);

  const specs = discoverSpecs(args.spec);
  console.log(`Found ${specs.length} OpenAPI spec file(s)\n`);

  if (specs.length === 0) {
    console.log('No OpenAPI specs found. Exiting.');
    process.exit(0);
  }

  mkdirSync(args.out, { recursive: true });

  let totalSchemasWritten = 0;

  for (const { path: specPath, fileSlug } of specs) {
    console.log(`Processing ${fileSlug}-openapi.yaml...`);

    const openApiSpec = await loadSpec(specPath);
    if (!openApiSpec) {
      console.log(`  Skipped (failed to load)\n`);
      continue;
    }

    const domainName = openApiSpec.info?.['x-domain'] ?? fileSlug;
    const schemas = extractSchemas(openApiSpec, fileSlug);
    const schemaCount = Object.keys(schemas).length;

    if (schemaCount === 0) {
      console.log(`  No schemas found\n`);
      continue;
    }

    const written = writeSchemas(schemas, domainName, args.out);
    totalSchemasWritten += written;

    console.log(`  Extracted ${schemaCount} schema(s)`);
    console.log(`  Written to ${domainName}/\n`);
  }

  console.log(`Complete! ${totalSchemasWritten} JSON Schema file(s) generated`);
  console.log(`Output: ${args.out}`);
}

export { convertToJsonSchema, parseArgs, discoverSpecs, loadSpec, extractSchemas };

if (import.meta.url === `file://${realpathSync(process.argv[1])}`) {
  main();
}
