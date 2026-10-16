/**
 * What a state machine or composition attaches to: an OpenAPI document in
 * its domain, and the resource in it. Rules attach to nothing — a rules
 * document's endpoints are served under its domain and documented in an API
 * document generated from it.
 *
 * Internal to core. Resolve's generators use it to choose the document they
 * patch, and `extract` reports it to consumers, so what the mock serves and
 * what resolve documents come from one decision.
 *
 * A domain can span several OpenAPI documents — `eligibility-openapi.yaml`
 * beside `eligibility-adapter-openapi.yaml`, a framework file beside a set's
 * own — so what something attaches to is decided by the resource it names,
 * read from each document's model, never by a filename. This replaced
 * filename rules: a state machine's `apiSpec:`, and a composition file's own
 * name.
 */

import { extractDomain, isDeprecated } from './contract-types.js';

/**
 * The API documents of a domain.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {string} domain
 * @returns {import('../types.js').Doc[]}
 */
function apisOf(docs, domain) {
  return docs.filter((doc) =>
    doc.type === 'openapi' && (doc.domain ?? extractDomain(doc.content)) === domain && !isDeprecated(doc.content));
}

/**
 * The resource a state machine governs: the one in its domain named for its
 * object. Null when no document in the domain serves the object.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {string} domain
 * @param {string} object - A machine's `object`, e.g. "Verification"
 * @returns {{ api: import('../types.js').Doc, resource: object }|null}
 * @throws {Error} When more than one resource in the domain is named for it
 */
export function governedResource(docs, domain, object) {
  const hits = [];
  for (const api of apisOf(docs, domain)) {
    for (const resource of api.model().resources) {
      if (resource.name === object) hits.push({ api, resource });
    }
  }

  if (hits.length > 1) {
    throw new Error(
      `The ${object} state machine in domain "${domain}" matches ${hits.length} resources ` +
      `(${hits.map(({ api, resource }) => `${resource.path('item')} in ${api.relativePath ?? api.path}`).join('; ')}). ` +
      'A state machine governs one resource.'
    );
  }
  return hits[0] ?? null;
}

/**
 * The resource a compositions document is about: the top-level resource whose
 * collection each of its compositions names in `resource:` — `applications`
 * for intake's. Null when its domain declares none of them.
 *
 * Compositions name the collection, not the schema, so this matches a
 * top-level resource's collection segment.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {string} domain
 * @param {string[]} collections - Each composition's `resource:`
 * @param {string} subject - Names what is attaching, for the error
 * @returns {{ api: import('../types.js').Doc, resource: object }|null}
 * @throws {Error} When they name resources in more than one document, or a name matches more than one resource
 */
export function declaredResource(docs, domain, collections, subject) {
  const found = [];
  for (const collection of new Set(collections)) {
    const hits = [];
    for (const api of apisOf(docs, domain)) {
      for (const resource of api.model().resources) {
        if (resource.parent === null && resource.collection.segment === collection) hits.push({ api, resource });
      }
    }
    if (hits.length > 1) {
      throw new Error(`${subject} names resource "${collection}", which ${hits.length} documents in domain "${domain}" declare.`);
    }
    if (hits.length === 1) found.push(hits[0]);
  }

  const documents = new Set(found.map(({ api }) => api));
  if (documents.size > 1) {
    throw new Error(`${subject} names resources in ${documents.size} OpenAPI documents of domain "${domain}"; a compositions document's resources are declared in one.`);
  }
  return found[0] ?? null;
}
