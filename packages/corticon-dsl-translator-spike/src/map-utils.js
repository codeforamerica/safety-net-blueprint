/** Accept either a Map or a plain object (the JSON-deserialized shape produced by `ingest-project.js --out`) uniformly. Shared by every phase past ingestion, since each one may run against a freshly-loaded project or a JSON file read back in from a prior phase. */
export function entriesOf(mapOrObject) {
  if (!mapOrObject) return [];
  return mapOrObject instanceof Map ? [...mapOrObject.entries()] : Object.entries(mapOrObject);
}

/** Just the keys, via `entriesOf` so the same Map-or-object duality applies. */
export function keysOf(mapOrObject) {
  return entriesOf(mapOrObject).map(([key]) => key);
}
