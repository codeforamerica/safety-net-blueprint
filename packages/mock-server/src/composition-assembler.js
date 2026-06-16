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
 *  6. Derived fields    — evaluate `derive:` expressions; item-scope or collection-scope
 *
 * Filter and derive expressions use the same CEL syntax as state machine conditions.
 */

import { evaluateCEL } from './cel-evaluator.js';
import { findAll, findById, create, update } from './database-manager.js';

// ---------------------------------------------------------------------------
// Composition CEL helpers
// ---------------------------------------------------------------------------

// $present(v) — true if value is non-null, non-undefined, non-empty string.
// Injected into every filter and derive expression context for compositions.
const COMPOSITION_HELPERS = {
  $present: (v) => v !== null && v !== undefined && v !== '',
};

/**
 * Resolve a derive expression — either an inline string or a $ref to the derives map.
 *
 * @param {string|Object} exprOrRef - String expression or { $ref: '#/derives/name' }
 * @param {Object} derives - The derives map from the composition file
 * @returns {string|undefined}
 */
function resolveDerivExpr(exprOrRef, derives = {}) {
  if (typeof exprOrRef === 'string') return exprOrRef;
  if (exprOrRef?.$ref) {
    const match = exprOrRef.$ref.match(/^#\/derives\/(.+)$/);
    if (match) {
      // Walk nested path: '#/derives/complete/item' → derives.complete.item
      const parts = match[1].split('/');
      let val = derives;
      for (const part of parts) {
        if (val == null) return undefined;
        val = val[part];
      }
      return typeof val === 'string' ? val : undefined;
    }
  }
  return undefined;
}

/**
 * Apply derive: expressions to a panel response.
 *
 * Scope inference:
 *   - Expression references 'items' → collection scope: evaluated once against
 *     the full array; result added as a top-level field on the panel response
 *   - Otherwise → item scope: evaluated per item; result added as a new field
 *     on each item object
 *
 * @param {Object} sectionDef - The section's composition definition
 * @param {Object} composition - The full composition definition (for derives: map)
 * @param {Array} items - The section's item array (mutated in place for item-scope)
 * @param {Object} panel - The panel response object (receives collection-scope fields)
 */
function applyDerives(sectionDef, composition, items, panel) {
  const derive = sectionDef.derive;
  if (!derive) return;

  const derives = composition.derives || {};

  // Snapshot each item's source fields before any derives are applied.
  // This ensures $self and collection items always reflect source data,
  // not accumulated derived fields from earlier entries in the derive map.
  const snapshots = Array.isArray(items) ? items.map(item => ({ ...item })) : [];

  for (const [fieldName, exprOrRef] of Object.entries(derive)) {
    const expr = resolveDerivExpr(exprOrRef, derives);
    if (!expr) continue;

    const isCollectionScope = /\bitems\b/.test(expr);

    if (isCollectionScope) {
      panel[fieldName] = evaluateCEL(expr, { ...COMPOSITION_HELPERS, items: snapshots });
    } else if (Array.isArray(items)) {
      items.forEach((item, idx) => {
        item[fieldName] = evaluateCEL(expr, { ...COMPOSITION_HELPERS, ...snapshots[idx], $self: snapshots[idx] });
      });
    }
  }
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
  const { items } = findAll(resource, filterObj, { limit: 1000 });

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
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      out[field] = record[field];
    }
  }
  return out;
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
 * declares a views.index, also fetches summary data using that view's filter
 * and field projection, and evaluates derive: expressions against it.
 *
 * @param {Object} composition - Composition definition from YAML
 * @param {Object} params - Express req.params (path params)
 * @param {string} basePath - Base URL path for this composition endpoint
 * @param {Object} stateDefaults - Default field values for the state resource
 * @returns {Object}
 */
export function assembleSectionIndex(composition, params, basePath, stateDefaults = {}) {
  const sectionDefs = composition.sections || {};
  const bindValues = buildBindValues(params);

  // Build the concrete base path by substituting path params
  const resolvedBase = basePath.replace(/:(\w+)/g, (_, name) => params[name] ?? `:${name}`);

  // Resolve state resource info once for the whole index
  const stateInfo = composition.state ? deriveStateResource(composition.state) : null;
  const bindParam = stateInfo ? extractPrimaryParam(composition.endpoint?.path ?? '') : null;

  const sections = Object.entries(sectionDefs).map(([name, sectionDef]) => {
    const entry = { name, href: `${resolvedBase}/${name}` };

    const indexView = sectionDef.views?.index;
    if (!indexView) return entry;

    const context = { sectionName: name };

    // Fetch items using the index view's filter, but without field projection yet
    // so that derive expressions can operate on the full record before projection.
    const fetchNode = {
      resource: sectionDef.resource,
      bind: sectionDef.bind,
      missing: sectionDef.missing,
      filter: indexView.filter,
    };
    const items = fetchNodeItems(fetchNode, bindValues, context);

    // Apply derive: expressions (collection-scope adds to entry, item-scope adds to items)
    if (Array.isArray(items)) {
      applyDerives(sectionDef, composition, items, entry);

      // Embed state per item if composition declares state:
      if (stateInfo && bindParam) {
        const bindValue = bindValues[bindParam];
        for (const item of items) {
          const record = findStateRecord(stateInfo.collectionName, bindParam, bindValue, name, item.id ?? null);
          const { id: _id, createdAt: _c, updatedAt: _u, [bindParam]: _bp, section: _s, itemId: _ii, ...stateFields } =
            record ?? {};
          item[stateInfo.camelKey] = Object.keys(stateFields).length > 0
            ? stateFields
            : { ...stateDefaults };
        }
      }

      // Project fields for display after derives have been evaluated
      entry.items = indexView.fields
        ? items.map(item => projectFields(item, indexView.fields))
        : items;
    } else {
      entry.data = items;
    }

    return entry;
  });

  return { sections };
}

// ---------------------------------------------------------------------------
// Panel assembly
// ---------------------------------------------------------------------------

/**
 * Assemble a section panel response for a sectionView composition.
 *
 * @param {Object} composition - Composition definition from YAML
 * @param {string} sectionName - Name of the section being requested
 * @param {Object} params - Express req.params (path params)
 * @param {Object} stateDefaults - Default field values for the state resource (keyed by field name)
 * @returns {Object|null} Panel response, or null if section not found
 */
export function assembleSectionPanel(composition, sectionName, params, stateDefaults = {}) {
  const sections = composition.sections || {};
  const sectionDef = sections[sectionName];
  if (!sectionDef) return null;

  const bindValues = buildBindValues(params);
  const context = { sectionName };

  // Fetch primary section resource
  const items = fetchNodeItems(sectionDef, bindValues, context);

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

  const response = { section: sectionName };

  // items may be an array (normal) or empty object (missing: empty)
  if (Array.isArray(items)) {
    // Apply derived fields: item-scope mutates items; collection-scope adds to response
    applyDerives(sectionDef, composition, items, response);

    // Embed composition state per item if state: is declared on the composition
    if (composition.state) {
      const stateInfo = deriveStateResource(composition.state);
      const bindParam = extractPrimaryParam(composition.endpoint?.path ?? '');
      if (stateInfo && bindParam) {
        const bindValue = bindValues[bindParam];
        for (const item of items) {
          const record = findStateRecord(stateInfo.collectionName, bindParam, bindValue, sectionName, item.id ?? null);
          const { id: _id, createdAt: _c, updatedAt: _u, [bindParam]: _bp, section: _s, itemId: _ii, ...stateFields } =
            record ?? {};
          item[stateInfo.camelKey] = Object.keys(stateFields).length > 0
            ? stateFields
            : { ...stateDefaults };
        }
      }
    }

    response.items = items;
  } else {
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
 * and kebab-case (collection name / path segment).
 *
 * @param {Object} stateConfig - composition.state
 * @returns {{ defsKey: string, collectionName: string, camelKey: string } | null}
 */
export function deriveStateResource(stateConfig) {
  if (!stateConfig?.schema?.$ref) return null;
  const match = stateConfig.schema.$ref.match(/#\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/);
  if (!match) return null;
  const defsKey = match[1];
  const collectionName = defsKey.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const camelKey = defsKey.charAt(0).toLowerCase() + defsKey.slice(1);
  return { defsKey, collectionName, camelKey };
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
  if (itemId !== null) filters.itemId = itemId;
  const { items } = findAll(collectionName, filters, { limit: 1 });
  return items[0] ?? null;
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
  const filters = { [bindParam]: bindValue, section };
  if (itemId !== null) filters.itemId = itemId;
  const { items } = findAll(collectionName, filters, { limit: 1 });

  if (items[0]) {
    return update(collectionName, items[0].id, updates);
  }

  return create(collectionName, {
    [bindParam]: bindValue,
    section,
    ...(itemId !== null ? { itemId } : {}),
    ...updates,
  });
}

// ---------------------------------------------------------------------------
// Route param extraction
// ---------------------------------------------------------------------------

/**
 * Extract the path param name that provides the primary bind value.
 * Uses the last {param} in the endpoint path.
 *
 * @param {string} endpointPath - e.g. /applications/{applicationId}/review
 * @returns {string|null}
 */
export function extractPrimaryParam(endpointPath) {
  const matches = [...endpointPath.matchAll(/\{([^}]+)\}/g)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
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
