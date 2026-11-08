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
import { extractExpandFields, applyExpand, propertiesOf } from './handlers/expand-utils.js';
import { operationsOf } from './operation-calls.js';
import { fitToSchema } from './payload-fit.js';
import { resolverFor } from './schema-refs.js';
import { startSlaClocks, earliestDeadline } from './sla-engine.js';
import { causedBy, asSystem, areSystemRoles } from './auth-context.js';

/**
 * @param {Object} options
 * @param {Array}  options.apiSpecs      - Loaded API documents, each with `serverBasePath`, `domain` and `doc`
 * @param {Array}  options.stateMachines - From `extract(docs, 'state-machines')`
 * @param {Array}  [options.slaTypes]    - From `extract(docs, 'sla-types')`, for an action a call runs
 * @param {Object} options.store
 * @returns {{ resolve: Function, apply: Function, perform: Function, settleCreated: Function, startClocksAt: Function, serve: Function, slaTypesFor: Function }}
 */
export function createStepCalls({ apiSpecs, stateMachines, slaTypes = [], store, docs = [] }) {
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
      follow: spec.resolve?.schema ?? ((x) => x),
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

  /** A resource's schema, and how to follow a `$ref` from it. */
  function schemaOf(resolved) {
    const schema = resolved.api.doc.content?.components?.schemas?.[resolved.resource.name];
    return { schema, follow: resolved.api.follow };
  }

  /**
   * A call's body with each null its route's request schema doesn't accept
   * left out (payload-fit.js): the create's, the update's or the action's, as
   * the API declares it at that method and path. A path no API declares is
   * left to fail where it's used.
   *
   * @param {string} method - POST, PATCH
   * @param {string} path - Interpolated, as for resolve
   * @param {Object} body
   * @returns {Object}
   */
  function fitBody(method, path, body) {
    let resolved;
    try { resolved = resolve(method, path); } catch { return body; }
    const at = resolved.kind === 'create' ? resolved.resource.path('collection')
      : resolved.kind === 'update' ? resolved.resource.path('item')
      : `${resolved.resource.path('item')}/${resolved.action}`;
    const schema = resolved.api.doc.content?.paths?.[at]?.[method.toLowerCase()]?.requestBody?.content?.['application/json']?.schema;
    return fitToSchema(body, schema, resolved.api.follow);
  }

  // The schema of each event's data, by its type, from the events documents.
  const eventData = new Map();
  for (const doc of docs.filter((d) => d.type === 'asyncapi')) {
    const resolveRef = resolverFor(doc, docs).schema;
    // An AsyncAPI multi-format schema holds the schema itself under `schema`,
    // and a message's may name a component that is one too.
    const follow = (node) => {
      let resolved = resolveRef(node);
      while (resolved && resolved.schemaFormat !== undefined && resolved.schema) resolved = resolveRef(resolved.schema);
      return resolved;
    };
    for (const entry of Object.values(doc.content?.components?.messages ?? {})) {
      const message = resolveRef(entry);
      if (!message?.name || !message.payload || eventData.has(message.name)) continue;
      // The envelope declares data too, as anything; the event narrows it.
      const declared = propertiesOf(message.payload, follow).filter((properties) => 'data' in properties).map((properties) => properties.data);
      if (declared.length > 0) eventData.set(message.name, { schema: { allOf: declared }, follow });
    }
  }

  /**
   * Where a machine's steps fill values in, the schemas each goes into, so a
   * null one doesn't accept is left out (payload-fit.js): a call's request
   * body, by method and path or by operationId; an event's data, by its type;
   * a field `set:` writes, on the machine's resource.
   *
   * @param {Object|null} machine - The machine whose steps run
   * @returns {{ body: Function, call: Function, event: Function, field: Function }}
   */
  function schemasFor(machine) {
    const entry = machine ? (stateMachines ?? []).find((e) => e.machine === machine) : null;
    const api = entry ? apis.find((a) => a.doc === entry.api) : null;
    const record = api && entry.resource?.name ? api.doc.content?.components?.schemas?.[entry.resource.name] : null;
    return {
      body: (method, path, body) => fitBody(method, path, body),
      call: (operationId, contentType, payload) => {
        const operation = operations.get(operationId);
        const media = operation?.bodies?.[contentType ?? 'application/json'];
        return media?.schema ? fitToSchema(payload, media.schema, operation.follow) : payload;
      },
      event: (type, data) => {
        const found = eventData.get(type);
        return found && data ? fitToSchema(data, found.schema, found.follow) : data;
      },
      field: (name, value) => (record ? name in fitToSchema({ [name]: value }, record, api.follow) : true),
    };
  }

  /**
   * Check a record against its resource's full schema, as the API would return
   * it — a related record the contract shows expanded is checked expanded —
   * and throw naming what is wrong.
   */
  function checkRecord(resolved, stored) {
    const { schema, follow } = schemaOf(resolved);
    if (!schema) return;
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
      const stored = store.create(collection, { ...body, ...resolved.params });
      try {
        checkRecord(resolved, stored);
      } catch (error) {
        store.deleteResource(collection, stored.id);
        throw error;
      }
      const record = startClocks(resolved, stored, now);
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
   * The call is sent through the mock's own routes, so the operation's
   * validation, the checks on a call a record carries, its guards' conditions
   * and refusing a duplicate apply as they would to a request. `runAs: caller`
   * makes it as whoever triggered the step, under their roles. `runAs:
   * system`, the default, makes it as the system: role matching is skipped,
   * and its events name the system as who acted, `causationid` linking them
   * to the event that caused the call. The request is marked as the system's
   * beside it (asSystem), which is what skips role matching. A caller whose
   * headers name the system's role acts as the system too, as a guard's actors
   * match it, but its roles are still matched.
   *
   * @param {{ operationId: string, parameters?: Array<{ name: string, in: string, value: * }>, requestBody?: { contentType?: string, payload?: * } }} call
   * @param {Object} options
   * @param {'system'|'caller'} [options.runAs]
   * @param {{ id: string|null, roles: string[] }} options.caller
   * @param {string|null} [options.traceparent]
   * @param {string|null} [options.causationid] - The event the call's own events name as their cause
   * @param {string|null} [options.idempotencyKey] - Sent as the Idempotency-Key when the operation requires one and the call has none
   * @returns {Promise<{ ok: boolean, status: number, body: * }>}
   */
  async function perform(call, { runAs = 'system', caller, traceparent = null, causationid = null, idempotencyKey = null } = {}) {
    const operation = operations.get(call.operationId);
    if (!operation) return failure(422, 'VALIDATION_ERROR', operations.whyNot(call.operationId));
    if (!fetchHere) return failure(500, 'INTERNAL_ERROR', 'The mock has no routes to send a call through yet.');

    const given = call.parameters ?? [];
    let path = operation.path;
    for (const p of given.filter((p) => p.in === 'path')) {
      path = path.replace(`{${p.name}}`, encodeURIComponent(String(p.value)));
    }
    const query = new URLSearchParams(given.filter((p) => p.in === 'query').map((p) => [p.name, String(p.value)]));
    const headers = { 'content-type': call.requestBody?.contentType ?? 'application/json' };
    for (const p of given.filter((p) => p.in === 'header')) headers[p.name] = String(p.value);
    // A stored call leaves out the Idempotency-Key its operation requires; the
    // one making the call supplies it (base/schemas/operations.yaml).
    const wantsKey = operation.parameters.some((p) => p.in === 'header' && p.name.toLowerCase() === 'idempotency-key');
    if (wantsKey && idempotencyKey && !Object.keys(headers).some((h) => h.toLowerCase() === 'idempotency-key')) {
      headers['Idempotency-Key'] = String(idempotencyKey);
    }
    // A caller who is the system — a call made as the caller from an action
    // the system ran — is the system here too.
    const system = runAs !== 'caller' || areSystemRoles(caller?.roles);
    if (system) {
      headers['x-caller-id'] = 'system';
    } else {
      if (caller?.id) headers['x-caller-id'] = caller.id;
      if (caller?.roles?.length) headers['x-caller-roles'] = caller.roles.join(',');
    }
    if (traceparent) headers.traceparent = traceparent;
    const payload = call.requestBody?.payload;
    const request = causedBy(new Request(`http://mock.internal${path}${query.size ? `?${query}` : ''}`, {
      method: operation.method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }), causationid);
    if (system) asSystem(request);

    const response = await fetchHere(request);
    const text = await response.text();
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { ok: response.ok, status: response.status, body };
  }

  /**
   * Start the SLA clocks of a record a step created, as a create through the
   * API does: when its resource has a state machine and its domain declares
   * SLA types.
   *
   * @param {Object} resolved - What the create's path means (resolve)
   * @param {Object} record - As stored
   * @param {string} [now]
   * @returns {Object} The record, with its slaInfo when clocks started
   */
  function startClocks(resolved, record, now) {
    if (!machineFor(resolved.api, resolved.resource)) return record;
    const slaInfo = startSlaClocks(record, slaTypesFor(resolved.api.domain), now ?? new Date().toISOString());
    if (!slaInfo) return record;
    const clocks = { slaInfo };
    // And its slaDeadline, where its schema declares one, as a create through
    // the API sets it.
    const { schema, follow } = schemaOf(resolved);
    if (propertiesOf(schema, follow).some((p) => 'slaDeadline' in p)) clocks.slaDeadline = earliestDeadline(slaInfo);
    return store.update(collectionOf(resolved.resource), record.id, clocks) ?? { ...record, ...clocks };
  }

  /**
   * Start the clocks of, and send the event a create through the API would
   * for, a record a step wrote directly, by the path it wrote to. A path no API
   * declares has no resource: neither happens.
   *
   * @param {string} path - The step's path, e.g. "decision-support/suggestions"
   * @param {Object} record - As stored
   * @param {Object} options - As for announceCreated
   * @returns {Object|null} The record as it now is, or null when the path names
   *   no resource an API serves, and so nothing was announced
   */
  function settleCreated(path, record, options = {}) {
    const started = startClocksAt(path, record, options.now);
    return announceCreated(path, started, options) ? started : null;
  }

  /** startClocks, for a record a step created by the path it wrote to. */
  function startClocksAt(path, record, now) {
    let resolved;
    try { resolved = resolve('POST', path); } catch { return record; }
    return resolved.kind === 'create' ? startClocks(resolved, record, now) : record;
  }

  /**
   * Send the event a create through the API would for a record a step wrote
   * directly: named for the resource the API serves at that path. A path no
   * API declares has no resource to name, so it sends none.
   *
   * @param {string} path - The step's path, e.g. "decision-support/suggestions"
   * @param {Object} record - As stored
   * @param {Object} options
   * @param {{ id: string|null, roles: string[] }} options.caller
   * @param {string|null} [options.traceparent]
   * @param {string|null} [options.causationid]
   * @param {string} [options.now]
   * @returns {boolean} Whether an event was sent
   */
  function announceCreated(path, record, { caller, traceparent = null, causationid = null, now } = {}) {
    let resolved;
    try { resolved = resolve('POST', path); } catch { return false; }
    if (resolved.kind !== 'create' || !resolved.resource.eventName) return false;
    emitEvent({
      store,
      domain: resolved.api.domain,
      object: resolved.resource.eventName,
      action: 'created',
      resourceId: record.id,
      source: `/${resolved.api.base.join('/')}`,
      data: { ...record },
      callerId: caller?.id ?? null,
      callerRoles: caller?.roles ?? [],
      traceparent,
      causationid,
      now,
    });
    return true;
  }

  /** Give perform the mock's fetch, once its routes are registered. */
  const serve = (fetch) => { fetchHere = fetch; };

  /** A domain's SLA types, for running one of its actions. */
  const slaTypesFor = (domain) => slaTypes.filter((s) => s.domain === domain).flatMap((s) => s.slaTypes ?? []);

  return { resolve, apply, perform, schemasFor, settleCreated, startClocksAt, serve, slaTypesFor };
}

/** An outcome that failed, in the shared Error shape. */
function failure(status, code, message, details) {
  return { ok: false, status, body: details ? { code, message, details } : { code, message } };
}
