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

import { findAll, findById } from './database-manager.js';

// ---------------------------------------------------------------------------
// Filter evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a simple filter expression against a record.
 *
 * Supported forms:
 *   field == 'value'       — equality against a string literal
 *   field == $section.name — equality against the current section name
 *
 * @param {string} expr - Filter expression string
 * @param {Object} record - Record to evaluate against
 * @param {Object} context - Evaluation context ({ sectionName })
 * @returns {boolean}
 */
function evaluateFilter(expr, record, context = {}) {
  if (!expr) return true;

  const trimmed = expr.trim();

  // Parse: lhs == rhs
  const eqMatch = trimmed.match(/^(\w+)\s*==\s*(.+)$/);
  if (!eqMatch) return true; // Unknown expression form — pass through

  const lhs = eqMatch[1];
  const rhsRaw = eqMatch[2].trim();

  // Resolve RHS: string literal ('value') or variable ($section.name)
  let rhsValue;
  if (rhsRaw.startsWith("'") && rhsRaw.endsWith("'")) {
    rhsValue = rhsRaw.slice(1, -1);
  } else if (rhsRaw === '$section.name') {
    rhsValue = context.sectionName ?? null;
  } else {
    rhsValue = rhsRaw; // bare word — treat as literal
  }

  return record[lhs] === rhsValue;
}

// ---------------------------------------------------------------------------
// Derive evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a derive expression against a context.
 *
 * Transforms common CEL patterns to JavaScript before evaluation:
 *   has(field)              — field is present and non-empty
 *   .size()                 — collection or string length
 *   .filter(var, pred)      — filter collection
 *   .map(var, expr)         — transform collection
 *   .all(var, pred)         — all items satisfy predicate
 *   .exists(var, pred)      — any item satisfies predicate
 *
 * @param {string} expr - CEL expression
 * @param {Object} context - Variables available to the expression
 * @returns {*} Evaluated result, or undefined on error
 */
// Helpers injected into every derive expression context.
// $present(v) — true if value is non-null, non-undefined, non-empty string
const DERIVE_HELPERS = {
  $present: (v) => v !== null && v !== undefined && v !== '',
};

function evaluateDerive(expr, context = {}) {
  if (!expr || typeof expr !== 'string') return undefined;
  try {
    const jsExpr = expr
      .replace(/\bhas\((\w+)\)/g, '(typeof $1 !== "undefined" && $1 !== null && $1 !== "")')
      .replace(/\.size\(\)/g, '.length')
      .replace(/\.(filter|map)\((\w+),\s*([^)]+(?:\([^)]*\))*[^)]*)\)/g, (_, fn, v, pred) => `.${fn}(${v} => (${pred}))`)
      .replace(/\.all\((\w+),\s*([^)]+(?:\([^)]*\))*[^)]*)\)/g, '.every($1 => ($2))')
      .replace(/\.exists\((\w+),\s*([^)]+(?:\([^)]*\))*[^)]*)\)/g, '.some($1 => ($2))');

    const fullCtx = { ...DERIVE_HELPERS, ...context };
    const fn = new Function(...Object.keys(fullCtx), `return (${jsExpr});`);
    return fn(...Object.values(fullCtx));
  } catch (e) {
    console.warn(`Derive expression evaluation error for "${expr}": ${e.message}`);
    return undefined;
  }
}

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
      panel[fieldName] = evaluateDerive(expr, { items: snapshots });
    } else if (Array.isArray(items)) {
      items.forEach((item, idx) => {
        item[fieldName] = evaluateDerive(expr, { ...snapshots[idx], $self: snapshots[idx] });
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
    ? items.filter(item => evaluateFilter(filter, item, context))
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
 * Returns an object listing section names with links to their panel endpoints.
 *
 * @param {Object} composition - Composition definition from YAML
 * @param {Object} params - Express req.params (path params)
 * @param {string} basePath - Base URL path for this composition endpoint
 * @returns {Object}
 */
export function assembleSectionIndex(composition, params, basePath) {
  const sections = Object.keys(composition.sections || {});

  // Build the concrete base path by substituting path params
  const resolvedBase = basePath.replace(/:(\w+)/g, (_, name) => params[name] ?? `:${name}`);

  return {
    sections: sections.map(name => ({
      name,
      href: `${resolvedBase}/${name}`
    }))
  };
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
 * @returns {Object|null} Panel response, or null if section not found
 */
export function assembleSectionPanel(composition, sectionName, params) {
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
