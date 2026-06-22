/**
 * Composition Assembler
 *
 * Assembles composite view responses from composition config at request time.
 * Supports sectionView compositeType: section index + per-section panel responses.
 *
 * For each section panel request:
 *  1. Bind resolution   — fetch the section's primary resource filtered by the bind field
 *  2. Filter evaluation — apply optional inline filter expression to the result set
 *  3. Field selection   — project a subset of fields when `fields:` is declared
 *  4. Include nodes     — fetch each included resource with its own bind + filter
 *  5. Panel nodes       — add the shared panel includes (verifications, notes, etc.)
 *
 * Filter expressions use the same CEL syntax as state machine conditions.
 */

import { evaluateCEL } from './cel-evaluator.js';
import { findAll, findById, create, update } from './database-manager.js';
import { deriveCollectionName, extractPrimaryParam, resolveDotPath } from './collection-utils.js';
import { filterItems, paginateItems, sortItems } from './search-engine.js';

// ---------------------------------------------------------------------------
// Parent link registry
// ---------------------------------------------------------------------------

/**
 * Registry populated at startup by registerCompositionRoutes when a composition
 * declares parentLink: true.  Maps the parent resource's OpenAPI item path
 * (e.g. /applications/{applicationId}) to a map of compositionName → { href }.
 *
 * The get-handler consults this at request time to inject _links into the parent
 * resource response.  Because JavaScript closures capture references, the handler
 * sees the populated registry even though it was created before the composition
 * routes were registered.
 */
export const parentLinkRegistry = new Map();

/**
 * Register a composition as a link on its parent resource's GET by ID response.
 *
 * @param {string} parentPath - OpenAPI path of parent GET by ID (e.g. /applications/{applicationId})
 * @param {string} compositionName - Composition key (e.g. "reviewContext")
 * @param {string} compositionEndpointPath - OpenAPI path of the composition endpoint
 */
export function registerParentLink(parentPath, compositionName, compositionEndpointPath) {
  if (!parentLinkRegistry.has(parentPath)) {
    parentLinkRegistry.set(parentPath, {});
  }
  parentLinkRegistry.get(parentPath)[compositionName] = { href: compositionEndpointPath };
}

// ---------------------------------------------------------------------------
// Composition CEL helpers
// ---------------------------------------------------------------------------

// $present(v) — true if value is non-null, non-undefined, non-empty string.
// Injected into every filter and derive expression context for compositions.
const COMPOSITION_HELPERS = {
  $present: (v) => v !== null && v !== undefined && v !== '',
};

/**
 * Build a _links.self URL for a resource item.
 *
 * Substitutes known path params from `params` into the item path pattern, then
 * replaces the last remaining {param} placeholder with the item's own ID.
 *
 * @param {string} resourceItemPath - OpenAPI path pattern for the resource item endpoint
 * @param {string} serverBasePath - Server base path (e.g. "/intake")
 * @param {Object} params - Express req.params (path parameter values)
 * @param {string} itemId - The item's own ID
 * @returns {string} Fully resolved URL
 */
function buildSelfLink(resourceItemPath, serverBasePath, params, itemId) {
  let url = `${serverBasePath}${resourceItemPath}`;
  for (const [param, value] of Object.entries(params)) {
    url = url.replace(`{${param}}`, String(value));
  }
  // Last remaining placeholder is the item's own ID
  url = url.replace(/\{[^}]+\}$/, String(itemId ?? ''));
  return url;
}

// ---------------------------------------------------------------------------
// Resource fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch records for a composition node.
 *
 * @param {Object} node - Composition node ({ resource, bind, filter, fields, missing })
 * @param {Object} bindValues - Map of bind field name → value from path params
 * @param {Object} context - Evaluation context ({ sectionName })
 * @returns {Array|Object|null} Items array, empty object (missing: empty), or null
 */
function fetchNodeItems(node, bindValues, context) {
  const { resource, bind, filter, fields, missing } = node;

  const filterObj = bind ? { [bind]: bindValues[bind] } : {};
  const { items } = findAll(resource, filterObj, { limit: null });

  const filtered = filter
    ? items.filter(item => Boolean(evaluateCEL(filter, { ...COMPOSITION_HELPERS, ...item, $section: { name: context.sectionName } })))
    : items;

  const projected = fields ? filtered.map(item => projectFields(item, fields)) : filtered;

  if (projected.length === 0 && missing === 'empty') {
    return {};
  }

  return projected;
}

/**
 * Project a subset of fields from a record.
 *
 * @param {Object} record
 * @param {string[]} fields - Field names to include
 * @returns {Object}
 */
function projectFields(record, fields) {
  const out = {};
  for (const field of fields) {
    if (field.includes('.')) {
      // Dot-notation: resolve the value and set it at the top-level key (first segment).
      // e.g. "person.firstName" → out.person = { firstName: <value> }
      const dot = field.indexOf('.');
      const topKey = field.slice(0, dot);
      const subPath = field.slice(dot + 1);
      const value = resolveDotPath(record, field);
      if (value !== null) {
        if (!Object.prototype.hasOwnProperty.call(out, topKey)) out[topKey] = {};
        // Set nested value at subPath within out[topKey]
        const subParts = subPath.split('.');
        let target = out[topKey];
        for (let i = 0; i < subParts.length - 1; i++) {
          if (!Object.prototype.hasOwnProperty.call(target, subParts[i])) target[subParts[i]] = {};
          target = target[subParts[i]];
        }
        target[subParts[subParts.length - 1]] = value;
      }
    } else if (Object.prototype.hasOwnProperty.call(record, field)) {
      out[field] = record[field];
    }
  }
  return out;
}

/**
 * Strip framework-managed fields from a state record, returning only the
 * client-visible fields. Used when embedding state into panel and index responses.
 *
 * @param {Object|null} record - State record from the DB (or null)
 * @param {string} bindParam - The bind parameter name (e.g. 'applicationId')
 * @returns {Object} Record with id, createdAt, updatedAt, bindParam, section, itemId removed
 */
function stripFrameworkFields(record, bindParam) {
  if (!record) return null;
  const { id: _1, createdAt: _2, updatedAt: _3, section: _4, itemId: _5, [bindParam]: _6, ...fields } = record;
  return fields;
}

// ---------------------------------------------------------------------------
// Bind value extraction
// ---------------------------------------------------------------------------

/**
 * Build bind values from request path params.
 * The bind field on each node declares which param to filter by.
 *
 * @param {Object} params - Express req.params
 * @returns {Object} Same as params but with normalized keys
 */
function buildBindValues(params) {
  return { ...params };
}

// ---------------------------------------------------------------------------
// Section index assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the section index response for a sectionView composition.
 *
 * For each section, includes a link to its panel endpoint. When the section
 * declares an index: config, also fetches summary data using that config's filter
 * and field projection, and evaluates derive: expressions against it.
 *
 * When viewName is given, the named view's filter is composed (AND) with the
 * section's index.filter. Sections with zero surviving items are excluded.
 *
 * @param {Object} composition - Composition definition from YAML (with doc.views merged in)
 * @param {Object} params - Express req.params (path params)
 * @param {string} basePath - Base URL path for this composition endpoint
 * @param {Object} stateDefaults - Default field values for the state resource
 * @returns {Object}
 */
export function assembleSectionIndex(composition, params, basePath, stateDefaults = {}, { resourceItemPathMap = null, serverBasePath = '' } = {}) {
  const sectionDefs = composition.sections || {};
  const bindValues = buildBindValues(params);

  // Build the concrete base path by substituting path params
  const resolvedBase = basePath.replace(/:(\w+)/g, (_, name) => params[name] ?? `:${name}`);

  // Resolve state resource info once for the whole index
  const stateInfo = composition.state ? deriveStateResource(composition.state, composition.endpoint?.path, serverBasePath) : null;
  const bindParam = stateInfo ? extractPrimaryParam(composition.endpoint?.path ?? '') : null;

  const sections = [];

  for (const [name, sectionDef] of Object.entries(sectionDefs)) {
    const entry = { name, href: `${resolvedBase}/${name}` };

    // Embed section-level state (itemId: null) on every section entry.
    // The index shows one state object per section; per-item state appears on the panel only.
    if (stateInfo && bindParam) {
      const bindValue = bindValues[bindParam];
      const record = findStateRecord(stateInfo.collectionName, bindParam, bindValue, name, null);
      const fields = stripFrameworkFields(record, bindParam);
      entry[stateInfo.camelKey] = (fields && Object.keys(fields).length > 0) ? fields : { ...stateDefaults };
    }

    const indexConfig = sectionDef.index;

    // Sections with no index config are link-only (plus state above)
    if (!indexConfig) {
      sections.push(entry);
      continue;
    }

    const context = { sectionName: name };

    // Fetch items using the index config's filter, without field projection yet
    // so that derive expressions can operate on the full record before projection.
    const fetchNode = {
      resource: sectionDef.resource,
      bind: sectionDef.bind,
      missing: sectionDef.missing,
      filter: indexConfig?.filter,
    };
    let items = fetchNodeItems(fetchNode, bindValues, context);

    if (!Array.isArray(items)) {
      // Singleton (missing: empty) — expose as data, unaffected by view filter
      entry.data = items;
      sections.push(entry);
      continue;
    }

    // Project fields for display.
    // Index fields take precedence over view fields on the index endpoint.
    // Track original IDs before projection so _links.self can use them even
    // when `id` is not included in index.fields.
    const itemIds = items.map(item => item.id);
    let finalItems = indexConfig?.fields
      ? items.map(item => projectFields(item, indexConfig.fields))
      : items;

    // Add _links.self after projection (so links are not stripped by field selection).
    if (sectionDef.links && resourceItemPathMap) {
      const itemPath = resourceItemPathMap.get(sectionDef.resource);
      if (itemPath) {
        finalItems = finalItems.map((item, idx) => ({
          ...item,
          _links: { self: buildSelfLink(itemPath, serverBasePath, params, itemIds[idx]) },
        }));
      }
    }

    // Embed per-item state on index items (after projection so state is never stripped by field selection).
    if (stateInfo && bindParam) {
      const bindValue = bindValues[bindParam];
      finalItems = finalItems.map((item, idx) => {
        const record = findStateRecord(stateInfo.collectionName, bindParam, bindValue, name, itemIds[idx] ?? null);
        const fields = stripFrameworkFields(record, bindParam);
        return {
          ...item,
          [stateInfo.camelKey]: (fields && Object.keys(fields).length > 0) ? fields : { ...stateDefaults },
        };
      });
    }

    entry.items = finalItems;

    sections.push(entry);
  }

  // Project root resource fields into the index response if the composition
  // declares a top-level fields: list (e.g. fields: [programs, status]).
  // Fetches the parent resource record and merges the projected fields into
  // the response alongside sections.
  let rootFields = {};
  if (composition.fields && composition.resource) {
    const primaryParam = extractPrimaryParam(composition.endpoint?.path ?? '');
    if (primaryParam && bindValues[primaryParam]) {
      const { items: parentItems } = findAll(
        composition.resource,
        { id: bindValues[primaryParam] },
        { limit: 1 }
      );
      if (parentItems.length > 0) {
        rootFields = projectFields(parentItems[0], composition.fields);
      }
    }
  }

  // Process root-level include nodes (e.g. members on a sectionView index).
  const rootInclude = {};
  if (composition.include) {
    for (const [key, includeNode] of Object.entries(composition.include)) {
      rootInclude[key] = fetchNodeItems(includeNode, bindValues, {});
    }
  }

  return {
    ...rootFields,
    sections,
    ...(Object.keys(rootInclude).length > 0 ? { include: rootInclude } : {}),
  };
}

// ---------------------------------------------------------------------------
// Plain composition assembly
// ---------------------------------------------------------------------------

/**
 * Assemble a plain (non-sectionView) composition response.
 *
 * Fetches the root resource by its own ID (derived from the primary path parameter),
 * applies optional field projection and include nodes, and returns the assembled record.
 *
 * @param {Object} composition - Composition definition (compositeType absent or not 'sectionView')
 * @param {Object} params - Express req.params
 * @param {Object} opts
 * @returns {Object|null} Assembled record, or null if root resource not found
 */
export function assemblePlainComposition(composition, params, { resourceItemPathMap = null, serverBasePath = '' } = {}) {
  const bindValues = buildBindValues(params);
  const primaryParam = extractPrimaryParam(composition.endpoint?.path ?? '');
  const rootId = primaryParam ? bindValues[primaryParam] : null;
  const rootRecord = rootId ? findById(composition.resource, rootId) : null;
  if (!rootRecord) return null;

  const record = composition.fields ? projectFields(rootRecord, composition.fields) : { ...rootRecord };

  if (composition.include) {
    const context = { sectionName: null };
    const include = {};
    for (const [key, includeNode] of Object.entries(composition.include)) {
      include[key] = fetchNodeItems(includeNode, bindValues, context);
    }
    if (Object.keys(include).length > 0) {
      record.include = include;
    }
  }

  if (composition.links && resourceItemPathMap) {
    const itemPath = resourceItemPathMap.get(composition.resource);
    if (itemPath) {
      record._links = { self: buildSelfLink(itemPath, serverBasePath, params, record.id) };
    }
  }

  return record;
}

// ---------------------------------------------------------------------------
// Panel assembly
// ---------------------------------------------------------------------------

/**
 * Assemble a section panel response for a sectionView composition.
 *
 * For list sections (items array), applies q= filtering and limit/offset pagination
 * from queryParams and returns the standard paginated response shape:
 *   { section, items, total, limit, offset, hasNext, include? }
 *
 * For singleton sections (missing: empty → data object), query params are ignored
 * and no pagination fields are added.
 *
 * @param {Object} composition - Composition definition from YAML
 * @param {string} sectionName - Name of the section being requested
 * @param {Object} params - Express req.params (path params)
 * @param {Object} stateDefaults - Default field values for the state resource (keyed by field name)
 * @param {Object} opts
 * @param {Object} [opts.queryParams={}] - Request query parameters (q, limit, offset, etc.)
 * @param {Object} [opts.paginationDefaults={}] - Domain pagination defaults
 * @returns {Object|null} Panel response, or null if section not found
 */
export function assembleSectionPanel(composition, sectionName, params, stateDefaults = {}, { resourceItemPathMap = null, serverBasePath = '', queryParams = {}, paginationDefaults = {} } = {}) {
  const sections = composition.sections || {};
  const sectionDef = sections[sectionName];
  if (!sectionDef) return null;

  const bindValues = buildBindValues(params);
  const context = { sectionName };

  // Fetch primary section resource using the section's base filter
  let items = fetchNodeItems(sectionDef, bindValues, context);

  // Fetch section-level includes
  const include = {};
  if (sectionDef.include) {
    for (const [key, includeNode] of Object.entries(sectionDef.include)) {
      include[key] = fetchNodeItems(includeNode, bindValues, context);
    }
  }

  // Fetch panel-level includes (shared across all sections)
  if (composition.panel?.include) {
    for (const [key, panelNode] of Object.entries(composition.panel.include)) {
      // Panel includes may already appear in section includes — section wins
      if (!(key in include)) {
        include[key] = fetchNodeItems(panelNode, bindValues, context);
      }
    }
  }

  // Resolve state resource info once — used for both section-level and per-item embedding.
  const stateInfo = composition.state
    ? deriveStateResource(composition.state, composition.endpoint?.path, serverBasePath)
    : null;
  const bindParam = stateInfo ? extractPrimaryParam(composition.endpoint?.path ?? '') : null;

  const response = { section: sectionName };

  // Embed section-level state (itemId: null) at the panel root.
  // Present for both list and singleton sections.
  if (stateInfo && bindParam) {
    const bindValue = bindValues[bindParam];
    const record = findStateRecord(stateInfo.collectionName, bindParam, bindValue, sectionName, null);
    const fields = stripFrameworkFields(record, bindParam);
    response[stateInfo.camelKey] = (fields && Object.keys(fields).length > 0) ? fields : { ...stateDefaults };
  }

  // items may be an array (normal) or empty object (missing: empty)
  if (Array.isArray(items)) {
    // Embed per-item state for collection-backed (member-scoped) sections.
    if (stateInfo && bindParam) {
      const bindValue = bindValues[bindParam];
      for (const item of items) {
        const record = findStateRecord(stateInfo.collectionName, bindParam, bindValue, sectionName, item.id ?? null);
        const fields = stripFrameworkFields(record, bindParam);
        item[stateInfo.camelKey] = (fields && Object.keys(fields).length > 0) ? fields : { ...stateDefaults };
      }
    }

    const itemIds = items.map(item => item.id);
    let finalItems = items;

    // Add _links.self after state embedding (so links are never stripped by field selection).
    if (sectionDef.links && resourceItemPathMap) {
      const itemPath = resourceItemPathMap.get(sectionDef.resource);
      if (itemPath) {
        finalItems = finalItems.map((item, idx) => ({
          ...item,
          _links: { self: buildSelfLink(itemPath, serverBasePath, params, itemIds[idx]) },
        }));
      }
    }

    // Apply filtering, sorting, and pagination on the fully assembled set
    // (after state embedding and links) so callers can filter/sort on
    // embedded fields like reviewProgress.status.
    const filtered = filterItems(finalItems, queryParams);
    const sortResult = sortItems(filtered, queryParams, sectionDef.sortable);
    if (sortResult.error) return { error: sortResult.error };
    const paginated = paginateItems(sortResult.items, queryParams, paginationDefaults);

    response.items = paginated.items;
    response.total = paginated.total;
    response.limit = paginated.limit;
    response.offset = paginated.offset;
    response.hasNext = paginated.hasNext;
  } else {
    // Singleton section (missing: empty) — query params are not applicable.
    response.data = items;
  }

  if (Object.keys(include).length > 0) {
    response.include = include;
  }

  return response;
}

// ---------------------------------------------------------------------------
// Composition state helpers
// ---------------------------------------------------------------------------

/**
 * Derive state resource metadata from a composition state config block.
 *
 * Extracts the $defs key from the $ref, converts to camelCase (response key)
 * and kebab-case (URL path segment). The DB collection name is derived via
 * deriveCollectionName so it matches the collection names used by the route
 * generator and seeder.
 *
 * @param {Object} stateConfig - composition.state
 * @param {string} [endpointPath] - OpenAPI-style composition endpoint path (e.g. /applications/{applicationId}/review)
 * @param {string} [basePath] - Server base path (e.g. /intake)
 * @returns {{ defsKey: string, pathSegment: string, collectionName: string, camelKey: string } | null}
 */
export function deriveStateResource(stateConfig, endpointPath, basePath) {
  const defsKey = stateConfig?.schema?.name;
  if (!defsKey) return null;
  const pathSegment = defsKey.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const camelKey = defsKey.charAt(0).toLowerCase() + defsKey.slice(1);
  // Build the path the state resource will be served at and derive the collection name from it
  const parentBase = (endpointPath || '').replace(/\/[^/]+$/, '');
  const stateResourcePath = parentBase ? `${parentBase}/${pathSegment}` : pathSegment;
  const collectionName = endpointPath
    ? deriveCollectionName(stateResourcePath, basePath || '')
    : pathSegment;
  return { defsKey, pathSegment, collectionName, camelKey };
}

/**
 * Look up a single state record by section + optional itemId.
 *
 * @param {string} collectionName - Derived from state resource (e.g. 'review-progress')
 * @param {string} bindParam - The binding path param name (e.g. 'applicationId')
 * @param {string} bindValue - The binding path param value
 * @param {string} section - Section name
 * @param {string|null} itemId - Item ID for collection-backed sections; null for singletons
 * @returns {Object|null}
 */
export function findStateRecord(collectionName, bindParam, bindValue, section, itemId = null) {
  const filters = { [bindParam]: bindValue, section };
  if (itemId !== null) {
    filters.itemId = itemId;
    const { items } = findAll(collectionName, filters, { limit: 1 });
    return items[0] ?? null;
  }
  // Section-level lookup (itemId: null): findAll skips null filter values so it
  // would match per-item records too. Fetch all section records and find the one
  // without an itemId explicitly.
  const { items } = findAll(collectionName, filters, { limit: null });
  return items.find(r => r.itemId === undefined || r.itemId === null) ?? null;
}

/**
 * List state records for a section. Returns the standard paginated result shape.
 *
 * @param {string} collectionName
 * @param {string} bindParam
 * @param {string} bindValue
 * @param {string} section
 * @param {Object} pagination - { limit, offset }
 * @returns {{ items: Object[], total: number, limit: number, offset: number, hasNext: boolean }}
 */
export function listStateRecords(collectionName, bindParam, bindValue, section, pagination = {}) {
  const limit = pagination.limit ?? 25;
  const offset = pagination.offset ?? 0;
  const { items, total } = findAll(collectionName, { [bindParam]: bindValue, section }, { limit, offset });
  return { items, total, limit, offset, hasNext: offset + items.length < total };
}

/**
 * Create or update a state record. Looks up existing record first; creates if absent.
 *
 * @param {string} collectionName
 * @param {string} bindParam
 * @param {string} bindValue
 * @param {string} section
 * @param {string|null} itemId
 * @param {Object} updates - Client-supplied fields
 * @returns {Object} The full updated (or newly created) record
 */
export function upsertStateRecord(collectionName, bindParam, bindValue, section, itemId, updates) {
  const filters = { [bindParam]: bindValue, section, itemId: itemId ?? null };
  const { items } = findAll(collectionName, filters, { limit: 1 });

  if (items[0]) {
    return update(collectionName, items[0].id, updates);
  }

  return create(collectionName, {
    [bindParam]: bindValue,
    section,
    itemId: itemId ?? null,
    ...updates,
  });
}

/**
 * Convert OpenAPI path format to Express path format.
 *
 * @param {string} path - e.g. /applications/{applicationId}/review
 * @returns {string} - e.g. /applications/:applicationId/review
 */
export function toExpressPath(path) {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}
