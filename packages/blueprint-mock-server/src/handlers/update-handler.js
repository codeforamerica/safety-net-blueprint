/**
 * Handler for PATCH /resources/{id} (store.update)
 */

import { validate, createErrorResponse } from '../validator.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { extractPrimaryParam, capitalize, eventDomainOf } from '../collection-utils.js';
import { emitEvent } from '../emit-event.js';
import { extractAuthContext, extractCallerRoles, callerHeader, traceparentOf, causationOf } from '../auth-context.js';
import { extractExpandFields, applyExpand, extractLinksFields, applyLinks, extractDerivedFields, applyDerivedFields } from './expand-utils.js';
import { assertFetchShaped, readJsonBody } from '../http/request.js';
import { missingReferences, parentsOf } from '../references.js';

export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object' && !Array.isArray(a)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

export function buildChanges(before, after) {
  const excluded = new Set(['id', 'createdAt', 'updatedAt']);
  const changes = [];

  function diffPaths(b, a, prefix) {
    const allKeys = new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})]);
    for (const key of allKeys) {
      if (!prefix && excluded.has(key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const beforeVal = b?.[key] ?? null;
      const afterVal = a?.[key] ?? null;
      if (deepEqual(beforeVal, afterVal)) continue;
      if (beforeVal && afterVal && typeof beforeVal === 'object' && !Array.isArray(beforeVal)
          && typeof afterVal === 'object' && !Array.isArray(afterVal)) {
        diffPaths(beforeVal, afterVal, path);
      } else {
        changes.push({ field: path, before: beforeVal, after: afterVal });
      }
    }
  }

  diffPaths(before, after, '');
  return changes;
}

/**
 * Create store.update handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @param {Object|null} stateMachine - State machine contract
 * @returns {(request: Request, ctx: object) => Promise<Response>}
 */
export function createUpdateHandler(apiMetadata, endpoint, stateMachine = null, slaTypes = [], machine = null, { store } = {}) {
  const paramName = extractPrimaryParam(endpoint.path) ?? 'id';
  // The resource updated, in the API's model, for the records it's under.
  const model = apiMetadata.doc?.model?.();
  const written = model?.resources.find((r) => r.name && r.name === endpoint.resource?.name);
  return async (request, ctx = {}) => {
    const { params = {}, body: bodyOverride } = ctx;
    const { pathname } = new URL(assertFetchShaped(request, 'createUpdateHandler').url);
    try {
      const httpStub = matchAndPopHttp(request.method, pathname);
      if (httpStub) {
        return Response.json(httpStub.response?.body ?? {}, { status: httpStub.response?.status ?? 200 });
      }

      const requestBody = bodyOverride !== undefined ? bodyOverride : (await readJsonBody(request)).value;

      let resourceId = params[paramName] || params.id;

      if (resourceId === 'me') {
        const auth = extractAuthContext(request);
        if (!auth) {
          return Response.json({
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }, { status: 401 });
        }
        resourceId = auth.userId;
      }

      // Check if resource exists
      const existing = store.findById(endpoint.collectionName, resourceId);
      if (!existing) {
        return Response.json({
          code: 'NOT_FOUND',
          message: `${capitalize(paramName.replace(/Id$/, ''))} not found`
        }, { status: 404 });
      }

      // Check if request body is an object (400 for malformed request)
      if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
        return Response.json({
          code: 'BAD_REQUEST',
          message: 'Request body must be a JSON object',
          details: [{ field: 'body', message: 'must be object' }]
        }, { status: 400 });
      }

      // Check minProperties requirement for PATCH (at least 1 field)
      if (Object.keys(requestBody).length === 0) {
        return Response.json({
          code: 'BAD_REQUEST',
          message: 'Request body must contain at least one field to update',
          details: [{ field: 'body', message: 'minProperties: 1' }]
        }, { status: 400 });
      }

      // For PATCH, merge with existing data first, then validate the complete merged object.
      // Exclude null values for fields the client didn't send — those are null-initialized
      // placeholders from record creation and should not trigger validation failures.
      const mergedData = { ...existing, ...requestBody };

      // Validate merged data (422 for validation errors)
      if (endpoint.requestSchema) {
        const clientFields = new Set(Object.keys(requestBody));
        const dataForValidation = Object.fromEntries(
          Object.entries(mergedData).filter(([k, v]) => v !== null || clientFields.has(k))
        );
        const { valid, errors } = validate(
          dataForValidation,
          endpoint.requestSchema,
          `${endpoint.collectionName}-update`,
          { relativePath: apiMetadata.relativePath, ref: endpoint.requestSchemaRef }
        );

        if (!valid) {
          return Response.json(createErrorResponse(errors, 422), { status: 422 });
        }
      }

      // Only the ids the client sent: one already stored was checked when it was written.
      const missing = missingReferences(requestBody, endpoint.requestSchema, apiMetadata.resolve?.schema, store, {
        parents: parentsOf(written, params), resources: model?.resources, schemas: apiMetadata.schemas,
      });
      if (missing.length > 0) {
        return Response.json(createErrorResponse(missing, 422), { status: 422 });
      }

      // Snapshot existing state before any mutations
      const existingSnapshot = { ...existing };

      // Update in database (database manager handles deep merge and updatedAt timestamp)
      const updated = store.update(endpoint.collectionName, resourceId, requestBody);

      // The fields this update changed, for its event
      const changes = buildChanges(existingSnapshot, updated);

      // Emit updated event with complete field-level diff
      if (endpoint.resource) try {
        const domain = eventDomainOf(apiMetadata);
        const object = endpoint.resource.eventName;
        emitEvent({
        store,
          domain,
          object,
          action: 'updated',
          resourceId,
          source: apiMetadata.serverBasePath,
          data: { changes },
          callerId: callerHeader(request, 'x-caller-id'),
          callerRoles: extractCallerRoles(request),
          traceparent: traceparentOf(request),
          causationid: causationOf(request),
          now: updated.updatedAt,
        });
      } catch (eventError) {
        console.error('Failed to emit updated event:', eventError.message);
      }

      const expandFields = extractExpandFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
      const linksFields = extractLinksFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
      const derivedFields = extractDerivedFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
      let responseBody = expandFields.length > 0 ? applyExpand(updated, expandFields, store.findById) : updated;
      if (linksFields.length > 0) responseBody = applyLinks(responseBody, linksFields, (c, id) => store.findById(c, id));
      if (derivedFields.length > 0) responseBody = applyDerivedFields(responseBody, derivedFields);
      return Response.json(responseBody);
    } catch (error) {
      console.error('Update handler error:', error);
      return Response.json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      }, { status: 500 });
    }
  };
}

