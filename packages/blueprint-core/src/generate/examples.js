/**
 * Group a contract set's example data by the collection it belongs to.
 *
 * Example keys are named after their schema — `ApplicationMemberExample1` —
 * so assigning one to a collection means matching the schema prefix that
 * collection implies. Prefixes nest, which is the whole difficulty:
 * `ApplicationMemberExample1` starts with both `Application` and
 * `ApplicationMember`, and only the longer one is right.
 *
 * Both the mock server's seeder and the Postman builder need this, and had
 * drifted — the seeder matched longest-prefix, Postman took the first match
 * and so assigned nested records to their parent as well.
 */

import { basename } from 'path';
import { collectionToSchemaPrefix, extractIndividualResources } from '../openapi/utils.js';

/**
 * @param {import('../../types.js').Doc[]} docs
 * @returns {Record<string, Array<{ key: string, name: string, data: object }>>}
 *   Collection name to its individual resource examples
 */
export function buildExamples(docs) {
  const byCollection = {};

  for (const doc of docs.filter((d) => d.type === 'openapi')) {
    const name = basename(doc.path, '-openapi.yaml');
    const collections = collectionsOf(doc.content);
    const examples = examplesOf(docs, name, doc.content);

    for (const collection of collections) {
      byCollection[collection] = examplesForCollection(examples, collection, collections);
    }
  }

  return byCollection;
}

/**
 * The examples belonging to one collection.
 *
 * Exported for the Postman builder, which asks per endpoint rather than
 * taking the whole grouping.
 *
 * @param {Record<string, unknown>} examples - Every example for the API
 * @param {string} collection - The collection to select for
 * @param {string[]} collections - Every collection on the API, for disambiguation
 * @returns {Array<{ key: string, name: string, data: object }>}
 */
export function examplesForCollection(examples, collection, collections) {
  const target = collectionToSchemaPrefix(collection);
  const prefixes = collections.map(collectionToSchemaPrefix);

  const filtered = {};
  for (const [key, value] of Object.entries(examples)) {
    if (!key.startsWith(target)) continue;

    // The longest matching prefix wins. Without this a record belonging to
    // `application-members` is also handed to `applications`.
    const longest = prefixes
      .filter((prefix) => key.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];

    if (longest === target) filtered[key] = value;
  }

  return extractIndividualResources(filtered);
}

/**
 * Collection names an API declares, from its non-parameter path segments.
 *
 * @param {object} spec
 * @returns {string[]}
 */
function collectionsOf(spec) {
  const names = new Set();
  for (const path of Object.keys(spec?.paths ?? {})) {
    const segments = path.split('/').filter(Boolean).filter((s) => !s.startsWith('{'));
    if (segments.length > 0) names.add(segments.join('-'));
  }
  return [...names];
}

/**
 * Every example available to match against a collection.
 *
 * Three sources, in precedence order: a seed document named after the API,
 * then the pooled `mock-data` documents, then the `components.examples` the
 * spec declares inline. Mock data is pooled across the whole set rather than
 * read per API, because an example key names its schema, not its file — a
 * record for `application-members` may sit in any of them.
 *
 * @param {import('../../types.js').Doc[]} docs
 * @param {string} name - API name, the spec's filename stem
 * @param {object} spec
 * @returns {Record<string, unknown>}
 */
function examplesOf(docs, name, spec) {
  const seed = docs.find((doc) => basename(doc.path) === `${name}.yaml`);
  if (seed) return seed.content ?? {};

  const pooled = {};
  for (const doc of docs.filter((d) => d.type === 'mock-data')) {
    Object.assign(pooled, doc.content ?? {});
  }
  if (Object.keys(pooled).length > 0) return pooled;

  const inline = spec?.components?.examples ?? {};
  return Object.fromEntries(
    Object.entries(inline).filter(([, ex]) => ex?.value).map(([key, ex]) => [key, ex.value])
  );
}
