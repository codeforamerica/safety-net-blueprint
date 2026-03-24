#!/usr/bin/env node
/**
 * Seed Data Generator
 *
 * Generates realistic mock seed data for all blueprint APIs by walking
 * OpenAPI schemas and applying field-level heuristics. Output is committed
 * to packages/mock-server/seed/ so the mock server always has data on startup.
 *
 * Usage:
 *   npm run mock:seed
 *   node packages/mock-server/scripts/generate-seed.js [--spec=<dir>] [--out=<dir>]
 *
 * Flags:
 *   --spec=<dir>   Directory containing OpenAPI specs (default: packages/contracts/)
 *   --out=<dir>    Output directory for seed files (default: packages/mock-server/seed/)
 *   --count=<n>    Records per resource (default: 2)
 *   -h, --help     Show this help message
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { faker } from '@faker-js/faker';
import { discoverApiSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fixed faker seed for determinism across regenerations
faker.seed(12345);

// =============================================================================
// Deterministic UUID generation (UUIDv5-style using SHA-1)
// =============================================================================

const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // RFC4122 DNS namespace

function uuidv5(name) {
  const hash = createHash('sha1')
    .update(UUID_NAMESPACE + name)
    .digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16),
    (parseInt(hash[16], 16) & 0x3 | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32)
  ].join('-');
}

// =============================================================================
// Field value generation
// =============================================================================

function pickEnum(values, index) {
  return values[index % values.length];
}

function generateFieldValue(propName, propSchema, resourceName, recordIndex, generatedIds) {
  const name = propName.toLowerCase();
  const format = propSchema.format;
  const type = propSchema.type;

  // FK field with x-relationship
  if (propName !== 'id' && propName.endsWith('Id') && format === 'uuid') {
    const rel = propSchema['x-relationship'];
    if (rel?.resource && rel.resource !== 'External') {
      const relResource = rel.resource;
      const relIds = generatedIds[relResource];
      if (relIds && relIds.length > 0) {
        return relIds[recordIndex % relIds.length];
      }
    }
    // External or unknown resource — use a stable placeholder UUID
    return uuidv5(`${resourceName}.${propName}.placeholder.${recordIndex}`);
  }

  // Primary key
  if (propName === 'id' && format === 'uuid') {
    return uuidv5(`${resourceName}.${recordIndex}`);
  }

  // Enum
  if (propSchema.enum) {
    return pickEnum(propSchema.enum, recordIndex);
  }

  // allOf — use first branch's enum/type
  if (propSchema.allOf) {
    for (const branch of propSchema.allOf) {
      if (branch.enum) return pickEnum(branch.enum, recordIndex);
    }
  }

  // Boolean
  if (type === 'boolean') {
    return recordIndex % 2 === 0;
  }

  // Number / integer
  if (type === 'number' || type === 'integer') {
    if (name.includes('amount') || name.includes('salary') || name.includes('wage')) {
      return recordIndex === 0 ? 2500 : 3200;
    }
    return recordIndex === 0 ? 1 : 2;
  }

  // Array — generate a short array of values using items schema
  if (type === 'array') {
    const items = propSchema.items;
    if (!items) return [];
    if (items.type === 'string' && items.format === 'uuid') return [];
    if (items.enum) return [pickEnum(items.enum, recordIndex)];
    if (items.type === 'string') return [faker.lorem.word()];
    return [];
  }

  // Object — generate nested properties
  if (type === 'object' && propSchema.properties) {
    const obj = {};
    for (const [k, v] of Object.entries(propSchema.properties)) {
      obj[k] = generateFieldValue(k, v, resourceName, recordIndex, generatedIds);
    }
    return obj;
  }

  // String fields by format
  if (format === 'uuid') return uuidv5(`${resourceName}.${propName}.${recordIndex}`);
  if (format === 'date-time') {
    const d = new Date('2024-01-01T00:00:00Z');
    d.setDate(d.getDate() + recordIndex * 30);
    return d.toISOString();
  }
  if (format === 'date') {
    return recordIndex === 0 ? '1985-04-12' : '1990-11-08';
  }
  if (format === 'email') return faker.internet.email().toLowerCase();
  if (format === 'uri' || format === 'url') return faker.internet.url();
  if (format === 'phone') return faker.phone.number();

  // String fields by name heuristics
  if (name === 'firstname' || name === 'first_name') return faker.person.firstName();
  if (name === 'lastname' || name === 'last_name') return faker.person.lastName();
  if (name.includes('phone')) return faker.phone.number({ style: 'national' });
  if (name.includes('email')) return faker.internet.email().toLowerCase();
  if (name.includes('city')) return faker.location.city();
  if (name.includes('state') && type === 'string') return faker.location.state({ abbreviated: true });
  if (name.includes('postal') || name.includes('zip')) return faker.location.zipCode('#####');
  if (name.includes('county')) return `${faker.location.city()} County`;
  if (name.includes('address') && name.includes('line')) return faker.location.streetAddress();
  if (name.includes('street')) return faker.location.streetAddress();
  if (name.includes('description') || name.includes('notes') || name.includes('reason')) {
    return faker.lorem.sentence();
  }
  if (name.includes('title')) return faker.lorem.words(3);
  if (name.includes('name') && type === 'string') return faker.person.fullName();
  if (name.includes('version')) return '1.0.0';
  if (name.includes('status') && type === 'string') return 'active';
  if (name.includes('type') && type === 'string') return 'standard';
  if (name.includes('url') || name.includes('uri')) return faker.internet.url();
  if (name.includes('code') && propSchema.maxLength) return faker.string.alphanumeric(Math.min(propSchema.maxLength, 8));

  // Default
  if (type === 'string') {
    if (propSchema.maxLength && propSchema.maxLength < 20) {
      return faker.string.alphanumeric(Math.min(propSchema.maxLength, 8));
    }
    return faker.lorem.words(2);
  }

  return null;
}

// =============================================================================
// Schema walking
// =============================================================================

function collectSchemaProperties(schema) {
  if (!schema) return {};
  const props = { ...(schema.properties || {}) };
  if (schema.allOf) {
    for (const branch of schema.allOf) {
      if (!branch.$ref) Object.assign(props, collectSchemaProperties(branch));
    }
  }
  return props;
}

function generateRecord(resourceName, schema, recordIndex, generatedIds) {
  const properties = collectSchemaProperties(schema);
  const record = {};

  for (const [propName, propSchema] of Object.entries(properties)) {
    if (!propSchema || propSchema.$ref) continue;
    // Skip readOnly fields except id/createdAt/updatedAt (always include those)
    if (propSchema.readOnly && propName !== 'id' && propName !== 'createdAt' && propName !== 'updatedAt') {
      if (propName !== 'id') {
        // Include readOnly id
      }
    }
    const value = generateFieldValue(propName, propSchema, resourceName, recordIndex, generatedIds);
    if (value !== null && value !== undefined) {
      record[propName] = value;
    }
  }

  // Ensure required timestamps
  if (!record.createdAt && properties.createdAt) {
    const d = new Date('2024-01-01T00:00:00Z');
    d.setDate(d.getDate() + recordIndex * 30);
    record.createdAt = d.toISOString();
  }
  if (!record.updatedAt && properties.updatedAt) {
    record.updatedAt = record.createdAt || new Date('2024-01-01T00:00:00Z').toISOString();
  }

  return record;
}

// =============================================================================
// Dependency graph and topological sort
// =============================================================================

/**
 * Extract x-relationship dependencies from a schema (non-External resources).
 */
function extractDependencies(schema) {
  const deps = new Set();
  const props = collectSchemaProperties(schema);
  for (const [propName, propSchema] of Object.entries(props)) {
    if (!propSchema || propSchema.$ref) continue;
    if (propName !== 'id' && propName.endsWith('Id') && propSchema.format === 'uuid') {
      const rel = propSchema['x-relationship'];
      if (rel?.resource && rel.resource !== 'External') {
        deps.add(rel.resource);
      }
    }
    // Recurse into array items
    if (propSchema.type === 'array' && propSchema.items && !propSchema.items.$ref) {
      const itemProps = collectSchemaProperties(propSchema.items);
      for (const [k, v] of Object.entries(itemProps)) {
        if (!v || v.$ref) continue;
        if (k !== 'id' && k.endsWith('Id') && v.format === 'uuid') {
          const rel = v['x-relationship'];
          if (rel?.resource && rel.resource !== 'External') deps.add(rel.resource);
        }
      }
    }
  }
  return [...deps];
}

function topologicalSort(nodes) {
  // nodes: Map<resourceName, { apiName, schema, deps: string[] }>
  const visited = new Set();
  const sorted = [];

  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const node = nodes.get(name);
    if (node) {
      for (const dep of node.deps) {
        visit(dep);
      }
    }
    sorted.push(name);
  }

  for (const name of nodes.keys()) {
    visit(name);
  }

  return sorted;
}

// =============================================================================
// Main
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const contractsDir = resolve(__dirname, '..', '..', '..', 'packages', 'contracts');
  const seedDir = resolve(__dirname, '..', 'seed');
  const options = { spec: contractsDir, out: seedDir, count: 2, help: false };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--spec=')) options.spec = resolve(arg.split('=')[1]);
    else if (arg.startsWith('--out=')) options.out = resolve(arg.split('=')[1]);
    else if (arg.startsWith('--count=')) options.count = parseInt(arg.split('=')[1], 10);
    else { console.error(`Error: Unknown argument: ${arg}`); process.exit(1); }
  }
  return options;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
Seed Data Generator

Generates realistic mock seed data for all blueprint APIs.

Usage:
  node scripts/generate-seed.js [--spec=<dir>] [--out=<dir>] [--count=<n>]

Flags:
  --spec=<dir>   Directory containing OpenAPI specs (default: packages/contracts/)
  --out=<dir>    Output directory for seed files (default: packages/mock-server/seed/)
  --count=<n>    Records per resource (default: 2)
  -h, --help     Show this help message
`);
    process.exit(0);
  }

  console.log('='.repeat(70));
  console.log('Safety Net Seed Data Generator');
  console.log('='.repeat(70));
  console.log(`\n  Specs: ${options.spec}`);
  console.log(`  Output: ${options.out}`);
  console.log(`  Records per resource: ${options.count}\n`);

  // Discover specs
  const apiSpecs = discoverApiSpecs({ specsDir: options.spec });
  console.log(`Found ${apiSpecs.length} API spec(s)\n`);

  // Load and dereference all specs
  const loadedSpecs = [];
  for (const apiSpec of apiSpecs) {
    try {
      const spec = await $RefParser.dereference(apiSpec.specPath, {
        dereference: { circular: 'ignore' }
      });
      loadedSpecs.push({ ...apiSpec, spec });
    } catch (error) {
      console.warn(`  Warning: Could not load ${apiSpec.name}: ${error.message}`);
    }
  }

  // Build resource → { apiName, schema, deps } map
  const resourceNodes = new Map();
  for (const { name: apiName, spec } of loadedSpecs) {
    if (!spec.components?.schemas) continue;
    for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
      // Only include primary/main schemas (not Create/Update/List variants)
      if (schemaName.endsWith('Create') || schemaName.endsWith('Update') ||
          schemaName.endsWith('List') || schemaName.endsWith('Status') ||
          schemaName.endsWith('Type') || schemaName.endsWith('Member') ||
          schemaName.endsWith('Event') || schemaName.endsWith('Identity') ||
          schemaName.endsWith('Expenses') || schemaName.endsWith('Utilities') ||
          schemaName.endsWith('Income') && schemaName !== 'Income') continue;

      // Skip schemas without an id property (not resource schemas)
      const props = collectSchemaProperties(schema);
      if (!props.id) continue;

      const deps = extractDependencies(schema);
      resourceNodes.set(schemaName, { apiName, schema, deps });
    }
  }

  // Topological sort
  const sortedResources = topologicalSort(resourceNodes);
  console.log('Generation order:', sortedResources.join(' → '));
  console.log('');

  // Generate records in dependency order
  const generatedIds = {}; // resourceName → [id1, id2, ...]
  const apiSeedData = {}; // apiName → { ExampleKey: data }

  for (const resourceName of sortedResources) {
    const node = resourceNodes.get(resourceName);
    if (!node) continue;

    const { apiName, schema } = node;
    if (!apiSeedData[apiName]) apiSeedData[apiName] = {};

    const ids = [];
    for (let i = 0; i < options.count; i++) {
      const record = generateRecord(resourceName, schema, i, generatedIds);
      const exampleKey = `${resourceName}Example${i + 1}`;
      apiSeedData[apiName][exampleKey] = record;
      if (record.id) ids.push(record.id);
    }
    generatedIds[resourceName] = ids;
    console.log(`  Generated ${options.count} ${resourceName} record(s)`);
  }

  // Write seed files
  if (!existsSync(options.out)) {
    mkdirSync(options.out, { recursive: true });
  }

  console.log('\nWriting seed files...');
  for (const [apiName, data] of Object.entries(apiSeedData)) {
    const outputPath = join(options.out, `${apiName}.yaml`);
    const content = `# Seed data for ${apiName} — generated by mock:seed\n# Edit freely; run mock:seed to regenerate from scratch.\n\n` +
      yaml.dump(data, { lineWidth: -1, noRefs: true });
    writeFileSync(outputPath, content);
    console.log(`  Wrote ${outputPath}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('✓ Seed data generated successfully!');
  console.log('='.repeat(70));
  console.log('\nCommit the seed/ files and run mock:start to use the new data.');
  console.log('Re-run mock:seed after schema changes to regenerate.\n');
}

main().catch(error => {
  console.error('\n❌ Seed generation failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
