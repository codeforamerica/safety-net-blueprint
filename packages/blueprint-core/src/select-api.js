/**
 * What one API is, for choosing it on its own (select.js): its documents, and
 * the parts of the documents beside it that are about its resources.
 *
 * Nothing in an OpenAPI document points at its state machine, sample records
 * or annotations; they point at its resources, by name. So an API is followed
 * from its resources outward:
 *
 * - its OpenAPI document, and its events document (the same `doc.api`);
 * - the state machines whose `object` is one of its resources;
 * - the rulesets those machines evaluate (`evaluate:`) and its operations are
 *   generated from (`x-relationship: { type: ruleset }`), and the compositions
 *   its operations are (`type: composition`);
 * - in its domain, the annotations about its schemas, operations, events and
 *   those rulesets' facts, the metrics counting only its collections or
 *   events, and the SLA types, when a kept machine keeps an SLA clock: each a
 *   domain's own, so another domain's, even about the same event, stays out;
 * - the sample records of its schemas, wherever they're kept, and the
 *   configuration catalogs of its resources (`resource:` on a catalog).
 *
 * A document covering other resources too is cut to the entries about these,
 * and one left with none is left out, so the part never describes something
 * that isn't in it.
 */

import { toDoc } from './doc.js';

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];
const pascalOf = (value) => String(value).split(/[_-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
const camelOf = (value) => value.charAt(0).toLowerCase() + value.slice(1);

/** A copy of a document with new content, or null when it has nothing left. */
const cut = (doc, content, empty) => (empty ? null : toDoc({ path: doc.path, relativePath: doc.relativePath, domain: doc.domain, type: doc.type, content }));

/** Every value of a key anywhere in a node. */
function valuesOf(node, key, found = new Set()) {
  if (!node || typeof node !== 'object') return found;
  if (typeof node[key] === 'string') found.add(node[key]);
  for (const value of Object.values(node)) valuesOf(value, key, found);
  return found;
}

/** The names an API's sample records may start with: every schema in the set, for the longest match. */
function schemaNames(docs) {
  return docs.filter((doc) => doc.type === 'openapi').flatMap((doc) => Object.keys(doc.content?.components?.schemas ?? {}));
}

/**
 * The documents of some APIs and the parts of others about their resources.
 *
 * @param {import('../types.js').Doc[]} docs - The whole set
 * @param {string[]} apis - API names (doc.api)
 * @returns {import('../types.js').Doc[]} Kept whole or cut, in the set's order
 */
export function apiPart(docs, apis) {
  // Its OpenAPI document and the events document named for it, or an AsyncAPI API of its own, such as one reached over a WebSocket.
  const own = docs.filter((doc) => apis.includes(doc.api) && (doc.type === 'openapi' || doc.type === 'asyncapi'));
  const openapis = own.filter((doc) => doc.type === 'openapi');

  // What the APIs have: resources, schemas, collections, operations and the
  // artifacts their operations were generated from.
  const resources = new Set();
  const collections = new Set();
  const schemas = new Set();
  const operations = new Set();
  const rulesets = new Set();
  const compositions = new Set();
  const domains = new Set();
  for (const doc of openapis) {
    if (doc.domain) domains.add(doc.domain);
    for (const name of Object.keys(doc.content?.components?.schemas ?? {})) schemas.add(name);
    for (const top of doc.model?.()?.resources ?? []) {
      for (const resource of [top, ...top.singletons]) {
        if (resource.name) resources.add(resource.name);
        const path = resource.path?.('collection');
        if (path) collections.add(path.split('/').filter(Boolean).pop());
      }
    }
    for (const pathItem of Object.values(doc.content?.paths ?? {})) {
      for (const method of METHODS) {
        const operation = pathItem?.[method];
        if (operation?.operationId) operations.add(operation.operationId);
        const rel = operation?.['x-relationship'];
        if (rel?.type === 'ruleset' && rel.id) rulesets.add(rel.id);
        if (rel?.type === 'composition' && rel.id) compositions.add(rel.id);
      }
    }
  }

  const part = new Map(own.map((doc) => [doc.relativePath, doc]));

  // State machines, cut to the machines of these resources.
  let slaClocks = false;
  for (const doc of docs.filter((d) => d.type === 'state-machine' && Array.isArray(d.content?.machines))) {
    const machines = doc.content.machines.filter((machine) => resources.has(machine?.object));
    if (!machines.length) continue;
    for (const name of valuesOf(machines, 'evaluate')) rulesets.add(name);
    if (JSON.stringify(machines).includes('"slaClock"')) slaClocks = true;
    part.set(doc.relativePath, machines.length === doc.content.machines.length ? doc : cut(doc, { ...doc.content, machines }, false));
  }

  // Rules and their examples, cut to these rulesets; compositions, to these.
  // Rules, compositions, annotations, metrics and SLA types are a domain's own,
  // so only the API's domain's are cut to it.
  const ofDomain = (doc) => domains.has(doc.domain);
  for (const doc of docs.filter((d) => (d.type === 'rules' || d.type === 'rules-examples') && d.content?.rulesets && ofDomain(d))) {
    const kept = Object.fromEntries(Object.entries(doc.content.rulesets).filter(([name]) => rulesets.has(name)));
    const count = Object.keys(kept).length;
    if (count) part.set(doc.relativePath, count === Object.keys(doc.content.rulesets).length ? doc : cut(doc, { ...doc.content, rulesets: kept }, false));
  }
  for (const doc of docs.filter((d) => d.type === 'compositions' && d.content?.compositions && ofDomain(d))) {
    const entries = doc.content.compositions;
    const list = Array.isArray(entries) ? entries.filter((c) => compositions.has(c?.id ?? c?.name)) : null;
    const map = Array.isArray(entries) ? null : Object.fromEntries(Object.entries(entries).filter(([name]) => compositions.has(name)));
    const count = list ? list.length : Object.keys(map).length;
    const total = Array.isArray(entries) ? entries.length : Object.keys(entries).length;
    if (count) part.set(doc.relativePath, count === total ? doc : cut(doc, { ...doc.content, compositions: list ?? map }, false));
  }

  // Annotations, cut to what's about these resources, schemas and rulesets.
  const camelSchemas = new Set([...schemas].map(camelOf));
  const camelResources = new Set([...resources].map(camelOf));
  const about = {
    schema: (key) => camelSchemas.has(key.split('.')[0].replace(/\[\]$/, '')),
    operations: (key) => camelResources.has(key.split('.')[0]),
    events: (key) => resources.has(pascalOf(key.split('.').slice(-2)[0])),
    facts: (key) => rulesets.has(key.split('.')[0]),
  };
  for (const doc of docs.filter((d) => d.type === 'annotations' && ofDomain(d))) {
    const content = { ...doc.content };
    let entries = 0;
    for (const [section, belongs] of Object.entries(about)) {
      if (!content[section] || typeof content[section] !== 'object') continue;
      content[section] = Object.fromEntries(Object.entries(content[section]).filter(([key]) => belongs(key)));
      entries += Object.keys(content[section]).length;
      if (!Object.keys(content[section]).length) delete content[section];
    }
    if (entries) part.set(doc.relativePath, cut(doc, content, false));
  }

  // Sample records, cut to these schemas' by the longest schema name a key starts with.
  const allSchemas = schemaNames(docs).sort((a, b) => b.length - a.length);
  for (const doc of docs.filter((d) => d.type === 'mock-data')) {
    const { domain, capability, ...records } = doc.content ?? {};
    const kept = Object.fromEntries(Object.entries(records).filter(([key]) => schemas.has(allSchemas.find((name) => key.startsWith(name)))));
    if (!Object.keys(kept).length) continue;
    const declared = { ...(domain ? { domain } : {}), ...(capability ? { capability } : {}) };
    part.set(doc.relativePath, Object.keys(kept).length === Object.keys(records).length ? doc : cut(doc, { ...declared, ...kept }, false));
  }

  // Configuration catalogs of these resources: each top-level catalog names
  // its resource (profiles: { resource: TranscriptionProfile, entries }).
  for (const doc of docs.filter((d) => d.type === 'config' && d.content && typeof d.content === 'object')) {
    const catalogs = Object.entries(doc.content).filter(([, value]) => value && typeof value === 'object' && typeof value.resource === 'string');
    const kept = catalogs.filter(([, catalog]) => resources.has(catalog.resource));
    if (!kept.length) continue;
    const dropped = new Set(catalogs.filter(([, catalog]) => !resources.has(catalog.resource)).map(([key]) => key));
    part.set(doc.relativePath, dropped.size ? cut(doc, Object.fromEntries(Object.entries(doc.content).filter(([key]) => !dropped.has(key))), false) : doc);
  }

  // Metrics counting only these collections, or events; SLA types, for a machine with an SLA clock.
  for (const doc of docs.filter((d) => d.type === 'metrics' && Array.isArray(d.content?.metrics) && ofDomain(d))) {
    const metrics = doc.content.metrics.filter((metric) => [...valuesOf(metric, 'collection')].every((name) => name === 'events' || collections.has(name)));
    if (metrics.length) part.set(doc.relativePath, metrics.length === doc.content.metrics.length ? doc : cut(doc, { ...doc.content, metrics }, false));
  }
  if (slaClocks) {
    for (const doc of docs.filter((d) => d.type === 'sla-types' && ofDomain(d))) part.set(doc.relativePath, doc);
  }

  return docs.filter((doc) => part.has(doc.relativePath)).map((doc) => part.get(doc.relativePath));
}

/** The API names a set has: each OpenAPI document's. */
export function apiNames(docs) {
  return [...new Set(docs.filter((doc) => doc.type === 'openapi').map((doc) => doc.api))].sort();
}
