/**
 * Data seeder - loads example data from YAML files into SQLite
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import yaml from 'js-yaml';
import { insertResource, clearAll } from './database-manager.js';
import { deriveCollectionName as deriveCollectionNameFromPath } from './collection-utils.js';
import { join } from 'path';
import { resolveTimeTokens } from './time-tokens.js';
import pluralize from 'pluralize';

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
/**
 * The example records belonging to one collection.
 *
 * Example keys are named after their schema, and schema prefixes nest:
 * `ApplicationMemberExample1` starts with both `Application` and
 * `ApplicationMember`. Only the longest match is right, or a record gets
 * seeded into its parent collection as well.
 *
 * Private to the seeder. blueprint-core matches the same way in
 * generate(docs, 'examples'), and the two are kept honest by the collection
 * naming parity test: both depend on a collection name round-tripping to the
 * schema its examples are keyed by, and that convention is now asserted in
 * one place.
 *
 * They are not one function because core groups by the collections an OpenAPI
 * document declares, while the seeder is handed its collections by the caller
 * — the reseed endpoint and the unit tests seed without a spec directory at
 * all. Collapsing them needs either a matcher on core's entry point or a
 * seeder rewritten to be document-driven; neither is worth ~15 lines of pure
 * matching that a test now pins.
 *
 * @param {Record<string, unknown>} examples - Every example in the pool
 * @param {string} collection - The collection to select for
 * @param {string[]} collections - All collections, for disambiguation
 * @returns {Array<{ key: string, name: string, data: object }>}
 */
function examplesForCollection(examples, collection, collections) {
  const target = schemaPrefixOf(collection);
  const prefixes = collections.map(schemaPrefixOf);

  const matched = [];
  for (const [key, value] of Object.entries(examples)) {
    if (!key.startsWith(target)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

    const longest = prefixes
      .filter((prefix) => key.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];

    if (longest === target) matched.push({ key, name: key, data: value });
  }

  return matched.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * `task-audit-events` → `TaskAuditEvent`. Only the trailing segment is the
 * plural noun; earlier ones qualify it.
 *
 * @param {string} collection
 * @returns {string}
 */
function schemaPrefixOf(collection) {
  const segments = collection.split('-');
  return segments
    .map((segment, i) => {
      const s = i === segments.length - 1 ? pluralize.singular(segment) : segment;
      return s.charAt(0).toUpperCase() + s.slice(1);
    })
    .join('');
}

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
      const resources = examplesForCollection(allExamples, collectionName, allCollections);

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
