/**
 * Handler for PATCH /resources/{id} (store.update)
 */

import { validate, createErrorResponse } from '../validator.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { applyEffects, applySteps } from '../state-machine-engine.js';
import { executeProcedures, resolveContextLayers } from './procedure-runner.js';
import { mergeByPrecedence, buildInlineRules, extractPrimaryParam, capitalize } from '../collection-utils.js';
import { emitEvent } from '../emit-event.js';
import { extractAuthContext, extractCallerRoles, callerHeader } from '../auth-context.js';
import { extractExpandFields, applyExpand, extractLinksFields, applyLinks, extractDerivedFields, applyDerivedFields } from './expand-utils.js';
import { assertFetchShaped, readJsonBody } from '../http/request.js';

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
 * @param {Object|null} stateMachine - State machine contract (for onUpdate effects)
 * @returns {(request: Request, ctx: object) => Promise<Response>}
 */
export function createUpdateHandler(apiMetadata, endpoint, stateMachine = null, slaTypes = [], machine = null, { store } = {}) {
  const paramName = extractPrimaryParam(endpoint.path) ?? 'id';
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

      // Snapshot existing state before any mutations
      const existingSnapshot = { ...existing };

      // Update in database (database manager handles deep merge and updatedAt timestamp)
      const updated = store.update(endpoint.collectionName, resourceId, requestBody);

      // Fire onUpdate steps/effects if any watched fields changed.
      // Must run before emitting so rule-driven mutations (e.g. priority re-scored
      // because isExpedited changed) are included in the event's changes array.
      const onUpdate = machine?.triggers?.onUpdate ?? stateMachine?.onUpdate;
      const hasOnUpdate = onUpdate?.steps?.length > 0 || onUpdate?.effects?.length > 0;

      if (hasOnUpdate) {
        const watchedFields = onUpdate?.fields;
        const patchedFields = Object.keys(requestBody);
        const shouldFire = !watchedFields || watchedFields.length === 0
          || patchedFields.some(f => watchedFields.includes(f));

        if (shouldFire) {
          const callerRoles = extractCallerRoles(request);
          const baseContext = {
            caller: {
              id: callerHeader(request, 'x-caller-id'),
              roles: callerRoles
            },
            object: { ...existing },
            request: requestBody,
            now: new Date().toISOString(),
          };

          const entities = resolveContextLayers(
            [stateMachine?.context, machine?.context, onUpdate?.context],
            updated,
            baseContext,
            store
          );
          if (entities === null) {
            console.error('onUpdate: required context binding failed — skipping trigger');
          }
          const context = entities !== null ? { ...baseContext, entities } : baseContext;

          let pendingProcedures;
          if (onUpdate?.steps?.length > 0) {
            ({ pendingProcedures } = applySteps(onUpdate.steps, updated, context, store));
          } else {
            ({ pendingProcedures } = applyEffects(onUpdate.effects, updated, context));
          }
          const inlineRules = buildInlineRules(stateMachine, machine);
          executeProcedures(pendingProcedures, updated, inlineRules, context, store);

          // Persist any rule-driven mutations (e.g. priority, queueId) back to DB
          const onUpdateDiff = {};
          for (const [key, value] of Object.entries(updated)) {
            if (existingSnapshot[key] !== value && !Object.prototype.hasOwnProperty.call(requestBody, key)
                && key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
              onUpdateDiff[key] = value;
            }
          }
          if (Object.keys(onUpdateDiff).length > 0) {
            store.update(endpoint.collectionName, resourceId, onUpdateDiff);
          }
        }
      }

      // Build changes diff after all mutations have settled (PATCH fields + any rule-driven mutations)
      const changes = buildChanges(existingSnapshot, updated);

      // Emit updated event with complete field-level diff
      try {
        const domain = (apiMetadata.serverBasePath ?? '').replace(/^\//, '');
        const object = endpoint.collectionName.replace(/s$/, '');
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
          traceparent: callerHeader(request, 'traceparent'),
          now: updated.updatedAt,
        });
      } catch (eventError) {
        console.error('Failed to emit updated event:', eventError.message);
      }

      const expandFields = extractExpandFields(endpoint.responseSchema);
      const linksFields = extractLinksFields(endpoint.responseSchema);
      const derivedFields = extractDerivedFields(endpoint.responseSchema);
      let responseBody = expandFields.length > 0 ? applyExpand(updated, expandFields, store.findById) : updated;
      if (linksFields.length > 0) responseBody = applyLinks(responseBody, linksFields, apiMetadata.serverBasePath);
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

