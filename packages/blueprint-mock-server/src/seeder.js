/**
 * Data seeder - loads example data from YAML files into SQLite
 */

import { discover, generate, load } from '@codeforamerica/blueprint-core';
import { insertResource, clearAll } from './database-manager.js';
import { deriveCollectionName as deriveCollectionNameFromPath } from './collection-utils.js';
import { resolveTimeTokens } from './time-tokens.js';

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
 * Seed all databases for all discovered APIs.
 *
 * Records are grouped by collection through core's `generate(docs,
 * 'examples')` — the same call the rest of the pipeline makes — so the server
 * seeds exactly what the pipeline says belongs where. Any *-mock-data.yaml
 * under seedDir joins the pool regardless of its location or name; an example
 * key names its schema, not its file.
 *
 * @param {Array} apiSpecs - Array of API specification objects, for the set of
 *   collections to clear and report on
 * @param {string|string[]} specsDir - Directory (or directories) of resolved
 *   contracts. Their paths are what name the collections the records are
 *   grouped into. The server can be started with several --spec dirs, and a
 *   reseed has to cover all of them at once or the last one clears the rest.
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

  // Collect all collection names across all APIs for disambiguation
  const allCollections = [...new Set(apiSpecs.flatMap(api => deriveAllCollectionNames(api)))];

  // Grouping records by collection is core's job — the same call the rest of
  // the pipeline makes. It derives the collections from the specs and pools
  // the mock data itself, so both directories go in together.
  const specDirs = Array.isArray(specsDir) ? specsDir : [specsDir].filter(Boolean);
  const byCollection = generate(
    [...specDirs.flatMap((dir) => discover(dir)), ...discover(seedDir)].map(load),
    'examples'
  );

  if (Object.values(byCollection).every((records) => records.length === 0)) {
    console.log('  No *-mock-data.yaml files found; databases will be empty.');
    const summary = {};
    for (const api of apiSpecs) {
      for (const name of deriveAllCollectionNames(api)) summary[name] = 0;
    }
    return summary;
  }

  const summary = {};
  const now = new Date();
  const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();

  for (const collectionName of allCollections) {
    try {
      const resources = byCollection[collectionName] ?? [];

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
