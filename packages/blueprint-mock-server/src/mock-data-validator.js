/**
 * Mock data validator — validates *-mock-data.yaml records against API schemas.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { readdirSync, statSync } from 'fs';
import yaml from 'js-yaml';
import { discover, generate, load } from '@codeforamerica/blueprint-core';
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

export function validateMockData(specsDir, apiSpecs) {
  const errors = [];

  const allSchemas = {};
  for (const api of apiSpecs) Object.assign(allSchemas, api.schemas ?? {});

  // Core groups each record under the schema it exemplifies, so the schema to
  // check against is the one it was grouped under. Deriving a schema name
  // from the key looked right and was not: records keyed RegistryPolicy* are
  // `Policy`, so the lookup found nothing and skipped validation in silence.
  const docs = discover(specsDir).map(load);
  const schemaOf = new Map();
  for (const [schema, records] of Object.entries(generate(docs, 'examples'))) {
    for (const record of records) schemaOf.set(record.key, schema);
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

      // Matching no schema is the dangerous case: the record conforms to
      // nothing, is seeded nowhere, and nothing says so. A platform event
      // keyed DomainEventExample1 survived that way while the schema is
      // `Event`.
      const schemaName = schemaOf.get(key);
      if (!schemaName) {
        errors.push({
          api: apiName,
          key,
          message: 'matches no schema in the contract set, so it is seeded nowhere. '
            + 'Name the key after the schema it is an example of.',
        });
        continue;
      }

      const schema = allSchemas[schemaName];
      if (!schema) continue;

      for (const { instancePath, message } of validateAgainstSchema(value, schema)) {
        errors.push({ api: apiName, key, message: `${instancePath || '/'}: ${message}` });
      }
    }
  }

  return errors;
}
