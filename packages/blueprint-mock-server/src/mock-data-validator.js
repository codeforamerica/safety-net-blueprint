/**
 * Mock data validator — validates *-mock-data.yaml records against API schemas.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { readdirSync, statSync } from 'fs';
import yaml from 'js-yaml';
import { discover, generate, load } from '@codeforamerica/blueprint-core';
import { deriveCollectionName } from './collection-utils.js';
import { getItemSchema } from './handlers/expand-utils.js';
import { validateAgainstSchema } from './example-validator.js';

/**
 * Recursively find all *-mock-data.yaml files under rootDir.
 * Returns an array of { apiName, filePath } objects.
 */
function findMockDataFiles(rootDir) {
  const results = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('-mock-data.yaml')) {
        const apiName = entry.replace(/-mock-data\.yaml$/, '');
        results.push({ apiName, filePath: full });
      }
    }
  }
  walk(rootDir);
  return results;
}

/**
 * The schema each collection actually holds, according to the contract.
 *
 * Derived from the collection endpoint's list response rather than from the
 * example key's name. Deriving a schema name from the key looks right and is
 * not: `/registry/policies` is collection `registry-policies`, whose records
 * are keyed `RegistryPolicyExample1`, but the schema is `Policy`. A key-based
 * lookup finds nothing there and skips validation in silence — those two
 * records went unchecked for exactly that reason.
 *
 * @param {Array} apiSpecs - API metadata from loadAllSpecs
 * @returns {Map<string, object>} Collection name to the schema its records must satisfy
 */
function schemaByCollection(apiSpecs) {
  const byCollection = new Map();

  for (const api of apiSpecs) {
    for (const endpoint of api.endpoints ?? []) {
      if (endpoint.method !== 'GET' || endpoint.path.includes('{')) continue;

      const collection = deriveCollectionName(endpoint.path, api.serverBasePath || '');
      if (!collection || byCollection.has(collection)) continue;

      const schema = getItemSchema(endpoint.responseSchema, api.schemas);
      if (schema) byCollection.set(collection, schema);
    }
  }

  return byCollection;
}

export function validateMockData(specsDir, apiSpecs) {
  const errors = [];
  const bySchema = schemaByCollection(apiSpecs);

  // Which collection each record belongs to is core's answer — the same
  // grouping the seeder uses, so the validator checks a record against the
  // schema of the collection it will actually be seeded into.
  const docs = discover(specsDir).map(load);
  const grouped = generate(docs, 'examples');

  const collectionOf = new Map();
  for (const [collection, records] of Object.entries(grouped)) {
    for (const record of records) collectionOf.set(record.key, collection);
  }

  for (const { apiName, filePath } of findMockDataFiles(specsDir)) {
    let examples;
    try {
      examples = yaml.load(readFileSync(filePath, 'utf8')) || {};
    } catch (err) {
      errors.push({ api: apiName, key: null, message: `Failed to parse mock data file: ${err.message}` });
      continue;
    }

    for (const [key, value] of Object.entries(examples)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

      // Belonging to no collection is the dangerous case: the record is
      // seeded nowhere and validated against nothing, and nothing says so. A
      // platform event sat in the workflow seed file keyed DomainEventExample1
      // while the schema is Event, and was silently dropped for years.
      const collection = collectionOf.get(key);
      if (!collection) {
        errors.push({
          api: apiName,
          key,
          message: 'belongs to no collection in the contract set, so it is seeded nowhere. '
            + 'Name the key after the schema it is an example of.',
        });
        continue;
      }

      const schema = bySchema.get(collection);
      if (!schema) continue;

      for (const { instancePath, message } of validateAgainstSchema(value, schema)) {
        errors.push({ api: apiName, key, message: `${instancePath || '/'}: ${message}` });
      }
    }
  }

  return errors;
}
