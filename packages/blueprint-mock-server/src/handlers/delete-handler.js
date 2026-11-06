/**
 * Handler for DELETE /resources/{id}
 */

import { emitEvent } from '../emit-event.js';
import { isConfigManaged } from '../config-registry.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { extractPrimaryParam, capitalize, eventDomainOf } from '../collection-utils.js';
import { extractCallerRoles, callerHeader, traceparentOf, causationOf } from '../auth-context.js';
import { assertFetchShaped } from '../http/request.js';
import { deletionOf } from '../references.js';

/**
 * Create delete handler for a resource.
 *
 * Fetch-shaped: `(request, ctx) => Response` (#448).
 *
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {(request: Request, ctx: { params: Record<string,string> }) => Response}
 */
export function createDeleteHandler(apiMetadata, endpoint, { store, referencesTo } = {}) {
  const paramName = extractPrimaryParam(endpoint.path) ?? 'id';
  return (request, { params }) => {
    const { pathname } = new URL(assertFetchShaped(request, 'createDeleteHandler').url);

    const httpStub = matchAndPopHttp(request.method, pathname);
    if (httpStub) {
      const status = httpStub.response?.status ?? 204;
      return status === 204 || !httpStub.response?.body
        ? new Response(null, { status })
        : Response.json(httpStub.response.body, { status });
    }

    const resourceId = params[paramName] || params.id;

    // Check if resource exists
    const existing = store.findById(endpoint.collectionName, resourceId);
    if (!existing) {
      return Response.json({
        code: 'NOT_FOUND',
        message: `${capitalize(paramName.replace(/Id$/, ''))} not found`
      }, { status: 404 });
    }

    // Block deletion of config-managed resources
    if (isConfigManaged(endpoint.collectionName, resourceId)) {
      return Response.json({
        code: 'CONFIG_MANAGED',
        message: `${capitalize(paramName.replace(/Id$/, ''))} is managed by deployment configuration and cannot be deleted`
      }, { status: 409 });
    }

    // Records that name this one go with it where their relationship says
    // onDelete: cascade; any other record naming it refuses the delete.
    const { deleted, refusedBy } = deletionOf(
      { name: endpoint.resource?.name, collection: endpoint.collectionName, id: resourceId }, referencesTo, store);
    if (refusedBy.length > 0) {
      return Response.json({
        code: 'CONFLICT',
        message: `${capitalize(paramName.replace(/Id$/, ''))} can't be deleted while other records name it.`,
        details: refusedBy.map(({ name, id, field }) => ({ field, message: `${name} ${id} names it` })),
      }, { status: 409 });
    }

    // The records a cascade reaches first, then this one, each announcing it.
    for (const { collection, id, reference } of deleted.reverse()) {
      store.deleteResource(collection, id);
      const api = reference?.api ?? apiMetadata;
      const object = reference ? reference.resource.eventName : endpoint.resource?.eventName;
      if (object) try {
        emitEvent({
          store,
          domain: eventDomainOf(api),
          object,
          action: 'deleted',
          resourceId: id,
          source: api.serverBasePath,
          data: null,
          callerId: callerHeader(request, 'x-caller-id'),
          callerRoles: extractCallerRoles(request),
          traceparent: traceparentOf(request),
          causationid: causationOf(request),
          now: new Date().toISOString(),
        });
      } catch (eventError) {
        console.error('Failed to emit deleted event:', eventError.message);
      }
    }

    return new Response(null, { status: 204 });
  };
}
