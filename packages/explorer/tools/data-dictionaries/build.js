#!/usr/bin/env node
/**
 * Data Dictionary build
 *
 * Generates a static data dictionary from:
 *   - packages/explorer/data-explorer/output/{domain}-field-inventory.yaml  (field paths + types)
 *   - packages/contracts/{domain}-annotations.yaml                      (programs, policies, classification)
 *   - packages/resolved/{domain}-openapi.yaml                           (version number)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { resolve, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { loadAnnotations, loadPolicies } from '@codeforamerica/safety-net-blueprint-contracts';
import { COLORS } from '../../lib/theme.js';
import { esc as h, titleCase, breadcrumb, headerMetaSubtitle, HEADER_CODE_STYLE } from '../../lib/html.js';
import { FIELD_CSS } from '../../lib/field-card.js';
import { twoColumnPage, singleColumnPage } from '../../lib/layout.js';
import { resolvedDir, resolvedSourcePairs } from '../../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir     = resolve(__dirname);
const PROJECT_ROOT  = resolve(__dirname, '../../..');
readdirSync(outputDir).filter(f => f.endsWith('.html')).forEach(f => rmSync(resolve(outputDir, f)));

// Resolved source files this tool reads — shown in each page's header metadata.
const SOURCE_SUFFIXES = ['openapi', 'annotations'];

// ── Policy registry ───────────────────────────────────────────────────────────

let POLICIES = {};
try { POLICIES = loadPolicies(resolvedDir); } catch { /* run without policy data if file is missing */ }

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

function buildAnnotationResolver(mergedSchema) {
  const all = mergedSchema ?? {};

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

function renderFieldCard(path, meta, ann) {
  const type = displayType(meta);
  const typeBadge = type ? `<span class="type-badge">${h(type)}</span>` : '';
  const relBadge = (meta?.relationship && meta?.type !== 'uuid') ? `<span class="rel-badge">→ ${h(String(meta.relationship))}</span>` : '';

  let annHtml = '';
  if (ann) {
    const programs = ann.programs ?? [];
    const policies = ann.policies ?? [];
    const dc = ann.dataClassification ?? [];
    const reason   = (ann.reason   ?? '').replace(/\s+/g, ' ').trim();
    const modeling = (ann.modeling ?? '').replace(/\s+/g, ' ').trim();
    const parts = [];
    if (reason)          parts.push(`<p class="ann-reason"><span class="ann-label">Reason</span>${h(reason)}</p>`);
    if (modeling)        parts.push(`<p class="ann-modeling"><span class="ann-label">Modeling</span>${h(modeling)}</p>`);
    if (dc.length)       parts.push(`<div class="ann-row"><span class="ann-label">Classification</span>${dc.map(badge).join('')}</div>`);
    if (programs.length) parts.push(`<div class="ann-row"><span class="ann-label">Programs</span>${programs.map(badge).join('')}</div>`);
    if (policies.length) {
      const policyItems = policies.map(id => {
        const pol = POLICIES[id];
        if (!pol) return `<div class="policy-item"><code class="policy-id">${h(id)}</code></div>`;
        const citationHtml = pol.citationUrl
          ? `<a class="policy-citation" href="${pol.citationUrl}" target="_blank" rel="noopener">${h(pol.citation)}</a>`
          : pol.citation ? `<span class="policy-citation">${h(pol.citation)}</span>` : '';
        const desc = (pol.description ?? '').replace(/\s+/g, ' ').trim();
        return `<div class="policy-item">` +
          `<div class="policy-item-head"><code class="policy-id">${h(id)}</code>${citationHtml}</div>` +
          (desc ? `<p class="policy-desc">${h(desc)}</p>` : '') +
          `</div>`;
      }).join('');
      parts.push(`<div class="ann-row ann-row--col"><span class="ann-label">Policies</span><div class="policy-list">${policyItems}</div></div>`);
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

  return `<div class="card content-item" data-path="${h(path)}">` +
    `<div class="card-header"><code class="field-path">${h(path)}</code>${typeBadge}${relBadge}</div>` +
    bodyHtml +
    `</div>`;
}

// ── CSS (field cards and index — layout comes from lib/layout.js) ─────────────
// FIELD_CSS imported from ../../lib/field-card.js

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
    title: 'Safety Net Blueprint \u2014 Data Dictionary',
    breadcrumbs: [{ label: 'Explorer', href: '../../index.html' }, { label: 'Data Dictionary' }],
    bodyHtml: `
      <div class="index-layout">
        <div class="index-header">
          <h1>Data Dictionary</h1>
          <p class="index-sub">Field-level reference for the Safety Net Blueprint data model. Select a domain to browse its fields.</p>
        </div>
        <div class="domain-grid">${cards}</div>
      </div>`,
    extraStyle: INDEX_CSS,
  });
}

function buildDomainPage(domain, sections, resolveAnn) {
  const label = domainLabel(domain);
  const totalFields = sections.reduce((n, s) => n + s.fields.length, 0);

  const navHtml = sections.map(s => {
    const id = `sec-${s.name}`;
    return `<a href="#${h(id)}" class="nav-link">${h(s.name)} <span class="nav-count">${s.fields.length}</span></a>`;
  }).join('');

  const metaSubtitle = headerMetaSubtitle(domain, resolvedSourcePairs(domain, { include: SOURCE_SUFFIXES }));

  const mainHtml = sections.map(s => {
    const id = `sec-${s.name}`;
    const cards = s.fields.map(f => renderFieldCard(f.path, f.meta, resolveAnn(f.path))).join('');
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
    title: `Safety Net Blueprint \u2014 Data Dictionary \u2014 ${h(label)}`,
    breadcrumbs: [
      { label: 'Explorer',        href: '../../index.html' },
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
  const dataModelFiles = readdirSync(outputDir)
    .filter(f => f.endsWith('-field-inventory.yaml'))
    .sort();

  if (dataModelFiles.length === 0) {
    console.warn('No data model YAML files found in output/ — run the data model generator first.');
    return;
  }

  const domains = [];

  for (const dmFile of dataModelFiles) {
    const domain = dmFile.replace('-field-inventory.yaml', '');
    const dataModelPath = resolve(outputDir, dmFile);

    console.log(`  Processing ${domain}...`);

    let ann = { schema: {} };
    try { ann = loadAnnotations(domain, resolvedDir); } catch { /* run without annotations if missing */ }
    const resolveAnn = buildAnnotationResolver(ann.schema);
    const sections = parseDataModel(dataModelPath);

    let version = null;
    const resolvedSpec = resolve(resolvedDir, `${domain}-openapi.yaml`);
    if (existsSync(resolvedSpec)) {
      try { version = safeLoad(resolvedSpec)?.info?.version ?? null; } catch { /* ignore */ }
    }

    domains.push({ domain, sections, version, resolveAnn });
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
    const pageHtml = buildDomainPage(d.domain, d.sections, d.resolveAnn);
    writeFileSync(resolve(outputDir, `${d.domain}.html`), pageHtml, 'utf8');
    console.log(`  Written: ${d.domain}.html`);
  }

  console.log(`  ✓ Generated data dictionary (${domains.length} domain${domains.length === 1 ? '' : 's'})`);
}

main();
