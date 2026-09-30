/**
 * Group a contract set's example data by the schema each record exemplifies.
 *
 * An example key names its schema — `ApplicationMemberExample1` is an
 * `ApplicationMember` — so grouping is a prefix match against the schemas the
 * document declares. Prefixes nest, which is the whole difficulty:
 * `ApplicationMemberExample1` starts with both `Application` and
 * `ApplicationMember`, and only the longer one is right.
 *
 * Keyed by schema rather than by collection deliberately. A collection is the
 * mock server's name for a database, and naming one is a rule that server
 * owns and needs at runtime for routing anyway. Labelling output that way
 * would require the rule here too — and it did, and the two drifted: the
 * seeder matched longest-prefix while Postman took the first match and
 * assigned nested records to their parent as well. A schema is something the
 * document declares, so nothing has to agree about anything.
 */

import { basename } from 'path';
import { collectionToSchemaPrefix, extractIndividualResources } from '../openapi/utils.js';

/**
 * @param {import('../../types.js').Doc[]} docs
 * @returns {Record<string, Array<{ key: string, name: string, data: object }>>}
 *   Schema name to its individual resource examples
 */
export function buildExamples(docs) {
  const bySchema = {};

  for (const doc of docs.filter((d) => d.type === 'openapi')) {
    const name = basename(doc.path, '-openapi.yaml');
    const schemas = Object.keys(doc.content?.components?.schemas ?? {});
    const examples = examplesOf(docs, name, doc.content);

    for (const schema of schemas) {
      const records = examplesForSchema(examples, schema, schemas);
      if (records.length || !(schema in bySchema)) bySchema[schema] = records;
    }
  }

  return bySchema;
}

/**
 * The examples of one schema.
 *
 * @param {Record<string, unknown>} examples - Every example for the API
 * @param {string} schema - The schema to select for
 * @param {string[]} schemas - Every schema on the API, for disambiguation
 * @returns {Array<{ key: string, name: string, data: object }>}
 */
export function examplesForSchema(examples, schema, schemas) {
  const filtered = {};

  for (const [key, value] of Object.entries(examples)) {
    if (!key.startsWith(schema)) continue;

    // The longest matching name wins. Without this a record of
    // `ApplicationMember` is handed to `Application` as well.
    const longest = schemas
      .filter((name) => key.startsWith(name))
      .sort((a, b) => b.length - a.length)[0];

    if (longest === schema) filtered[key] = value;
  }

  return extractIndividualResources(filtered);
}

/**
 * The examples belonging to one collection.
 *
 * Kept for the Postman builder, which works in collections and asks per
 * endpoint rather than taking the whole grouping.
 *
 * @param {Record<string, unknown>} examples - Every example for the API
 * @param {string} collection - The collection to select for
 * @param {string[]} collections - Every collection on the API, for disambiguation
 * @returns {Array<{ key: string, name: string, data: object }>}
 */
export function examplesForCollection(examples, collection, collections) {
  return examplesForSchema(
    examples,
    collectionToSchemaPrefix(collection),
    collections.map(collectionToSchemaPrefix)
  );
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
