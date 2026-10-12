/**
 * An OpenAPI document as the resources it serves.
 *
 * The document states its API as path strings — `/applications/{applicationId}/
 * verifications/{verificationId}` — and every consumer that needed to know what
 * a path meant used to take the string apart itself. This reads the paths once
 * into linked objects: a resource has a parent and children, a collection and
 * an item. Strings come back only at the edge, from `path()`.
 *
 * Built only as far as attachment needs. The organization is meant to hold as
 * it grows: operations will land on `collection` and `item`, request and
 * response schemas on the operations, and singletons such as
 * `/applications/{applicationId}/interview` on the resource that owns them —
 * all additions to these objects, nothing moved.
 */

import { snakeCase } from '../event-names.js';

/**
 * @param {object} content - An OpenAPI document's content
 * @returns {{ servers: { url: string, base: string }[], resources: Resource[] }}
 */
export function buildApiModel(content) {
  const nodes = new Map();
  const resources = [];

  const nodeFor = (segments) => {
    const key = segments.join('/');
    if (nodes.has(key)) return nodes.get(key);

    const parent = segments.length > 2 ? nodeFor(segments.slice(0, -2)) : null;
    const node = createResource(parent, segments.at(-2), unbrace(segments.at(-1)));
    nodes.set(key, node);
    resources.push(node);
    if (parent) parent.children.push(node);
    return node;
  };

  const refOf = (operation, status) => operation?.responses?.[status]?.content?.['application/json']?.schema?.$ref;

  for (const [path, pathItem] of Object.entries(content?.paths ?? {})) {
    const segments = path.split('/').filter(Boolean);
    const items = itemDepth(segments);
    if (items === 0) continue;

    // Every `segment/{param}` pair along the way is a resource, so a nested
    // one always has its ancestors, named or not.
    const node = nodeFor(segments.slice(0, items * 2));

    // An item path that is the whole path names its resource by the schema it
    // returns — when changed, where it can be, since that is the record
    // itself; a read can answer with a wrapper around it, as review progress
    // by section answers with a list.
    if (items * 2 === segments.length && node.name === null) {
      const ref = [pathItem?.patch, pathItem?.put, pathItem?.get].map((op) => refOf(op, '200')).find((r) => typeof r === 'string');
      if (ref) node.name = ref.split('/').pop();
    }
  }

  // A collection that can be listed and added to, with no item endpoint of
  // its own, is still a resource, named for what its create returns. Read
  // after every item path, so one that does have an item is not made twice.
  for (const [path, pathItem] of Object.entries(content?.paths ?? {})) {
    const segments = path.split('/').filter(Boolean);
    const items = itemDepth(segments);
    if (segments.length !== items * 2 + 1 || isParameter(segments.at(-1)) || !pathItem?.get || !pathItem?.post) continue;
    const parent = items > 0 ? nodeFor(segments.slice(0, items * 2)) : null;
    const siblings = parent ? parent.children : resources.filter((r) => r.parent === null);
    if (siblings.some((r) => r.collection.segment === segments.at(-1))) continue;
    const node = createResource(parent, segments.at(-1), null);
    const ref = refOf(pathItem.post, '201');
    if (typeof ref === 'string') node.name = ref.split('/').pop();
    resources.push(node);
    if (parent) parent.children.push(node);
  }

  return { servers: serversOf(content), resources };
}

/**
 * @typedef {object} Resource
 * @property {string|null} name - The schema its item endpoint returns, changed or read; null when none is stated
 * @property {string|null} eventName - `name` in snake_case, as its events name it: `application_member`
 * @property {Resource|null} parent
 * @property {Resource[]} children
 * @property {{ segment: string }} collection
 * @property {{ parameter: string|null }} item - No parameter for a collection with no item endpoint
 * @property {(part: 'item'|'collection') => string|null} path - Relative to the server, as OpenAPI writes paths; null for an item that has no endpoint
 */

/**
 * @param {Resource|null} parent
 * @param {string} segment
 * @param {string} parameter
 * @returns {Resource}
 */
function createResource(parent, segment, parameter) {
  return {
    name: null,
    get eventName() { return this.name ? snakeCase(this.name) : null; },
    parent,
    children: [],
    collection: { segment },
    item: { parameter },
    path(part) {
      const collectionPath = `${this.parent ? this.parent.path('item') : ''}/${this.collection.segment}`;
      if (part === 'collection') return collectionPath;
      return this.item.parameter ? `${collectionPath}/{${this.item.parameter}}` : null;
    },
  };
}

/**
 * How many leading `segment/{param}` pairs a path has: 2 for
 * `/applications/{applicationId}/verifications/{verificationId}/satisfy`.
 *
 * @param {string[]} segments
 * @returns {number}
 */
function itemDepth(segments) {
  let pairs = 0;
  while (pairs * 2 + 1 < segments.length
    && !isParameter(segments[pairs * 2])
    && isParameter(segments[pairs * 2 + 1])) {
    pairs += 1;
  }
  return pairs;
}

const isParameter = (segment) => segment.startsWith('{') && segment.endsWith('}');
const unbrace = (segment) => segment.slice(1, -1);

/**
 * Every server the document lists, each with the path it puts the API under:
 * `/intake` for `https://api.example.com/intake`. Which one to act as is the
 * consumer's choice — the mock stands in for the localhost server — so none is
 * singled out.
 *
 * @param {object} content
 * @returns {{ url: string, base: string }[]}
 */
function serversOf(content) {
  return (content?.servers ?? [])
    .filter((server) => typeof server?.url === 'string')
    .map(({ url }) => ({ url, base: basePathOf(url) }));
}

/** @param {string} url */
function basePathOf(url) {
  try {
    return new URL(url, 'http://relative.invalid').pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}
