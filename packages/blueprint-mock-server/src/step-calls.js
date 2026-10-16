/**
 * What a step's `call:` means, and doing it.
 *
 * A step writes a call the way a client sends a request — a method and a path,
 * `POST: communication/transcripts/$object.id/entries` — and it means what the
 * API's route at that method and path means. The path is read against core's
 * model of each API document: a POST to a nested collection the document
 * declares a create for is a create there; a POST to a word after an item is
 * that resource's action; a PATCH to an item the document declares a PATCH for
 * updates it. One source per route
 * guarantees an action and a create never claim the same method and path, so
 * the reading is never a guess. A path that means nothing is an error naming it.
 *
 * The machine is trusted: a create or update a step makes skips what a client
 * faces — the create schema, governed guards, an Idempotency-Key — and is
 * checked against the resource's full schema instead, so a contract mistake is
 * caught while a record only the machine may write, a pause entry, is allowed.
 */

import { deriveCollectionName } from './collection-utils.js';
import { emitEvent } from './emit-event.js';
import { validate } from './validator.js';
import { buildChanges } from './handlers/update-handler.js';
import { extractExpandFields, applyExpand } from './handlers/expand-utils.js';

/**
 * @param {Object} options
 * @param {Array}  options.apiSpecs      - Loaded API documents, each with `serverBasePath`, `domain` and `doc`
 * @param {Array}  options.stateMachines - From `extract(docs, 'state-machines')`
 * @param {Array}  [options.slaTypes]    - From `extract(docs, 'sla-types')`, for an action a call runs
 * @param {Object} options.store
 * @returns {{ resolve: Function, apply: Function, slaTypesFor: Function }}
 */
export function createStepCalls({ apiSpecs, stateMachines, slaTypes = [], store }) {
  const apis = (apiSpecs ?? [])
    .filter((spec) => typeof spec.doc?.model === 'function')
    .map((spec) => ({
      base: (spec.serverBasePath ?? '').split('/').filter(Boolean),
      domain: spec.domain,
      doc: spec.doc,
      model: spec.doc.model(),
    }));

  const machineFor = (api, resource) => (stateMachines ?? []).find((entry) =>
    entry.domain === api.domain && entry.resource?.path('item') === resource.path('item'));

  /**
   * What a call means.
   *
   * @param {string} method - POST, PATCH
   * @param {string} path   - Interpolated, e.g. "communication/transcripts/7a1e…/entries"
   * @returns {Object} `{ kind: 'create'|'action'|'update', api, resource, params, ... }`
   * @throws {Error} When the path means nothing in any API document
   */
  function resolve(method, path) {
    const segments = path.split('/').filter(Boolean);
    if (segments.some((s) => s === 'undefined' || s === 'null')) {
      throw new Error(`call: ${method} ${path} has an empty value in its path — a binding it uses found no record`);
    }

    for (const api of apis) {
      if (api.base.some((s, i) => segments[i] !== s)) continue;
      const rest = segments.slice(api.base.length);

      let resource = null;
      const params = {};
      let i = 0;
      while (i < rest.length) {
        const candidates = resource ? resource.children : api.model.resources.filter((r) => !r.parent);
        const next = candidates.find((r) => r.collection.segment === rest[i]);
        if (!next) break;
        if (i + 1 === rest.length) {
          // A collection: a POST there is its create, if the document declares one.
          const declared = api.doc.content?.paths?.[next.path('collection')];
          if (method === 'POST' && declared?.post) return { kind: 'create', api, resource: next, params };
          break;
        }
        params[next.item.parameter] = rest[i + 1];
        resource = next;
        i += 2;
      }

      if (!resource) continue;
      if (i === rest.length && method === 'PATCH' && api.doc.content?.paths?.[resource.path('item')]?.patch) {
        return { kind: 'update', api, resource, params, id: params[resource.item.parameter] };
      }
      if (i + 1 === rest.length && method === 'POST') {
        const entry = machineFor(api, resource);
        const action = entry?.machine?.actions?.find((a) => a.id === rest[i]);
        if (action) return { kind: 'action', api, resource, params, id: params[resource.item.parameter], entry, action: action.id };
      }
    }
    throw new Error(`call: ${method} ${path} is not a route any API declares`);
  }

  /** The collection a resource is stored in, as the mock names it. */
  const collectionOf = (resource) => deriveCollectionName(resource.path('collection'), '');

  /**
   * Check a record against its resource's full schema, as the API would return
   * it — a related record the contract shows expanded is checked expanded —
   * and throw naming what is wrong.
   */
  function checkRecord(resolved, stored) {
    const schema = resolved.api.doc.content?.components?.schemas?.[resolved.resource.name];
    if (!schema) return;
    const follow = (node) => (typeof node?.$ref === 'string' && node.$ref.startsWith('#/')
      ? node.$ref.slice(2).split('/').reduce((at, key) => at?.[key], resolved.api.doc.content) ?? node
      : node);
    const record = applyExpand(stored, extractExpandFields(schema, follow), store.findById);
    const source = { relativePath: resolved.api.doc.relativePath, ref: `#/components/schemas/${resolved.resource.name}` };
    const { valid, errors } = validate(record, schema, `step-call-${resolved.api.domain}-${resolved.resource.name}`, source);
    if (!valid) {
      throw new Error(`call wrote a ${resolved.resource.name} its schema refuses: ${errors.map((e) => `${e.field} ${e.message}`).join('; ')}`);
    }
  }

  /**
   * Do a call.
   *
   * @param {{ method: string, path: string, body?: Object }} call
   * @param {Object} options
   * @param {{ id: string|null, roles: string[] }} options.caller
   * @param {string|null} [options.traceparent]
   * @param {string|null} [options.causationid]
   * @param {string} [options.now]
   * @param {Function} [options.runAction] - Runs a transition: `({ entry, collection, id, action, body }) => result`
   * @returns {Object|null} The record created or updated, or the action's result
   */
  function apply({ method, path, body = {} }, { caller, traceparent = null, causationid = null, now, runAction } = {}) {
    const resolved = resolve(method, path);
    const collection = collectionOf(resolved.resource);
    // Named for the resource, as a client's write is: a machine's write is
    // the same event.
    const event = (action, resourceId, data) => resolved.resource.eventName && emitEvent({
      store,
      domain: resolved.api.domain,
      object: resolved.resource.eventName,
      action,
      resourceId,
      source: `/${resolved.api.base.join('/')}`,
      data,
      callerId: caller?.id ?? null,
      callerRoles: caller?.roles ?? [],
      traceparent,
      causationid,
      now,
    });

    if (resolved.kind === 'create') {
      const record = store.create(collection, { ...body, ...resolved.params });
      try {
        checkRecord(resolved, record);
      } catch (error) {
        store.deleteResource(collection, record.id);
        throw error;
      }
      event('created', record.id, { ...record });
      return record;
    }

    if (resolved.kind === 'update') {
      const existing = store.findById(collection, resolved.id);
      if (!existing) throw new Error(`call: ${method} ${path} names a ${resolved.resource.name} that does not exist`);
      const patch = {};
      for (const [field, value] of Object.entries(body)) {
        patch[field] = value && typeof value === 'object' && '$push' in value
          ? [...(Array.isArray(existing[field]) ? existing[field] : []), value.$push]
          : value;
      }
      checkRecord(resolved, { ...existing, ...patch });
      const updated = store.update(collection, resolved.id, patch);
      event('updated', resolved.id, { changes: buildChanges(existing, updated) });
      return updated;
    }

    if (!runAction) throw new Error(`call: ${method} ${path} is an action, and nothing here can run one`);
    return runAction({ entry: resolved.entry, collection, id: resolved.id, action: resolved.action, body });
  }

  /** A domain's SLA types, for running one of its actions. */
  const slaTypesFor = (domain) => slaTypes.filter((s) => s.domain === domain).flatMap((s) => s.slaTypes ?? []);

  return { resolve, apply, slaTypesFor };
}
