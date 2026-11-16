/**
 * Handler for GET /resources/{id}
 */

import { extractAuthContext } from '../auth-context.js';
import { extractExpandFields, applyExpand, extractLinksFields, applyLinks, extractDerivedFields, applyDerivedFields } from './expand-utils.js';
import { extractPrimaryParam, capitalize } from '../collection-utils.js';
import { assertFetchShaped } from '../http/request.js';

/**
 * Create get-by-id handler for a resource.
 *
 * Returns a Fetch-shaped handler — `(request, ctx) => Response`, the same
 * signature as `fetch` itself. A `Request` carries a URL but no route match,
 * so the matched path params arrive in `ctx` (#448).
 *
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @param {{ store: Object, instance: Object }} deps - The mock serving it (instance.js)
 * @returns {(request: Request, ctx: { params: Record<string,string> }) => Response}
 */
export function createGetHandler(apiMetadata, endpoint, { store, instance } = {}) {
  const paramName = extractPrimaryParam(endpoint.path) ?? 'id';
  return (request, { params }) => {
    const { pathname } = new URL(assertFetchShaped(request, 'createGetHandler').url);

    const httpStub = instance.stubs.matchAndPopHttp(request.method, pathname);
    if (httpStub) {
      return Response.json(httpStub.response?.body ?? {}, { status: httpStub.response?.status ?? 200 });
    }

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

    const resource = store.findById(endpoint.collectionName, resourceId);

    if (!resource) {
      return Response.json({
        code: 'NOT_FOUND',
        message: `${capitalize(paramName.replace(/Id$/, ''))} not found`
      }, { status: 404 });
    }

    const expandFields = extractExpandFields(endpoint.responseSchema, apiMetadata.resolve?.schema, instance.resources);
    const linksFields = extractLinksFields(endpoint.responseSchema, apiMetadata.resolve?.schema, instance.resources);
    const derivedFields = extractDerivedFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
    let responseBody = expandFields.length > 0 ? applyExpand(resource, expandFields, (c, id) => store.findById(c, id)) : resource;
    if (linksFields.length > 0) responseBody = applyLinks(responseBody, linksFields, (c, id) => store.findById(c, id), instance.resources);
    if (derivedFields.length > 0) responseBody = applyDerivedFields(responseBody, derivedFields);

    // Composition parentLink registrations, merged rather than returned on
    // their own. Returning here used to skip everything above it, so
    // declaring `parentLink: true` on a composition silently turned off
    // expand, links-only and derived fields for that resource's GET — three
    // features disabled by an unrelated one, with nothing reported.
    const compositionLinks = instance.parentLinks.get(endpoint.path);
    if (compositionLinks) {
      const _links = {};
      for (const [key, link] of Object.entries(compositionLinks)) {
        _links[key] = {
          href: link.href.replace(/\{([^}]+)\}/g, (_, p) => params[p] ?? `{${p}}`),
        };
      }
      responseBody = { ...responseBody, _links };
    }

    return Response.json(responseBody);
  };
}
