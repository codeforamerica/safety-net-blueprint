/**
 * Data seeder - loads example data from YAML files into SQLite
 */

import { discover, generate, load } from '@codeforamerica/blueprint-core';
import { deriveCollectionName } from './collection-utils.js';
import { insertResource, clearAll } from './database-manager.js';
import { resolveTimeTokens } from './time-tokens.js';

/**
 * The schema a list response holds, by name.
 *
 * A list wraps its records in `allOf` alongside the shared pagination
 * schema, so the items are not always a direct property.
 *
 * @param {object} listSchema - The list schema, as authored
 * @returns {string|null}
 */
function itemSchemaName(listSchema) {
  if (!listSchema || typeof listSchema !== 'object') return null;

  for (const candidate of [listSchema, ...(listSchema.allOf ?? [])]) {
    const ref = candidate?.properties?.items?.items?.$ref;
    if (ref) return ref.split('/').pop();
  }

  return null;
}

/**
 * Which schema each collection holds, from the contracts.
 *
 * A collection endpoint's list response names the schema its records are, so
 * this is read rather than inferred. `/registry/policies` is collection
 * `registry-policies` and holds `Policy` — no naming convention connects
 * those two, and guessing one is how records went unvalidated.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {Map<string, string>} Collection name to schema name
 */
function collectionSchemas(docs) {
  const byCollection = new Map();

  for (const doc of docs.filter((d) => d.type === 'openapi')) {
    const spec = doc.content ?? {};
    const server = (spec.servers ?? []).find((s) => s.url?.includes('localhost'));
    let basePath = '';
    if (server) {
      try { basePath = new URL(server.url).pathname.replace(/\/$/, ''); } catch { /* no base path */ }
    }

    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      // Skip item endpoints, not every path with a parameter: a
      // sub-collection carries its parent's parameter in the middle.
      if (path.endsWith('}') || !item?.get) continue;

      const collection = deriveCollectionName(`${basePath}${path}`, basePath);
      if (!collection || byCollection.get(collection)) continue;

      const listRef = item.get.responses?.['200']?.content?.['application/json']?.schema?.$ref;
      const listName = listRef?.split('/').pop();

      // Every collection is recorded even when no schema can be found for it,
      // because the set is also what gets cleared on boot. A collection left
      // out here would keep stale rows from the previous run.
      byCollection.set(collection, itemSchemaName(spec.components?.schemas?.[listName]));
    }
  }

  return byCollection;
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
export function seedAllDatabases(specsDir, seedDir) {
  // Core groups the records by the schema each one exemplifies — a fact the
  // documents state. Which collection holds a given schema is this server's
  // business, and the contract answers it: a collection endpoint's list
  // response names the schema its records are. So the naming rule lives here
  // only, in collection-utils, where routing needs it regardless.
  const specDirs = Array.isArray(specsDir) ? specsDir : [specsDir].filter(Boolean);
  const docs = [
    ...specDirs.flatMap((dir) => discover(dir)),
    ...(seedDir ? discover(seedDir) : []),
  ].map(load);

  const bySchema = generate(docs, 'examples');
  const schemaOf = collectionSchemas(docs);
  const collections = [...schemaOf.keys()];
  const byCollection = Object.fromEntries(
    collections.map((name) => [name, bySchema[schemaOf.get(name)] ?? []])
  );

  for (const name of collections) clearAll(name);

  if (!seedDir) {
    console.log('\nNo --seed directory specified; databases will be empty.');
    return Object.fromEntries(collections.map((name) => [name, 0]));
  }

  console.log(`\nSeeding databases from ${seedDir}...`);

  if (collections.every((name) => byCollection[name].length === 0)) {
    console.log('  No *-mock-data.yaml files found; databases will be empty.');
    return Object.fromEntries(collections.map((name) => [name, 0]));
  }

  const summary = {};
  const now = new Date();
  const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();

  for (const collectionName of collections) {
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
