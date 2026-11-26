/**
 * Who publishes each event, for the pages that say so: the event catalog and the
 * state machine pages. Both sit one directory under the explorer's root, so
 * the links work from either.
 *
 * A publisher is one of:
 *   - a state machine action, which emits it;
 *   - an endpoint, whose write publishes a resource's created, updated or deleted event;
 *   - the timer service, which publishes the callback a machine asked for.
 */

import { esc as h, titleCase, apiEndpointSlug, actionAnchor, objectSlug } from './html.js';

/** What sends an event, said as a path from its domain: Communication › Transcript › close. */
export const pathLabel = (...parts) => parts.map(h).join(' › ');

/**
 * The endpoint whose write sends each resource's created, updated and deleted
 * event: the collection's POST, the item's PATCH and DELETE. Keyed by the
 * event's domain, resource and verb with the resource as objectSlug has it, so
 * `communication.transcript_entry.created` finds TranscriptEntry.
 */
function writeEndpoints(apiDocs) {
  const endpoints = new Map();
  for (const doc of apiDocs) {
    const domain = doc.domain ?? doc.content?.info?.['x-domain'];
    if (!domain) continue;
    const page = doc.api;
    const paths = doc.content?.paths ?? {};
    for (const resource of doc.model()?.resources ?? []) {
      if (!resource.name) continue;
      const collection = resource.path('collection');
      const item = resource.path('item');
      const writes = [['created', 'post', collection], ['updated', 'patch', item], ['deleted', 'delete', item]];
      for (const [verb, method, path] of writes) {
        if (!path || !paths[path]?.[method]) continue;
        // The event's own name has the resource in snake_case: TranscriptEntry → transcript_entry.
        const type = `${domain}.${resource.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}.${verb}`;
        endpoints.set(`${domain}.${objectSlug(resource.name)}.${verb}`, { domain, page, method, path, type });
      }
    }
  }
  return endpoints;
}

/**
 * @param {ReturnType<import('../contract-nav.js').buildEventIndex>} eventIndex
 * @param {import('@codeforamerica/blueprint-core').Doc[]} apiDocs
 * @returns {(type: string) => ({ kind: string, href?: string, label: string } | null)}
 *   The event's publisher, with a link to it where it has a page; null when no
 *   contract in the set sends it.
 */
export function eventSenders(eventIndex, apiDocs) {
  const endpoints = writeEndpoints(apiDocs);
  return (type) => {
    const emitter = eventIndex.emitters[type];
    if (emitter) return {
      kind: 'State machine action',
      href: `../state-machine-docs/${emitter.domain}.html#${actionAnchor(emitter.object, emitter.action)}`,
      label: pathLabel(titleCase(emitter.domain), emitter.object, emitter.action),
    };
    const [domain, resource, verb] = type.split('.');
    const endpoint = endpoints.get(`${domain}.${objectSlug(resource ?? '')}.${verb}`);
    if (endpoint) return {
      kind: 'Endpoint',
      href: `../api-reference/${endpoint.page}.html#${apiEndpointSlug(endpoint.method, endpoint.path)}`,
      label: pathLabel(titleCase(endpoint.domain), `${endpoint.method.toUpperCase()} ${endpoint.path}`),
    };
    if (eventIndex.timerCallbacks.has(type)) return { kind: 'timer', label: 'The timer service, when the timer fires' };
    return null;
  };
}

/**
 * The endpoint a state machine's call step calls, found by its operationId or
 * by its method and path, with what that endpoint sends: its resource's
 * created, updated or deleted event, or, for a state machine action, the
 * action it runs.
 *
 * `{ POST: 'eligibility/determinations' }` → the determinations collection's
 * POST, whose event is `eligibility.determination.created`.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} apiDocs
 * @returns {(request: object) => ({ label: string, href: string, event: string|null,
 *   relationship: { domain: string, resource: string, id: string }|null } | null)}
 */
export function callTargets(apiDocs) {
  const byId = new Map();
  const all = [];
  for (const doc of apiDocs) {
    const servers = doc.content?.servers ?? [];
    const local = servers.find((server) => /localhost|127\.0\.0\.1/.test(server.url)) ?? servers[0];
    let base = '';
    try { base = new URL(local?.url ?? '', 'http://relative.invalid').pathname.replace(/\/$/, ''); } catch { /* no base path */ }
    const page = doc.api;
    const writes = new Map([...writeEndpoints([doc]).values()].map((endpoint) => [`${endpoint.method} ${endpoint.path}`, endpoint.type]));
    for (const [path, item] of Object.entries(doc.content?.paths ?? {})) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = item?.[method];
        if (!operation) continue;
        const relationship = operation['x-relationship'];
        const target = {
          method,
          segments: `${base}${path}`.split('/').filter(Boolean),
          label: `${method.toUpperCase()} ${base}${path}`,
          href: `../api-reference/${page}.html#${apiEndpointSlug(method, path)}`,
          event: writes.get(`${method} ${path}`) ?? null,
          relationship: relationship?.type === 'state-machine-action' ? relationship : null,
        };
        all.push(target);
        if (operation.operationId) byId.set(operation.operationId, target);
      }
    }
  }
  const isParam = (segment) => /^\{.+\}$/.test(segment);
  return (request) => {
    if (!request || typeof request !== 'object') return null;
    if (request.operationId) return byId.get(request.operationId) ?? null;
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].find((m) => typeof request[m] === 'string');
    if (!method) return null;
    const segments = request[method].split('/').filter(Boolean);
    // A template's literal segments must match; its parameters match anything.
    // The one with the most literal segments wins: /entries/search over /entries/{id}.
    return all
      .filter((target) => target.method === method.toLowerCase() && target.segments.length === segments.length
        && target.segments.every((segment, i) => isParam(segment) || segment === segments[i]))
      .sort((a, b) => a.segments.filter(isParam).length - b.segments.filter(isParam).length)[0] ?? null;
  };
}
