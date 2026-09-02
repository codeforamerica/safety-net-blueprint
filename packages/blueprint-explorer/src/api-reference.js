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

import { writeFileSync, readdirSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { COLORS, FONT } from './lib/theme.js';
import { esc, titleCase, breadcrumb, statusBadge, methodBadge, typeBadge, nextEid, expandHidden, expandChip, headerMetaSubtitle } from './lib/html.js';
import { inlineMd, renderMarkdown } from './lib/markdown.js';
import { twoColumnPage, singleColumnPage } from './lib/layout.js';
import { resolvedDir, resolvedSourcePairs } from './lib/paths.js';
import { resolveExternalDefRef, loadContractFiles, loadExternalRefs } from '@codeforamerica/blueprint-core';

const __dirname  = dirname(fileURLToPath(import.meta.url));

const contractFiles = loadContractFiles(resolvedDir);

const contentArg = process.argv.find(a => a.startsWith('--content='));
if (!contentArg) {
  console.error('Usage: node api-reference.js --content=<path> [--resolved=<path>]');
  process.exit(1);
}
const contentDir = resolve(process.cwd(), contentArg.slice('--content='.length));
const outDir = resolve(contentDir, 'api-reference');
mkdirSync(outDir, { recursive: true });
readdirSync(outDir).filter(f => f.endsWith('.html')).forEach(f => rmSync(resolve(outDir, f)));

// Resolved source files this tool reads — shown in each page's header metadata.
const SOURCE_SUFFIXES = ['openapi', 'state-machine'];

// Shared parameters from the resolved components — covers SearchQueryParam, LimitParam, etc.
const sharedParams = [...contractFiles.values()].find(e => e.type === 'parameters')?.content ?? {};

// Shared responses (BadRequest, NotFound, etc.) from the resolved components.
// Filter to only response objects (have `description`) — excludes the Error schema entry.
const rawSharedResponses = [...contractFiles.values()].find(e => e.type === 'responses')?.content ?? {};
const sharedResponses = Object.fromEntries(Object.entries(rawSharedResponses).filter(([, v]) => v?.description && !v?.type));

// ── Load + dereference all OpenAPI specs ──────────────────────────────────

const specs = (
  await Promise.all(
    [...contractFiles.entries()]
      .filter(([, e]) => e.type === 'openapi')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([absPath, entry]) => {
        const slug = basename(absPath).replace('-openapi.yaml', '');
        try {
          const raw  = entry.content;
          const spec = await $RefParser.dereference(absPath);
          if (!spec?.info || !spec?.paths) return null;
          const fileMap = loadExternalRefs(absPath, raw, contractFiles);
          return { slug, spec, raw, fileMap };
        } catch {
          return null;
        }
      })
  )
).filter(Boolean);

// ── Constants ─────────────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

// ── State machine reverse index ───────────────────────────────────────────
// Maps "method:path" → [{domain, actionId, actionDesc}]

const SM_RPC_RE = /^(GET|POST|PATCH|PUT|DELETE)\s+(\S+)/i;
const smActionIndex = new Map(); // "method:path" → [{domain, actionId, actionDesc}]

try {
  const smEntries = [...contractFiles.entries()].filter(([, e]) => e.type === 'state-machine');
  for (const [, smEntry] of smEntries) {
    const sm = smEntry.content;
    if (!sm?.apiSpec) continue;
    const domain = sm.domain;
    for (const machine of sm.machines ?? []) {
      for (const action of machine.actions ?? []) {
        const match = action.description ? SM_RPC_RE.exec(action.description) : null;
        if (!match) continue;
        const key = `${match[1].toLowerCase()}:${match[2]}`;
        if (!smActionIndex.has(key)) smActionIndex.set(key, []);
        smActionIndex.get(key).push({ domain, actionId: action.id, actionDesc: action.description ?? '' });
      }
    }
  }
} catch { /* contractsDir missing or unreadable — silently skip */ }

// ── Enum display ──────────────────────────────────────────────────────────

const ENUM_VALUE_STYLE = `font-size:10px;background:#f0f0f0;padding:0 3px;border-radius:2px;`;
const ENUM_LABEL_STYLE = `font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#999;margin-right:4px;`;

/** Render enum values as a compact chip list with an "enum" label. */
function renderEnumValues(values) {
  if (!values?.length) return '';
  const chips = values.map(v => `<code style="${ENUM_VALUE_STYLE}">${esc(String(v))}</code>`).join(' ');
  return `<div style="margin-top:3px;display:flex;flex-wrap:wrap;align-items:baseline;gap:3px;"><span style="${ENUM_LABEL_STYLE}">enum</span>${chips}</div>`;
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
    const inner = schema.items ? typeStr(schema.items) : 'any';
    return `array[${inner}]`;
  }
  if (schema.type)       return String(schema.type);
  if (schema.allOf)      return 'object';
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
        const { sourceSchema } = resolveExternalDefRef(s['$ref'], fileMap);
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

  function extractRef(ref) {
    if (typeof ref !== 'string') return null;
    if (ref.startsWith(SCHEMA_PREFIX)) return ref.slice(SCHEMA_PREFIX.length);
    const defsMatch = ref.match(/#\/\$defs\/(.+)$/);
    if (defsMatch) return defsMatch[1];
    return null;
  }

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

function renderProps(schema, depth = 0, rawSchemas = null, rawSchema = null, fileMap = null) {
  if (depth > 8 || !schema || typeof schema !== 'object') return '';

  // Merge allOf into a single view
  if (schema.allOf) {
    return schema.allOf
      .filter(s => s && typeof s === 'object')
      .map(s => renderProps(s, depth, rawSchemas, rawSchema, fileMap))
      .join('');
  }

  // Render oneOf/anyOf as labeled variant blocks
  if (schema.oneOf || schema.anyOf) {
    const variants = schema.oneOf ?? schema.anyOf;
    const pad = 12 + depth * 20;
    return variants.map((v, i) => {
      const title = v.title ?? `Variant ${i + 1}`;
      const inner = renderProps(v, depth, rawSchemas, null, fileMap);
      return `<div style="border-top:1px solid #ede8f5;background:rgba(124,92,191,0.03);">
        <div style="padding:3px ${pad}px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#7c5cbf;">${esc(title)}</div>
        ${inner || `<div style="padding:4px ${pad}px;font-size:11px;color:#aaa;font-style:italic;">No additional fields</div>`}
      </div>`;
    }).join('');
  }

  const props    = schema.properties ?? {};
  const reqs     = new Set(schema.required ?? []);
  const rawProps = getRawProps(rawSchema, fileMap);
  const pad      = 12 + depth * 20;

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
      const innerHtml   = renderProps(innerSchema, depth + 1, rawSchemas, innerRaw, fileMap);
      const readOnly    = prop.readOnly  ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">read-only</span>` : '';
      const writeOnly   = prop.writeOnly ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">write-only</span>` : '';
      return `<div style="border-top:1px solid #f2f2f2;padding:6px 12px 6px ${pad}px;">
        <details>
          <summary style="list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
            <span class="chevron" style="font-size:9px;color:#aaa;flex-shrink:0;margin-top:2px;">&#x25B6;</span>
            <span style="font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.text};">${esc(name)}</span>
            <span style="font-family:monospace;font-size:11px;font-weight:600;color:${COLORS.midBlue};background:${COLORS.paleBlue};border:1px solid ${COLORS.lightBlue};border-radius:4px;padding:1px 6px;">${esc(typeLabel)}</span>
            ${isReq ? `<span style="font-size:9px;font-weight:700;color:${COLORS.richRed};letter-spacing:0.04em;text-transform:uppercase;">required</span>` : ''}
            ${readOnly}${writeOnly}
            ${desc ? `<span style="font-size:11px;color:#555;margin-left:2px;">${esc(desc)}</span>` : ''}
          </summary>
          ${innerHtml
            ? `<div style="border-top:1px solid #f0f0f0;background:rgba(0,0,0,0.012);">${innerHtml}</div>`
            : `<div style="padding:6px 12px 6px ${pad + 20}px;font-size:11px;color:#aaa;font-style:italic;">No additional fields</div>`}
        </details>
      </div>`;
    }

    const type     = typeStr(prop);
    const enumVals = prop.enum
      ? renderEnumValues(prop.enum)
      : '';
    const formatTag = prop.format
      ? `<span style="font-size:10px;color:#999;font-family:monospace;"> (${esc(prop.format)})</span>` : '';
    const readOnly  = prop.readOnly  ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">read-only</span>` : '';
    const writeOnly = prop.writeOnly ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">write-only</span>` : '';

    // Determine what to recurse into (inline anonymous objects)
    let inner = null;
    if (prop.type === 'object' || prop.properties || prop.allOf) inner = prop;
    else if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
      const items = prop.items;
      if (items.type === 'object' || items.properties || items.allOf) inner = items;
    }

    const children = inner ? renderProps(inner, depth + 1, rawSchemas, null, fileMap) : '';
    const hasCh = children.trim().length > 0;

    return `<div style="display:flex;flex-direction:column;border-top:1px solid #f2f2f2;padding:6px 12px 6px ${pad}px;${hasCh ? 'background:rgba(0,0,0,0.015);' : ''}">
      <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
        <span style="font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.text};">${esc(name)}</span>
        ${typeBadge(type)}${formatTag}
        ${isReq ? `<span style="font-size:9px;font-weight:700;color:${COLORS.richRed};letter-spacing:0.04em;text-transform:uppercase;">required</span>` : ''}
        ${readOnly}${writeOnly}
        ${desc ? `<span style="font-size:11px;color:#555;margin-left:2px;">${esc(desc)}</span>` : ''}
      </div>
      ${enumVals}
    </div>
    ${children}`;
  }).join('');
}

function renderSchema(schema, rawSchemas = null, rawSchema = null, fileMap = null) {
  if (!schema || typeof schema !== 'object') return '';

  if (schema.type === 'array' && schema.items) {
    const itemsBody = renderProps(schema.items, 0, rawSchemas, rawSchema, fileMap);
    const itemsDesc = itemsBody.trim()
      ? `<div style="font-size:10px;font-weight:700;letter-spacing:0.04em;color:#888;padding:5px 12px;background:#fafafa;border-bottom:1px solid #f0f0f0;">Array items:</div>${itemsBody}`
      : typeBadge(typeStr(schema));
    return itemsDesc;
  }

  const body = renderProps(schema, 0, rawSchemas, rawSchema, fileMap);
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
// Used to detect named component params without fragile raw-array index matching.
function renderParams(params, paramNameByKey = new Map(), rawParams = []) {
  if (!params?.length) return '';

  const rows = params.map((p, i) => {
    if (!p || typeof p !== 'object') return '';
    const rawP      = rawParams[i];
    const refName   = localRef(rawP);
    const schema    = p.schema ?? {};
    const type      = typeStr(schema);
    const typeCell  = refName ? schemaLink(refName) : typeBadge(type);
    const enumVals  = (!refName && schema.enum)
      ? renderEnumValues(schema.enum)
      : '';
    // Detect named component params via: (1) raw $ref name, or (2) name:in reverse lookup
    const componentParamName = localParamRef(rawP) ?? (p.name && p.in ? paramNameByKey.get(`${p.name}:${p.in}`) : undefined);
    if (componentParamName) {
      const desc = p.description ?? '';
      // Only expand if the expanded panel would show something beyond a short description:
      // long description or enum values (which can be numerous). Scalar metadata like
      // default/minimum/maximum/example is shown inline and doesn't warrant an expand.
      const shouldExpand = desc.length > 80 || schema.enum?.length > 0;
      if (shouldExpand) {
        const eid = nextEid();
        const expandContent = `${renderMarkdown(desc)}${renderEnumValues(schema.enum)}`;
        const nameCell = `<span role="button" tabindex="0" data-expand-id="${eid}" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.midBlue};"><span class="chevron" style="font-size:9px;opacity:0.6;">&#x25B6;</span>${esc(p.name ?? '')}</span>`;
        // Expand row spans all columns so content gets full table width (avoids clipping)
        const expandRow = `<tr id="${eid}" style="display:none"><td colspan="5" style="padding:4px 12px 10px;background:#fafafa;border-top:none;">${expandContent}</td></tr>`;
        return `<tr>
          <td style="padding:5px 12px;white-space:nowrap;">${nameCell}</td>
          <td style="padding:5px 12px;">${typeCell}</td>
          <td style="padding:5px 12px;font-size:10px;color:#888;font-family:monospace;">${esc(p.in ?? '')}</td>
          <td style="padding:5px 12px;text-align:center;">${p.required ? `<span style="font-size:9px;font-weight:700;color:${COLORS.richRed};">✓</span>` : ''}</td>
          <td style="padding:5px 12px;color:#999;font-size:11px;font-style:italic;">${esc(desc.split('\n')[0].slice(0, 80))}</td>
        </tr>${expandRow}`;
      }
    }
    const descCell = `${renderMarkdown(p.description ?? '')}${enumVals}`;
    return `<tr>
      <td style="padding:5px 12px;white-space:nowrap;font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.text};">${esc(p.name ?? '')}</td>
      <td style="padding:5px 12px;">${typeCell}</td>
      <td style="padding:5px 12px;font-size:10px;color:#888;font-family:monospace;">${esc(p.in ?? '')}</td>
      <td style="padding:5px 12px;text-align:center;">${p.required ? `<span style="font-size:9px;font-weight:700;color:${COLORS.richRed};">✓</span>` : ''}</td>
      <td style="padding:5px 12px;">${descCell}</td>
    </tr>`;
  }).join('');

  const thStyle = `padding:5px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#888;text-align:left;background:#fafafa;border-bottom:1px solid #eee;`;

  return `<div style="margin-top:16px;">
    <div style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#888;padding:5px 12px;background:#fafafa;border:1px solid #eee;border-bottom:none;border-radius:4px 4px 0 0;">Parameters</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;">
      <thead><tr>
        <th style="${thStyle}">Name</th>
        <th style="${thStyle}">Type</th>
        <th style="${thStyle}">In</th>
        <th style="${thStyle}">Req</th>
        <th style="${thStyle}">Description</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ── Request body ──────────────────────────────────────────────────────────

function renderRequestBody(reqBody, rawReqBody, rawSchemas = null, fileMap = null) {
  if (!reqBody) return '';
  const content    = reqBody.content ?? {};
  const mediaType  = content['application/json'] ?? Object.values(content)[0] ?? {};
  const schema     = mediaType.schema;
  if (!schema) return '';

  const refName = localRef(rawReqBody);
  let bodyContent;
  if (refName) {
    const rawSchema = rawSchemas?.[refName] ?? null;
    bodyContent = `<details style="border:1px solid #eee;border-radius:0 0 4px 4px;overflow:hidden;">
      <summary style="list-style:none;cursor:pointer;padding:8px 12px;display:flex;align-items:center;gap:6px;background:#fafafa;">
        <span class="chevron" style="font-size:9px;color:#aaa;">&#x25B6;</span>
        <span style="font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.midBlue};">${esc(refName)}</span>
      </summary>
      <div style="border-top:1px solid #eee;">${renderSchema(schema, rawSchemas, rawSchema, fileMap)}</div>
    </details>`;
  } else {
    bodyContent = `<div style="border:1px solid #eee;border-radius:0 0 4px 4px;overflow:hidden;">${renderSchema(schema, rawSchemas, null, fileMap)}</div>`;
  }

  return `<div style="margin-top:16px;">
    <div style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#888;padding:5px 12px;background:#fafafa;border:1px solid #eee;border-bottom:none;border-radius:4px 4px 0 0;">
      Request body${reqBody.required ? ` <span style="color:${COLORS.richRed};font-weight:700;">required</span>` : ''}
    </div>
    ${bodyContent}
  </div>`;
}

// ── Response section ──────────────────────────────────────────────────────

function renderResponses(responses, rawResponses = {}, rawSchemas = null, fileMap = null) {
  if (!responses || !Object.keys(responses).length) return '';

  const entries = Object.entries(responses).map(([status, resp]) => {
    if (!resp) return '';
    const statusNum = parseInt(status, 10);
    const statusColor = statusNum >= 200 && statusNum < 300 ? COLORS.deepGreen
      : statusNum >= 400 && statusNum < 500 ? COLORS.richRed
      : statusNum >= 500 ? '#7A4800' : '#444';

    const content   = resp.content ?? {};
    const mediaType = content['application/json'] ?? Object.values(content)[0] ?? {};
    const schema    = mediaType.schema;

    // Check for named shared response ref first, then named schema ref
    const responseRefName = localResponseRef(rawResponses[status]);
    const schemaRefName   = !responseRefName ? localRef(rawResponses[status]) : null;
    let schemaHtml = '';
    if (responseRefName) {
      const inner = schema
        ? renderSchema(schema, rawSchemas, null, fileMap)
        : `<div style="padding:8px 12px;font-size:12px;color:#555;">${esc(resp.description ?? '')}</div>`;
      schemaHtml = `<details style="border-top:1px solid #f0f0f0;">
        <summary style="list-style:none;cursor:pointer;padding:8px 12px;display:flex;align-items:center;gap:6px;background:#fafafa;">
          <span class="chevron" style="font-size:9px;color:#aaa;">&#x25B6;</span>
          <span style="font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.midBlue};">${esc(responseRefName)}</span>
        </summary>
        <div style="border-top:1px solid #f0f0f0;">${inner}</div>
      </details>`;
    } else if (schemaRefName) {
      const rawSchema = rawSchemas?.[schemaRefName] ?? null;
      schemaHtml = `<details style="border-top:1px solid #f0f0f0;">
        <summary style="list-style:none;cursor:pointer;padding:8px 12px;display:flex;align-items:center;gap:6px;background:#fafafa;">
          <span class="chevron" style="font-size:9px;color:#aaa;">&#x25B6;</span>
          <span style="font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.midBlue};">${esc(schemaRefName)}</span>
        </summary>
        <div style="border-top:1px solid #f0f0f0;">${renderSchema(schema, rawSchemas, rawSchema, fileMap)}</div>
      </details>`;
    } else if (schema) {
      schemaHtml = `<div style="border-top:1px solid #f0f0f0;">${renderSchema(schema, rawSchemas, null, fileMap)}</div>`;
    }

    return `<div style="border-top:1px solid #eee;">
      <div style="display:flex;align-items:center;gap:8px;padding:5px 12px;background:#fafafa;">
        <span style="font-size:11px;font-weight:700;font-family:monospace;color:${statusColor};">${esc(status)}</span>
        <span style="font-size:11px;color:#555;">${inlineMd(resp.description ?? '')}</span>
      </div>
      ${schemaHtml}
    </div>`;
  }).join('');

  return `<div style="margin-top:16px;">
    <div style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#888;padding:5px 12px;background:#fafafa;border:1px solid #eee;border-bottom:none;border-radius:4px 4px 0 0;">Responses</div>
    <div style="border:1px solid #eee;border-radius:0 0 4px 4px;overflow:hidden;">${entries}</div>
  </div>`;
}

// ── Endpoint block ────────────────────────────────────────────────────────

function endpointId(path, method) {
  return `op-${method}-${path.replace(/\//g, '-').replace(/[{}]/g, '').replace(/--+/g, '-').replace(/^-|-$/g, '')}`;
}

function renderEndpoint(path, method, op, rawOp = {}, paramNameByKey = new Map(), rawSchemas = null, fileMap = null) {
  const id       = endpointId(path, method);
  const params   = op.parameters ?? [];
  const descHtml = op.description
    ? `<div style="padding:12px 16px;border-top:1px solid #f0f0f0;">${renderMarkdown(op.description)}</div>`
    : '';

  const smEntries = smActionIndex.get(`${method.toLowerCase()}:${path}`) ?? [];
  const smBadges = smEntries.map(({ domain, actionId, actionDesc }) => {
    const trimmedDesc = actionDesc.length > 80 ? actionDesc.slice(0, 80) + '…' : actionDesc;
    return `<a href="../state-machine-docs/${domain}.html#action-${actionId}" style="font-size:10px;background:#f0ecff;border:1px solid #d4c5f5;border-radius:3px;padding:1px 6px;color:#6b4fa8;text-decoration:none;white-space:nowrap;" title="${esc(actionId)}: ${esc(trimmedDesc)}">State machine →</a>`;
  }).join(' ');

  return `<div id="${id}" class="content-item" style="border:1px solid ${COLORS.sandDark};border-radius:6px;margin-bottom:10px;overflow:hidden;">
  <details>
    <summary style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:#fafafa;cursor:pointer;list-style:none;user-select:none;">
      <span style="font-size:10px;color:#aaa;width:12px;flex-shrink:0;margin-top:3px;" class="chevron">▶</span>
      <span style="flex-shrink:0;margin-top:1px;">${methodBadge(method)}</span>
      <span style="flex:1;min-width:0;">
        <code style="font-size:13px;font-weight:600;color:${COLORS.text};word-break:break-all;">${esc(path)}</code>
        ${op.summary ? `<span style="display:block;font-size:12px;color:#666;margin-top:2px;">${esc(op.summary)}</span>` : ''}
      </span>
      <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
        ${op.deprecated ? `<span style="font-size:9px;font-weight:700;color:#7A4800;background:${COLORS.lightYellow};border:1px solid ${COLORS.warmYellow};border-radius:3px;padding:1px 6px;">DEPRECATED</span>` : ''}
        ${smBadges}
        <a href="#${id}" class="permalink" title="Link to this endpoint">#</a>
      </span>
    </summary>
    <div style="padding:12px 16px;">
      ${descHtml}
      ${renderParams(params, paramNameByKey, rawOp?.parameters ?? [])}
      ${renderRequestBody(op.requestBody, rawOp?.requestBody, rawSchemas, fileMap)}
      ${renderResponses(op.responses, rawOp?.responses ?? {}, rawSchemas, fileMap)}
    </div>
  </details>
</div>`;
}

// ── Domain page ───────────────────────────────────────────────────────────

function buildDomainPage({ slug, spec, raw, fileMap = new Map() }) {
  const metaSubtitle = headerMetaSubtitle(slug, resolvedSourcePairs(slug, { include: SOURCE_SUFFIXES }));

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

  const navHtml = [...byTag.entries()].map(([tag, ops]) =>
    `<a href="#${sectionId(tag)}" class="nav-link">${esc(tag)} <span class="nav-count">${ops.length}</span></a>`
  ).join('');

  // Main content sections — nav links point to tag sections; endpoint cards are content-items within
  const sections = [...byTag.entries()].map(([tag, ops]) => {
    const tagDesc = tagMap.get(tag) ?? '';
    const endpoints = ops.map(({ path, method, op, rawOp }) => renderEndpoint(path, method, op, rawOp, paramNameByKey, rawSchemas, fileMap)).join('');
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
  </div>`;

  const mainHtml = `
    <div style="margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid ${COLORS.sandDark};">
      ${info.description ? `<div style="max-width:720px;">${renderMarkdown(info.description)}</div>` : ''}
      ${serverUrl ? `<div style="margin-top:10px;font-size:11px;color:#888;">Base URL: <code style="font-size:11px;color:#555;background:#f0f0f0;padding:1px 5px;border-radius:3px;">${esc(serverUrl)}</code></div>` : ''}
    </div>
    ${sections}`;

  return twoColumnPage({
    title: `Safety Net Blueprint \u2014 ${esc(info.title ?? slug)}`,
    breadcrumbs: [
      { label: 'Explorer',      href: '../../index.html' },
      { label: 'API Reference', href: 'index.html'       },
      { label: info.title ?? slug },
    ],
    headerHtml,
    navHtml,
    mainHtml,
    navWidth: 260,
    navSearch: true,
  });
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
  <title>Safety Net Blueprint \u2014 API Reference</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; color: ${COLORS.text}; min-height: 100vh; }
  </style>
</head>
<body>

  ${breadcrumb([
    { label: 'Explorer',      href: '../../index.html' },
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
    <a href="https://github.com/codeforamerica/safety-net-blueprint" style="color:${COLORS.midBlue};text-decoration:none;">Safety Net Blueprint</a>
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
