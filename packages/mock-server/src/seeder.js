/**
 * Data seeder - loads example data from YAML files into SQLite
 */

import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import { insertResource, clearAll } from './database-manager.js';
import { collectionToSchemaPrefix, extractIndividualResources } from '@codeforamerica/safety-net-blueprint-contracts/loader';
import { deriveCollectionName as deriveCollectionNameFromPath } from './collection-utils.js';
import { join } from 'path';
import { resolveTimeTokens } from './time-tokens.js';

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
 * Seed database with examples from a seed YAML file.
 * @param {string} collectionName - Database collection name (e.g., 'tasks')
 * @param {string} seedDir - Path to seed directory
 * @param {string} [apiName] - API name for finding the seed file (defaults to collectionName)
 * @returns {number} Number of resources seeded
 */
export function seedDatabase(collectionName, seedDir, apiName) {
  const resourceName = apiName || collectionName;
  try {
    const examples = loadExamples(join(seedDir, `${resourceName}.yaml`));

    if (Object.keys(examples).length === 0) {
      console.log(`  No seed file found for ${resourceName}, database will be empty`);
      return 0;
    }

    const resources = extractIndividualResources(examples);

    if (resources.length === 0) {
      console.log(`  No valid resources found in ${resourceName}.yaml`);
      return 0;
    }

    let seededCount = 0;
    const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();
    const now = new Date();

    for (let i = 0; i < resources.length; i++) {
      try {
        const resource = resolveTimeTokens({ ...resources[i].data }, now);
        // Example1 (i=0) gets newest timestamp so it appears first when sorted DESC
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

    console.log(`  Seeded ${seededCount} ${collectionName}`);
    return seededCount;
  } catch (error) {
    console.error(`  Error seeding ${collectionName}:`, error.message);
    return 0;
  }
}

/**
 * Derive the collection name from an API's baseResource path.
 * Example: "/tasks" → "tasks", "/persons" → "persons"
 * Falls back to api.name for APIs without a baseResource.
 * @param {Object} api - API metadata object
 * @returns {string} Collection name
 */
function deriveCollectionName(api) {
  if (api.baseResource) {
    const basePath = api.serverBasePath || '';
    const resourcePath = basePath && api.baseResource.startsWith(basePath)
      ? api.baseResource.slice(basePath.length)
      : api.baseResource;
    return resourcePath.split('/')[1];
  }
  return api.name;
}

/**
 * Derive all unique collection names from an API's endpoints.
 *
 * Uses the path-based `deriveCollectionName` from collection-utils.js (the
 * same helper the route generator uses) so sub-resource paths map to their
 * proper sub-collection names rather than collapsing to the top-level
 * segment. Examples:
 *   /applications                                       → "applications"
 *   /applications/{id}/members                          → "application-members"
 *   /applications/{id}/members/{memberId}/incomes       → "member-incomes"
 *   /applications/{id}/household-info                   → "household-infos"
 *
 * Without this, an API whose paths are all under `/applications/...` would
 * yield only `applications`, leaving every sub-collection the route handlers
 * actually query (`application-members`, `member-incomes`, etc.) empty.
 *
 * @param {Object} api - API metadata object
 * @returns {string[]} Array of collection names
 */
export function deriveAllCollectionNames(api) {
  const names = new Set();
  const basePath = api.serverBasePath || '';
  for (const endpoint of api.endpoints || []) {
    const name = deriveCollectionNameFromPath(endpoint.path, basePath);
    if (name) names.add(name);
  }
  // Fallback for APIs with no endpoints
  if (names.size === 0) names.add(deriveCollectionName(api));
  return [...names];
}

/**
 * Extract resources from examples that belong to a specific collection.
 *
 * Uses longest-prefix matching to disambiguate keys when collection schema
 * prefixes share a common prefix. For example, both "applications"
 * (prefix "Application") and "application-members" (prefix
 * "ApplicationMember") match the key "ApplicationMemberExample1" via
 * startsWith — but only "ApplicationMember" is the longest match, so the
 * key is correctly assigned to application-members and not applications.
 *
 * @param {Object} examples - All examples from the YAML file
 * @param {string} collectionName - Target collection name
 * @param {string[]} allCollections - All collection names for this API (used for disambiguation)
 * @returns {Array} Array of resource objects for this collection
 */
function extractResourcesForCollection(examples, collectionName, allCollections) {
  const targetPrefix = collectionToSchemaPrefix(collectionName);
  const allPrefixes = allCollections.map(collectionToSchemaPrefix);
  const filtered = {};
  for (const [key, value] of Object.entries(examples)) {
    if (!key.startsWith(targetPrefix)) continue;
    // Find the longest schema prefix that matches this key. If a more specific
    // collection (e.g. "ApplicationMember") also matches, skip this key for the
    // less specific one (e.g. "Application") so records aren't double-assigned.
    const longestMatch = allPrefixes
      .filter((p) => key.startsWith(p))
      .sort((a, b) => b.length - a.length)[0];
    if (longestMatch === targetPrefix) {
      filtered[key] = value;
    }
  }
  return extractIndividualResources(filtered);
}

/**
 * Seed all databases for all discovered APIs
 * @param {Array} apiSpecs - Array of API specification objects
 * @param {string} specsDir - Path to specs directory (unused, kept for backward compat)
 * @param {string} seedDir - Path to seed directory
 * @returns {Object} Summary of seeded data
 */
export function seedAllDatabases(apiSpecs, specsDir, seedDir) {
  console.log('\nSeeding databases from seed files...');

  const summary = {};
  const now = new Date();

  for (const api of apiSpecs) {
    try {
      const allCollections = deriveAllCollectionNames(api);

      for (const name of allCollections) {
        clearAll(name);
      }

      const examples = loadExamples(join(seedDir, `${api.name}.yaml`));

      if (Object.keys(examples).length === 0) {
        console.log(`  No seed file found for ${api.name}, databases will be empty`);
        for (const name of allCollections) {
          summary[name] = 0;
        }
        continue;
      }

      for (const collectionName of allCollections) {
        const resources = extractResourcesForCollection(examples, collectionName, allCollections);

        if (resources.length === 0) {
          summary[collectionName] = 0;
          continue;
        }

        let seededCount = 0;
        const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();

        for (let i = 0; i < resources.length; i++) {
          try {
            const resource = resolveTimeTokens({ ...resources[i].data }, now);
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

        console.log(`  Seeded ${seededCount} ${collectionName}`);
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
