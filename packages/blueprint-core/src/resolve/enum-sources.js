/**
 * Resolve `x-enum-source` annotations across the contract set.
 *
 * A schema field can declare that its permitted values come from a behavioral
 * contract — the SLA types defined elsewhere, or the states of a machine —
 * instead of repeating them. This pass reads those collections and writes the
 * values in, so one edit to a state machine cannot leave a schema enumerating
 * states that no longer exist.
 *
 * It runs after overlays, so the values reflect a state's customizations.
 *
 * Three annotation forms, and one named source:
 *
 *     x-enum-source: "slaTypes[].id"
 *     x-enum-source: { source: "states[].id", machine: "Application" }
 *     x-enum-source: { registry: "transcription-services" }
 *     x-enum-source: domains
 *
 * The object form picks one machine's states; the string form takes every
 * machine's states in the document. The registry form takes the entry ids of
 * every registry of that type in the set, so a list several files contribute
 * to — the framework's providers and a state's own — is written nowhere as a
 * list. `domains` is the domains the set defines —
 * those its OpenAPI, AsyncAPI and rules documents declare — so the Domain enum
 * is written nowhere as a list.
 */

import { definedDomains, extractDomain } from '../contract-types.js';

const ANNOTATION = 'x-enum-source';
const SOURCE_SYNTAX = /^(\w+)\[\]\.(\w+)$/;

/**
 * @param {import('../../types.js').Doc[]} docs
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
export function injectEnumSources(docs) {
  const index = buildIndex(docs);
  if (index.size === 0) return { docs, warnings: [], applied: [] };

  const warnings = [];
  const applied = [];

  const injected = docs.map((doc) => {
    const where = doc.relativePath ?? doc.path;
    let count = 0;

    // A collection named without a machine is the annotated document's own
    // domain's, when it has one.
    const domain = doc.domain ?? extractDomain(doc.content);
    const content = transform(doc.content, '', {
      lookup: (key) => (domain && index.get(`${key}@${domain}`)) || index.get(key),
      onInjected: () => { count += 1; },
      onWarning: (message) => warnings.push(`${message} (${where})`),
    });

    if (count === 0) return doc;

    applied.push(`Injected ${count} enum(s) from source contracts -> ${where}`);
    return { ...doc, content };
  });

  return { docs: injected, warnings, applied };
}

/**
 * Collect the value lists that annotations can draw from.
 *
 * Keys are the collection name — `slaTypes`, `states` — plus `states:{Object}`
 * for each machine, so an annotation can name one machine's states, and
 * `domains` for the domains the set defines. `states@{domain}` and
 * `slaTypes@{domain}` pool every document of that domain, and `registry:{type}`
 * every registry file of that type, sorted: an annotation that
 * names no machine takes its own domain's, never whichever document happened
 * to be read last — which, once the framework added a state machine of its
 * own, gave workflow's Task the Transcript's states.
 *
 * @param {import('../../types.js').Doc[]} docs
 * @returns {Map<string, string[]>}
 */
function buildIndex(docs) {
  const index = new Map();

  const domains = definedDomains(docs);
  if (domains.length > 0) index.set('domains', domains);

  const registries = new Map();

  for (const doc of docs) {
    if (doc.type === 'registry' && typeof doc.content?.type === 'string') {
      const pooled = registries.get(doc.content.type) ?? new Set();
      for (const id of Object.keys(doc.content.entries ?? {})) pooled.add(id);
      registries.set(doc.content.type, pooled);
      continue;
    }

    const domain = doc.domain ?? extractDomain(doc.content);
    const pool = (key, values) => {
      index.set(key, values);
      if (domain) index.set(`${key}@${domain}`, [...new Set([...(index.get(`${key}@${domain}`) ?? []), ...values])]);
    };

    if (doc.type === 'sla-types' && Array.isArray(doc.content?.slaTypes)) {
      pool('slaTypes', ids(doc.content.slaTypes));
    }

    if (doc.type !== 'state-machine' || !doc.content) continue;

    // Some state machines declare states at the top level rather than under a
    // machine; both forms feed the flat `states` key.
    if (Array.isArray(doc.content.states)) {
      pool('states', ids(doc.content.states));
      continue;
    }

    if (!Array.isArray(doc.content.machines)) continue;

    const all = [];
    for (const machine of doc.content.machines) {
      if (!Array.isArray(machine.states)) continue;
      const stateIds = ids(machine.states);
      all.push(...stateIds);
      if (machine.object) index.set(`states:${machine.object}`, stateIds);
    }
    pool('states', all);
  }

  for (const [type, pooled] of registries) index.set(`registry:${type}`, [...pooled].sort());

  return index;
}

/**
 * @param {{ id?: string }[]} entries
 * @returns {string[]}
 */
function ids(entries) {
  return entries.map((entry) => entry?.id).filter(Boolean);
}

/**
 * Rebuild a tree with every annotation replaced by the values it names.
 *
 * Annotations are reached at any depth, including inside `allOf`, `oneOf` and
 * `anyOf` arrays, which is where composed schemas put them.
 *
 * @param {*} node
 * @param {string} path - Location within the document, for warnings
 * @param {{ lookup: Function, onInjected: Function, onWarning: Function }} handlers
 * @returns {*}
 */
function transform(node, path, handlers) {
  if (!node || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    return node.map((item, i) => transform(item, `${path}[${i}]`, handlers));
  }

  const children = Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== ANNOTATION)
      .map(([key, value]) => [key, transform(value, path ? `${path}.${key}` : key, handlers)])
  );

  const annotation = node[ANNOTATION];
  if (!annotation) return children;

  const values = resolveAnnotation(annotation, path, handlers);
  if (values === null) return { ...children, [ANNOTATION]: annotation };

  handlers.onInjected();
  return { ...children, enum: values };
}

/**
 * @param {string|{source: string, machine?: string}|{registry: string}} annotation
 * @param {string} path
 * @param {{ lookup: Function, onWarning: Function }} handlers
 * @returns {string[]|null} Values, or null when the annotation cannot be resolved
 */
function resolveAnnotation(annotation, path, handlers) {
  if (typeof annotation === 'object' && annotation?.registry !== undefined) {
    const type = annotation.registry;
    const values = typeof type === 'string' ? handlers.lookup(`registry:${type}`) : null;
    if (!values || values.length === 0) {
      handlers.onWarning(`${ANNOTATION}: no registry entries of type "${type}" at #${path}`);
      return null;
    }
    return values;
  }

  if (annotation === 'domains') {
    const values = handlers.lookup('domains');
    if (!values || values.length === 0) {
      handlers.onWarning(`${ANNOTATION}: no OpenAPI, AsyncAPI or rules document declares a domain, at #${path}`);
      return null;
    }
    return values;
  }

  const source = typeof annotation === 'string' ? annotation : annotation?.source;
  const machine = typeof annotation === 'string' ? null : annotation?.machine ?? null;

  if (typeof source !== 'string') {
    handlers.onWarning(`${ANNOTATION}: no source given at #${path}`);
    return null;
  }

  const match = source.match(SOURCE_SYNTAX);
  if (!match) {
    handlers.onWarning(`${ANNOTATION}: invalid syntax "${source}" at #${path}`);
    return null;
  }

  const [, collection] = match;
  const key = collection === 'states' && machine ? `states:${machine}` : collection;
  const values = handlers.lookup(key);

  if (!values || values.length === 0) {
    const qualifier = machine ? ` (machine: ${machine})` : '';
    handlers.onWarning(`${ANNOTATION}: no values found for "${collection}"${qualifier} at #${path}`);
    return null;
  }

  return values;
}
