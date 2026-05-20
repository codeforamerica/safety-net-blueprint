/**
 * Seed data validator — validates seed YAML records against API schemas.
 */

import { validateExamples } from '@codeforamerica/safety-net-blueprint-contracts/example-validator';
import { loadResolvedSeed } from './seed-loader.js';
import { SeedTemplateError } from './seed-template-resolver.js';

/**
 * Validate all seed files in seedDir against schemas in apiSpecs.
 * @param {string} seedDir - Path to seed directory
 * @param {Array} apiSpecs - Array of API metadata objects (from loadAllSpecs)
 * @returns {Array<{api: string, key: string|null, message: string}>} Validation errors
 */
export function validateSeedData(seedDir, apiSpecs) {
  const errors = [];
  // Single reference instant for token resolution across this validation
  // pass. The seeder uses its own `now` at insert time — those are within
  // milliseconds and the validator doesn't persist anything, so the
  // separation is fine.
  const now = new Date();

  for (const api of apiSpecs) {
    let examples;
    try {
      examples = loadResolvedSeed(seedDir, api.name, now);
    } catch (err) {
      // Template errors are seed-author bugs that should fail the boot, but
      // we still want to surface them through the same validator pipeline
      // so the consolidated error message includes them.
      if (err instanceof SeedTemplateError) {
        errors.push({ api: api.name, key: null, message: err.message });
        continue;
      }
      errors.push({ api: api.name, key: null, message: `Failed to parse seed file: ${err.message}` });
      continue;
    }

    if (Object.keys(examples).length === 0) continue;

    for (const { key, instancePath, message } of validateExamples(examples, api.schemas)) {
      const path = instancePath || '/';
      errors.push({ api: api.name, key, message: `${path}: ${message}` });
    }
  }

  return errors;
}
