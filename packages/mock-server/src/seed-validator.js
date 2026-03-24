/**
 * Seed data validator — validates seed YAML records against API schemas.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { validateExamples } from '@codeforamerica/safety-net-blueprint-contracts/example-validator';

/**
 * Validate all seed files in seedDir against schemas in apiSpecs.
 * @param {string} seedDir - Path to seed directory
 * @param {Array} apiSpecs - Array of API metadata objects (from loadAllSpecs)
 * @returns {Array<{api: string, key: string|null, message: string}>} Validation errors
 */
export function validateSeedData(seedDir, apiSpecs) {
  const errors = [];

  for (const api of apiSpecs) {
    const seedPath = join(seedDir, `${api.name}.yaml`);
    if (!existsSync(seedPath)) continue;

    let examples;
    try {
      examples = yaml.load(readFileSync(seedPath, 'utf8')) || {};
    } catch (err) {
      errors.push({ api: api.name, key: null, message: `Failed to parse seed file: ${err.message}` });
      continue;
    }

    for (const { key, instancePath, message } of validateExamples(examples, api.schemas)) {
      const path = instancePath || '/';
      errors.push({ api: api.name, key, message: `${path}: ${message}` });
    }
  }

  return errors;
}
