/**
 * Ids in a write that name no record (#481).
 *
 * A field declaring `x-relationship` says which resource its id points at, so
 * the mock can look the record up before keeping the write. Without this it
 * accepted an income whose `memberId` matched nobody, and a service writing
 * through it had to check its own foreign keys — which is what the transcript
 * analysis experiment did.
 *
 * Only what the mock holds is checked:
 *   - `External` and `Polymorphic` name no schema, so there is nothing to find;
 *   - a collection no loaded contract serves has no records here at all;
 *   - a collection whose routes are forwarded lives in a real service, and its
 *     records here, if any, are not the ones that count.
 *
 * Fields are read from the request schema, so only what a client may send is
 * checked, and only when it sends it: an id left out or null is the schema's
 * business, not this one's.
 */

import { propertiesOf, resourceToCollection, extractExpandFields } from './handlers/expand-utils.js';

const NOTHING_TO_FIND = new Set(['External', 'Polymorphic']);

/**
 * The route each collection's records are read from, so a check can tell
 * whether that route still answers here or has been forwarded. Module-level
 * like `collectionsByResource`, and cleared by each server as it starts.
 *
 * @type {Map<string, { routes: { get(key: string): object|undefined }, key: string }>}
 */
const readRoutes = new Map();

/** Forget every collection, as a server starts registering its own. */
export function clearReadRoutes() {
  readRoutes.clear();
}

/**
 * Note where a collection's records are read, as its GET route is registered.
 *
 * @param {string} collection
 * @param {{ get(key: string): object|undefined }} routes
 * @param {string} key - Route key, e.g. `GET /applications/{applicationId}/members/{memberId}`
 */
export function registerReadRoute(collection, routes, key) {
  readRoutes.set(collection, { routes, key });
}

/** Whether this mock holds a collection's records, rather than a real service. */
export function heldHere(collection) {
  const read = readRoutes.get(collection);
  if (!read) return false;
  return !read.routes.get(read.key)?.forwarded;
}

/** The resource an `x-relationship` points at, when there's a record of it to find. */
function target(definition) {
  const relationship = definition?.['x-relationship'];
  if (!relationship?.resource || (relationship.type && relationship.type !== 'fk')) return null;
  return NOTHING_TO_FIND.has(relationship.resource) ? null : relationship.resource;
}

/**
 * The records a write is made under, by resource name.
 *
 * Read from the API model's parent links and the route's parameters, so a
 * write to an application's incomes under application B is under
 * `{ Application: 'B' }`. Empty for a write that isn't nested.
 *
 * @param {{ name: string|null, parent: object|null, item: { parameter: string|null } }|undefined} resource - The model resource written
 * @param {Object<string, string>} params - The route's parameters, by name
 * @returns {Object<string, string>}
 */
export function parentsOf(resource, params) {
  const parents = {};
  for (let parent = resource?.parent; parent; parent = parent.parent) {
    const id = params[parent.item.parameter];
    if (parent.name && id !== undefined) parents[parent.name] = id;
  }
  return parents;
}

/**
 * The ids a write sends that name no record this mock holds, or a record that
 * belongs to a different parent than the write.
 *
 * Walks the schema and the body together, so an id inside a nested object or
 * array is checked as well as one at the top — `roomers[0].memberId` as much
 * as `memberId`. It only goes where the body has values, so a schema that
 * refers to itself can't send it round forever.
 *
 * A record the id points at must share the write's parent when both are
 * nested under it: an income under application B can't name a member of
 * application A. Which parent a record belongs to is the field its schema
 * declares with `x-relationship` to the parent resource. A record whose schema
 * declares none is left alone rather than guessed at.
 *
 * @param {*} body - What the client sent
 * @param {object} schema - The request schema
 * @param {(schema: *) => *} follow - Resolves a ref, as `api.resolve.schema` does
 * @param {{ findById(collection: string, id: string): object|null }} store
 * @param {object} [context]
 * @param {Object<string, string>} [context.parents] - From `parentsOf`
 * @param {object[]} [context.resources] - The API model's resources, to find what a record is nested under
 * @param {Object<string, object>} [context.schemas] - The API's schemas, by name
 * @param {string} [context.at] - Where in the body this is, for the field it names
 * @returns {Array<{ field: string, message: string }>} Details for a 422, empty when every id is found
 */
export function missingReferences(body, schema, follow = (x) => x, store, context = {}) {
  const { at = '' } = context;
  if (!schema || body === null || typeof body !== 'object') return [];

  if (Array.isArray(body)) {
    const items = follow(schema)?.items;
    return body.flatMap((value, i) => missingReferences(value, items, follow, store, { ...context, at: `${at}[${i}]` }));
  }

  const missing = [];
  for (const props of propertiesOf(schema, follow)) {
    for (const [name, definition] of Object.entries(props)) {
      const value = body[name];
      if (value === undefined || value === null) continue;
      const field = at ? `${at}.${name}` : name;
      const resource = target(definition);
      if (!resource) {
        missing.push(...missingReferences(value, definition, follow, store, { ...context, at: field }));
        continue;
      }
      const collection = resourceToCollection(resource);
      if (!heldHere(collection)) continue;
      const record = store.findById(collection, value);
      if (!record) {
        missing.push({ field, message: `No ${resource} has the id "${value}".` });
        continue;
      }
      const other = otherParent(record, resource, follow, context);
      if (other) missing.push({ field, message: `${resource} "${value}" belongs to a different ${other}.` });
    }
  }
  return missing;
}

/**
 * The parent resource a record belongs to a different one of than the write,
 * or null when they agree or there's nothing declared to compare.
 *
 * @param {object} record - The record an id points at
 * @param {string} resource - Its resource name
 * @param {(schema: *) => *} follow
 * @param {{ parents?: Object<string, string>, resources?: object[], schemas?: Object<string, object> }} context
 * @returns {string|null}
 */
function otherParent(record, resource, follow, { parents = {}, resources = [], schemas = {} }) {
  const nested = resources.find((r) => r.name === resource);
  const schema = schemas[resource];
  if (!nested || !schema) return null;
  // A relationship resolve expanded is read as the related record, but the
  // record is stored under its key.
  const storedAs = new Map(extractExpandFields(schema, follow).map(({ fieldName, fkField }) => [fieldName, fkField]));
  for (let parent = nested.parent; parent; parent = parent.parent) {
    if (!(parent.name in parents)) continue;
    for (const props of propertiesOf(schema, follow)) {
      for (const [name, definition] of Object.entries(props)) {
        if (target(definition) !== parent.name) continue;
        const value = record[storedAs.get(name) ?? name];
        if (value !== undefined && value !== null && value !== parents[parent.name]) return parent.name;
      }
    }
  }
  return null;
}
