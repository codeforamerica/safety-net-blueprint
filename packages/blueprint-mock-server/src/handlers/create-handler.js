/**
 * Handler for POST /resources (store.create)
 */

import { validate, createErrorResponse } from '../validator.js';
import { hasConfigManagedResources } from '../config-registry.js';
import { applyEffects, applySteps } from '../state-machine-engine.js';
import { initializeSlaInfo } from '../sla-engine.js';
import { executeProcedures, resolveContextLayers } from './procedure-runner.js';
import { mergeByPrecedence, buildInlineRules } from '../collection-utils.js';
import { emitEvent } from '../emit-event.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { extractCallerRoles, callerHeader } from '../auth-context.js';
import { extractExpandFields, applyExpand, extractLinksFields, applyLinks, extractDerivedFields, applyDerivedFields } from './expand-utils.js';
import { assertFetchShaped, readJsonBody } from '../http/request.js';


/**
 * Create store.create handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @param {string} baseUrl - Base URL for Location header
 * @param {Object|null} stateMachine - State machine contract (null for APIs without one)
 * @returns {(request: Request, ctx: object) => Promise<Response>}
 */
export function createCreateHandler(apiMetadata, endpoint, baseUrl, stateMachine, slaTypes = [], machine = null, { store } = {}, options = {}) {
  return async (request, ctx = {}) => {
    const { params = {}, enrichmentData, body: bodyOverride } = ctx;
    const { pathname } = new URL(assertFetchShaped(request, 'createCreateHandler').url);
    try {
      // HTTP stub intercept — if a stub is registered for this method + path, return it
      // before normal processing. Used in tests to simulate adapter responses.
      const httpStub = matchAndPopHttp(request.method, pathname);
      if (httpStub) {
        return Response.json(httpStub.response?.body ?? {}, { status: httpStub.response?.status ?? 200 });
      }

      // A sub-resource POST passes its parent path params already merged in.
      const requestBody = bodyOverride !== undefined ? bodyOverride : (await readJsonBody(request)).value;

      // Check if request body is an object (400 for malformed request)
      if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
        return Response.json({
          code: 'BAD_REQUEST',
          message: 'Request body must be a JSON object',
          details: [{ field: 'body', message: 'must be object' }]
        }, { status: 400 });
      }

      // Validate request body (422 for validation errors)
      if (endpoint.requestSchema) {
        const { valid, errors } = validate(
          requestBody,
          endpoint.requestSchema,
          `${endpoint.collectionName}-create`,
          { relativePath: apiMetadata.relativePath, ref: endpoint.requestSchemaRef }
        );

        if (!valid) {
          return Response.json(createErrorResponse(errors, 422), { status: 422 });
        }
      }

      // Merge enrichment data (catalog-derived fields, path params for sub-resources)
      const mergedBody = enrichmentData ? { ...requestBody, ...enrichmentData } : requestBody;

      // Optional non-nullable fields not provided in the request body are intentionally
      // omitted from the stored record (absent ≠ null per OpenAPI 3.1).
      // Required-nullable defaults (null) and required-array defaults ([]) are applied
      // at the database layer via registerCollectionDefaults / extractRequiredDefaults.
      const createData = mergedBody;

      const resource = store.create(endpoint.collectionName, createData);

      // Mark runtime-created resources as user-sourced when the collection
      // also has config-managed (system) entries, so consumers can distinguish them
      if (hasConfigManagedResources(endpoint.collectionName)) {
        resource.source = 'user';
        store.update(endpoint.collectionName, resource.id, { source: 'user' });
      }

      // Apply initial state from state machine if no status was supplied in the body.
      // New format: machine.initialState; old format: stateMachine.initialState
      const initialState = machine?.initialState ?? stateMachine?.initialState;
      if (initialState && !resource.status) {
        resource.status = initialState;
        store.update(endpoint.collectionName, resource.id, { status: initialState });
      }


      const callerId = callerHeader(request, 'x-caller-id');
      const now = new Date().toISOString();
      const traceparent = callerHeader(request, 'traceparent');
      // A spec with no localhost server URL has no domain prefix, and
      // prefixing with an empty string produced ".application.created" — a
      // malformed CloudEvents type with a leading dot. Better to emit an
      // unprefixed type than a broken one (#448).
      const domain = (apiMetadata.serverBasePath ?? '').replace(/^\//, '');
      const object = endpoint.collectionName.replace(/s$/, '');

      const onCreate = machine?.triggers?.onCreate ?? stateMachine?.onCreate;

      // Execute onCreate steps/effects if this resource has a state machine
      if (onCreate) {
        const callerRoles = extractCallerRoles(request);

        // Enforce onCreate actors if defined
        if (onCreate.actors && onCreate.actors.length > 0) {
          if (!callerRoles.some(r => onCreate.actors.includes(r))) {
            return Response.json({
              code: 'FORBIDDEN',
              message: `Creating this resource requires one of the following roles: ${onCreate.actors.join(', ')}`
            }, { status: 403 });
          }
        }

        // Snapshot before any steps/effects mutate resource (for DB diff later)
        const original = JSON.parse(JSON.stringify(resource));

        const baseContext = {
          caller: { id: callerId, roles: callerRoles },
          object: { ...resource },
          request: requestBody,
          now
        };

        const entities = resolveContextLayers(
          [stateMachine?.context, machine?.context, onCreate?.context],
          resource,
          baseContext,
          store
        );
        if (entities === null) {
          console.error('onCreate: required context binding failed — skipping trigger');
          return Response.json({ code: 'INTERNAL_ERROR', message: 'Context binding failed', details: [] }, { status: 500 });
        }
        const context = { ...baseContext, entities };

        const { pendingCreates, pendingProcedures } = onCreate.steps?.length > 0
          ? applySteps(onCreate.steps, resource, context, store)
          : applyEffects(onCreate.effects || [], resource, context);

        const inlineRules = buildInlineRules(stateMachine, machine);
        executeProcedures(pendingProcedures, resource, inlineRules, context, store);

        // Execute pending creates
        for (const { entity, data } of pendingCreates) {
          try {
            store.create(entity, data);
          } catch (createError) {
            console.error(`Failed to store.create ${entity}:`, createError.message);
          }
        }

        // Initialize SLA info if SLA types are configured
        if (slaTypes.length > 0) {
          initializeSlaInfo(resource, slaTypes, now);
        }

        // Persist rule-driven and SLA mutations back to DB
        const diff = {};
        for (const [key, value] of Object.entries(resource)) {
          if (original[key] !== value && key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
            diff[key] = value;
          }
        }

        if (Object.keys(diff).length > 0) {
          store.update(endpoint.collectionName, resource.id, diff);
          // Refresh resource with updated timestamps
          Object.assign(resource, diff);
        }
      }

      // Auto-emit created event with full resource snapshot (after effects applied)
      const callerRoles = extractCallerRoles(request);
      try {
        emitEvent({
        store,
          domain,
          object,
          action: 'created',
          resourceId: resource.id,
          source: apiMetadata.serverBasePath,
          data: { ...resource },
          callerId,
          callerRoles,
          traceparent,
          now,
        });
      } catch (eventError) {
        console.error('Failed to emit created event:', eventError.message);
      }

      // Build Location header — use the request path (actual URL) rather than
      // endpoint.path, so sub-resource POSTs like /applications/app-123/documents
      // get the right URL.
      const location = `${baseUrl}${pathname}/${resource.id}`;

      // Re-read from DB so the response reflects any mutations made by event subscriptions
      // (e.g. assignToQueue running synchronously in response to the created event)
      const fresh = store.findById(endpoint.collectionName, resource.id) || resource;

      // Apply x-relationship expand, links-only, and x-derived transformations (same as GET handler)
      const expandFields = extractExpandFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
      const linksFields = extractLinksFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
      const derivedFields = extractDerivedFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
      let responseBody = expandFields.length > 0 ? applyExpand(fresh, expandFields, store.findById) : fresh;
      if (linksFields.length > 0) responseBody = applyLinks(responseBody, linksFields, apiMetadata.serverBasePath);
      if (derivedFields.length > 0) responseBody = applyDerivedFields(responseBody, derivedFields);

      return Response.json(responseBody, { status: 201, headers: { Location: location } });
    } catch (error) {
      console.error('Create handler error:', error);

      // Handle unique constraint violations
      if (error.message?.includes('UNIQUE constraint')) {
        return Response.json({
          code: 'CONFLICT',
          message: 'A resource with this identifier already exists'
        }, { status: 409 });
      }

      return Response.json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      }, { status: 500 });
    }
  };
}
