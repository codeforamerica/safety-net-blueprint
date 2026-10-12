/**
 * Config-managed resource registry.
 *
 * Tracks which resource IDs are config-managed (loaded from *-config.yaml files).
 * Config-managed resources cannot be deleted via the API.
 * An in-memory registry keeps config metadata out of the resource data stored in SQLite,
 * so API responses stay clean.
 */

import { deriveCollectionName } from './collection-utils.js';

/** @type {Map<string, Set<string>>} collectionName -> Set of config-managed IDs */
const configManagedIds = new Map();

/** @type {Set<string>} Collection names that have at least one config-managed entry */
const configManagedCollections = new Set();

/**
 * Register a resource ID as config-managed for a given collection.
 * @param {string} collectionName - e.g. 'queues'
 * @param {string} id - Resource UUID
 */
export function registerConfigManaged(collectionName, id) {
  if (!configManagedIds.has(collectionName)) {
    configManagedIds.set(collectionName, new Set());
  }
  configManagedIds.get(collectionName).add(id);
  configManagedCollections.add(collectionName);
}

/**
 * Check whether a collection has any config-managed entries.
 * Used by the create handler to set source: 'user' on runtime-created resources.
 * @param {string} collectionName
 * @returns {boolean}
 */
export function hasConfigManagedResources(collectionName) {
  return configManagedCollections.has(collectionName);
}

/**
 * Check whether a resource is config-managed.
 * @param {string} collectionName - e.g. 'queues'
 * @param {string} id - Resource UUID
 * @returns {boolean}
 */
export function isConfigManaged(collectionName, id) {
  return configManagedIds.has(collectionName) &&
    configManagedIds.get(collectionName).has(id);
}

/**
 * Seed every config catalog into the store, as records of the resource it names.
 *
 * Each catalog declares its resource, and the records go in that resource's
 * collection, worked out from its path the way its routes are — not from the
 * catalog's key. An entry already in the store is left as it is: config seeds
 * what is missing, so a change made through the API is not undone. Records are
 * marked `source: system`, which the resource's schema declares.
 *
 * @param {Array} configs - From `extract(docs, 'config')`
 * @param {Object} store
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 */
export function seedConfigs(configs, store, { verbose = false } = {}) {
  for (const config of configs ?? []) {
    for (const [key, catalog] of Object.entries(config.catalogs)) {
      if (!catalog.resource) {
        console.warn(`Warning: config catalog "${key}" (${config.domain}) seeds ${catalog.resourceName}, which no API in the domain serves; not seeded`);
        continue;
      }
      const collection = deriveCollectionName(catalog.resource.path('collection'), '');
      // Records added through the API are marked `user`, even when the file
      // seeds none.
      configManagedCollections.add(collection);
      for (const entry of catalog.entries) {
        const data = Object.fromEntries(Object.entries(entry).filter(([field]) => !field.startsWith('x-')));
        if (!store.findById(collection, data.id)) store.insertResource(collection, { ...data, source: 'system' });
        registerConfigManaged(collection, data.id);
      }
      if (verbose) console.log(`✓ Seeded ${catalog.entries.length} config-managed ${catalog.resourceName} (${config.domain})`);
    }
  }
}

/**
 * Clear the registry (used between test runs).
 */
export function clearConfigRegistry() {
  configManagedIds.clear();
  configManagedCollections.clear();
}
