#!/usr/bin/env node
/**
 * API Reference Explorer build
 *
 * Generates a static, no-server-required API reference from all resolved
 * *-openapi.yaml files. Uses @apidevtools/json-schema-ref-parser to fully
 * dereference external $refs before rendering.
 *
 * Output:
 *   tools/api-reference/index.html   — landing page, one card per domain
 *   tools/api-reference/{slug}.html  — full API reference per spec
 *
 * Usage: node build.js
 */

import { writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, dirname, basename, relative, join } from 'path';
import { fileURLToPath } from 'url';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { COLORS, FONT } from './lib/theme.js';
import { METHOD_STYLE, esc, titleCase, breadcrumb, statusBadge, methodBadge, typeBadge, nextEid, expandHidden, expandChip, headerMetaSubtitle, fieldNameLink, dataDictFieldHref, stateMachineLink, rulesLink, stateMachineDocsHref, rulesDocsHref } from './lib/html.js';
import { inlineMd, renderMarkdown } from './lib/markdown.js';
import { twoColumnPage, singleColumnPage } from './lib/layout.js';
import { resolvedSourcePairs } from './lib/paths.js';
import { discover, load } from '@codeforamerica/blueprint-core';
import { loadConfig } from './lib/config.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));

/**
 * @param {{ contentDir: string, resolvedDir: string }} opts
 */
/**
 * Follow an external `$defs` ref to the schema it names.
 *
 * `fileMap` is what `doc.externalRefs(docs)` returned — the sibling
 * documents this spec points at, keyed by the ref's file part as written.
 *
 * @param {string} ref
 * @param {Map<string, object>} fileMap
 * @returns {object|null}
 */
function resolveDefRef(ref, fileMap) {
  if (typeof ref !== 'string') return null;
  const hashIdx = ref.indexOf('#');
  if (hashIdx === -1) return null;

  const file = ref.slice(0, hashIdx);
  const content = fileMap.get(file) ?? fileMap.get(file.replace(/^\.\//, ''));
  if (!content) return null;

  let node = content;
  for (const segment of ref.slice(hashIdx + 1).split('/').filter(Boolean)) {
    if (node === null || typeof node !== 'object') return null;
    node = node[segment];
  }
  return node ?? null;
}

export async function build({ contentDir, resolvedDir }) {
const docs = discover(resolvedDir).map(load);
const outDir = resolve(contentDir, 'api-reference');
const hubHref = relative(outDir, join(contentDir, 'index.html'));
const { name: projectName, repo } = loadConfig(contentDir);
mkdirSync(outDir, { recursive: true });
readdirSync(outDir).filter(f => f.endsWith('.html')).forEach(f => rmSync(resolve(outDir, f)));

// Resolved source files this tool reads — shown in each page's header metadata.
const SOURCE_SUFFIXES = ['openapi', 'state-machine'];

// Every component library merged, then partitioned by what OpenAPI says each
// object is. Matching on shape rather than on a filename or a per-file type
// means libraries can be added, renamed or split without touching this.
const allComponents = Object.assign(
  {},
  ...docs.filter((d) => d.type === 'components').map((d) => d.content)
);
const componentsWhere = (predicate) =>
  Object.fromEntries(Object.entries(allComponents).filter(([, v]) => predicate(v)));

// Parameter Objects — covers SearchQueryParam, LimitParam, etc.
const sharedParams = componentsWhere(v => v?.in && v?.name);

// Response Objects. `description` without `type` distinguishes them from the
// schema entries that share these files.
const sharedResponses = componentsWhere(v => v?.description && !v?.type);

// ── Load + dereference all OpenAPI specs ──────────────────────────────────

const specs = (
  await Promise.all(
    docs
      .filter((d) => d.type === 'openapi')
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(async (doc) => {
        const absPath = doc.path;
        const slug = basename(absPath).replace('-openapi.yaml', '');
        try {
          const raw  = doc.content;
          const spec = await $RefParser.dereference(absPath);
          if (!spec?.info || !spec?.paths) return null;
          // The Doc answers for its own refs; the set is the pool it
          // resolves them against.
          const fileMap = doc.externalRefs(docs);
          return { slug, spec, raw, fileMap, doc };
        } catch {
          return null;
        }
      })
  )
).filter(Boolean);

// ── Constants ─────────────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

// ── Endpoint relationship index ───────────────────────────────────────────
// Maps "method:path" → { type, domain, id } from x-relationship on generated
// operations. Used to link endpoints back to their source contract artifacts.

const relIndex = new Map(); // "method:path" → { type, domain, id }

try {
  for (const entry of docs) {
    if (entry.type !== 'openapi') continue;
    for (const [path, pathItem] of Object.entries(entry.content?.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = pathItem?.[method];
        const rel = op?.['x-relationship'];
        if (!rel?.type || rel.type === 'fk') continue;
        if (!rel.domain || !rel.id) continue;
        relIndex.set(`${method}:${path}`, rel);
      }
    }
  }
} catch { /* resolvedDir missing or unreadable — silently skip */ }

// ── Enum display ──────────────────────────────────────────────────────────

/** Render enum values as chips under a "Values" label. */
function renderEnumValues(values) {
  if (!values?.length) return '';
  const chips = values.map(v => `<code class="value-chip">${esc(String(v))}</code>`).join('');
  return `<div class="values"><span class="values-label">Values</span>${chips}</div>`;
}

/** A field's type as plain text: `string · date`, or the schema it names. */
function fieldType(type, format = '') {
  return `<span class="ftype">${esc(type)}${format ? ` · ${esc(format)}` : ''}</span>`;
}

const REQUIRED = `<span class="freq">required</span>`;

/** The fields an object has, through allOf and array items, for a preview. */
function childNames(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 4) return [];
  if (schema.type === 'array' && schema.items) return childNames(schema.items, depth + 1);
  return [...new Set([
    ...Object.keys(schema.properties ?? {}),
    ...(schema.allOf ?? []).flatMap((part) => childNames(part, depth + 1)),
  ])];
}

/** A collapsed object's fields at a glance, as API docs show them: `{ city, state, street, +1 }`. */
function childPreview(schema) {
  const names = childNames(schema).sort();
  if (!names.length) return '';
  const shown = names.slice(0, 3);
  return `<span class="fpreview">{ ${shown.map(esc).join(', ')}${names.length > shown.length ? `, +${names.length - shown.length}` : ''} }</span>`;
}

// ── Schema type inference ─────────────────────────────────────────────────

function typeStr(schema) {
  if (!schema || typeof schema !== 'object') return 'any';
  // OAS 3.1 allows type to be an array e.g. ["string", "null"]
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.filter(t => t !== 'null');
    return nonNull.length ? nonNull.join('|') : 'null';
  }
  if (schema.type === 'array') {
    const items = schema.items;
    const inner = items ? (items.enum ? 'enum' : typeStr(items)) : 'any';
    return `array[${inner}]`;
  }
  if (schema.enum)       return 'enum';
  if (schema.type)       return String(schema.type);
  if (schema.allOf) {
    for (const s of schema.allOf) {
      if (s && typeof s === 'object' && s.type) return typeStr(s);
    }
    return 'object';
  }
  if (schema.oneOf)      return 'oneOf';
  if (schema.anyOf)      return 'anyOf';
  if (schema.properties) return 'object';
  return 'any';
}

// ── Schema renderer ───────────────────────────────────────────────────────
//
// Renders a schema as a nested property tree. depth guards against cycles
// in self-referential schemas (e.g. recursive tree nodes).
//
// rawSchemas: raw.components.schemas — used to detect named $ref chips at
//             each level so that composition is visible instead of a flat dump.
// rawSchema:  the raw (pre-dereference) counterpart of `schema` at this level,
//             used to read property-level $ref names before they were resolved.

const SCHEMA_PREFIX = '#/components/schemas/';

/** Collect raw property definitions from a raw schema, flattening allOf parts.
 *  Handles the common pattern of allOf: [{ $ref: BaseSchema }, { properties: {...} }]
 *  where properties are split across allOf entries.
 *  When fileMap is provided, external $defs refs (e.g. ./schemas/domain/foo.yaml#/$defs/Bar)
 *  are followed via resolveExternalDefRef so their properties are included. */
function getRawProps(rawSchema, fileMap = null) {
  if (!rawSchema || typeof rawSchema !== 'object') return {};
  if (rawSchema.properties) return rawSchema.properties;
  if (Array.isArray(rawSchema.allOf)) {
    return Object.assign({}, ...rawSchema.allOf.map(s => {
      if (typeof s?.['$ref'] === 'string' && !s['$ref'].startsWith('#') && fileMap) {
        const sourceSchema = resolveDefRef(s['$ref'], fileMap);
        return getRawProps(sourceSchema, fileMap);
      }
      return getRawProps(s, fileMap);
    }));
  }
  return {};
}

/** Extract a named component schema ref from a raw property definition.
 *  Returns { name, isArray } when the property references a named schema,
 *  or null when it is an anonymous/inline type.
 *  Handles both #/components/schemas/Name and external file#/$defs/Name refs. */
function namedPropRef(rawProp) {
  if (!rawProp || typeof rawProp !== 'object') return null;

  const extractRef = (ref) => (typeof ref === 'string' ? ref.split('#').pop().split('/').filter(Boolean).pop() ?? null : null);

  // Direct object ref
  const directName = extractRef(rawProp['$ref']);
  if (directName) return { name: directName, isArray: false };

  // allOf wrapping a single ref (common OAS pattern for description overrides)
  if (Array.isArray(rawProp.allOf)) {
    for (const s of rawProp.allOf) {
      const n = extractRef(s?.['$ref']);
      if (n) return { name: n, isArray: false };
    }
  }

  // Array of named schema items: { type: 'array', items: { $ref: '...' } }
  if (rawProp.type === 'array') {
    const itemName = extractRef(rawProp.items?.['$ref']);
    if (itemName) return { name: itemName, isArray: true };
  }

  return null;
}

/** Render a oneOf/anyOf schema as a collapsible "(one of)" row with per-variant accordions.
 *  @param {string|null} typeName  Optional schema name to show as a type chip (e.g. "EvaluationFact") */
function renderOneOfBlock(variants, discriminatorProp, depth, rawSchemas, fileMap, typeName = null, fieldPath = '', dataDictHref = null, validPaths = null) {
  const pad = 0;
  const variantPad = pad;
  const variantsHtml = variants.map(v => {
    let title = v.title;
    if (!title && discriminatorProp) {
      const enumVal = v.properties?.[discriminatorProp]?.enum?.[0]
        ?? v.properties?.[discriminatorProp]?.const;
      if (enumVal != null) title = `${discriminatorProp}: ${enumVal}`;
    }
    title ??= v.description?.split(/[.,]/)[0]?.trim() ?? 'Variant';
    const inner = renderProps(v, depth + 1, rawSchemas, null, fileMap, fieldPath, dataDictHref, validPaths);
    return `<details style="border-top:1px solid #ede8f5;">
      <summary style="list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:6px;padding:4px ${variantPad}px;background:rgba(124,92,191,0.03);">
        <span class="chevron" style="font-size:9px;color:#7c5cbf;flex-shrink:0;margin-top:2px;">&#x25B6;</span>
        <span style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#7c5cbf;">${esc(title)}</span>
      </summary>
      ${inner || `<div style="padding:4px ${variantPad + 20}px;font-size:11px;color:#aaa;font-style:italic;">No additional fields</div>`}
    </details>`;
  }).join('');
  const typeChip = typeName
    ? `<span style="font-family:monospace;font-size:11px;font-weight:600;color:${COLORS.midBlue};background:${COLORS.paleBlue};border:1px solid ${COLORS.lightBlue};border-radius:4px;padding:1px 6px;">${esc(typeName)}</span>`
    : '';
  return `<div style="padding:7px 0;">
    <details>
      <summary style="list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
        <span class="chevron" style="font-size:9px;color:#aaa;flex-shrink:0;margin-top:2px;">&#x25B6;</span>
        <span style="font-family:monospace;font-size:12px;font-weight:600;color:#aaa;">(one of)</span>
        ${typeChip}
      </summary>
      <div class="nested">${variantsHtml}</div>
    </details>
  </div>`;
}

function renderProps(schema, depth = 0, rawSchemas = null, rawSchema = null, fileMap = null, fieldPath = '', dataDictHref = null, validPaths = null, alsoRequired = []) {
  if (depth > 8 || !schema || typeof schema !== 'object') return '';

  // Merge allOf into a single view, propagating the correct raw schema for each entry.
  // A part may only list what's required of fields another part declares —
  // `allOf: [{ $ref: Writable }, { required: [...] }]` — so every part's
  // required list applies to the fields of all of them.
  if (schema.allOf) {
    const rawAllOf = rawSchema?.allOf ?? [];
    const required = [...alsoRequired, ...schema.allOf.flatMap((part) => part?.required ?? [])];
    return schema.allOf
      .filter(s => s && typeof s === 'object')
      .map((s, i) => {
        const rawEntry = rawAllOf[i];
        let entryRaw = null;
        if (rawEntry?.['$ref'] && !rawEntry['$ref'].startsWith('#') && fileMap) {
          entryRaw = resolveDefRef(rawEntry['$ref'], fileMap) ?? null;
        } else if (rawEntry && !rawEntry['$ref']) {
          entryRaw = rawEntry;
        }
        return renderProps(s, depth, rawSchemas, entryRaw, fileMap, fieldPath, dataDictHref, validPaths, required);
      })
      .join('');
  }

  // Render array schemas as a collapsible "[] items" row showing the item shape
  if (schema.type === 'array' && schema.items && typeof schema.items === 'object') {
    const pad = 0;
    const items = schema.items;
    const rawItems = rawSchema?.items ?? null;
    const rawItemRef = rawItems?.['$ref'] ?? null;
    const itemRefName = rawItemRef ? (namedPropRef({ '$ref': rawItemRef })?.name ?? null) : null;
    const itemTypeLabel = itemRefName ?? typeStr(items);
    const innerHtml = renderProps(items, depth + 1, rawSchemas, itemRefName ? (rawSchemas?.[itemRefName] ?? null) : rawItems, fileMap, fieldPath, dataDictHref, validPaths);
    const typeChip = `<span style="font-family:monospace;font-size:11px;font-weight:600;color:${COLORS.midBlue};background:${COLORS.paleBlue};border:1px solid ${COLORS.lightBlue};border-radius:4px;padding:1px 6px;">${esc(itemTypeLabel)}</span>`;
    return `<div style="padding:7px 0;">
      <details>
        <summary style="list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
          <span class="chevron" style="font-size:9px;color:#aaa;flex-shrink:0;margin-top:2px;">&#x25B6;</span>
          <span style="font-family:monospace;font-size:12px;font-weight:600;color:#aaa;">[] items</span>
          ${typeChip}
        </summary>
        ${innerHtml
          ? `<div class="nested">${innerHtml}</div>`
          : `<div style="padding:6px 12px 6px ${pad + 20}px;font-size:11px;color:#aaa;font-style:italic;">No additional fields</div>`}
      </details>
    </div>`;
  }

  // Render oneOf/anyOf as a collapsible "(one of)" row containing per-variant accordions
  if (schema.oneOf || schema.anyOf) {
    const typeName = schema.title ?? schema['x-schema-name'] ?? null;
    return renderOneOfBlock(schema.oneOf ?? schema.anyOf, schema.discriminator?.propertyName ?? null, depth, rawSchemas, fileMap, typeName, fieldPath, dataDictHref, validPaths);
  }

  const props    = schema.properties ?? {};
  const reqs     = new Set([...(schema.required ?? []), ...alsoRequired]);
  const rawProps = getRawProps(rawSchema, fileMap);
  const pad      = 0;

  // Render additionalProperties as a synthetic "* (any key)" row when there
  // are no explicit properties — covers map-typed schemas like EvaluationResult.
  const additionalPropsHtml = (() => {
    if (Object.keys(props).length > 0) return '';
    const ap = schema.additionalProperties;
    if (!ap || typeof ap !== 'object') return '';
    // Prefer the raw ref name (works for both component and external base schema refs)
    // since the dereferenced schema has already had $ref replaced with the inline object.
    const rawApRef = rawSchema?.additionalProperties?.['$ref'] ?? ap['$ref'] ?? null;
    const refName = rawApRef ? (namedPropRef({ '$ref': rawApRef })?.name ?? null) : null;
    // When the map value type is itself a oneOf/anyOf, surface it directly as a "(one of)"
    // row rather than nesting: (any key) → type → (one of).
    const apVariants = ap.oneOf ?? ap.anyOf ?? null;
    if (apVariants) {
      return renderOneOfBlock(apVariants, ap.discriminator?.propertyName ?? null, depth, rawSchemas, fileMap, refName, fieldPath, dataDictHref, validPaths);
    }
    const typeLabel = refName ?? typeStr(ap);
    const innerSchema = ap.type === 'object' || ap.properties || ap.allOf ? ap : null;
    const innerRaw    = refName ? (rawSchemas?.[refName] ?? null) : null;
    const innerHtml   = innerSchema ? renderProps(innerSchema, depth + 1, rawSchemas, innerRaw, fileMap, fieldPath, dataDictHref, validPaths) : '';
    // Simple scalar map — no meaningful inner content, show as flat note
    if (!innerHtml) {
      return `<div style="padding:7px 0;display:flex;align-items:baseline;gap:6px;">
        <span style="font-family:monospace;font-size:11px;color:#aaa;">{ [key: string]:</span>
        <span style="font-family:monospace;font-size:11px;font-weight:600;color:${COLORS.midBlue};background:${COLORS.paleBlue};border:1px solid ${COLORS.lightBlue};border-radius:4px;padding:1px 6px;">${esc(typeLabel)}</span>
        <span style="font-family:monospace;font-size:11px;color:#aaa;">}</span>
      </div>`;
    }
    return `<div style="padding:7px 0;">
      <details>
        <summary style="list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
          <span class="chevron" style="font-size:9px;color:#aaa;flex-shrink:0;margin-top:2px;">&#x25B6;</span>
          <span style="font-family:monospace;font-size:12px;font-weight:600;color:#aaa;">* (any key)</span>
          <span style="font-family:monospace;font-size:11px;font-weight:600;color:${COLORS.midBlue};background:${COLORS.paleBlue};border:1px solid ${COLORS.lightBlue};border-radius:4px;padding:1px 6px;">${esc(typeLabel)}</span>
        </summary>
        <div class="nested">${innerHtml}</div>
      </details>
    </div>`;
  })();

  if (additionalPropsHtml) return additionalPropsHtml;

  return Object.entries(props).map(([name, prop]) => {
    if (!prop || typeof prop !== 'object') return '';

    const isReq    = reqs.has(name);
    const desc     = prop.description ?? '';
    const rawProp  = rawProps[name] ?? null;
    const named    = rawSchemas ? namedPropRef(rawProp) : null;

    // Named schema ref — render as an expandable chip showing the schema name.
    // The expanded content is the dereferenced schema so readers can inspect fields.
    if (named) {
      const { name: refName, isArray } = named;
      const typeLabel = isArray ? `array[${refName}]` : refName;
      const innerSchema = isArray ? prop.items : prop;
      const innerRaw    = rawSchemas?.[refName] ?? null;
      const propPath    = fieldPath ? `${fieldPath}.${name}` : name;
      // Pagination list wrappers use `items` as their payload property; the data dict
      // path skips this level (application.id, not application.items[].id).
      const isListItems = isArray && name === 'items';
      const innerPath   = isListItems ? fieldPath : (isArray ? `${propPath}[]` : propPath);
      const innerHtml   = renderProps(innerSchema, depth + 1, rawSchemas, innerRaw, fileMap, innerPath, dataDictHref, validPaths);
      const readOnly    = prop.readOnly  ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">read-only</span>` : '';
      const writeOnly   = prop.writeOnly ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">write-only</span>` : '';
      const dataDictPath = (validPaths && !validPaths.has(innerPath)) ? null : innerPath;
      const nameHtml = (dataDictHref && dataDictPath)
        ? fieldNameLink(name, `${dataDictHref}#field-${encodeURIComponent(dataDictPath)}`)
        : `<span style="font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.text};">${esc(name)}</span>`;
      return `<div style="padding:7px 0;">
        <details>
          <summary class="field-summary">
            <span class="field-head">
              <span class="chevron">&#x25B6;</span>
              ${nameHtml}
              ${fieldType(typeLabel)}
              ${childPreview(innerSchema)}
              ${isReq ? REQUIRED : ''}
              ${readOnly}${writeOnly}
            </span>
            ${desc ? `<span class="fdesc">${esc(desc)}</span>` : ''}
          </summary>
          ${innerHtml
            ? `<div class="nested">${innerHtml}</div>`
            : `<div style="padding:6px 12px 6px ${pad + 20}px;font-size:11px;color:#aaa;font-style:italic;">No additional fields</div>`}
        </details>
      </div>`;
    }

    const type     = typeStr(prop);
    const enumVals = prop.enum
      ? renderEnumValues(prop.enum)
      : prop.type === 'array' && prop.items?.enum
        ? renderEnumValues(prop.items.enum)
        : '';
    const readOnly  = prop.readOnly  ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">read-only</span>` : '';
    const writeOnly = prop.writeOnly ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">write-only</span>` : '';

    // Determine what to recurse into (inline anonymous objects)
    let inner = null;
    const isArrayProp = prop.type === 'array';
    if (prop.type === 'object' || prop.properties || prop.allOf || prop.oneOf || prop.anyOf) inner = prop;
    else if (isArrayProp && prop.items && typeof prop.items === 'object') {
      const items = prop.items;
      if (items.type === 'object' || items.properties || items.allOf) inner = items;
    }

    const propPath    = fieldPath ? `${fieldPath}.${name}` : name;
    const isListItems = isArrayProp && name === 'items';
    const innerPath   = isListItems ? fieldPath : (isArrayProp ? `${propPath}[]` : propPath);
    const children = inner ? renderProps(inner, depth + 1, rawSchemas, null, fileMap, innerPath, dataDictHref, validPaths) : '';
    const hasCh = children.trim().length > 0;

    const dataDictPath = (validPaths && !validPaths.has(innerPath)) ? null : innerPath;
    const nameHtml = (dataDictHref && dataDictPath)
      ? fieldNameLink(name, `${dataDictHref}#field-${encodeURIComponent(dataDictPath)}`)
      : `<span style="font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.text};">${esc(name)}</span>`;

    // An object's own fields start folded away, its names previewed.
    if (hasCh) {
      return `<div class="field">
        <details>
          <summary class="field-summary">
            <span class="field-head">
              <span class="chevron">&#x25B6;</span>
              ${nameHtml}
              ${fieldType(type, prop.format)}
              ${childPreview(inner)}
              ${isReq ? REQUIRED : ''}
              ${readOnly}${writeOnly}
            </span>
            ${desc ? `<span class="fdesc">${esc(desc)}</span>` : ''}
          </summary>
          ${enumVals}
          <div class="nested">${children}</div>
        </details>
      </div>`;
    }

    return `<div class="field">
      <div class="field-head">
        ${nameHtml}
        ${fieldType(type, prop.format)}
        ${isReq ? REQUIRED : ''}
        ${readOnly}${writeOnly}
      </div>
      ${desc ? `<div class="fdesc">${esc(desc)}</div>` : ''}
      ${enumVals}
    </div>`;
  }).join('');
}

/** Derive the data dictionary root path prefix from a component schema name.
 *  Strips common write-variant suffixes so "ApplicationCreate" → "application",
 *  matching the path prefix used in the field inventory. */

function renderSchema(schema, rawSchemas = null, rawSchema = null, fileMap = null, rootPrefix = '', dataDictHref = null, validPaths = null) {
  if (!schema || typeof schema !== 'object') return '';

  if (schema.type === 'array' && schema.items) {
    const itemsBody = renderProps(schema.items, 0, rawSchemas, rawSchema, fileMap, rootPrefix, dataDictHref, validPaths);
    const itemsDesc = itemsBody.trim()
      ? `<div style="font-size:10px;font-weight:700;letter-spacing:0.04em;color:#888;padding:5px 12px;background:#fafafa;border-bottom:1px solid #f0f0f0;">Array items:</div>${itemsBody}`
      : typeBadge(typeStr(schema));
    return itemsDesc;
  }

  const body = renderProps(schema, 0, rawSchemas, rawSchema, fileMap, rootPrefix, dataDictHref, validPaths);
  if (body.trim()) return body;
  return `<div style="padding:8px 12px;">${typeBadge(typeStr(schema))}</div>`;
}

// ── Schema link helpers ───────────────────────────────────────────────────

/** Extract the schema name from a local $ref, or null if not a local component schema ref. */
function localRef(obj) {
  const ref = obj?.['$ref'] ?? obj?.schema?.['$ref'] ?? obj?.content?.['application/json']?.schema?.['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    return ref.slice('#/components/schemas/'.length);
  }
  return null;
}

/** Extract the parameter name from a $ref pointing to a named parameter, or null.
 *  Handles both internal (#/components/parameters/Name) and external file refs
 *  (./components/parameters.yaml#/Name) since the resolved spec uses both. */
function localParamRef(rawParam) {
  const ref = rawParam?.['$ref'];
  if (typeof ref !== 'string') return null;
  // Internal: #/components/parameters/Name
  if (ref.startsWith('#/components/parameters/')) return ref.slice('#/components/parameters/'.length);
  // External file: ./components/parameters.yaml#/Name  or  ../components/parameters.yaml#/Name
  const fileMatch = ref.match(/parameters\.yaml#\/(.+)$/);
  if (fileMatch) return fileMatch[1];
  return null;
}

/** Extract the response name from a $ref pointing to a named shared response, or null. */
function localResponseRef(rawResponse) {
  const ref = rawResponse?.['$ref'];
  if (typeof ref !== 'string') return null;
  if (ref.startsWith('#/components/responses/')) return ref.slice('#/components/responses/'.length);
  const fileMatch = ref.match(/responses\.yaml#\/(.+)$/);
  if (fileMatch) return fileMatch[1];
  return null;
}

const CHIP_STYLE = `display:inline-flex;align-items:center;gap:4px;font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.midBlue};background:${COLORS.paleBlue};border:1px solid ${COLORS.lightBlue};border-radius:4px;padding:2px 8px;text-decoration:none;cursor:pointer;`;

function schemaLink(name, eid = '') {
  return eid
    ? expandChip(esc(name), eid, CHIP_STYLE)
    : `<a href="#schema-${esc(name)}" style="${CHIP_STYLE}"><span class="chip-arrow" style="font-size:9px;opacity:0.7;">&#x25B6;</span> ${esc(name)}</a>`;
}

function responseLink(name, eid = '') {
  return eid
    ? expandChip(esc(name), eid, CHIP_STYLE)
    : `<a href="#response-${esc(name)}" style="${CHIP_STYLE}"><span class="chip-arrow" style="font-size:9px;opacity:0.7;">&#x25B6;</span> ${esc(name)}</a>`;
}

// ── Parameter table ───────────────────────────────────────────────────────

// paramNameByKey: Map of "name:in" → component parameter name, built per spec in buildDomainPage.
const PARAM_GROUPS = [['path', 'Path parameters'], ['query', 'Query parameters'], ['header', 'Headers'], ['cookie', 'Cookies']];

/**
 * Parameters as a list, grouped by where each goes, as most API docs show
 * them: name, type and whether it's required on one line, the description
 * beneath. A long description shows its first paragraph, with the rest a
 * click away.
 */
function renderParams(params, paramNameByKey = new Map(), rawParams = []) {
  if (!params?.length) return '';

  const item = (p, i) => {
    if (!p || typeof p !== 'object') return '';
    const rawP    = rawParams[i];
    const refName = localRef(rawP);
    const schema  = p.schema ?? {};
    const type    = refName ? schemaLink(refName) : fieldType(typeStr(schema), schema.format);
    const [first, ...rest] = (p.description ?? '').trim().split(/\n\s*\n/);
    const more    = rest.length ? `<details class="more"><summary>More</summary>${renderMarkdown(rest.join('\n\n'))}</details>` : '';
    return `<div class="param" data-param="${esc(p.name ?? '')}" data-in="${esc(p.in ?? '')}"${p.required ? ' data-required' : ''}>
      <div class="field-head">
        <code class="fname">${esc(p.name ?? '')}</code>
        ${type}
        ${p.required ? REQUIRED : ''}
      </div>
      ${first ? `<div class="fdesc">${renderMarkdown(first)}</div>` : ''}
      ${more}
      ${!refName ? renderEnumValues(schema.enum) : ''}
    </div>`;
  };

  const indexed = params.map((p, i) => [p, i]);
  return PARAM_GROUPS.map(([where, label]) => {
    const group = indexed.filter(([p]) => p?.in === where);
    if (!group.length) return '';
    return `<div class="op-section params-section">
      <h4 class="op-h">${label}</h4>
      ${group.map(([p, i]) => item(p, i)).join('')}
    </div>`;
  }).join('');
}

// ── Request body ──────────────────────────────────────────────────────────

function renderRequestBody(reqBody, rawReqBody, rawSchemas = null, fileMap = null, dataDictHref = null, validPaths = null, domainSlug = '', prefixOf = () => null) {
  if (!reqBody) return '';
  const content    = reqBody.content ?? {};
  const mediaType  = content['application/json'] ?? Object.values(content)[0] ?? {};
  const schema     = mediaType.schema;
  if (!schema) return '';

  const refName = localRef(rawReqBody);
  const type = Object.keys(content)[0] ?? 'application/json';
  const fields = refName
    ? renderSchema(schema, rawSchemas, rawSchemas?.[refName] ?? null, fileMap, prefixOf(refName) ?? domainSlug, dataDictHref, validPaths)
    : renderSchema(schema, rawSchemas, null, fileMap, domainSlug, dataDictHref, validPaths);

  return `<div class="op-section request-body-section">
    <h4 class="op-h">Body
      ${refName ? `<span class="schema-name">${esc(refName)}</span>` : ''}
      <span class="pill">${esc(type)}</span>
      ${reqBody.required ? `<span class="pill pill-req">required</span>` : ''}
    </h4>
    <div class="body-fields">${fields}</div>
  </div>`;
}
// ── Response section ──────────────────────────────────────────────────────

function renderResponses(responses, rawResponses = {}, rawSchemas = null, fileMap = null, dataDictHref = null, validPaths = null, domainSlug = '', prefixOf = () => null) {
  if (!responses || !Object.keys(responses).length) return '';

  // One tab per status, the first open: most readers want the success.
  const statuses = Object.entries(responses).filter(([, resp]) => resp);
  const tabs = statuses.map(([status], i) => {
    const n = parseInt(status, 10);
    const kind = n >= 200 && n < 300 ? 'ok' : n >= 400 ? 'bad' : 'other';
    return `<button type="button" class="resp-tab resp-${kind}${i === 0 ? ' on' : ''}" data-resp="${i}">${esc(status)}</button>`;
  }).join('');

  const panels = statuses.map(([status, resp], i) => {
    const content    = resp.content ?? {};
    const mediaType  = content['application/json'] ?? Object.values(content)[0] ?? {};
    const schema     = mediaType.schema;
    const responseRefName = localResponseRef(rawResponses[status]);
    const schemaRefName   = !responseRefName ? localRef(rawResponses[status]) : null;
    const rawSchema  = schemaRefName ? (rawSchemas?.[schemaRefName] ?? null) : null;
    const rootPrefix = schemaRefName ? (prefixOf(schemaRefName) ?? domainSlug) : domainSlug;
    const name       = schemaRefName ?? responseRefName;
    const type       = Object.keys(content)[0];
    const fields     = schema ? renderSchema(schema, rawSchemas, rawSchema, fileMap, rootPrefix, dataDictHref, validPaths) : '';
    return `<div class="resp-panel" data-resp="${i}"${i === 0 ? '' : ' hidden'}>
      <div class="fdesc">${inlineMd(resp.description ?? '')}${name ? ` <span class="schema-name">${esc(name)}</span>` : ''}${type ? ` <span class="pill">${esc(type)}</span>` : ''}</div>
      ${fields ? `<div class="body-fields">${fields}</div>` : ''}
    </div>`;
  }).join('');

  return `<div class="op-section responses-section">
    <h4 class="op-h">Responses</h4>
    <div class="resp-tabs" role="tablist">${tabs}</div>
    ${panels}
  </div>`;
}

// ── Endpoint block ────────────────────────────────────────────────────────

/** The element id an operation's card has, for links and the sidebar. */
function endpointId(method, path) {
  return `op-${method}-${path.replace(/\//g, '-').replace(/[{}]/g, '').replace(/--+/g, '-').replace(/^-|-$/g, '')}`;
}

function renderEndpoint(path, method, op, rawOp = {}, paramNameByKey = new Map(), rawSchemas = null, fileMap = null, dataDictHref = null, validPaths = null, domainSlug = '', prefixOf = () => null, tryFile = null) {
  const id       = endpointId(method, path);
  const params   = op.parameters ?? [];
  const descHtml = op.description
    ? `<div style="padding:12px 16px;border-top:1px solid #f0f0f0;">${renderMarkdown(op.description)}</div>`
    : '';

  const rel = relIndex.get(`${method.toLowerCase()}:${path}`);
  const relBadge = (() => {
    if (!rel) return '';
    const compStyle = `font-size:10px;border:1px solid;border-radius:3px;padding:1px 6px;text-decoration:none;white-space:nowrap;`;
    if (rel.type === 'state-machine-action') {
      return stateMachineLink(stateMachineDocsHref(rel.domain, rel.id), `State machine action: ${rel.id}`);
    }
    if (rel.type === 'ruleset') {
      return rulesLink(rulesDocsHref(rel.domain, rel.id), `Rules: ${rel.id}`);
    }
    if (rel.type === 'composition') {
      return `<span style="${compStyle}background:#f0fdf4;border-color:#bbf7d0;color:#15803d;" title="Composition: ${esc(rel.id)}">Composition</span>`;
    }
    return '';
  })();

  // Where Send fills in a Try it panel, once the mock has loaded.
  const tryAttrs = tryFile && op.operationId ? ` data-try-op="${esc(op.operationId)}" data-try-file="${esc(tryFile)}"` : '';
  return `<div id="${id}" class="content-item op-${esc(method.toLowerCase())}"${tryAttrs} style="border:1px solid ${COLORS.sandDark};border-radius:6px;margin-bottom:6px;overflow:hidden;">
  <details>
    <summary class="op-row" style="display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer;list-style:none;user-select:none;">
      <span style="font-size:10px;color:#aaa;width:10px;flex-shrink:0;" class="chevron">▶</span>
      <span class="op-line">
        ${methodBadge(method)}
        <code class="op-path">${esc(path)}</code>
        ${op.summary ? `<span class="op-name">${esc(op.summary)}</span>` : ''}
      </span>
      ${op.operationId ? `<code class="op-id" title="operationId">${esc(op.operationId)}</code>` : ''}
      <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
        ${op.deprecated ? `<span style="font-size:9px;font-weight:700;color:#7A4800;background:${COLORS.lightYellow};border:1px solid ${COLORS.warmYellow};border-radius:3px;padding:1px 6px;">DEPRECATED</span>` : ''}
        ${relBadge}
        <a href="#${id}" class="permalink" title="Link to this endpoint">#</a>
      </span>
    </summary>
    <div class="op-body">
      <div class="op-docs">
        ${descHtml}
        ${renderParams(params, paramNameByKey, rawOp?.parameters ?? [])}
        ${renderRequestBody(op.requestBody, rawOp?.requestBody, rawSchemas, fileMap, dataDictHref, validPaths, domainSlug, prefixOf)}
      </div>
      <aside class="op-side">${renderResponses(op.responses, rawOp?.responses ?? {}, rawSchemas, fileMap, dataDictHref, validPaths, domainSlug, prefixOf)}</aside>
    </div>
  </details>
</div>`;
}

// ── Domain page ───────────────────────────────────────────────────────────

const SCHEMA_SUFFIXES = ['List', 'Create', 'Update', 'Writable'];

/**
 * What a domain's data dictionary holds, read from its field inventory: the
 * field paths it has an entry for, and where each schema sits in them.
 *
 * Links used to be built from schema names alone — `Decision` linked as
 * `decision.id`, though the dictionary has it as `determination.decisions[].id`,
 * and a list's `total` linked too — so most of them led nowhere. The inventory
 * is what the dictionary page is built from, so it is the authority on both.
 *
 * @returns {{ fields: Set<string>|null, prefixOf: (schemaName: string) => string|null }}
 */
function readDictionary(inventoryPath) {
  if (!existsSync(inventoryPath)) return { fields: null, prefixOf: () => null };

  const fields = new Set();
  const prefixes = new Map();
  let section = null;
  let sectionSeen = true;
  for (const line of readFileSync(inventoryPath, 'utf8').split('\n')) {
    const header = line.match(/^# ── (\w+) /);
    if (header) { section = header[1]; sectionSeen = false; continue; }
    const entry = line.match(/^([a-z][^:]*): \{ type: (?:list\()?([A-Z]\w*)?/);
    if (!entry) continue;
    const [, path, typeName] = entry;
    fields.add(path);
    if (typeName && !prefixes.has(typeName)) prefixes.set(typeName, path);
    // A root resource's section has no entry naming its type; its fields start
    // with the resource's own name.
    if (!sectionSeen) {
      sectionSeen = true;
      if (!prefixes.has(section)) prefixes.set(section, typeName === section ? path : path.split('.')[0]);
    }
  }

  const prefixOf = (name) => {
    if (prefixes.has(name)) return prefixes.get(name);
    const suffix = SCHEMA_SUFFIXES.find((s) => name.endsWith(s) && prefixes.has(name.slice(0, -s.length)));
    return suffix ? prefixes.get(name.slice(0, -suffix.length)) : null;
  };
  return { fields, prefixOf };
}

// The sidebar's operations: a name that wraps, and its method, small, at the right.
const NAV_STYLE = `
  /* An operation's sections: plain headings and lists, one box only, the card. */
  /* Closed, an operation is one line tinted by its method, as Swagger lists
     them: method, path, name. Open, it's the two columns. */
  .op-line { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .op-path { font: 600 13px monospace; color: ${COLORS.text}; word-break: break-all; }
  .op-name { font-size: 13px; color: #555; }
  .op-id { font-size: 11px; color: #999; flex-shrink: 0; }
  .content-item.op-get    { border-color: ${METHOD_STYLE.get.border} !important; }    .op-get > details > summary    { background: ${METHOD_STYLE.get.bg}66; }
  .content-item.op-post   { border-color: ${METHOD_STYLE.post.border} !important; }   .op-post > details > summary   { background: ${METHOD_STYLE.post.bg}88; }
  .content-item.op-patch, .content-item.op-put { border-color: ${METHOD_STYLE.patch.border} !important; } .op-patch > details > summary, .op-put > details > summary { background: ${METHOD_STYLE.patch.bg}88; }
  .content-item.op-delete { border-color: ${METHOD_STYLE.delete.border} !important; } .op-delete > details > summary { background: ${METHOD_STYLE.delete.bg}88; }
  .content-item > details[open] > summary { border-bottom: 1px solid rgba(0,0,0,0.06); }
  .op-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 28px; padding: 2px 18px 16px; font-size: 12.5px; line-height: 1.45; }
  /* The request and the responses beside the docs, where there's room. */
  @media (min-width: 1100px) {
    .op-body:has(.op-side:not(:empty)) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .op-side { align-self: start; }
  }
  .op-side:empty { display: none; }
  /* Evenly spaced, whatever is showing: hidden items take no room. */
  .op-side { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
  .op-side > * { margin-top: 0 !important; flex-shrink: 0; }
  .op-section { margin-top: 12px; }
  .op-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; font-weight: 700; color: ${COLORS.text}; padding-bottom: 4px; margin-bottom: 2px; border-bottom: 1px solid #ececec; }
  .param, .field { padding: 5px 0; }
  .field-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .fname { font: 600 12.5px monospace; color: ${COLORS.text}; }
  .ftype { font: 11.5px monospace; color: #777; }
  .fpreview { font: 11.5px monospace; color: #999; }
  .freq { font-size: 11.5px; color: ${COLORS.richRed}; }
  .fdesc { display: block; color: #555; margin-top: 1px; }
  .fdesc p { margin: 0; }
  .values { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 3px; }
  .values-label { font-size: 11px; color: #888; margin-right: 4px; }
  .value-chip { font: 11.5px monospace; border: 1px solid #ddd; border-radius: 4px; padding: 0 6px; background: #fff; }
  .nested { margin: 0 0 2px 5px; padding-left: 12px; border-left: 2px solid #eeeaf8; }
  .field-summary { list-style: none; cursor: pointer; display: block; padding: 0; background: none !important; }
  .field-summary .chevron { font-size: 9px; color: #aaa; }
  details.more > summary { list-style: none; cursor: pointer; font-size: 12px; color: ${COLORS.midBlue}; background: none !important; }
  details.more[open] > summary { margin-bottom: 4px; }
  .schema-name { font: 600 12px monospace; color: ${COLORS.midBlue}; }
  .pill { font: 400 11px sans-serif; color: #666; border: 1px solid #ddd; border-radius: 10px; padding: 0 8px; }
  .pill-req { color: ${COLORS.richRed}; border-color: #f3c2c2; }
  .resp-tabs { display: flex; gap: 2px; margin: 0 0 4px; border-bottom: 1px solid #ececec; }
  .resp-tab { font: 600 12px monospace; padding: 3px 10px; border: 0; border-bottom: 2px solid transparent; background: none; color: #888; cursor: pointer; margin-bottom: -1px; }
  .resp-tab.on { color: ${COLORS.text}; border-bottom-color: ${COLORS.midBlue}; }
  .resp-tab.resp-ok.on { border-bottom-color: ${COLORS.deepGreen}; }
  .resp-tab.resp-bad.on { border-bottom-color: ${COLORS.richRed}; }

  a.nav-group { display: block; text-decoration: none; }
  a.nav-group:hover { color: rgba(255,255,255,0.7); }
  #sidebar a.nav-op { flex-wrap: nowrap; align-items: flex-start; padding: 4px 0.75rem 4px 1.1rem; line-height: 1.35; }
  .nav-op-name { flex: 1; min-width: 0; }
  .nav-method { flex-shrink: 0; font: 700 9px monospace; letter-spacing: 0.04em; margin-top: 2px; }
  .nav-method-get { color: #86efac; } .nav-method-post { color: #a5b4fc; }
  .nav-method-put, .nav-method-patch { color: #fcd34d; } .nav-method-delete { color: #fca5a5; }
`;

// Going to an operation, from the sidebar or a link, opens it; a response
// tab shows its response.
const OPEN_ON_NAV = `
  document.addEventListener('click', (event) => {
    const tab = event.target.closest('.resp-tab');
    if (!tab) return;
    const section = tab.closest('.responses-section');
    for (const other of section.querySelectorAll('.resp-tab')) other.classList.toggle('on', other === tab);
    for (const panel of section.querySelectorAll('.resp-panel')) panel.hidden = panel.dataset.resp !== tab.dataset.resp;
  });
  const openTarget = () => {
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    const details = target?.matches('.content-item') ? target.querySelector(':scope > details') : null;
    if (details && !details.open) details.open = true;
  };
  addEventListener('hashchange', openTarget);
  openTarget();
  // The sidebar goes to an operation without putting it in the address, so a
  // reload starts from the top; an operation's own # link is the one to share.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('#sidebar a.nav-op');
    if (!link) return;
    const target = document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
    if (!target) return;
    event.preventDefault();
    const details = target.querySelector(':scope > details');
    if (details && !details.open) details.open = true;
    target.scrollIntoView({ block: 'start' });
  });
`;


function buildDomainPage({ slug, spec, raw, fileMap = new Map(), doc = null }) {
  // Which document the page's operations are sent from, in the mock.
  const tryFile = doc ? doc.relativePath : null;
  // Only where there is one to link to. A data dictionary is built from a
  // domain's annotations, so a domain with none gets no page — and every
  // field on this page pointed into it regardless, which is hundreds of
  // dead links per domain. Data dictionaries are built before this tool, so
  // the answer is on disk by now.
  //
  // A dictionary is per domain and this page is per document, so it's found
  // by the document's domain: platform-events and platform-registries both
  // read the platform dictionary.
  const dictSlug = spec.info?.['x-domain'] ?? slug;
  const dataDictFile = resolve(contentDir, 'data-dictionaries', `${dictSlug}.html`);
  const dataDictHref = existsSync(dataDictFile) ? `../data-dictionaries/${dictSlug}.html` : null;
  const dictionary = readDictionary(resolve(contentDir, 'data-dictionaries', `${dictSlug}-field-inventory.yaml`));
  const metaSubtitle = headerMetaSubtitle(slug, resolvedSourcePairs(slug, resolvedDir, { include: SOURCE_SUFFIXES }, repo));

  const info       = spec.info ?? {};
  const paths      = spec.paths ?? {};
  const tags       = spec.tags ?? [];
  const tagMap     = new Map(tags.map(t => [t.name, t.description ?? '']));
  // Raw (pre-dereference) component schemas — used to detect named $ref chips in renderProps.
  const rawSchemas = raw?.components?.schemas ?? null;

  // Merge spec-local and shared (external file) component parameters.
  // sharedParams covers SearchQueryParam, LimitParam, OffsetParam, SortParam which
  // are referenced via ./components/parameters.yaml#/Name and never bundled into components.parameters.
  const allComponentParams = { ...sharedParams, ...(spec.components?.parameters ?? {}) };

  // Reverse map: "name:in" → component parameter name.
  const paramNameByKey = new Map();
  for (const [pName, pDef] of Object.entries(allComponentParams)) {
    if (pDef?.name && pDef?.in) paramNameByKey.set(`${pDef.name}:${pDef.in}`, pName);
  }

  // Collect all operations grouped by tag
  const byTag = new Map(); // tag → [{path, method, op}]

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    // Path-level parameters inherited by all operations
    const pathParams = pathItem.parameters ?? [];

    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op) continue;

      // Merge path-level params (op params override by name)
      const opParams  = op.parameters ?? [];
      const nameInSet = new Set(opParams.map(p => `${p.name}:${p.in}`));
      const merged    = [
        ...pathParams.filter(p => !nameInSet.has(`${p.name}:${p.in}`)),
        ...opParams,
      ];
      const opWithParams = { ...op, parameters: merged };

      // Raw (pre-dereference) operation — used to detect local $ref links.
      // Merge raw path-level + op-level params in the same order as the dereferenced merge.
      const rawPathItem  = raw?.paths?.[path] ?? {};
      const rawOpBase    = rawPathItem[method] ?? {};
      const rawPathParams = rawPathItem.parameters ?? [];
      const rawOpParams   = rawOpBase.parameters ?? [];
      const rawOpNames   = new Set(rawOpParams.map(p => localParamRef(p) ?? p?.name));
      const rawMerged    = [
        ...rawPathParams.filter(p => !rawOpNames.has(localParamRef(p) ?? p?.name)),
        ...rawOpParams,
      ];
      const rawOp = { ...rawOpBase, parameters: rawMerged };

      // Infer a group from the path when no tags are declared.
      // Uses the second static segment (after the root collection) so that e.g.
      // /applications/{id}/review/… → "Review" and
      // /applications/{id}/review-progress/{s}/… → "Review Progress".
      const inferredTag = (() => {
        const staticSegs = path.split('/').filter(s => s && !s.startsWith('{'));
        const seg = staticSegs[1] ?? staticSegs[0] ?? 'Other';
        return titleCase(seg);
      })();
      const opTags = op.tags?.length ? op.tags : [inferredTag];
      for (const tag of opTags) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag).push({ path, method, op: opWithParams, rawOp });
      }
    }
  }

  // Count total endpoints
  const total = [...byTag.values()].reduce((n, ops) => n + ops.length, 0);

  // Sidebar nav — uses nav-link / nav-section classes from lib/layout.js
  // Show last 2 path segments to keep nav readable on long paths; full path on hover.
  function navPath(p) {
    const segs = p.split('/').filter(Boolean);
    return segs.length > 2 ? '/' + segs.slice(-2).join('/') : p;
  }

  const schemaNames   = Object.keys(spec.components?.schemas ?? {});
  const paramNames    = Object.keys(allComponentParams);
  const responseNames = Object.keys(sharedResponses);

  function sectionId(tag) {
    return `section-${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  }

  // Each group's operations by name, with the method beside each, so a
  // reader goes straight to one rather than to its group.
  const navHtml = [...byTag.entries()].map(([tag, ops]) => `<div class="nav-section">
    <a href="#${sectionId(tag)}" class="nav-section-label nav-group">${esc(tag)}</a>
    ${ops.map(({ path, method, op }) => `<a href="#${endpointId(method, path)}" class="nav-link nav-op" title="${esc(method.toUpperCase())} ${esc(path)}">
      <span class="nav-op-name">${esc(op.summary ?? path)}</span>
      <span class="nav-method nav-method-${esc(method.toLowerCase())}">${esc(method.toUpperCase() === 'DELETE' ? 'DEL' : method.toUpperCase())}</span>
    </a>`).join('')}
  </div>`).join('');

  // Main content sections — nav links point to tag sections; endpoint cards are content-items within
  const sections = [...byTag.entries()].map(([tag, ops]) => {
    const tagDesc = tagMap.get(tag) ?? '';
    const endpoints = ops.map(({ path, method, op, rawOp }) => renderEndpoint(path, method, op, rawOp, paramNameByKey, rawSchemas, fileMap, dataDictHref, dictionary.fields, slug, dictionary.prefixOf, tryFile)).join('');
    return `<section id="${sectionId(tag)}" style="margin-bottom:2.5rem;">
      <div style="margin-bottom:1rem;">
        <h2 style="font-size:1rem;font-weight:800;color:${COLORS.darkBlue};margin-bottom:0.25rem;">${esc(tag)}</h2>
        ${tagDesc ? `<p style="font-size:12px;color:#666;">${esc(tagDesc)}</p>` : ''}
      </div>
      ${endpoints}
    </section>`;
  }).join('');

  const serverUrl = spec.servers?.[0]?.url ?? '';

  const headerHtml = `<div style="background:${COLORS.darkBlue};color:${COLORS.white};">
    <div style="padding:0.625rem 1.25rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:0.9375rem;font-weight:800;">${esc(info.title ?? slug)}</span>
      <span style="font-size:11px;font-family:monospace;color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;">v${esc(info.version ?? '')}</span>
      ${statusBadge(info['x-status'])}
      <span style="font-size:11px;color:rgba(255,255,255,0.35);margin-left:auto;">${total} endpoint${total !== 1 ? 's' : ''}</span>
    </div>
    ${metaSubtitle}
    ${tryFile ? '<div id="try-it-bar"></div>' : ''}
  </div>`;

  // Where operations have code, each shows the server it calls, so the page
  // doesn't repeat it above them.
  const baseUrl = serverUrl && !tryFile
    ? `<div style="margin-top:10px;font-size:11px;color:#888;">Base URL: <code style="font-size:11px;color:#555;background:#f0f0f0;padding:1px 5px;border-radius:3px;">${esc(serverUrl)}</code></div>`
    : '';
  const intro = info.description || baseUrl
    ? `<div style="margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid ${COLORS.sandDark};">
      ${info.description ? `<div style="max-width:720px;">${renderMarkdown(info.description)}</div>` : ''}
      ${baseUrl}
    </div>`
    : '';
  const mainHtml = `${intro}${sections}`;

  const page = twoColumnPage({
    title: `${projectName} \u2014 ${esc(info.title ?? slug)}`,
    breadcrumbs: [
      { label: 'Explorer',      href: hubHref },
      { label: 'API Reference', href: 'index.html'       },
      { label: info.title ?? slug },
    ],
    headerHtml,
    navHtml,
    mainHtml,
    navWidth: 260,
    navSearch: true,
    extraStyle: NAV_STYLE,
  });
  const withNav = page.replace('</body>', () => `<script>${OPEN_ON_NAV}</script>\n</body>`);
  if (!tryFile) return withNav;
  // The mock loads after the page has rendered, so reading never waits on it.
  return withNav.replace('</body>', () => `<script src="../mock/mock.js" defer></script>
<script src="../mock/contracts.js" defer></script>
<script type="module">
if (globalThis.BlueprintMock && globalThis.BlueprintContracts) {
  BlueprintMock.mountSendPanels({ contracts: BlueprintContracts, version: BlueprintContractsVersion, scope: new URL('../mock/', location.href).href });
}
</script>
</body>`);
}

// ── Index (landing) page ──────────────────────────────────────────────────

function countEndpoints(spec) {
  return Object.values(spec.paths ?? {}).reduce((n, pathItem) => {
    if (!pathItem || typeof pathItem !== 'object') return n;
    return n + HTTP_METHODS.filter(m => pathItem[m]).length;
  }, 0);
}

function buildIndexPage(entries) {
  // Group by x-domain; preserve insertion order (specs are already sorted)
  const byDomain = new Map();
  for (const entry of entries) {
    const domain = entry.spec.info?.['x-domain'] ?? entry.slug;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(entry);
  }

  const cardStyle = `display:block;background:${COLORS.white};border:1px solid ${COLORS.sandDark};border-radius:8px;padding:1.25rem 1.25rem 1rem;text-decoration:none;`;
  const hoverOn  = `this.style.borderColor='${COLORS.midBlue}';this.style.boxShadow='0 2px 8px rgba(86,80,190,0.1)'`;
  const hoverOff = `this.style.borderColor='${COLORS.sandDark}';this.style.boxShadow=''`;

  const cards = [...byDomain.entries()].map(([domain, domainEntries]) => {
    // Use the "primary" spec (non-adapter, or first) for title/description/status
    const primary = domainEntries.find(e => !e.slug.endsWith('-adapter')) ?? domainEntries[0];
    const info    = primary.spec.info ?? {};
    const totalEndpoints = domainEntries.reduce((n, e) => n + countEndpoints(e.spec), 0);
    const desc    = info.description
      ? info.description.split('\n').find(l => l.trim()) ?? ''
      : '';

    const domainLabel = titleCase(domain);

    const apiLinks = domainEntries.map(({ slug, spec }) => {
      const apiTitle = spec.info?.title ?? slug;
      const version  = spec.info?.version ?? '';
      const badge    = statusBadge(spec.info?.['x-status']);
      return `<a href="${esc(slug)}.html" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;text-decoration:none;color:${COLORS.text};" onmouseover="this.style.background='${COLORS.paleBlue}'" onmouseout="this.style.background=''">
        <span style="font-size:12px;font-weight:600;color:${COLORS.midBlue};flex:1;">${esc(apiTitle)}</span>
        <span style="font-size:10px;font-family:monospace;color:#aaa;flex-shrink:0;">v${esc(version)}</span>
        ${badge}
      </a>`;
    }).join('');

    return `<div style="${cardStyle}">
      <div style="margin-bottom:0.25rem;">
        <span style="font-size:1rem;font-weight:800;color:${COLORS.darkBlue};">${esc(domainLabel)}</span>
      </div>
      ${desc ? `<p style="font-size:12px;color:#666;line-height:1.5;margin-bottom:0.75rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(desc)}</p>` : ''}
      <div style="border:1px solid ${COLORS.sandDark};border-radius:4px;overflow:hidden;margin-top:0.5rem;">${apiLinks}</div>
    </div>`;
  }).join('');

  const domainCount = byDomain.size;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${projectName} \u2014 API Reference</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; color: ${COLORS.text}; min-height: 100vh; }
  </style>
</head>
<body>

  ${breadcrumb([
    { label: 'Explorer',      href: hubHref },
    { label: 'API Reference' },
  ])}

  <div style="background:${COLORS.darkBlue};color:${COLORS.white};padding:1.25rem 1.5rem 1.125rem;">
    <h2 style="font-size:1.25rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:0.2rem;">API Reference</h2>
    <p style="font-size:0.8125rem;color:rgba(255,255,255,0.55);">Static reference for ${domainCount} contract domains. No running server required.</p>
  </div>

  <div style="max-width:1100px;margin:2rem auto;padding:0 1.5rem 4rem;">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
      ${cards}
    </div>
  </div>

  <footer style="border-top:1px solid ${COLORS.sandDark};background:${COLORS.white};padding:1.5rem 2rem;text-align:center;font-size:12px;color:${COLORS.textLight};">
    <a href="${repo?.url ?? '#'}" style="color:${COLORS.midBlue};text-decoration:none;">${projectName}</a>
    &nbsp;·&nbsp; Code for America
  </footer>

</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────

for (const entry of specs) {
  const html = buildDomainPage(entry);
  writeFileSync(resolve(outDir, `${entry.slug}.html`), html, 'utf8');
  console.log(`  Written: ${entry.slug}.html`);
}

const indexHtml = buildIndexPage(specs);
writeFileSync(resolve(outDir, 'index.html'), indexHtml, 'utf8');
console.log(`  Written: index.html`);
} // end build()

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contentArg  = process.argv.find(a => a.startsWith('--content='));
  const resolvedArg = process.argv.find(a => a.startsWith('--resolved='));
  if (!contentArg) {
    console.error('Usage: node api-reference.js --content=<path> [--resolved=<path>]');
    process.exit(1);
  }
  build({
    contentDir:  resolve(process.cwd(), contentArg.slice('--content='.length)),
    resolvedDir: resolvedArg ? resolve(process.cwd(), resolvedArg.slice('--resolved='.length)) : null,
  }).catch(e => { console.error(e); process.exit(1); });
}
