/**
 * Part of a contract set, chosen by domain or capability, that stands on its
 * own: what `blueprint-resolve` writes when it's told to keep only some of a
 * set, so that everything built from the folder after it — the explorer, the
 * bundle, the mock, clients — covers only that part.
 *
 * Standing on its own takes four things beyond the documents named:
 *
 * - **What they reference.** Every `$ref` out of a kept document, and every
 *   state machine's `extends`, until nothing new is reached, as
 *   `domainClosure` does for the bundle (artifact.js).
 * - **Platform, by use.** Nothing `$ref`s platform: a part of it is needed
 *   because of what the kept documents do. Events travel through the platform
 *   events API, timers through the platform timers document, and registries
 *   are served by the platform registries API. Without the events API, a
 *   scenario can't hear an event at all. These rules are the blueprint's own.
 * - **Scenarios that fit.** A scenario is kept when every document it calls is
 *   kept, whatever domain it declares, and never brings one in: it shows the
 *   part chosen, it doesn't widen it.
 * - **External types for what was left out.** A polymorphic reference names
 *   resources by type (a transcript's `subjectType: interview` names intake's
 *   Interview). A type whose resource was left out is mapped to `External` in
 *   its `discriminator.mapping`, as the validator asks for a resource outside
 *   the contracts, so the part validates on its own. A type that names no
 *   resource in the whole set is left for the validator to report.
 */

import { toDoc } from './doc.js';
import { followRef, indexByRelativePath, isRemoteRef } from './ref-lookup.js';
import { extendedDocOf } from './contract-readers.js';

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
function close(keep, positioned, byRelativePath, machineDocs) {
  let growing = true;
  while (growing) {
    growing = false;
    for (const relativePath of [...keep]) {
      const doc = positioned.get(relativePath);
      if (!doc) continue;
      const found = [...doc.refs().values()]
        .filter((ref) => ref.external && ref.file && !isRemoteRef(ref.file))
        .map((ref) => followRef(ref.file, byRelativePath, relativePath));
      if (doc.type === 'state-machine') found.push(extendedDocOf(doc.content, relativePath, machineDocs));
      for (const reached of found) {
        if (reached?.relativePath && !keep.has(reached.relativePath)) {
          keep.add(reached.relativePath);
          growing = true;
        }
      }
    }
  }
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

/**
 * A document with each polymorphic type whose resource was left out mapped to
 * External, or the document as it was when it has none.
 */
function withExternalTypes(doc, kept, inSet) {
  if (doc.type === 'asyncapi' || !doc.content || typeof doc.content !== 'object') return doc;
  const content = structuredClone(doc.content);
  let changed = false;
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
 * @param {{ domains?: string[], capabilities?: string[] }} choice - Each adds
 *   to the others; a document is chosen when it declares one of the domains or
 *   capabilities
 * @returns {import('../types.js').Doc[]} The part, in the set's order, with
 *   left-out types mapped to External
 * @throws {Error} When a name is none the set declares, listing the ones it does
 */
export function selectDocs(docs, { domains = [], capabilities = [] } = {}) {
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
  close(keep, positioned, byRelativePath, machineDocs);

  // Platform, by what the kept documents do.
  const kept = () => [...keep].map((path) => positioned.get(path)).filter(Boolean);
  const platformApi = (name) => docs.find((doc) => doc.api === name);
  const needed = [];
  if (kept().some(usesEvents)) needed.push(platformApi(PLATFORM.events));
  if (kept().some(usesTimers)) needed.push(platformApi(PLATFORM.timers));
  if (kept().some((doc) => doc.type === 'registry')) needed.push(platformApi(PLATFORM.registries));
  for (const doc of needed) if (doc?.relativePath) keep.add(doc.relativePath);
  close(keep, positioned, byRelativePath, machineDocs);

  // Scenarios whose every document is kept, and what they reference.
  for (const doc of docs.filter(scenario)) {
    const sources = sourcesOf(doc, byRelativePath);
    if (sources.length && sources.every((path) => path && keep.has(path))) keep.add(doc.relativePath);
  }
  close(keep, positioned, byRelativePath, machineDocs);

  const part = docs.filter((doc) => keep.has(doc.relativePath));
  const keptResources = resourceNames(part);
  const allResources = resourceNames(docs);
  return part.map((doc) => withExternalTypes(doc, keptResources, allResources));
}
