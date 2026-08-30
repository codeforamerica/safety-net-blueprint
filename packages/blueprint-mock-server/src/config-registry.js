/**
 * Config-managed resource registry.
 *
 * Tracks which resource IDs are config-managed (loaded from *-config.yaml files).
 * Config-managed resources cannot be deleted via the API.
 * An in-memory registry keeps config metadata out of the resource data stored in SQLite,
 * so API responses stay clean.
 */

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
 * Clear the registry (used between test runs).
 */
export function clearConfigRegistry() {
  configManagedIds.clear();
  configManagedCollections.clear();
}
