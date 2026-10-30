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
import { operationsOf } from './operation-calls.js';
import { causedBy } from './auth-context.js';

/**
 * @param {Object} options
 * @param {Array}  options.apiSpecs      - Loaded API documents, each with `serverBasePath`, `domain` and `doc`
 * @param {Array}  options.stateMachines - From `extract(docs, 'state-machines')`
 * @param {Array}  [options.slaTypes]    - From `extract(docs, 'sla-types')`, for an action a call runs
 * @param {Object} options.store
 * @returns {{ resolve: Function, apply: Function, perform: Function, serve: Function, slaTypesFor: Function }}
 */
export function createStepCalls({ apiSpecs, stateMachines, slaTypes = [], store }) {
  // Every operation by operationId, including those a state machine adds, for
  // a call that names one; and the mock's own fetch, once its routes exist,
  // for a call made as the caller.
  const operations = operationsOf(apiSpecs);
  let fetchHere = null;

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

  /**
   * Make a call to an operation by its operationId.
   *
   * `runAs: caller` sends it through the mock's own routes as a request from
   * the caller, so the operation's permissions, validation and guards apply
   * as they would to the caller making it by hand. `runAs: system`, the
   * default, is the machine's own write, as a call by method and path is.
   *
   * @param {{ operationId: string, parameters?: Array<{ name: string, in: string, value: * }>, body?: * }} call
   * @param {Object} options
   * @param {'system'|'caller'} [options.runAs]
   * @param {{ id: string|null, roles: string[] }} options.caller
   * @param {string|null} [options.traceparent]
   * @param {string|null} [options.causationid] - The event the call's own events name as their cause
   * @param {string} [options.now]
   * @param {Function} [options.runAction] - As for apply
   * @returns {Promise<{ ok: boolean, status: number, body: * }>}
   */
  async function perform(call, { runAs = 'system', caller, traceparent = null, causationid = null, now, runAction } = {}) {
    const operation = operations.get(call.operationId);
    if (!operation) {
      return failure(422, 'VALIDATION_ERROR', `No operation in the contract set has the operationId "${call.operationId}".`);
    }
    const given = call.parameters ?? [];
    let path = operation.path;
    for (const p of given.filter((p) => p.in === 'path')) {
      path = path.replace(`{${p.name}}`, encodeURIComponent(String(p.value)));
    }

    if (runAs === 'caller') {
      if (!fetchHere) return failure(500, 'INTERNAL_ERROR', 'The mock has no routes to send a call through yet.');
      const query = new URLSearchParams(given.filter((p) => p.in === 'query').map((p) => [p.name, String(p.value)]));
      const headers = { 'content-type': 'application/json' };
      for (const p of given.filter((p) => p.in === 'header')) headers[p.name] = String(p.value);
      if (caller?.id) headers['x-caller-id'] = caller.id;
      if (caller?.roles?.length) headers['x-caller-roles'] = caller.roles.join(',');
      if (traceparent) headers.traceparent = traceparent;
      const request = causedBy(new Request(`http://mock.internal${path}${query.size ? `?${query}` : ''}`, {
        method: operation.method,
        headers,
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      }), causationid);
      const response = await fetchHere(request);
      const text = await response.text();
      let body = text;
      try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      return { ok: response.ok, status: response.status, body };
    }

    try {
      const result = await apply({ method: operation.method, path: path.replace(/^\//, ''), body: call.body ?? {} },
        { caller, traceparent, causationid, now, runAction });
      if (result && result.success === false) {
        return failure(result.status ?? 409, result.code ?? 'CONFLICT', result.error, result.details);
      }
      return { ok: true, status: 200, body: result?.result ?? result ?? null };
    } catch (error) {
      return failure(422, 'VALIDATION_ERROR', error.message);
    }
  }

  /** Give perform the mock's fetch, once its routes are registered. */
  const serve = (fetch) => { fetchHere = fetch; };

  /** A domain's SLA types, for running one of its actions. */
  const slaTypesFor = (domain) => slaTypes.filter((s) => s.domain === domain).flatMap((s) => s.slaTypes ?? []);

  return { resolve, apply, perform, serve, slaTypesFor };
}

/** An outcome that failed, in the shared Error shape. */
function failure(status, code, message, details) {
  return { ok: false, status, body: details ? { code, message, details } : { code, message } };
}
