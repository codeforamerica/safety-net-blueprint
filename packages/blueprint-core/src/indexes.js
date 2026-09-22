/**
 * Cross-document indexes.
 *
 * Every index is built once over the whole document set and passed to the
 * passes that need it. All three take docs — nothing here reads from disk,
 * because the caller has already loaded what it wants examined.
 *
 * These were previously three functions under two names: two different
 * `buildSchemaIndex` implementations (one returning where a schema lives, one
 * returning the resolved schema) and two unrelated `buildEndpointIndex`
 * implementations that happened to share a name. The schema pair is merged
 * here; the endpoint pair is separated into the two distinct things it always
 * was — relationship links and collection lookups.
 */

import { resolveSchemaRefs, collectTopLevelProperties } from './json-schema/index.js';

const ENDPOINT_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** @param {import('../types.js').Doc[]} docs */
const openapiDocs = (docs) => docs.filter((d) => d.type === 'openapi');

/**
 * Index every schema in the document set by name.
 *
 * Carries both what earlier callers needed: `spec`/`specFile` to say where a
 * schema is declared, and `schema`/`properties` for the resolved form. First
 * declaration of a name wins, matching the previous behaviour.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {Map<string, { spec: object, specFile: string, schema: object, properties: object }>}
 */
export function buildSchemaIndex(docs) {
  const index = new Map();

  for (const doc of openapiDocs(docs)) {
    const schemas = doc.content?.components?.schemas;
    if (!schemas) continue;

    for (const [name, rawSchema] of Object.entries(schemas)) {
      if (index.has(name)) continue;
      const schema = resolveSchemaRefs(rawSchema, { spec: doc.content, specFilePath: doc.path });
      index.set(name, {
        spec: doc.content,
        specFile: doc.path,
        schema,
        properties: collectTopLevelProperties(doc.content, schema),
      });
    }
  }

  return index;
}

/**
 * Index endpoints by the contract artifact they were generated from.
 *
 * Keyed `{type}:{domain}:{id}` from each operation's `x-relationship`, so the
 * explorer can link an artifact back to the endpoint it produced. Plain `fk`
 * relationships are field-level, not endpoint-level, and are skipped.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {Map<string, { path: string, method: string }>}
 */
export function buildRelationshipIndex(docs) {
  const index = new Map();

  for (const doc of openapiDocs(docs)) {
    for (const [path, pathItem] of Object.entries(doc.content?.paths ?? {})) {
      for (const method of ENDPOINT_METHODS) {
        const rel = pathItem?.[method]?.['x-relationship'];
        if (!rel?.type || rel.type === 'fk') continue;
        if (!rel.domain || !rel.id) continue;

        const key = `${rel.type}:${rel.domain}:${rel.id}`;
        if (!index.has(key)) index.set(key, { path, method });
      }
    }
  }

  return index;
}

/**
 * Index collection paths to the schema their GET returns.
 *
 * Keyed `domain/collection` — the non-parameter path segments joined and
 * prefixed by `x-domain` — so a state machine's `call:` target can be checked
 * against a real endpoint. Nested item endpoints also register the shorthand
 * the state machine convention uses: `intake/application-members` for
 * `/applications/{id}/members/{id}`.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {Map<string, string|null>} Collection key → response schema name
 */
export function buildCollectionIndex(docs) {
  const index = new Map();

  for (const doc of openapiDocs(docs)) {
    const domain = doc.content?.info?.['x-domain'];
    if (!domain || !doc.content.paths) continue;

    for (const [path, pathItem] of Object.entries(doc.content.paths)) {
      const nonParamSegs = path.split('/').filter(Boolean).filter((s) => !s.startsWith('{'));
      if (nonParamSegs.length === 0) continue;

      const endsWithParam = path.endsWith('}');
      const schemaName = responseSchemaName(pathItem.get);

      // The item endpoint (/things/{id}) and the collection endpoint (/things)
      // share a key. The item wins, because it returns the resource schema
      // itself rather than a list wrapper, and that is what field references
      // like $thing.id resolve against.
      const key = `${domain}/${nonParamSegs.join('/')}`;
      if (!endsWithParam && index.has(key)) continue;
      index.set(key, schemaName);

      if (endsWithParam && nonParamSegs.length >= 2) {
        const parent = nonParamSegs.at(-2);
        const child = nonParamSegs.at(-1);
        const parentSingular = parent.endsWith('s') ? parent.slice(0, -1) : parent;
        const shorthand = `${domain}/${parentSingular}-${child}`;
        if (!index.has(shorthand)) index.set(shorthand, schemaName);
      }
    }
  }

  return index;
}

/**
 * Index the event channels each AsyncAPI document declares.
 *
 * `bySpec` is keyed by filename so a state machine's `eventsSpec:` reference
 * resolves to its own domain's catalog; `all` is every channel in the set, for
 * subscriptions, which may cross domains.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {{ bySpec: Map<string, Set<string>>, all: Set<string> }}
 */
export function buildChannelIndex(docs) {
  const bySpec = new Map();
  const all = new Set();

  for (const doc of docs) {
    if (doc.type !== 'asyncapi') continue;

    const channels = new Set(Object.keys(doc.content?.channels ?? {}));
    bySpec.set((doc.relativePath ?? doc.path).split('/').pop(), channels);
    for (const channel of channels) all.add(channel);
  }

  return { bySpec, all };
}

/**
 * Name of the schema a GET returns, whether returned directly or as list items.
 *
 * @param {object} getOp - The `get` operation of a path item
 * @returns {string|null}
 */
function responseSchemaName(getOp) {
  const schema = getOp?.responses?.['200']?.content?.['application/json']?.schema;
  return schemaNameFromRef(schema?.$ref) ?? schemaNameFromRef(schema?.properties?.items?.$ref);
}

/**
 * @param {string|undefined} ref
 * @returns {string|null}
 */
function schemaNameFromRef(ref) {
  const match = typeof ref === 'string' ? ref.match(/^#\/components\/schemas\/(.+)$/) : null;
  return match ? match[1] : null;
}
