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

import { writeFileSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { COLORS, FONT } from '../../lib/theme.js';
import { esc, titleCase, breadcrumb } from '../../lib/html.js';

// ── Markdown renderer ─────────────────────────────────────────────────────
// Handles the subset of GFM used in OpenAPI descriptions:
// headings, bold/italic, inline code, blockquotes, lists, pipe tables.

function inlineMd(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, `<code style="font-size:11px;background:#f0f0f0;padding:0 3px;border-radius:2px;font-family:monospace;">$1</code>`);
}

function parsePipeTable(lines) {
  const dataLines = lines.filter(l => !/^\s*\|?[\s\-:|]+\|?\s*$/.test(l));
  if (!dataLines.length) return null;
  const parseRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const [head, ...body] = dataLines;
  const thStyle = `padding:4px 8px;font-size:10px;font-weight:700;text-align:left;background:#f5f5f5;border:1px solid #e0e0e0;white-space:nowrap;`;
  const tdStyle = `padding:4px 8px;font-size:11px;border:1px solid #e0e0e0;`;
  const ths = parseRow(head).map(h => `<th style="${thStyle}">${inlineMd(h)}</th>`).join('');
  const trs = body.map(r => `<tr>${parseRow(r).map(c => `<td style="${tdStyle}">${inlineMd(c)}</td>`).join('')}</tr>`).join('');
  return `<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;font-size:11px;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

function renderMarkdown(text) {
  if (!text) return '';
  const mdStyle = `font-size:13px;color:#444;line-height:1.65;`;
  const h3 = `font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#666;margin:14px 0 4px;`;
  const h2 = `font-size:13px;font-weight:800;color:#333;margin:14px 0 4px;`;

  // Split on double newlines to get blocks; collapse single newlines within a block
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

  const rendered = blocks.map(block => {
    if (block.startsWith('### ')) return `<h4 style="${h3}">${inlineMd(block.slice(4))}</h4>`;
    if (block.startsWith('## '))  return `<h3 style="${h2}">${inlineMd(block.slice(3))}</h3>`;
    if (block.startsWith('# '))   return `<h2 style="${h2}">${inlineMd(block.slice(2))}</h2>`;

    if (block.startsWith('> ')) {
      const content = block.replace(/^> ?/gm, '').trim();
      return `<blockquote style="border-left:3px solid #ddd;padding:4px 10px;margin:6px 0;color:#666;font-style:italic;">${inlineMd(content)}</blockquote>`;
    }

    const lines = block.split('\n');

    // Pipe table: first line has |, second line is a separator
    if (lines.length >= 2 && lines[0].includes('|') && /^\s*\|?[\s\-:|]+\|?\s*$/.test(lines[1])) {
      const table = parsePipeTable(lines);
      if (table) return table;
    }

    // Unordered list
    if (lines.every(l => /^\s*[-*] /.test(l))) {
      const items = lines.map(l => `<li>${inlineMd(l.replace(/^\s*[-*] /, ''))}</li>`).join('');
      return `<ul style="margin:6px 0;padding-left:1.25rem;">${items}</ul>`;
    }

    // Ordered list
    if (lines.every(l => /^\s*\d+\. /.test(l))) {
      const items = lines.map(l => `<li>${inlineMd(l.replace(/^\s*\d+\. /, ''))}</li>`).join('');
      return `<ol style="margin:6px 0;padding-left:1.25rem;">${items}</ol>`;
    }

    return `<p style="margin:0 0 6px;">${inlineMd(lines.join(' '))}</p>`;
  }).join('');

  return `<div style="${mdStyle}">${rendered}</div>`;
}

const __dirname  = dirname(fileURLToPath(import.meta.url));
const resolvedDir = resolve(__dirname, '../../../resolved');
const outDir      = __dirname;
mkdirSync(outDir, { recursive: true });

// ── Load + dereference all OpenAPI specs ──────────────────────────────────

const specFiles = readdirSync(resolvedDir)
  .filter(f => f.endsWith('-openapi.yaml'))
  .sort();

const specs = (
  await Promise.all(
    specFiles.map(async f => {
      const slug = f.replace('-openapi.yaml', '');
      try {
        const spec = await $RefParser.dereference(resolve(resolvedDir, f));
        if (!spec?.info || !spec?.paths) return null;
        return { slug, spec };
      } catch {
        return null;
      }
    })
  )
).filter(Boolean);

// ── Constants ─────────────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

const METHOD_STYLE = {
  get:     { bg: COLORS.lightGreen,  color: COLORS.deepGreen, border: COLORS.midGreen },
  post:    { bg: COLORS.paleBlue,    color: COLORS.darkBlue,  border: COLORS.midBlue  },
  patch:   { bg: COLORS.lightYellow, color: '#7A4800',        border: COLORS.warmYellow },
  put:     { bg: COLORS.lightYellow, color: '#7A4800',        border: COLORS.warmYellow },
  delete:  { bg: COLORS.lightRed,    color: '#7B0A11',        border: COLORS.richRed  },
  head:    { bg: '#f0f0f0',          color: '#444',           border: '#ccc' },
  options: { bg: '#f0f0f0',          color: '#444',           border: '#ccc' },
};

const TYPE_STYLE = {
  string:  { bg: COLORS.lightGreen,  color: COLORS.deepGreen },
  integer: { bg: COLORS.paleBlue,    color: COLORS.darkBlue  },
  number:  { bg: COLORS.paleBlue,    color: COLORS.darkBlue  },
  boolean: { bg: COLORS.lightYellow, color: '#7A4800'        },
  object:  { bg: COLORS.sandMid,     color: '#6B3A2A'        },
  array:   { bg: COLORS.sandMid,     color: '#6B3A2A'        },
};

// ── HTML helpers ──────────────────────────────────────────────────────────

function methodBadge(method) {
  const m = method.toLowerCase();
  const c = METHOD_STYLE[m] ?? { bg: '#f0f0f0', color: '#444', border: '#ccc' };
  return `<span style="font-size:9.5px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;padding:2px 7px;border-radius:3px;background:${c.bg};color:${c.color};border:1px solid ${c.border};flex-shrink:0;font-family:${FONT};">${esc(method.toUpperCase())}</span>`;
}

function statusBadge(status) {
  if (status === 'stable')        return `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:1px 6px;border-radius:100px;background:${COLORS.lightGreen};color:${COLORS.deepGreen};border:1px solid ${COLORS.midGreen};">Stable</span>`;
  if (status === 'beta')          return `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:1px 6px;border-radius:100px;background:${COLORS.paleBlue};color:${COLORS.midBlue};border:1px solid ${COLORS.lightBlue};">Beta</span>`;
  if (status === 'experimental')  return `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:1px 6px;border-radius:100px;background:${COLORS.lightYellow};color:#7A4800;border:1px solid ${COLORS.warmYellow};">Experimental</span>`;
  if (status === 'deprecated')    return `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:1px 6px;border-radius:100px;background:${COLORS.lightRed};color:#7B0A11;border:1px solid ${COLORS.richRed};">Deprecated</span>`;
  return '';
}

function typeBadge(type) {
  const base = type.startsWith('array') ? 'array' : type;
  const c = TYPE_STYLE[base] ?? { bg: '#f0f0f0', color: '#555' };
  return `<span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;background:${c.bg};color:${c.color};font-family:monospace;">${esc(type)}</span>`;
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

function renderProps(schema, depth = 0) {
  if (depth > 8 || !schema || typeof schema !== 'object') return '';

  // Merge allOf into a single view
  if (schema.allOf) {
    return schema.allOf
      .filter(s => s && typeof s === 'object')
      .map(s => renderProps(s, depth))
      .join('');
  }

  const props = schema.properties ?? {};
  const reqs  = new Set(schema.required ?? []);
  const pad   = 12 + depth * 20;

  return Object.entries(props).map(([name, prop]) => {
    if (!prop || typeof prop !== 'object') return '';

    const isReq    = reqs.has(name);
    const type     = typeStr(prop);
    const desc     = prop.description ?? '';
    const enumVals = prop.enum
      ? `<div style="margin-top:3px;font-size:10px;color:#666;">One of: ${prop.enum.map(v => `<code style="font-size:10px;background:#f0f0f0;padding:0 3px;border-radius:2px;">${esc(String(v))}</code>`).join(', ')}</div>`
      : '';
    const formatTag = prop.format
      ? `<span style="font-size:10px;color:#999;font-family:monospace;"> (${esc(prop.format)})</span>` : '';
    const readOnly  = prop.readOnly  ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">read-only</span>` : '';
    const writeOnly = prop.writeOnly ? `<span style="font-size:9px;color:#888;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:0 4px;margin-left:2px;">write-only</span>` : '';

    // Determine what to recurse into
    let inner = null;
    if (prop.type === 'object' || prop.properties || prop.allOf) inner = prop;
    else if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
      const items = prop.items;
      if (items.type === 'object' || items.properties || items.allOf) inner = items;
    }

    const children = inner ? renderProps(inner, depth + 1) : '';
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

function renderSchema(schema) {
  if (!schema || typeof schema !== 'object') return '';

  if (schema.type === 'array' && schema.items) {
    const itemsBody = renderProps(schema.items);
    const itemsDesc = itemsBody.trim()
      ? `<div style="font-size:10px;font-weight:700;letter-spacing:0.04em;color:#888;padding:5px 12px;background:#fafafa;border-bottom:1px solid #f0f0f0;">Array items:</div>${itemsBody}`
      : typeBadge(typeStr(schema));
    return itemsDesc;
  }

  const body = renderProps(schema);
  if (body.trim()) return body;
  return `<div style="padding:8px 12px;">${typeBadge(typeStr(schema))}</div>`;
}

// ── Parameter table ───────────────────────────────────────────────────────

function renderParams(params) {
  if (!params?.length) return '';

  const rows = params.map(p => {
    if (!p || typeof p !== 'object') return '';
    const schema  = p.schema ?? {};
    const type    = typeStr(schema);
    const enumVals = schema.enum
      ? `<div style="margin-top:2px;font-size:10px;">One of: ${schema.enum.map(v => `<code style="font-size:10px;background:#f0f0f0;padding:0 3px;border-radius:2px;">${esc(String(v))}</code>`).join(', ')}</div>`
      : '';
    return `<tr>
      <td style="padding:5px 12px;font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.text};white-space:nowrap;">${esc(p.name ?? '')}</td>
      <td style="padding:5px 12px;">${typeBadge(type)}</td>
      <td style="padding:5px 12px;font-size:10px;color:#888;font-family:monospace;">${esc(p.in ?? '')}</td>
      <td style="padding:5px 12px;text-align:center;">${p.required ? `<span style="font-size:9px;font-weight:700;color:${COLORS.richRed};">✓</span>` : ''}</td>
      <td style="padding:5px 12px;">${renderMarkdown(p.description ?? '')}${enumVals}</td>
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

function renderRequestBody(reqBody) {
  if (!reqBody) return '';
  const content    = reqBody.content ?? {};
  const mediaType  = content['application/json'] ?? Object.values(content)[0] ?? {};
  const schema     = mediaType.schema;
  if (!schema) return '';

  return `<div style="margin-top:16px;">
    <div style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#888;padding:5px 12px;background:#fafafa;border:1px solid #eee;border-bottom:none;border-radius:4px 4px 0 0;">
      Request body${reqBody.required ? ` <span style="color:${COLORS.richRed};font-weight:700;">required</span>` : ''}
    </div>
    <div style="border:1px solid #eee;border-radius:0 0 4px 4px;overflow:hidden;">${renderSchema(schema)}</div>
  </div>`;
}

// ── Response section ──────────────────────────────────────────────────────

function renderResponses(responses) {
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
    const schemaHtml = schema
      ? `<div style="border-top:1px solid #f0f0f0;">${renderSchema(schema)}</div>` : '';

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

function renderEndpoint(path, method, op) {
  const id       = endpointId(path, method);
  const params   = op.parameters ?? [];
  const descHtml = op.description
    ? `<div style="padding:12px 16px;border-top:1px solid #f0f0f0;">${renderMarkdown(op.description)}</div>`
    : '';

  return `<div id="${id}" style="border:1px solid ${COLORS.sandDark};border-radius:6px;margin-bottom:10px;overflow:hidden;">
  <details>
    <summary style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fafafa;cursor:pointer;list-style:none;user-select:none;">
      <span style="font-size:10px;color:#aaa;width:12px;flex-shrink:0;" class="chevron">▶</span>
      ${methodBadge(method)}
      <code style="font-size:13px;font-weight:600;color:${COLORS.text};flex:1;">${esc(path)}</code>
      <span style="font-size:12px;color:#666;">${esc(op.summary ?? '')}</span>
      ${op.deprecated ? `<span style="font-size:9px;font-weight:700;color:#7A4800;background:${COLORS.lightYellow};border:1px solid ${COLORS.warmYellow};border-radius:3px;padding:1px 6px;">DEPRECATED</span>` : ''}
    </summary>
    <div style="padding:12px 16px;">
      ${descHtml}
      ${renderParams(params)}
      ${renderRequestBody(op.requestBody)}
      ${renderResponses(op.responses)}
    </div>
  </details>
</div>`;
}

// ── Domain page ───────────────────────────────────────────────────────────

function buildDomainPage({ slug, spec }) {
  const info    = spec.info ?? {};
  const paths   = spec.paths ?? {};
  const tags    = spec.tags ?? [];
  const tagMap  = new Map(tags.map(t => [t.name, t.description ?? '']));

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
        byTag.get(tag).push({ path, method, op: opWithParams });
      }
    }
  }

  // Count total endpoints
  const total = [...byTag.values()].reduce((n, ops) => n + ops.length, 0);

  // Sidebar nav
  const navSections = [...byTag.entries()].map(([tag, ops]) => {
    const links = ops.map(({ path, method }) => {
      const id = endpointId(path, method);
      return `<a href="#${id}" style="display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:11px;color:#444;text-decoration:none;border-radius:3px;transition:background 0.1s;" onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background=''">${methodBadge(method)}<code style="font-size:10px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(path)}</code></a>`;
    }).join('');
    return `<div style="margin-bottom:12px;">
      <div style="font-size:9.5px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#aaa;padding:4px 8px 2px;">${esc(tag)}</div>
      ${links}
    </div>`;
  }).join('');

  // Main content sections
  const sections = [...byTag.entries()].map(([tag, ops]) => {
    const tagDesc = tagMap.get(tag) ?? '';
    const endpoints = ops.map(({ path, method, op }) => renderEndpoint(path, method, op)).join('');
    return `<section style="margin-bottom:2.5rem;">
      <div style="margin-bottom:1rem;">
        <h2 style="font-size:1rem;font-weight:800;color:${COLORS.darkBlue};margin-bottom:0.25rem;">${esc(tag)}</h2>
        ${tagDesc ? `<p style="font-size:12px;color:#666;">${esc(tagDesc)}</p>` : ''}
      </div>
      ${endpoints}
    </section>`;
  }).join('');

  const serverUrl = spec.servers?.[0]?.url ?? '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Safety Net Blueprint \u2014 ${esc(info.title ?? slug)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; color: ${COLORS.text}; display: flex; flex-direction: column; }
    details summary::-webkit-details-marker { display: none; }
  </style>
</head>
<body>

  <!-- Non-scrollable header: breadcrumb + compact title bar -->
  <div style="flex-shrink:0;z-index:50;">
    ${breadcrumb([
      { label: 'Explorer',       href: '../../../index.html' },
      { label: 'API Reference',  href: 'index.html'          },
      { label: info.title ?? slug },
    ])}
    <div style="background:${COLORS.darkBlue};color:${COLORS.white};padding:0.625rem 1.25rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:0.9375rem;font-weight:800;">${esc(info.title ?? slug)}</span>
      <span style="font-size:11px;font-family:monospace;color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;">v${esc(info.version ?? '')}</span>
      ${statusBadge(info['x-status'])}
      <span style="font-size:11px;color:rgba(255,255,255,0.35);margin-left:auto;">${total} endpoint${total !== 1 ? 's' : ''}</span>
    </div>
  </div>

  <!-- Scrollable body: sidebar + main content scroll independently -->
  <div style="flex:1;display:flex;overflow:hidden;">

    <!-- Sidebar -->
    <nav style="width:260px;flex-shrink:0;overflow-y:auto;background:${COLORS.white};border-right:1px solid ${COLORS.sandDark};padding:1rem 0.75rem;">
      ${navSections}
    </nav>

    <!-- Main content -->
    <main style="flex:1;overflow-y:auto;padding:2rem 2.5rem;min-width:0;">

      <!-- API description + server info -->
      <div style="margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid ${COLORS.sandDark};">
        ${info.description ? `<div style="max-width:720px;">${renderMarkdown(info.description)}</div>` : ''}
        ${serverUrl ? `<div style="margin-top:10px;font-size:11px;color:#888;">Base URL: <code style="font-size:11px;color:#555;background:#f0f0f0;padding:1px 5px;border-radius:3px;">${esc(serverUrl)}</code></div>` : ''}
      </div>

      <!-- Endpoint sections -->
      ${sections}

    </main>
  </div>

  <script>
    // Rotate chevron icons when details open/close
    document.querySelectorAll('details').forEach(d => {
      d.addEventListener('toggle', () => {
        const ch = d.querySelector('.chevron');
        if (ch) ch.textContent = d.open ? '\u25BC' : '\u25B6';
      });
    });

    // Breadcrumb current-page link scrolls main content to top
    // (body has overflow:hidden here; main is the scrollable container)
    document.querySelectorAll('a[href="#"]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        document.querySelector('main').scrollTop = 0;
      });
    });
  </script>

</body>
</html>`;
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
