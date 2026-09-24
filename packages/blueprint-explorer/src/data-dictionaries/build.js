#!/usr/bin/env node
/**
 * Data Dictionary build
 *
 * Generates a static data dictionary from:
 *   - packages/explorer/data-explorer/output/{domain}-field-inventory.yaml  (field paths + types)
 *   - packages/contracts/{domain}-annotations.yaml                      (programs, policies, classification)
 *   - packages/generated/{domain}-openapi.yaml                           (version number)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync } from 'fs';
import { resolve, dirname, sep, relative, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { loadAnnotations } from '../annotations.js';
import { contractFileMap } from '../contract-files.js';
import { findSpecRelativePaths } from '../contract-nav.js';
import { COLORS } from '../lib/theme.js';
import { esc as h, titleCase, breadcrumb, headerMetaSubtitle, HEADER_CODE_STYLE, annotationChips } from '../lib/html.js';
import { twoColumnPage, singleColumnPage } from '../lib/layout.js';
import { resolvedSourcePairs } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { generate as generateFieldInventory } from './generate-field-inventory.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../..');

// Resolved source files this tool reads — shown in each page's header metadata.
const SOURCE_SUFFIXES = ['openapi', 'annotations'];

/**
 * @param {{ contentDir: string, resolvedDir: string }} opts
 */
export async function build({ contentDir, resolvedDir }) {
const outputDir = resolve(contentDir, 'data-dictionaries');
const hubHref = relative(outputDir, join(contentDir, 'index.html'));
const { name: projectName, repo } = loadConfig(contentDir);
mkdirSync(outputDir, { recursive: true });

// Clean stale field inventories before regenerating.
readdirSync(outputDir)
  .filter(f => f.endsWith('-field-inventory.yaml'))
  .forEach(f => rmSync(resolve(outputDir, f)));

// Generate field inventories from resolved OpenAPI specs.
await generateFieldInventory({ specDir: resolvedDir, outDir: outputDir });

// Clean stale HTML pages.
readdirSync(outputDir).filter(f => f.endsWith('.html')).forEach(f => rmSync(resolve(outputDir, f)));

// ── Policy registry ───────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeLoad(filePath) {
  const real = resolve(filePath);
  if (!real.startsWith(PROJECT_ROOT + sep)) {
    throw new Error(`Refusing to read file outside project: ${real}`);
  }
  return yaml.load(readFileSync(real, 'utf8'), { schema: yaml.CORE_SCHEMA });
}

const domainLabel = titleCase;

// ── Data model YAML parser ────────────────────────────────────────────────────

function parseDataModel(filePath) {
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^# ── (.+?) ─+$/);
    if (sectionMatch) {
      current = { name: sectionMatch[1].trim(), fields: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.match(/^([^#\s][^:]+):\s*(\{.+\})\s*$/);
    if (!fieldMatch) continue;
    const path = fieldMatch[1].trim();
    let meta;
    try {
      meta = yaml.load(fieldMatch[2], { schema: yaml.CORE_SCHEMA }) ?? {};
    } catch {
      meta = {};
    }
    current.fields.push({ path, meta });
  }

  return sections;
}

// ── Annotation matching ───────────────────────────────────────────────────────

function bestMatch(entries, fieldPath) {
  let best = null;
  let bestLen = -1;
  for (const [annPath, ann] of entries) {
    if (fieldPath === annPath || fieldPath.startsWith(annPath + '.') || fieldPath.startsWith(annPath + '[')) {
      if (annPath.length > bestLen) { best = ann; bestLen = annPath.length; }
    }
  }
  return best;
}

function buildAnnotationResolver(mergedSchema, doc = null) {
  const rawAll = mergedSchema ?? {};

  // Expand any schema-relative annotation keys (e.g. "applicationMember.dob")
  // to their spec-relative equivalents (e.g. "application.members[].dob") so
  // they match the field inventory paths produced by generate-field-inventory.
  const all = {};
  for (const [key, value] of Object.entries(rawAll)) {
    const resolvedKeys = doc ? findSpecRelativePaths(doc, key) : [key];
    for (const resolved of resolvedKeys) {
      all[resolved] = value;
    }
  }

  function inheritedValue(fieldPath, key) {
    let path = fieldPath;
    while (true) {
      if (all[path]?.[key] !== undefined) return all[path][key];
      const stripped = path.replace(/\.[^.]+$/, '');
      if (stripped === path) return undefined;
      path = stripped;
    }
  }

  return function resolve(fieldPath) {
    const ann            = all[fieldPath] ?? null;
    const programs       = inheritedValue(fieldPath, 'programs');
    const policies       = inheritedValue(fieldPath, 'policies');
    const dataClassification = inheritedValue(fieldPath, 'dataClassification');
    const s = (programs || policies || dataClassification)
      ? { programs, policies, dataClassification }
      : null;
    if (!s && !ann) return null;
    return { ...s, ...ann };
  };
}

// ── Type display ──────────────────────────────────────────────────────────────

function displayType(meta) {
  const t = meta?.type;
  if (!t) return null;
  if (Array.isArray(t)) return t.join(' | ');
  if (typeof t === 'string') {
    if (meta?.relationship && t === 'uuid') return `uuid(${meta.relationship})`;
    return t;
  }
  return String(t);
}

// ── HTML rendering ────────────────────────────────────────────────────────────

function badge(text) {
  return `<span class="badge">${h(text.toUpperCase())}</span>`;
}

function renderFieldCard(path, meta, ann, allowedAnnotations, registryTypes = new Set()) {
  const type = displayType(meta);
  const typeBadge = type ? `<span class="type-badge">${h(type)}</span>` : '';
  const relBadge = (meta?.relationship && meta?.type !== 'uuid') ? `<span class="rel-badge">→ ${h(String(meta.relationship))}</span>` : '';

  const show = allowedAnnotations
    ? (field) => allowedAnnotations.includes(field)
    : () => true;

  // Known annotation fields to skip (metadata, not display fields)
  const SKIP_ANN_FIELDS = new Set(['$schema', 'version', 'domain']);

  let annHtml = '';
  if (ann) {
    const parts = [];
    for (const [field, value] of Object.entries(ann)) {
      if (SKIP_ANN_FIELDS.has(field)) continue;
      if (!show(field)) continue;
      const label = field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
      if (Array.isArray(value) && value.length > 0) {
        if (registryTypes.has(field)) {
          const items = annotationChips(field, value, '../annotations-explorer');
          parts.push(`<div class="ann-row"><span class="ann-label">${h(label)}</span>${items}</div>`);
        } else if (value.length === 1) {
          parts.push(`<p class="ann-reason"><span class="ann-label">${h(label)}</span>${h(String(value[0]).replace(/\s+/g, ' ').trim())}</p>`);
        } else {
          const items = value.map(v => `<li>${h(String(v).replace(/\s+/g, ' ').trim())}</li>`).join('');
          parts.push(`<div class="ann-row ann-row--col"><span class="ann-label">${h(label)}</span><ul class="ann-list">${items}</ul></div>`);
        }
      } else if (typeof value === 'string' && value.trim()) {
        const text = value.replace(/\s+/g, ' ').trim();
        parts.push(`<p class="ann-reason"><span class="ann-label">${h(label)}</span>${h(text)}</p>`);
      }
    }
    if (parts.length) annHtml = `<div class="card-ann">${parts.join('')}</div>`;
  }

  let valHtml = '';
  if (meta?.values?.length) {
    valHtml = `<div class="ann-row"><span class="ann-label ann-label--values">Values</span><span class="val-list">${meta.values.map(v => `<code>${h(String(v))}</code>`).join(' ')}</span></div>`;
  }

  let appliesHtml = '';
  if (meta?.appliesWhen) {
    appliesHtml = `<div class="ann-row"><span class="ann-label">Applies when</span><code class="applies-expr">${h(String(meta.appliesWhen))}</code></div>`;
  }

  const bodyHtml = (annHtml || valHtml || appliesHtml)
    ? `<div class="card-body">${appliesHtml}${valHtml}${annHtml}</div>`
    : '';

  return `<div class="card content-item" id="field-${h(path)}" data-path="${h(path)}">` +
    `<div class="card-header"><code class="field-path">${h(path)}</code>${typeBadge}${relBadge}</div>` +
    bodyHtml +
    `</div>`;
}

// ── CSS (field cards and index — layout comes from lib/layout.js) ─────────────

const FIELD_CSS = `
:root {
  --blue-dark:   ${COLORS.darkBlue};
  --blue-mid:    ${COLORS.midBlue};
  --blue-light:  ${COLORS.lightBlue};
  --sand:        ${COLORS.sandDark};
  --sand-light:  #F5F0ED;
  --lb-light:    ${COLORS.paleBlue};
  --green-dark:  ${COLORS.deepGreen};
  --green-light: ${COLORS.lightGreen};
  --yellow-light:${COLORS.lightYellow};
  --red-dark:    ${COLORS.richRed};
  --red-light:   ${COLORS.lightRed};
}
.csv-btn {
  font-size: 0.78rem; padding: 0.25rem 0.65rem;
  border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
  background: rgba(255,255,255,0.1); color: white; cursor: pointer; white-space: nowrap;
}
.csv-btn:hover { background: rgba(255,255,255,0.2); }
.no-results { padding: 2rem; text-align: center; color: #888; font-style: italic; }
.hidden { display: none !important; }
.dict-section { margin-bottom: 2.5rem; scroll-margin-top: 1rem; }
.section-title {
  font-size: 1rem; font-weight: 700; color: var(--blue-dark);
  border-bottom: 2px solid var(--blue-light);
  padding-bottom: 0.35rem; margin-bottom: 0.75rem;
}
.cards-grid { display: flex; flex-direction: column; gap: 0.5rem; }
.card {
  background: #fff; border: 1px solid var(--sand);
  border-left: 3px solid var(--blue-mid); border-radius: 6px; overflow: hidden;
}
.card.hidden { display: none; }
.card-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; background: var(--lb-light); }
.field-path { font-size: 0.82rem; font-weight: 600; color: var(--blue-dark); flex: 1; min-width: 0; overflow-wrap: anywhere; }
.type-badge {
  flex-shrink: 0; font-size: 0.65rem; font-weight: 600;
  background: var(--blue-light); color: var(--blue-dark);
  border-radius: 4px; padding: 0.1rem 0.4rem; text-transform: uppercase; letter-spacing: 0.03em;
}
.rel-badge {
  flex-shrink: 0; font-size: 0.65rem; font-weight: 600;
  background: var(--green-light); color: var(--green-dark);
  border-radius: 4px; padding: 0.1rem 0.4rem; letter-spacing: 0.02em;
}
.applies-expr { font-size: 0.72rem; background: var(--yellow-light); border-radius: 3px; padding: 0.05rem 0.4rem; color: #5a4000; }
.card-body { padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.4rem; }
.ann-reason { font-size: 0.78rem; color: #333; line-height: 1.5; margin: 0; }
.ann-modeling { font-size: 0.75rem; color: #555; line-height: 1.5; margin: 0; display: flex; gap: 0.5rem; align-items: baseline; }
.ann-modeling .ann-label { flex-shrink: 0; }
.card-ann { display: flex; flex-direction: column; gap: 0.3rem; }
.ann-row { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; font-size: 0.75rem; }
.ann-row--col { align-items: flex-start; }
.ann-label {
  display: inline-block; font-size: 0.6rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.05em;
  border-radius: 3px; padding: 0.1rem 0.35rem; margin-right: 0.1rem;
  vertical-align: middle; white-space: nowrap; flex-shrink: 0;
  background: var(--sand-light); color: #6b4c3b; border: 1px solid var(--sand);
}
.badge { font-size: 0.65rem; font-weight: 600; border-radius: 3px; padding: 0.1rem 0.35rem; letter-spacing: 0.03em; background: #e8e8e8; color: #444; }
.ann-chip { text-decoration: none; background: var(--lb-light); color: var(--blue-mid); border: 1px solid var(--blue-light); }
.ann-chip:hover { background: var(--blue-light); }
.val-list code { font-size: 0.72rem; background: #f0f0f0; border-radius: 3px; padding: 0.05rem 0.3rem; color: #444; }
@keyframes field-highlight {
  0%   { background: #fef9c3; border-left-color: #ca8a04; }
  100% { background: #fff;    border-left-color: var(--blue-mid); }
}
.card.field-highlight { animation: field-highlight 1.8s ease-out; }
`;

const INDEX_CSS = `
.index-layout { max-width: 900px; margin: 0 auto; padding: 3rem 2rem; }
.index-header { margin-bottom: 2.5rem; }
.index-header h1 { font-size: 2rem; font-weight: 700; color: ${COLORS.darkBlue}; margin-bottom: 0.5rem; }
.index-sub { color: #555; font-size: 0.9rem; max-width: 560px; line-height: 1.5; }
.domain-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
.domain-card {
  display: block; text-decoration: none; background: #fff;
  border: 1px solid ${COLORS.sandDark}; border-radius: 8px; padding: 1.25rem 1rem;
  cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s;
}
.domain-card:hover { border-color: ${COLORS.midBlue}; box-shadow: 0 2px 8px rgba(86,80,190,0.12); }
.domain-card-title { font-size: 1rem; font-weight: 700; color: ${COLORS.darkBlue}; margin-bottom: 0.3rem; }
.domain-card-meta { font-size: 0.75rem; color: #888; }
`;

// ── Domain page JS: CSV export ────────────────────────────────────────────────
// Layout.js handles nav filtering and item-level search via .content-item class.

const DOMAIN_JS = `
(function() {
  const hash = window.location.hash;
  if (!hash) return;
  const id = decodeURIComponent(hash.slice(1));
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('field-highlight');
  setTimeout(function() { el.classList.remove('field-highlight'); }, 2000);
})();

function exportCsv() {
  const rows = [['path', 'type', 'programs', 'policies', 'dataClassification']];
  document.querySelectorAll('.card:not(.hidden)').forEach(card => {
    const path = card.dataset.path ?? '';
    const type = card.querySelector('.type-badge')?.textContent ?? '';
    const getAnnRow = label => [...card.querySelectorAll('.ann-row')]
      .find(r => r.querySelector('.ann-label')?.textContent.trim().toLowerCase() === label);
    const programs = [...(getAnnRow('programs')?.querySelectorAll('.badge') ?? [])].map(b => b.textContent).join(';');
    const policies = [...(getAnnRow('policies')?.querySelectorAll('code') ?? [])].map(b => b.textContent).join(';');
    const dc = [...(getAnnRow('classification')?.querySelectorAll('.badge') ?? [])].map(b => b.textContent).join(';');
    rows.push([path, type, programs, policies, dc]);
  });
  const csv = rows.map(r => r.map(v => JSON.stringify(v)).join(',')).join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'data-dictionary.csv';
  a.click();
}
`;

// ── Page builders ─────────────────────────────────────────────────────────────

function buildIndexPage(domains) {
  const cards = domains.map(d => {
    const label = domainLabel(d.domain);
    const totalFields = d.sections.reduce((n, s) => n + s.fields.length, 0);
    const annotatedCount = d.sections.reduce((n, s) => n + s.fields.filter(f => d.resolveAnn(f.path)).length, 0);
    const metaParts = [];
    if (d.version) metaParts.push(`v${h(d.version)}`);
    metaParts.push(`${totalFields} fields`);
    if (annotatedCount) metaParts.push(`${annotatedCount} annotated`);
    return `<a href="${h(d.domain)}.html" class="domain-card">` +
      `<div class="domain-card-title">${h(label)}</div>` +
      `<div class="domain-card-meta">${metaParts.join(' · ')}</div>` +
      `</a>`;
  }).join('');

  return singleColumnPage({
    title: `${projectName} \u2014 Data Dictionary`,
    breadcrumbs: [{ label: 'Explorer', href: hubHref }, { label: 'Data Dictionary' }],
    bodyHtml: `
      <div class="index-layout">
        <div class="index-header">
          <h1>Data Dictionary</h1>
          <p class="index-sub">Field-level reference for the ${projectName} data model. Select a domain to browse its fields.</p>
        </div>
        <div class="domain-grid">${cards}</div>
      </div>`,
    extraStyle: INDEX_CSS,
  });
}

function buildDomainPage(domain, sections, resolveAnn, allowedAnnotations, registryTypes = new Set()) {
  const label = domainLabel(domain);
  const totalFields = sections.reduce((n, s) => n + s.fields.length, 0);

  const navHtml = sections.map(s => {
    const id = `sec-${s.name}`;
    return `<a href="#${h(id)}" class="nav-link">${h(s.name)} <span class="nav-count">${s.fields.length}</span></a>`;
  }).join('');

  const metaSubtitle = headerMetaSubtitle(domain, resolvedSourcePairs(domain, resolvedDir, { include: SOURCE_SUFFIXES }, repo));

  const mainHtml = sections.map(s => {
    const id = `sec-${s.name}`;
    const cards = s.fields.map(f => renderFieldCard(f.path, f.meta, resolveAnn(f.path), allowedAnnotations, registryTypes)).join('');

    return `<section class="dict-section" id="${h(id)}">
      <h2 class="section-title">${h(s.name)}</h2>
      <div class="cards-grid">${cards}</div>
    </section>`;
  }).join('');

  const headerHtml = `<div style="background:${COLORS.darkBlue};color:white;">
    <div style="padding:0.625rem 1.25rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:0.9375rem;font-weight:800;">${h(label)}</span>
      <span style="font-size:11px;color:rgba(255,255,255,0.45);font-family:monospace;">${totalFields} fields</span>
      <button class="csv-btn" onclick="exportCsv()" style="margin-left:auto;">Export CSV</button>
    </div>
    ${metaSubtitle}
  </div>`;

  return twoColumnPage({
    title: `${projectName} \u2014 Data Dictionary \u2014 ${h(label)}`,
    breadcrumbs: [
      { label: 'Explorer',        href: hubHref },
      { label: 'Data Dictionary', href: 'index.html'       },
      { label: label },
    ],
    headerHtml,
    navHtml,
    mainHtml,
    navWidth: 240,
    navSearch: true,
    extraStyle: FIELD_CSS,
    extraScript: DOMAIN_JS,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const config = loadConfig(contentDir);
  const allowedAnnotations = config.annotations ?? null;

  const dataModelFiles = readdirSync(outputDir)
    .filter(f => f.endsWith('-field-inventory.yaml'))
    .sort();

  if (dataModelFiles.length === 0) {
    console.warn('No data model YAML files found in output/ — run the data model generator first.');
    return;
  }

  const fileMap = contractFileMap(resolvedDir);

  // Index openapi files by x-domain for version lookup
  const openApiByDomain = new Map();
  for (const doc of fileMap.values()) {
    if (doc.type === 'openapi' && doc.domain) openApiByDomain.set(doc.domain, doc);
  }

  const domains = [];

  for (const dmFile of dataModelFiles) {
    const domain = dmFile.replace('-field-inventory.yaml', '');
    const dataModelPath = resolve(outputDir, dmFile);

    console.log(`  Processing ${domain}...`);

    let ann = { schema: {}, registryTypes: new Set() };
    try { ann = loadAnnotations(domain, fileMap); } catch { /* run without annotations if missing */ }
    const domainSpec = openApiByDomain.get(domain) ?? null;
    const resolveAnn = buildAnnotationResolver(ann.schema, domainSpec);
    const sections = parseDataModel(dataModelPath);
    const { registryTypes } = ann;

    const version = domainSpec?.content?.info?.version ?? null;

    domains.push({ domain, sections, version, resolveAnn, allowedAnnotations, registryTypes });
  }

  for (const legacy of ['data-explorer.html', 'data-dictionary.html']) {
    const legacyPath = resolve(outputDir, legacy);
    if (existsSync(legacyPath)) {
      rmSync(legacyPath);
      console.log(`  Removed legacy ${legacy}`);
    }
  }

  writeFileSync(resolve(outputDir, 'index.html'), buildIndexPage(domains), 'utf8');
  console.log(`  Written: index.html`);

  for (const d of domains) {
    const pageHtml = buildDomainPage(d.domain, d.sections, d.resolveAnn, d.allowedAnnotations, d.registryTypes);
    writeFileSync(resolve(outputDir, `${d.domain}.html`), pageHtml, 'utf8');
    console.log(`  Written: ${d.domain}.html`);
  }

  console.log(`  ✓ Generated data dictionary (${domains.length} domain${domains.length === 1 ? '' : 's'})`);
}

main();
} // end build()

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contentArg  = process.argv.find(a => a.startsWith('--content='));
  const resolvedArg = process.argv.find(a => a.startsWith('--resolved='));
  if (!contentArg) {
    console.error('Usage: node build.js --content=<path> [--resolved=<path>]');
    process.exit(1);
  }
  build({
    contentDir:  resolve(process.cwd(), contentArg.slice('--content='.length)),
    resolvedDir: resolvedArg ? resolve(process.cwd(), resolvedArg.slice('--resolved='.length)) : null,
  }).catch(e => { console.error(e); process.exit(1); });
}
