/**
 * Handler for /users/me — returns the authenticated user's own record.
 */

import { extractAuthContext } from '../auth-context.js';
import { extractExpandFields, applyExpand, extractLinksFields, applyLinks, extractDerivedFields, applyDerivedFields } from './expand-utils.js';
import { assertFetchShaped } from '../http/request.js';

/**
 * Create a handler for the current-user singleton endpoint.
 *
 * Fetch-shaped: `(request, ctx) => Response` (#448).
 *
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {(request: Request) => Response}
 */
export function createCurrentUserHandler(apiMetadata, endpoint, { store } = {}) {
  return (request) => {
    const auth = extractAuthContext(assertFetchShaped(request, 'createCurrentUserHandler'));
    if (!auth) {
      return Response.json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }, { status: 401 });
    }

    const resource = store.findById(endpoint.collectionName, auth.userId);
    if (!resource) {
      return Response.json({
        code: 'NOT_FOUND',
        message: 'User not found'
      }, { status: 404 });
    }

    const expandFields = extractExpandFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
    const linksFields = extractLinksFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
    const derivedFields = extractDerivedFields(endpoint.responseSchema, apiMetadata.resolve?.schema);
    let responseBody = expandFields.length > 0 ? applyExpand(resource, expandFields, (c, id) => store.findById(c, id)) : resource;
    if (linksFields.length > 0) responseBody = applyLinks(responseBody, linksFields, apiMetadata.serverBasePath);
    if (derivedFields.length > 0) responseBody = applyDerivedFields(responseBody, derivedFields);
    return Response.json(responseBody);
  };
}
