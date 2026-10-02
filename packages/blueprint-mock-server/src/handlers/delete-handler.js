/**
 * Handler for DELETE /resources/{id}
 */

import { emitEvent } from '../emit-event.js';
import { isConfigManaged } from '../config-registry.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { extractPrimaryParam, capitalize } from '../collection-utils.js';
import { extractCallerRoles, callerHeader } from '../auth-context.js';
import { assertFetchShaped } from '../http/request.js';

/**
 * Create delete handler for a resource.
 *
 * Fetch-shaped: `(request, ctx) => Response` (#448).
 *
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {(request: Request, ctx: { params: Record<string,string> }) => Response}
 */
export function createDeleteHandler(apiMetadata, endpoint, { store } = {}) {
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

    // Delete the resource
    store.deleteResource(endpoint.collectionName, resourceId);

    // Auto-emit deleted event
    try {
      const domain = (apiMetadata.serverBasePath ?? '').replace(/^\//, '');
      const object = endpoint.collectionName.replace(/s$/, '');
      emitEvent({
        store,
        domain,
        object,
        action: 'deleted',
        resourceId,
        source: apiMetadata.serverBasePath,
        data: null,
        callerId: callerHeader(request, 'x-caller-id'),
        callerRoles: extractCallerRoles(request),
        traceparent: callerHeader(request, 'traceparent'),
        now: new Date().toISOString(),
      });
    } catch (eventError) {
      console.error('Failed to emit deleted event:', eventError.message);
    }

    return new Response(null, { status: 204 });
  };
}
