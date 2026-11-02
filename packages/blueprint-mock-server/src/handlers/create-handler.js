/**
 * Handler for POST /resources (store.create)
 */

import { validate, createErrorResponse } from '../validator.js';
import { hasConfigManagedResources } from '../config-registry.js';
import { eventDomainOf } from '../collection-utils.js';
import { startSlaClocks } from '../sla-engine.js';
import { emitEvent } from '../emit-event.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { extractCallerRoles, callerHeader, traceparentOf, causationOf } from '../auth-context.js';
import { extractExpandFields, applyExpand, extractLinksFields, applyLinks, extractDerivedFields, applyDerivedFields } from './expand-utils.js';
import { assertFetchShaped, readJsonBody } from '../http/request.js';
import { missingReferences, parentsOf } from '../references.js';
import { callsIn, callProblems } from '../operation-calls.js';
import { makesSuggestions, fingerprintOf, repeated } from '../suggestion-fingerprints.js';


/**
 * Create store.create handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @param {string} baseUrl - Base URL for Location header
 * @param {Object|null} stateMachine - State machine contract (null for APIs without one)
 * @returns {(request: Request, ctx: object) => Promise<Response>}
 */
export function createCreateHandler(apiMetadata, endpoint, baseUrl, stateMachine, slaTypes = [], machine = null, { store, operations } = {}, options = {}) {
  // The resource created, in the API's model, for the records it's made under.
  const model = apiMetadata.doc?.model?.();
  const written = model?.resources.find((r) => r.name && r.name === endpoint.resource?.name);
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

      // A POST to a path with no list and no item is a call, not a create — an
      // adapter's evaluate endpoint, say. The mock cannot work out its answer
      // and keeps nothing for it; a stub stands in for it.
      if (endpoint.isCall) {
        return Response.json({
          code: 'NOT_IMPLEMENTED',
          message: `${request.method} ${pathname} is a call the mock cannot answer itself. Register an HTTP stub for it: POST /mock/stubs/http with match { method: "${request.method}", url: "${pathname}" }.`,
        }, { status: 501 });
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

      // A caller may choose the new record's id, but not one another record has.
      if (requestBody.id !== undefined && store.findById(endpoint.collectionName, requestBody.id)) {
        return Response.json({
          code: 'CONFLICT',
          message: `Another record already has the id ${requestBody.id}.`,
          details: [{ field: 'id', message: 'already in use' }],
        }, { status: 409 });
      }

      // An id that names no record is refused, like any other invalid value.
      const missing = missingReferences(requestBody, endpoint.requestSchema, apiMetadata.resolve?.schema, store, {
        parents: parentsOf(written, params), resources: model?.resources, schemas: apiMetadata.schemas,
      });
      if (missing.length > 0) {
        return Response.json(createErrorResponse(missing, 422), { status: 422 });
      }

      // A call it carries — a suggestion's proposed change — must be one the
      // operation it names would accept.
      const wrongCalls = callsIn(requestBody, endpoint.requestSchema, apiMetadata.resolve?.schema)
        .flatMap((found) => callProblems(found, operations ?? new Map()));
      if (wrongCalls.length > 0) {
        return Response.json(createErrorResponse(wrongCalls, 422), { status: 422 });
      }

      // A suggestion repeating one still open, or dismissed, is refused.
      let fingerprint;
      if (makesSuggestions(apiMetadata, endpoint)) {
        fingerprint = await fingerprintOf(requestBody);
        const existing = repeated(store, endpoint.collectionName, fingerprint);
        if (existing) {
          return Response.json({
            code: 'CONFLICT',
            message: `This repeats suggestion ${existing.id}, which is ${existing.status}.`,
            details: [{ id: existing.id, status: existing.status }],
          }, { status: 409 });
        }
      }

      // Merge enrichment data (catalog-derived fields, path params for sub-resources)
      const mergedBody = {
        ...requestBody,
        ...(enrichmentData ?? {}),
        ...(fingerprint ? { fingerprint } : {}),
      };

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

      // Its SLA clocks start now, before its created event carries it.
      const slaInfo = startSlaClocks(resource, slaTypes, now);
      if (slaInfo) {
        resource.slaInfo = slaInfo;
        store.update(endpoint.collectionName, resource.id, { slaInfo });
      }
      const traceparent = traceparentOf(request);
      // Named for the domain as declared and the resource the create acts on:
      // `intake.application_member.created`. A path that is no resource's
      // emits none.
      const domain = eventDomainOf(apiMetadata);
      const object = endpoint.resource?.eventName ?? null;

      // The created event, with the record as stored
      const callerRoles = extractCallerRoles(request);
      if (object) try {
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
          causationid: causationOf(request),
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
      if (linksFields.length > 0) responseBody = applyLinks(responseBody, linksFields, (c, id) => store.findById(c, id));
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
