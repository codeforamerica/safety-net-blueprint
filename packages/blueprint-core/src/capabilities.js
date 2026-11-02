/**
 * The framework's capabilities, for saying which one a finding is about.
 *
 * A set that refers to something from a capability it has not listed — a
 * scenario calling createTranscript, a file attaching to a domain only a
 * capability defines — fails validation the way any unknown name does. What
 * makes the finding useful is saying where the name comes from, and that is
 * derived from the framework's own files rather than kept as a list.
 */

import { discover } from './discover.js';
import { load } from './load.js';
import { baseContractsDir } from './paths.js';
import { definedDomains } from './contract-types.js';
import { operationIdsOf } from './validator/arazzo-validator.js';

/** The framework's base contracts, loaded once: they do not change while running. */
let frameworkDocs;
function framework() {
  frameworkDocs ??= discover(baseContractsDir)
    .map((file) => load({ ...file, relativePath: `base/${file.relativePath}` }));
  return frameworkDocs;
}

/**
 * Names that only a capability the set has not listed declares, each mapped to
 * that capability: its operation ids, its schemas, its registry types, and its
 * domain when nothing in the set defines that domain.
 *
 * A capability counts as listed when any document in the set declares it, so
 * this works on a resolved set as well as on one being resolved.
 *
 * @param {import('../types.js').Doc[]} docs - The set
 * @param {{ generatedOverlays: Function, rulesApis: Function }} generators - From
 *   core's generate, passed in to avoid an import cycle
 * @returns {Map<string, string>} Name to capability
 */
export function unlistedCapabilityNames(docs, generators) {
  const listed = new Set(docs.map((doc) => doc.capability).filter(Boolean));
  const setDomains = new Set(definedDomains(docs));
  const shared = framework().filter((doc) => !doc.capability);
  const sharedIds = operationIdsOf(shared, generators) ?? new Set();

  const byCapability = new Map();
  for (const doc of framework()) {
    if (!doc.capability || listed.has(doc.capability)) continue;
    if (!byCapability.has(doc.capability)) byCapability.set(doc.capability, []);
    byCapability.get(doc.capability).push(doc);
  }

  const names = new Map();
  for (const [capability, own] of byCapability) {
    const add = (name) => { if (name && !names.has(name)) names.set(name, capability); };
    // A capability's state machines add operations to its APIs, which only
    // generating them shows; platform's are subtracted, since every set has them.
    for (const id of operationIdsOf([...shared, ...own], generators) ?? []) {
      if (!sharedIds.has(id)) add(id);
    }
    for (const doc of own) {
      if (!setDomains.has(doc.domain)) add(doc.domain);
      if (doc.type === 'openapi') Object.keys(doc.content?.components?.schemas ?? {}).forEach(add);
      if (doc.type === 'registry') add(doc.content?.type);
    }
  }
  return names;
}

/**
 * A finding's message, with the capability it is about when it names something
 * only an unlisted capability declares.
 *
 * @param {string} message
 * @param {Map<string, string>} names - From unlistedCapabilityNames
 * @returns {string}
 */
export function withCapability(message, names) {
  if (names.size === 0 || typeof message !== 'string') return message;
  const named = message.split(/[^A-Za-z0-9_-]+/).find((token) => names.has(token));
  if (!named) return message;
  return `${message} "${named}" is declared by the framework's "${names.get(named)}" capability, ` +
    'which the set does not list in x-capabilities.';
}
