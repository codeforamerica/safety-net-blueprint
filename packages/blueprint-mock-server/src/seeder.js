/**
 * Data seeder - loads example data from YAML files into SQLite
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import yaml from 'js-yaml';
import { insertResource, clearAll } from './database-manager.js';
import { collectionToSchemaPrefix, extractIndividualResources } from '@codeforamerica/blueprint-core/loader';
import { deriveCollectionName as deriveCollectionNameFromPath } from './collection-utils.js';
import { join } from 'path';
import { resolveTimeTokens } from './time-tokens.js';

/**
 * Recursively find all *-mock-data.yaml files under rootDir.
 * Returns an array of file paths.
 */
function findMockDataFiles(rootDir) {
  const results = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('-mock-data.yaml')) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

/**
 * Load and merge all *-mock-data.yaml files found under seedDir into a
 * single examples map. Keys are record names (e.g. TaskExample1).
 */
function loadAllExamples(seedDir) {
  const files = findMockDataFiles(seedDir);
  const combined = {};
  for (const filePath of files) {
    try {
      const data = yaml.load(readFileSync(filePath, 'utf8')) || {};
      Object.assign(combined, data);
    } catch (err) {
      console.warn(`  Warning: Could not load seed file ${filePath}: ${err.message}`);
    }
  }
  return combined;
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
 * Seed all databases for all discovered APIs.
 *
 * Recursively discovers all *-mock-data.yaml files under seedDir, merges them
 * into a single examples pool, then routes records to collections by key-prefix
 * matching (e.g. TaskExample1 → tasks). No per-API file lookup — any
 * *-mock-data.yaml file under seedDir contributes to the pool regardless of
 * its location or name.
 *
 * @param {Array} apiSpecs - Array of API specification objects
 * @param {string} specsDir - Path to specs directory (unused, kept for compat)
 * @param {string|null} seedDir - Directory to recurse for *-mock-data.yaml files.
 *   When null, seeding is skipped and all collections start empty.
 * @returns {Object} Summary of seeded data
 */
export function seedAllDatabases(apiSpecs, specsDir, seedDir) {
  // Clear all collections first
  for (const api of apiSpecs) {
    for (const name of deriveAllCollectionNames(api)) {
      clearAll(name);
    }
  }

  if (!seedDir) {
    console.log('\nNo --seed directory specified; databases will be empty.');
    const summary = {};
    for (const api of apiSpecs) {
      for (const name of deriveAllCollectionNames(api)) summary[name] = 0;
    }
    return summary;
  }

  console.log(`\nSeeding databases from ${seedDir}...`);

  // Load all *-mock-data.yaml files into one combined pool
  const allExamples = loadAllExamples(seedDir);

  if (Object.keys(allExamples).length === 0) {
    console.log('  No *-mock-data.yaml files found; databases will be empty.');
    const summary = {};
    for (const api of apiSpecs) {
      for (const name of deriveAllCollectionNames(api)) summary[name] = 0;
    }
    return summary;
  }

  // Collect all collection names across all APIs for disambiguation
  const allCollections = [...new Set(apiSpecs.flatMap(api => deriveAllCollectionNames(api)))];

  const summary = {};
  const now = new Date();
  const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();

  for (const collectionName of allCollections) {
    try {
      const resources = extractResourcesForCollection(allExamples, collectionName, allCollections);

      if (resources.length === 0) {
        summary[collectionName] = 0;
        continue;
      }

      let seededCount = 0;
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
          console.warn(`  Warning: Could not seed resource ${resources[i].data?.id}: ${error.message}`);
        }
      }

      console.log(`  Seeded ${seededCount} ${collectionName}`);
      summary[collectionName] = seededCount;
    } catch (error) {
      console.warn(`  Warning: Could not seed ${collectionName}: ${error.message}`);
      summary[collectionName] = 0;
    }
  }

  console.log('✓ Database seeding complete\n');
  return summary;
}
