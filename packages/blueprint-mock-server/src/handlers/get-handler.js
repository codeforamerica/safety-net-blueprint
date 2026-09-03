/**
 * Handler for GET /resources/{id}
 */

import { findById } from '../database-manager.js';
import { matchAndPopHttp } from '../mock-stub-engine.js';
import { extractAuthContext } from '../auth-context.js';
import { parentLinkRegistry } from '../composition-assembler.js';
import { extractExpandFields, applyExpand, extractLinksFields, applyLinks, extractDerivedFields, applyDerivedFields } from './expand-utils.js';
import { extractPrimaryParam, capitalize } from '../collection-utils.js';

/**
 * Create get-by-id handler for a resource
 * @param {Object} apiMetadata - API metadata from OpenAPI spec
 * @param {Object} endpoint - Endpoint metadata
 * @returns {Function} Express handler
 */
export function createGetHandler(apiMetadata, endpoint) {
  const paramName = extractPrimaryParam(endpoint.path) ?? 'id';
  return (req, res) => {
    try {
      const httpStub = matchAndPopHttp(req.method, req.path);
      if (httpStub) {
        return res.status(httpStub.response?.status ?? 200).json(httpStub.response?.body ?? {});
      }

      let resourceId = req.params[paramName] || req.params.id;

      if (resourceId === 'me') {
        const auth = extractAuthContext(req);
        if (!auth) {
          return res.status(401).json({
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          });
        }
        resourceId = auth.userId;
      }

      const resource = findById(endpoint.collectionName, resourceId);

      if (!resource) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          message: `${capitalize(paramName.replace(/Id$/, ''))} not found`
        });
      }

      // Inject _links for composition parentLink registrations.
      // Path params are substituted into each link's href at request time.
      const compositionLinks = parentLinkRegistry.get(endpoint.path);
      if (compositionLinks) {
        const _links = {};
        for (const [key, link] of Object.entries(compositionLinks)) {
          _links[key] = {
            href: link.href.replace(/\{([^}]+)\}/g, (_, p) => req.params[p] ?? `{${p}}`),
          };
        }
        return res.json({ ...resource, _links });
      }

      const expandFields = extractExpandFields(endpoint.responseSchema);
      const linksFields = extractLinksFields(endpoint.responseSchema);
      const derivedFields = extractDerivedFields(endpoint.responseSchema);
      let responseBody = expandFields.length > 0 ? applyExpand(resource, expandFields, findById) : resource;
      if (linksFields.length > 0) responseBody = applyLinks(responseBody, linksFields, apiMetadata.serverBasePath);
      if (derivedFields.length > 0) responseBody = applyDerivedFields(responseBody, derivedFields);
      res.json(responseBody);
    } catch (error) {
      console.error('Get handler error:', error);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }]
      });
    }
  };
}

