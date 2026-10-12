/**
 * Every route a contract set will have, and any two that claim one URL.
 *
 * A route comes from one of four places: an operation written in an OpenAPI
 * document, a state machine action, a composition's endpoint, or a ruleset's
 * endpoint. The last three choose their paths in their own documents, so
 * nothing about the OpenAPI document stops one landing on a path another
 * already has — and a server can serve only one of them. Checked here, at
 * validation, so it is caught for any implementation and not only when the
 * mock server boots, and caught between two endpoints in the same file too.
 *
 * Paths compare with their parameters' names ignored: `/applications/{id}` and
 * `/applications/{applicationId}` are one route.
 */

import { readStateMachines, readCompositions, readRules } from '../contract-readers.js';
import { isDeprecated } from '../contract-types.js';

/** Operations resolve generates from another contract, which are counted from that contract instead. */
const GENERATED = new Set(['state-machine-action', 'composition', 'ruleset']);
const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

/** The path an API document's routes are served under: its localhost server's, as the mock serves it, or its first. */
function baseOf(doc) {
  const servers = doc.model().servers;
  const local = servers.find((server) => /localhost|127\.0\.0\.1/.test(server.url));
  return (local ?? servers[0])?.base ?? '';
}

const keyOf = (method, path) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`;

/**
 * Routes two contracts, or two places in one, both claim.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {Map<string, object[]>} Errors, keyed by the path of the document each belongs to
 */
export function duplicateRoutes(docs) {
  const routes = new Map();
  const add = (method, path, source, docPath) => {
    const key = keyOf(method, path);
    if (!routes.has(key)) routes.set(key, []);
    routes.get(key).push({ method: method.toUpperCase(), path, source, docPath });
  };

  for (const doc of docs.filter((d) => d.type === 'openapi' && !isDeprecated(d.content))) {
    const base = baseOf(doc);
    for (const [path, item] of Object.entries(doc.content?.paths ?? {})) {
      for (const method of METHODS) {
        const operation = item?.[method];
        if (!operation || GENERATED.has(operation['x-relationship']?.type)) continue;
        add(method, `${base}${path}`, `${doc.relativePath ?? doc.path}`, doc.path);
      }
    }
  }

  let machines = [];
  try { machines = readStateMachines(docs); } catch { /* reported where attachment is decided */ }
  for (const { api, resource, machine, domain, relativePath, stateMachine } of machines) {
    if (!api || !resource) continue;
    const docPath = docs.find((d) => d.relativePath === relativePath)?.path ?? relativePath;
    for (const action of machine.actions ?? []) {
      add('post', `${baseOf(api)}${resource.path('item')}/${action.id}`,
        `the ${domain} state machine's "${action.id}" action (${relativePath ?? stateMachine.domain})`, docPath);
    }
  }

  let compositionFiles = [];
  try { compositionFiles = readCompositions(docs); } catch { /* reported where attachment is decided */ }
  for (const { domain, doc, api, relativePath, filePath } of compositionFiles) {
    const base = api ? baseOf(api) : `/${domain}`;
    for (const [name, composition] of Object.entries(doc.compositions ?? {})) {
      const path = composition?.endpoint?.path;
      if (!path) continue;
      for (const method of composition.endpoint.methods ?? ['get']) {
        add(method, `${base}${path}`, `the ${domain} composition "${name}" (${relativePath ?? filePath})`, filePath);
      }
    }
  }

  for (const { domain, rulesets, relativePath, filePath } of readRules(docs)) {
    for (const { name, path } of rulesets) {
      add('post', path, `the ${domain} ruleset "${name}" (${relativePath ?? filePath})`, filePath);
    }
  }

  const errors = new Map();
  for (const claims of routes.values()) {
    if (claims.length < 2) continue;
    const message = `${claims[0].method} ${claims[0].path} is claimed by ${claims.map((c) => c.source).join(' and ')}. ` +
      'A server can serve only one; give each its own path.';
    for (const docPath of new Set(claims.map((c) => c.docPath))) {
      if (!errors.has(docPath)) errors.set(docPath, []);
      errors.get(docPath).push({ rule: 'duplicate-route', message, path: docPath });
    }
  }
  return errors;
}
