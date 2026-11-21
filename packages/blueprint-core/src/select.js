/**
 * Part of a contract set, chosen by domain or capability, that stands on its
 * own: what `blueprint-resolve` writes when it's told to keep only some of a
 * set, so that everything built from the folder after it — the explorer, the
 * bundle, the mock, clients — covers only that part.
 *
 * Standing on its own takes four things beyond the documents named:
 *
 * - **What they reference.** Every `$ref` out of a kept document, every
 *   state machine's `extends`, and every base contract a kept document's
 *   blueprint schema references, until nothing new is reached. The schema's
 *   count because the set overlays what they point to: the state machine
 *   schema checks actors against the set's roles, and the metrics schema a
 *   metric's collection against the set's collections, both in the set's
 *   `base/schemas/enums.yaml`.
 * - **Platform, by use.** Nothing `$ref`s platform: a part of it is needed
 *   because of what the kept documents do. Events travel through the platform
 *   events API, timers through the platform timers document, and registries
 *   are served by the platform registries API. Without the events API, a
 *   scenario can't hear an event at all. Annotations name entries in
 *   registries by the registry's type (`patterns: [read-only-field]`), so a
 *   registry of a type kept annotations use comes along too. These rules are
 *   the blueprint's own.
 * - **The contract of an API a kept one calls.** A state machine step can
 *   call another API's operation (`call: { operationId: createSuggestion }`).
 *   That API's OpenAPI document comes along, but not its behavior: each of its
 *   operations is marked `x-relationship: { type: external }`, so the mock
 *   answers none of them itself and a stub or routing stands in, and the
 *   explorer shows them as answered outside the contracts. Its own state
 *   machines, sample records and the rest stay out.
 * - **Scenarios that fit.** A scenario is kept when every document it calls is
 *   kept, and not only as a called contract, whatever domain it declares. It
 *   never brings one in: it shows the part chosen, it doesn't widen it.
 * - **External for what was left out.** A relationship names its resource
 *   by name. A plain one whose resource was left out becomes `resource:
 *   External`, keeping its `domain`; a polymorphic one names resources by type
 *   (a transcript's `subjectType: interview` names intake's Interview), and a
 *   type whose resource was left out is mapped to `External` in its
 *   `discriminator.mapping`. `External` is the reserved resource for a record
 *   outside the contracts (contract-types.js), so the part validates on its
 *   own. A name that's in no part of the set is left for the validator to
 *   report.
 */

import { toDoc } from './doc.js';
import { followRef, indexByRelativePath, isRemoteRef } from './ref-lookup.js';
import { extendedDocOf } from './contract-readers.js';
import { buildSchemaIndex } from './indexes.js';
import { RESERVED_RESOURCES } from './contract-types.js';

/**
 * Where a canonical ref to the framework's base contracts points within a set
 * resolve builds, which places them under `base/` (blueprint-resolve). Ahead
 * of the write, refs are still canonical, and the closure has to follow them.
 */
const BASE_URI = 'https://blueprint.codeforamerica.org/base/';

/** The parts of platform, by the API name each goes by (doc.api). */
const PLATFORM = {
  events: 'platform-events',
  timers: 'platform-timers',
  registries: 'platform-registries',
};

const pascalOf = (value) => String(value).split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');

/** Whether a document hears or publishes events: an events document, or a state machine that emits or listens. */
function usesEvents(doc) {
  if (doc.type === 'asyncapi') return doc.protocols.length === 0;
  if (doc.type !== 'state-machine') return false;
  return (doc.content?.machines ?? []).some((machine) => machine?.emits || machine?.on || machine?.timers)
    || JSON.stringify(doc.content ?? {}).includes('"emit"');
}

/** Whether a state machine sets timers: declares them, or asks for one by event. */
function usesTimers(doc) {
  if (doc.type !== 'state-machine') return false;
  return (doc.content?.machines ?? []).some((machine) => machine?.timers)
    || JSON.stringify(doc.content ?? {}).includes('platform.timer.');
}

/**
 * Every document a kept one references or extends, added to `keep` until
 * nothing new is reached.
 */
function close(keep, positioned, byRelativePath, machineDocs, schemaRefs) {
  let growing = true;
  while (growing) {
    growing = false;
    for (const relativePath of [...keep]) {
      const doc = positioned.get(relativePath);
      if (!doc) continue;
      const found = [...doc.refs().values()]
        .filter((ref) => ref.external && ref.file)
        .map((ref) => (ref.file.startsWith(BASE_URI)
          ? positioned.get(`base/${ref.file.slice(BASE_URI.length)}`)
          : isRemoteRef(ref.file) ? null : followRef(ref.file, byRelativePath, relativePath)));
      if (doc.type === 'state-machine') found.push(extendedDocOf(doc.content, relativePath, machineDocs));
      // What the document's own blueprint schema references, in the set.
      const schema = typeof doc.content?.$schema === 'string' ? doc.content.$schema.split('/').pop() : null;
      for (const ref of schema ? schemaRefs(schema) : []) {
        if (ref.startsWith(BASE_URI)) found.push(positioned.get(`base/${ref.slice(BASE_URI.length).split('#')[0]}`));
      }
      for (const reached of found) {
        if (reached?.relativePath && !keep.has(reached.relativePath)) {
          keep.add(reached.relativePath);
          growing = true;
        }
      }
    }
  }
}

/** The registry types an annotations document names entries of: the keys whose values are lists of names. */
function registryTypesNamed(doc) {
  const types = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) types.add(key);
      else walk(value);
    }
  };
  walk(doc.content);
  return types;
}

/** The operationIds a document's steps call: `call: { operationId }`, a bare `call:` naming a procedure. */
function operationsCalled(doc) {
  const called = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const id = node.call?.operationId;
    if (typeof id === 'string') called.add(id.startsWith('$apis.') ? id.split('.').pop() : id);
    for (const value of Object.values(node)) walk(value);
  };
  walk(doc.content);
  return called;
}

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

/** An OpenAPI document with every operation marked as answered outside the contracts. */
function asExternal(doc) {
  const content = structuredClone(doc.content);
  for (const pathItem of Object.values(content.paths ?? {})) {
    for (const method of METHODS) {
      if (pathItem?.[method]) pathItem[method]['x-relationship'] = { type: 'external' };
    }
  }
  return toDoc({ path: doc.path, relativePath: doc.relativePath, domain: doc.domain, type: doc.type, content });
}

/** The documents a scenario calls, by relative path; null for one that isn't in the set. */
function sourcesOf(doc, byRelativePath) {
  return (doc.content?.sourceDescriptions ?? [])
    .filter((source) => typeof source?.url === 'string' && !isRemoteRef(source.url))
    .map((source) => followRef(source.url, byRelativePath, doc.relativePath)?.relativePath ?? null);
}

/** The resources the OpenAPI documents among some define, by name. */
function resourceNames(docs) {
  const names = new Set();
  for (const doc of docs) {
    if (doc.type !== 'openapi') continue;
    for (const top of doc.model?.()?.resources ?? []) {
      for (const resource of [top, ...top.singletons]) if (resource.name) names.add(resource.name);
    }
  }
  return names;
}

/** Every properties map in a node. */
function* propertyMaps(node) {
  if (!node || typeof node !== 'object') return;
  if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) yield node.properties;
  for (const value of Object.values(node)) yield* propertyMaps(value);
}

/** A same-document `$ref`, followed. */
const local = (content, schema) => (typeof schema?.$ref === 'string' && schema.$ref.startsWith('#/')
  ? schema.$ref.slice(2).split('/').reduce((node, key) => node?.[key], content) ?? schema
  : schema);

/** Every x-relationship in a node. */
function* relationships(node) {
  if (!node || typeof node !== 'object') return;
  if (node['x-relationship'] && typeof node['x-relationship'] === 'object') yield node['x-relationship'];
  for (const value of Object.values(node)) yield* relationships(value);
}

/**
 * A document with each relationship whose resource was left out made
 * External, or the document as it was when it has none.
 */
function withExternalTypes(doc, kept, inSet, keptSchemas, setSchemas) {
  if (doc.type === 'asyncapi' || !doc.content || typeof doc.content !== 'object') return doc;
  const content = structuredClone(doc.content);
  let changed = false;
  // A plain relationship, named by its schema as the validator checks it.
  for (const relationship of relationships(content)) {
    const { resource } = relationship;
    if (typeof resource !== 'string' || RESERVED_RESOURCES.has(resource) || keptSchemas.has(resource) || !setSchemas.has(resource)) continue;
    relationship.resource = 'External';
    changed = true;
  }
  for (const properties of propertyMaps(content)) {
    for (const definition of Object.values(properties)) {
      const relationship = definition?.['x-relationship'];
      if (relationship?.resource !== 'Polymorphic') continue;
      const typeField = relationship.discriminator?.propertyName;
      const values = local(content, properties[typeField])?.enum;
      if (!Array.isArray(values)) continue;
      const mapping = relationship.discriminator.mapping ?? {};
      for (const value of values.filter((v) => v !== null)) {
        const resource = mapping[value] ?? pascalOf(value);
        if (resource === 'External' || kept.has(resource) || !inSet.has(resource)) continue;
        relationship.discriminator.mapping = { ...relationship.discriminator.mapping, [value]: 'External' };
        changed = true;
      }
    }
  }
  return changed ? toDoc({ path: doc.path, relativePath: doc.relativePath, domain: doc.domain, type: doc.type, content }) : doc;
}

/**
 * The names a choice can use, from the set: each domain and capability a
 * document declares.
 */
export function choosable(docs) {
  return {
    domains: [...new Set(docs.map((doc) => doc.domain).filter(Boolean))].sort(),
    capabilities: [...new Set(docs.map((doc) => doc.capability).filter(Boolean))].sort(),
  };
}

/**
 * Keep the documents of some domains and capabilities, and what they need to
 * stand on their own.
 *
 * @param {import('../types.js').Doc[]} docs - The whole set, after overlays
 * @param {{ domains?: string[], capabilities?: string[], schemaRefs?: (schema: string) => string[] }} choice -
 *   Each of domains and capabilities adds to the other; a document is chosen
 *   when it declares one. `schemaRefs` gives the refs a blueprint schema
 *   makes, by its file name (resolve.js reads them from core's schemas)
 * @returns {import('../types.js').Doc[]} The part, in the set's order, with
 *   left-out types mapped to External
 * @throws {Error} When a name is none the set declares, listing the ones it does
 */
export function selectDocs(docs, { domains = [], capabilities = [], schemaRefs = () => [] } = {}) {
  const known = choosable(docs);
  for (const [kind, names, flag] of [['domain', domains, 'domains'], ['capability', capabilities, 'capabilities']]) {
    const unknown = names.filter((name) => !known[flag].includes(name));
    if (unknown.length) {
      throw new Error(`No document declares the ${kind} ${unknown.join(', ')}. The set's ${flag}: ${known[flag].join(', ') || 'none'}`);
    }
  }

  const positioned = new Map(docs.filter((doc) => doc.relativePath).map((doc) => [doc.relativePath, doc]));
  const byRelativePath = indexByRelativePath(docs);
  const machineDocs = docs.filter((doc) => doc.type === 'state-machine');
  const scenario = (doc) => doc.type === 'arazzo';

  const keep = new Set(docs
    .filter((doc) => doc.relativePath && !scenario(doc))
    .filter((doc) => domains.includes(doc.domain) || capabilities.includes(doc.capability))
    .map((doc) => doc.relativePath));
  close(keep, positioned, byRelativePath, machineDocs, schemaRefs);

  // Platform, by what the kept documents do.
  const kept = () => [...keep].map((path) => positioned.get(path)).filter(Boolean);
  const platformApi = (name) => docs.find((doc) => doc.api === name);
  const needed = [];
  if (kept().some(usesEvents)) needed.push(platformApi(PLATFORM.events));
  if (kept().some(usesTimers)) needed.push(platformApi(PLATFORM.timers));
  if (kept().some((doc) => doc.type === 'registry')) needed.push(platformApi(PLATFORM.registries));
  const named = new Set(kept().filter((doc) => doc.type === 'annotations').flatMap((doc) => [...registryTypesNamed(doc)]));
  const registries = docs.filter((doc) => doc.type === 'registry' && named.has(doc.content?.type));
  needed.push(...registries);
  if (registries.length) needed.push(platformApi(PLATFORM.registries));
  for (const doc of needed) if (doc?.relativePath) keep.add(doc.relativePath);
  close(keep, positioned, byRelativePath, machineDocs, schemaRefs);

  // The contract of each API a kept document calls, answered outside.
  const operationOwner = new Map();
  for (const doc of docs.filter((d) => d.type === 'openapi')) {
    for (const pathItem of Object.values(doc.content?.paths ?? {})) {
      for (const method of METHODS) {
        const id = pathItem?.[method]?.operationId;
        if (id && !operationOwner.has(id)) operationOwner.set(id, doc);
      }
    }
  }
  const external = new Set();
  for (const doc of kept()) {
    for (const id of operationsCalled(doc)) {
      const owner = operationOwner.get(id);
      if (owner?.relativePath && !keep.has(owner.relativePath)) {
        keep.add(owner.relativePath);
        external.add(owner.relativePath);
      }
    }
  }
  close(keep, positioned, byRelativePath, machineDocs, schemaRefs);

  // Scenarios whose every document is kept, and what they reference.
  for (const doc of docs.filter(scenario)) {
    const sources = sourcesOf(doc, byRelativePath);
    // An API kept only as a called contract answers nothing, so a scenario calling it can't run.
    if (sources.length && sources.every((path) => path && keep.has(path) && !external.has(path))) keep.add(doc.relativePath);
  }
  close(keep, positioned, byRelativePath, machineDocs, schemaRefs);

  const part = docs.filter((doc) => keep.has(doc.relativePath))
    .map((doc) => (external.has(doc.relativePath) ? asExternal(doc) : doc));
  const keptResources = resourceNames(part);
  const allResources = resourceNames(docs);
  const keptSchemas = buildSchemaIndex(part);
  const setSchemas = buildSchemaIndex(docs);
  return part.map((doc) => withExternalTypes(doc, keptResources, allResources, keptSchemas, setSchemas));
}
