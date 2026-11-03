/**
 * Editable compositions: one document a caller reads, and changes with a JSON
 * Patch (RFC 6902) — compositeType: editable in compositions-schema.yaml.
 *
 * The document is the root record under its key (`application`), and each
 * include beside it, keyed by record id, or a singleton as one record or
 * null. Each record reads as its own GET answers it.
 *
 * A patch is a wrapper over the records' own operations. It's applied to a
 * copy of the document; the copy is compared with the original record by
 * record; and each difference becomes a call to that record's operation —
 * create, update or delete — made as the caller, through the mock's routes,
 * so its validation, permissions, guards and events apply as they would to a
 * request. All of them succeed or none is kept: an undo log restores what the
 * changes before a refused one wrote, and their events are held until all are
 * saved, then sent in order.
 */

import { applyPatch } from 'rfc6902';
import { eventBus } from './event-bus.js';
import { openUndoLog } from './undo-log.js';
import { parentLinkRegistry } from './composition-assembler.js';
import { operationsOf } from './operation-calls.js';
import { validate } from './validator.js';
import { extractAuthContext, extractCallerRoles, callerHeader } from './auth-context.js';
import {
  extractExpandFields, applyExpand, extractLinksFields, applyLinks, extractDerivedFields, applyDerivedFields,
} from './handlers/expand-utils.js';

/**
 * What the mock needs about each resource a composition can name, by schema
 * name: where its records are stored, whether it's a singleton, its schema,
 * and the operations that create, update and delete one.
 *
 * @param {object[]} apiSpecs
 * @param {Map<string, string>} collectionOf - Schema name → storage collection
 * @returns {Map<string, object>}
 */
export function editableResources(apiSpecs, collectionOf) {
  const byRoute = new Map([...operationsOf(apiSpecs)].map(([id, op]) => [`${op.method} ${op.path}`, { id, ...op }]));
  const resources = new Map();
  for (const api of apiSpecs) {
    const model = api.doc?.model?.();
    if (!model) continue;
    const base = api.serverBasePath ?? '';
    for (const top of model.resources) {
      for (const resource of [top, ...top.singletons]) {
        if (!resource.name || resources.has(resource.name)) continue;
        const collectionPath = `${base}${resource.path('collection')}`;
        const itemPath = resource.path('item') ? `${base}${resource.path('item')}` : null;
        resources.set(resource.name, {
          api,
          singleton: resource.singleton,
          collection: collectionOf.get(resource.name) ?? null,
          itemParameter: resource.item.parameter,
          itemPath: itemPath ?? collectionPath,
          schema: api.doc.content?.components?.schemas?.[resource.name] ?? null,
          create: byRoute.get(`POST ${collectionPath}`) ?? null,
          update: byRoute.get(`PATCH ${resource.singleton ? collectionPath : itemPath}`) ?? null,
          remove: itemPath ? byRoute.get(`DELETE ${itemPath}`) ?? null : null,
        });
      }
    }
  }
  return resources;
}

/** The key the root record sits under: `application` for `Application`. */
export function rootKeyOf(composition) {
  return composition.resource.charAt(0).toLowerCase() + composition.resource.slice(1);
}

/** A stored record as its own GET answers with it. */
function present(record, info, store) {
  if (!record || !info?.schema) return record;
  const follow = info.api.resolve?.schema ?? ((x) => x);
  const schema = follow(info.schema);
  const lookup = (c, id) => store.findById(c, id);
  const expand = extractExpandFields(schema, follow);
  const links = extractLinksFields(schema, follow);
  const derived = extractDerivedFields(schema, follow);
  let out = expand.length > 0 ? applyExpand(record, expand, lookup) : record;
  if (links.length > 0) out = applyLinks(out, links, lookup);
  if (derived.length > 0) out = applyDerivedFields(out, derived);
  // Links to the compositions built around this record (parentLink), as its
  // own read adds them, the path's parameters filled from the record.
  const parentLinks = parentLinkRegistry.get(info.itemPath);
  if (parentLinks) {
    const fill = (href) => href.replace(/\{([^}]+)\}/g, (_, name) => (name === info.itemParameter ? record.id : record[name]) ?? `{${name}}`);
    out = { ...out, _links: Object.fromEntries(Object.entries(parentLinks).map(([key, link]) => [key, { href: fill(link.href) }])) };
  }
  return out;
}

/** The fields a record's GET adds or renames: they can't be changed. */
function shownOnly(info) {
  if (!info?.schema) return new Set();
  const follow = info.api.resolve?.schema ?? ((x) => x);
  const schema = follow(info.schema);
  // An expanded relationship and a derived field are read, never written;
  // links sit under _links.
  return new Set([
    ...extractExpandFields(schema, follow).map((f) => f.fieldName),
    ...extractDerivedFields(schema, follow).map((f) => f.fieldName),
    '_links',
  ]);
}

/**
 * Assemble an editable composition's document, or null when its root record
 * doesn't exist.
 */
export function assembleEditable(composition, params, { resources, store, primaryParam }) {
  const rootInfo = resources.get(composition.resource);
  const root = rootInfo?.collection ? store.findById(rootInfo.collection, params[primaryParam]) : null;
  if (!root) return null;
  const document = { [rootKeyOf(composition)]: present(root, rootInfo, store) };
  for (const [key, include] of Object.entries(composition.include ?? {})) {
    const info = resources.get(include.resource);
    const bind = typeof include.bind === 'string' ? include.bind : primaryParam;
    const { items } = info?.collection
      ? store.findAll(info.collection, { [bind]: params[bind] ?? params[primaryParam] }, { limit: null })
      : { items: [] };
    document[key] = info?.singleton
      ? (items[0] ? present(items[0], info, store) : null)
      : Object.fromEntries(items.map((item) => [item.id, present(item, info, store)]));
  }
  return document;
}

/** An error response, in the shared Error shape. */
function refusal(status, code, message, details) {
  return Response.json({ code, message, ...(details ? { details } : {}) }, { status });
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The top-level fields that differ, as an update body; a removed field is null. */
function changedFields(before, after) {
  const body = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!sameValue(before[key], after[key])) body[key] = key in after ? after[key] : null;
  }
  return body;
}

/** Whether a value holds a string anywhere inside it. */
function mentions(value, id) {
  if (value === id) return true;
  if (value && typeof value === 'object') return Object.values(value).some((v) => mentions(v, id));
  return false;
}

/**
 * The calls a patch amounts to, in the order to make them: creates first, a
 * record after any new one it names; then updates; then deletes. Returns a
 * refusal instead when a change can't be made through any operation.
 */
function plan(composition, before, after, { resources, params, primaryParam }) {
  const steps = [];
  const refuse = (path, message) => ({ refused: refusal(422, 'VALIDATION_ERROR', message, [{ field: path, message }]) });
  const rootKey = rootKeyOf(composition);

  for (const key of Object.keys(after)) {
    if (key !== rootKey && !(key in (composition.include ?? {}))) return refuse(`/${key}`, `${key} isn't part of this composition.`);
  }

  // The root record.
  const rootInfo = resources.get(composition.resource);
  if (!after[rootKey] || typeof after[rootKey] !== 'object') return refuse(`/${rootKey}`, `${rootKey} can't be removed.`);
  const rootChange = changedFields(before[rootKey], after[rootKey]);
  if (Object.keys(rootChange).length > 0) {
    const fixed = Object.keys(rootChange).find((f) => f === 'id' || shownOnly(rootInfo).has(f));
    if (fixed) return refuse(`/${rootKey}/${fixed}`, `${fixed} can't be changed through this composition.`);
    if (!rootInfo?.update) return refuse(`/${rootKey}`, `${composition.resource} has no update operation.`);
    steps.push({ kind: 'update', path: `/${rootKey}`, operation: rootInfo.update, ids: { [rootInfo.itemParameter]: params[primaryParam] }, body: rootChange });
  }

  const creates = [];
  for (const [key, include] of Object.entries(composition.include ?? {})) {
    const info = resources.get(include.resource);
    const bind = typeof include.bind === 'string' ? include.bind : primaryParam;
    const hidden = shownOnly(info);

    if (info?.singleton) {
      const was = before[key];
      const now = after[key];
      if ((was === null) !== (now === null)) return refuse(`/${key}`, `${include.resource} is a singleton: it can be changed, not added or removed.`);
      if (was === null) continue;
      const change = changedFields(was, now);
      if (Object.keys(change).length === 0) continue;
      const fixed = Object.keys(change).find((f) => f === 'id' || f === bind || hidden.has(f));
      if (fixed) return refuse(`/${key}/${fixed}`, `${fixed} can't be changed through this composition.`);
      if (!info.update) return refuse(`/${key}`, `${include.resource} has no update operation.`);
      steps.push({ kind: 'update', path: `/${key}`, operation: info.update, ids: {}, body: change });
      continue;
    }

    const was = before[key] ?? {};
    const now = after[key];
    if (!now || typeof now !== 'object' || Array.isArray(now)) return refuse(`/${key}`, `${key} must stay an object of records keyed by id.`);

    for (const [id, record] of Object.entries(now)) {
      const path = `/${key}/${id}`;
      if (!record || typeof record !== 'object') return refuse(path, 'A record must be an object.');
      if ('id' in record && record.id !== id) return refuse(`${path}/id`, 'A record\'s id must match its key.');
      if (bind in record && record[bind] !== params[bind]) return refuse(`${path}/${bind}`, `${bind} can't move a record to another ${composition.resource}.`);
      if (!(id in was)) {
        if (!info?.create) return refuse(path, `${include.resource} has no create operation.`);
        const fixed = Object.keys(record).find((f) => hidden.has(f));
        if (fixed) return refuse(`${path}/${fixed}`, `${fixed} is shown, not stored, and can't be written.`);
        const { [bind]: _bound, ...body } = record;
        creates.push({ kind: 'create', path, operation: info.create, ids: {}, body: { ...body, id } });
        continue;
      }
      const change = changedFields(was[id], record);
      if (Object.keys(change).length === 0) continue;
      const fixed = Object.keys(change).find((f) => f === 'id' || f === bind || hidden.has(f));
      if (fixed) return refuse(`${path}/${fixed}`, `${fixed} can't be changed through this composition.`);
      if (!info?.update) return refuse(path, `${include.resource} has no update operation.`);
      steps.push({ kind: 'update', path, operation: info.update, ids: { [info.itemParameter]: id }, body: change });
    }
    for (const id of Object.keys(was)) {
      if (id in now) continue;
      if (!info?.remove) return refuse(`/${key}/${id}`, `${include.resource} has no delete operation.`);
      steps.push({ kind: 'remove', path: `/${key}/${id}`, operation: info.remove, ids: { [info.itemParameter]: id } });
    }
  }

  // Creates first, each after any new record it names.
  const ordered = [];
  const pending = [...creates];
  while (pending.length > 0) {
    const ready = pending.findIndex((c) => !pending.some((other) => other !== c && mentions(c.body, other.body.id)));
    if (ready === -1) return refuse(pending[0].path, 'New records that name each other can\'t be created in one patch. Create one, then add the other\'s reference in another patch.');
    ordered.push(...pending.splice(ready, 1));
  }
  return { steps: [...ordered, ...steps.filter((s) => s.kind === 'update'), ...steps.filter((s) => s.kind === 'remove')] };
}

// Each editable composition by its update's operationId, for checking a
// suggestion whose call is a patch to one.
const byOperation = new Map();

/** Forget the compositions a previous server registered. */
export function clearEditableOperations() {
  byOperation.clear();
}

/**
 * Remember an editable composition under its update's operationId.
 *
 * @param {string} operationId
 * @param {object} composition
 * @param {object} options - As createEditablePatchHandler takes them
 */
export function registerEditableOperation(operationId, composition, options) {
  byOperation.set(operationId, { composition, options });
}

/**
 * What a patch would do to an editable composition as it is now, saving
 * nothing: the document before and after, and the calls the patch becomes.
 * Refused as the composition's PATCH refuses it, except that a failed `test`
 * is told apart (409) from a path that names nothing (422).
 *
 * @param {string} operationId - The composition's update
 * @param {object} params - Its path parameters, by name
 * @param {object[]} patch
 * @returns {Promise<{ before: object, after: object, steps: object[], store: object } | { refused: { status: number, body: object } } | null>}
 *   Null when no editable composition has that update.
 */
export async function previewPatch(operationId, params, patch) {
  const registered = byOperation.get(operationId);
  if (!registered) return null;
  const { composition, options } = registered;
  const no = (status, code, message, details) => ({ refused: { status, body: { code, message, ...(details ? { details } : {}) } } });

  const before = assembleEditable(composition, params, options);
  if (!before) return no(422, 'VALIDATION_ERROR', `No ${composition.resource} has the id "${params[options.primaryParam]}".`);

  const after = structuredClone(before);
  const results = applyPatch(after, patch);
  const i = results.findIndex(Boolean);
  if (i >= 0) {
    const error = results[i];
    // A test of a path that isn't there names nothing; one of a value that
    // changed is a conflict.
    const tested = patch[i].path.split('/').slice(1).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), after);
    return error.name === 'TestError' && tested !== undefined
      ? no(409, 'CONFLICT', `A test failed: the data changed since it was read. ${error.message}`, [{ index: i, field: patch[i].path, message: error.message }])
      : no(422, 'VALIDATION_ERROR', `The patch names something the composition doesn't have: ${error.message}`, [{ index: i, field: patch[i].path, message: error.message }]);
  }

  const planned = plan(composition, before, after, { ...options, params });
  if (planned.refused) return { refused: { status: planned.refused.status, body: await planned.refused.json() } };
  // Each step as the ordinary call it becomes, so it's checked the way any
  // suggestion's call is.
  const steps = planned.steps.map((step) => ({ ...step, call: callFor(step, params) }));
  return { before, after, steps, store: options.store };
}

/** The OperationCall a step makes, its path parameters filled in. */
function callFor(step, params) {
  const values = { ...params, ...step.ids };
  const names = [...step.operation.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return {
    operationId: step.operation.id,
    parameters: names.map((name) => ({ name, in: 'path', value: values[name] })),
    ...(step.body !== undefined ? { requestBody: { payload: step.body } } : {}),
  };
}

/** The status a patch answers with when one of its changes is refused. */
function statusFor(status) {
  if (status === 404) return 409; // names a record that isn't there any more
  if (status === 403 || status === 409 || status === 422) return status;
  if (status >= 400 && status < 500) return 422;
  return status;
}

/**
 * Handle PATCH on an editable composition.
 *
 * `requestSchema` is where the generated operation's request body schema is
 * declared: the document's relative path and the ref, as the contract writes
 * it.
 *
 * @returns {(request: Request, ctx: { params: object }) => Promise<Response>}
 */
export function createEditablePatchHandler(composition, { resources, store, stepCalls, primaryParam, requestSchema }) {
  return async (request, { params }) => {
    const type = (callerHeader(request, 'content-type') ?? '').split(';')[0].trim();
    if (type !== 'application/json-patch+json') {
      return refusal(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the patch as application/json-patch+json.');
    }
    let patch;
    try { patch = await request.json(); } catch {
      return refusal(400, 'BAD_REQUEST', 'The body is not JSON.');
    }
    // Checked against the schema the operation's request body names in the
    // contract (JsonPatch, in the base contracts), as the document declares it.
    const { valid, errors } = validate(patch, requestSchema.schema, `${requestSchema.relativePath}-patch`, requestSchema);
    if (!valid) {
      return refusal(400, 'BAD_REQUEST', 'The body is not a JSON Patch.', errors.map((e) => ({ field: e.field || 'body', message: e.message })));
    }

    const before = assembleEditable(composition, params, { resources, store, primaryParam });
    if (!before) return refusal(404, 'NOT_FOUND', `${composition.resource} not found.`);

    const after = structuredClone(before);
    const failed = applyPatch(after, patch).map((error, i) => ({ error, i })).find(({ error }) => error);
    if (failed) {
      return refusal(409, 'CONFLICT', `The patch doesn't apply to the document as it is now: ${failed.error.message}`,
        [{ field: patch[failed.i].path, message: failed.error.message }]);
    }

    const planned = plan(composition, before, after, { resources, params, primaryParam });
    if (planned.refused) return planned.refused;

    const caller = { id: extractAuthContext(request).userId ?? null, roles: extractCallerRoles(request) };
    const patchId = crypto.randomUUID();
    const events = eventBus.hold((event) => event?.causationid === patchId);
    const undo = openUndoLog(store);
    for (const step of planned.steps) {
      const result = await stepCalls.perform(callFor(step, params), {
        runAs: 'caller', caller, causationid: patchId, traceparent: callerHeader(request, 'traceparent'),
      });
      if (!result.ok) {
        undo.rollback();
        events.discard();
        const cause = result.body && typeof result.body === 'object' ? result.body : { message: String(result.body ?? '') };
        return refusal(statusFor(result.status), cause.code ?? 'VALIDATION_ERROR',
          `The change at ${step.path} was refused, so nothing was saved: ${cause.message ?? `status ${result.status}`}`,
          [{ field: step.path, message: cause.message ?? '', ...(cause.details ? { details: cause.details } : {}) }]);
      }
    }
    undo.commit();
    events.release();
    return Response.json(assembleEditable(composition, params, { resources, store, primaryParam }));
  };
}
