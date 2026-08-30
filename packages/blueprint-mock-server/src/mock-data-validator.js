/**
 * Mock data validator — validates *-mock-data.yaml records against API schemas.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { readdirSync, statSync } from 'fs';
import yaml from 'js-yaml';
import { validateExamples } from '@codeforamerica/blueprint-core/example-validator';

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
 * Validate all *-mock-data.yaml files found under specsDir against schemas in apiSpecs.
 * @param {string} specsDir - Root directory to recurse for mock data files
 * @param {Array} apiSpecs - Array of API metadata objects (from loadAllSpecs)
 * @returns {Array<{api: string, key: string|null, message: string}>} Validation errors
 */
export function validateMockData(specsDir, apiSpecs) {
  const errors = [];
  const specsByName = Object.fromEntries(apiSpecs.map(s => [s.name, s]));
  const mockFiles = findMockDataFiles(specsDir);

  for (const { apiName, filePath } of mockFiles) {
    const api = specsByName[apiName];
    if (!api) continue;

    let examples;
    try {
      examples = yaml.load(readFileSync(filePath, 'utf8')) || {};
    } catch (err) {
      errors.push({ api: apiName, key: null, message: `Failed to parse mock data file: ${err.message}` });
      continue;
    }

    for (const { key, instancePath, message } of validateExamples(examples, api.schemas)) {
      const path = instancePath || '/';
      errors.push({ api: apiName, key, message: `${path}: ${message}` });
    }
  }

  return errors;
}
