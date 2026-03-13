/**
 * Data seeder - loads example data from YAML files into SQLite
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { insertResource, count, clearAll } from './database-manager.js';
import { getExamplesPath, collectionToSchemaPrefix, extractIndividualResources } from '@codeforamerica/safety-net-blueprint-contracts/loader';

/**
 * Load examples from YAML file
 * @param {string} examplesPath - Path to examples YAML file
 * @returns {Object} Examples object
 */
function loadExamples(examplesPath) {
  if (!existsSync(examplesPath)) {
    return {};
  }
  
  const content = readFileSync(examplesPath, 'utf8');
  return yaml.load(content) || {};
}

/**
 * Seed database with examples from YAML file
 * @param {string} collectionName - Database collection name (e.g., 'tasks')
 * @param {string} specsDir - Path to specs directory
 * @param {string} [apiName] - API name for finding the examples file (defaults to collectionName)
 * @returns {number} Number of resources seeded
 */
export function seedDatabase(collectionName, specsDir, apiName) {
  const resourceName = apiName || collectionName;
  try {
    const examplesPath = getExamplesPath(resourceName, specsDir);
    
    if (!existsSync(examplesPath)) {
      console.log(`  No examples file found for ${resourceName}, database will be empty`);
      return 0;
    }

    const examples = loadExamples(examplesPath);

    if (!examples || Object.keys(examples).length === 0) {
      console.log(`  No examples found in ${resourceName}.yaml, database will be empty`);
      return 0;
    }

    const resources = extractIndividualResources(examples);

    if (resources.length === 0) {
      console.log(`  No valid resources found in ${resourceName}.yaml examples`);
      return 0;
    }

    // Insert each resource with timestamps ensuring proper list order
    // Query orders by createdAt DESC, so Example1 needs the NEWEST timestamp to appear first
    let seededCount = 0;
    const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();

    for (let i = 0; i < resources.length; i++) {
      try {
        // Create a copy to avoid mutating the original
        const resource = { ...resources[i].data };

        // Override createdAt/updatedAt to ensure proper ordering
        // Example1 (i=0) gets newest timestamp, Example2 (i=1) gets older, etc.
        // This way when sorted DESC, Example1 appears first
        const minutesOffset = (resources.length - 1 - i) * 60000; // Reverse order: Example1=newest
        const timestamp = new Date(baseTimestamp + minutesOffset).toISOString();
        resource.createdAt = timestamp;
        resource.updatedAt = timestamp;

        insertResource(collectionName, resource);
        seededCount++;
      } catch (error) {
        console.warn(`  Warning: Could not seed resource ${resources[i].data.id}:`, error.message);
      }
    }

    console.log(`  Seeded ${seededCount} ${collectionName} from examples`);
    return seededCount;
  } catch (error) {
    console.error(`  Error seeding ${collectionName}:`, error.message);
    return 0;
  }
}

/**
 * Seed all databases for all discovered APIs
 * @param {Array} apiSpecs - Array of API specification objects
 * @param {string} specsDir - Path to specs directory
 * @returns {Object} Summary of seeded data
 */
/**
 * Derive the collection name from an API's baseResource path.
 * Example: "/tasks" → "tasks", "/persons" → "persons"
 * Falls back to api.name for APIs without a baseResource.
 * @param {Object} api - API metadata object
 * @returns {string} Collection name
 */
function deriveCollectionName(api) {
  if (api.baseResource) {
    return api.baseResource.split('/')[1];
  }
  return api.name;
}

/**
 * Derive all unique collection names from an API's endpoints.
 * @param {Object} api - API metadata object
 * @returns {string[]} Array of collection names
 */
function deriveAllCollectionNames(api) {
  const names = new Set();
  for (const endpoint of api.endpoints || []) {
    const segment = endpoint.path.split('/')[1];
    if (segment) names.add(segment);
  }
  // Fallback for APIs with no endpoints
  if (names.size === 0) names.add(deriveCollectionName(api));
  return [...names];
}

/**
 * Extract resources from examples that belong to a specific collection.
 * Matches example keys by schema prefix (e.g., "QueueExample1" matches "Queue" prefix).
 * @param {Object} examples - All examples from the YAML file
 * @param {string} collectionName - Target collection name
 * @returns {Array} Array of resource objects for this collection
 */
function extractResourcesForCollection(examples, collectionName) {
  const prefix = collectionToSchemaPrefix(collectionName);
  const filtered = {};
  for (const [key, value] of Object.entries(examples)) {
    if (key.startsWith(prefix)) {
      filtered[key] = value;
    }
  }
  return extractIndividualResources(filtered);
}

export function seedAllDatabases(apiSpecs, specsDir) {
  console.log('\nSeeding databases from example files...');

  const summary = {};

  for (const api of apiSpecs) {
    try {
      const allCollections = deriveAllCollectionNames(api);

      // Clear all collections for this API (primary + secondary)
      for (const name of allCollections) {
        clearAll(name);
      }

      // Load examples once for the API
      const examplesPath = getExamplesPath(api.name, specsDir);
      if (!existsSync(examplesPath)) {
        console.log(`  No examples file found for ${api.name}, databases will be empty`);
        for (const name of allCollections) {
          summary[name] = 0;
        }
        continue;
      }

      const examples = loadExamples(examplesPath);
      if (!examples || Object.keys(examples).length === 0) {
        console.log(`  No examples found in ${api.name}.yaml, databases will be empty`);
        for (const name of allCollections) {
          summary[name] = 0;
        }
        continue;
      }

      // Seed each collection with its matching examples
      for (const collectionName of allCollections) {
        const resources = extractResourcesForCollection(examples, collectionName);

        if (resources.length === 0) {
          summary[collectionName] = 0;
          continue;
        }

        let seededCount = 0;
        const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();

        for (let i = 0; i < resources.length; i++) {
          try {
            const resource = { ...resources[i].data };
            const minutesOffset = (resources.length - 1 - i) * 60000;
            const timestamp = new Date(baseTimestamp + minutesOffset).toISOString();
            resource.createdAt = timestamp;
            resource.updatedAt = timestamp;
            insertResource(collectionName, resource);
            seededCount++;
          } catch (error) {
            console.warn(`  Warning: Could not seed resource ${resources[i].data.id}:`, error.message);
          }
        }

        console.log(`  Seeded ${seededCount} ${collectionName} from examples`);
        summary[collectionName] = seededCount;
      }
    } catch (error) {
      console.warn(`  Warning: Could not seed ${api.name}:`, error.message);
      summary[api.name] = 0;
    }
  }

  console.log('✓ Database seeding complete\n');
  return summary;
}
