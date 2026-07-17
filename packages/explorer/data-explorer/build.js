#!/usr/bin/env node
/**
 * Data Dictionary build
 *
 * Generates a single data-dictionary.html from:
 *   - packages/explorer/data-explorer/output/{domain}-data-model.yaml  (field paths + types)
 *   - packages/contracts/{domain}-annotations.yaml                      (programs, policies, classification)
 *   - packages/resolved/{domain}-openapi.yaml                           (version number)
 *
 * Uses the same navigate(CONTENT) pattern as the context map:
 *   - CONTENT.index  — landing page with one card per domain
 *   - CONTENT[domain] — field dictionary for that domain
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { resolve, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir  = resolve(__dirname, '../../contracts');
const resolvedDir   = resolve(__dirname, '../../resolved');
const outputDir     = resolve(__dirname, 'output');
const PROJECT_ROOT  = resolve(__dirname, '../../..');

// ── Policy registry ───────────────────────────────────────────────────────────
// Loaded once, shared across all domain renders.

let POLICIES = {};
try {
  const reg = safeLoad(resolve(contractsDir, 'platform-registry-policies.yaml'));
  POLICIES = reg?.policies ?? {};
} catch { /* run without policy data if file is missing */ }

// ── Helpers ───────────────────────────────────────────────────────────────────

function h(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeLoad(filePath) {
  const real = resolve(filePath);
  if (!real.startsWith(PROJECT_ROOT + sep)) {
    throw new Error(`Refusing to read file outside project: ${real}`);
  }
  return yaml.load(readFileSync(real, 'utf8'), { schema: yaml.CORE_SCHEMA });
}

function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function domainLabel(domain) {
  // "case-management" → "Case Management"
  return domain.split('-').map(capitalize).join(' ');
}

// ── Data model YAML parser ────────────────────────────────────────────────────
// Reads line-by-line to preserve section comment groupings.

function parseDataModel(filePath) {
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const sections = [];   // [{ name, fields: [{path, meta}] }]
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
// Resolves annotations from two maps (structured + docs), merging on match.
// More specific (longer) paths override parent annotations within each map.

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

function buildAnnotationResolver(schemaAnnotations, docsAnnotations) {
  const structured = schemaAnnotations ?? {};
  const docs       = docsAnnotations ?? {};

  // Walk up ancestor paths to find the nearest entry with the given key.
  function inheritedValue(map, fieldPath, key) {
    let path = fieldPath;
    while (true) {
      if (map[path]?.[key] !== undefined) return map[path][key];
      // Strip the last segment: "a.b.c" → "a.b", "a.b[]" → "a.b", "a.b" → stop
      const stripped = path.replace(/\.[^.]+$/, '');
      if (stripped === path) return undefined;
      path = stripped;
    }
  }

  return function resolve(fieldPath) {
    // Prose (reason, modeling): exact-match only
    const d = docs[fieldPath] ?? null;

    // Structural context (programs, policies, dataClassification): inherit from nearest ancestor
    const programs           = inheritedValue(structured, fieldPath, 'programs');
    const policies           = inheritedValue(structured, fieldPath, 'policies');
    const dataClassification = inheritedValue(structured, fieldPath, 'dataClassification');

    const s = (programs || policies || dataClassification)
      ? { programs, policies, dataClassification }
      : null;

    if (!s && !d) return null;
    return { ...s, ...d };
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

function pathSegmentDepth(p) {
  // Count logical depth: split on '.' treating '[]' as part of its segment
  return p.split('.').length;
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

  const hasAnn = !!annHtml;
  return `<div class="card" data-path="${h(path)}">` +
    `<div class="card-header"><code class="field-path">${h(path)}</code>${typeBadge}${relBadge}</div>` +
    bodyHtml +
    `</div>`;
}

function renderDomainContent(domain, sections, resolveAnn) {
  const label = domainLabel(domain);
  const totalFields = sections.reduce((n, s) => n + s.fields.length, 0);

  const navItems = sections.map(s => {
    const id = `sec-${h(s.name)}`;
    return `<a href="#${id}" class="nav-sub" data-section="${id}">${h(s.name)} <span class="nav-count">${s.fields.length}</span></a>`;
  }).join('');

  const sectionsHtml = sections.map(s => {
    const id = `sec-${s.name}`;
    const cards = s.fields.map(f => renderFieldCard(f.path, f.meta, resolveAnn(f.path))).join('');
    return `<section class="dict-section" id="${h(id)}" data-section-id="${h(id)}">` +
      `<h2 class="section-title">${h(s.name)}</h2>` +
      `<div class="cards-grid">${cards}</div>` +
      `</section>`;
  }).join('');

  return `
<div class="dict-layout">
  <aside class="sidebar">
    <div class="sidebar-top">
      <button class="back-btn" onclick="navigate('index')">← All dictionaries</button>
      <div class="sidebar-domain">${h(label)}</div>
      <div class="sidebar-meta">${totalFields} fields</div>
    </div>
    <div class="search-wrap">
      <input class="search-bar" type="search" id="search" placeholder="Search fields…" autocomplete="off" />
    </div>
    <nav class="sidebar-nav">${navItems}</nav>
  </aside>
  <main class="dict-main">
    <div class="dict-header">
      <h1 class="dict-title">${h(label)} data dictionary</h1>
      <button class="csv-btn" onclick="exportCsv()">Export CSV</button>
    </div>
    <div id="no-results" class="no-results hidden">No fields match your search.</div>
    <div id="dict-content">${sectionsHtml}</div>
  </main>
</div>`;
}

function renderIndexContent(domains) {
  const cards = domains.map(d => {
    const label = domainLabel(d.domain);
    const totalFields = d.sections.reduce((n, s) => n + s.fields.length, 0);
    const annotatedCount = d.sections.reduce((n, s) => n + s.fields.filter(f => d.resolveAnn(f.path)).length, 0);
    const metaParts = [];
    if (d.version) metaParts.push(`v${h(d.version)}`);
    metaParts.push(`${totalFields} fields`);
    if (annotatedCount) metaParts.push(`${annotatedCount} annotated`);

    return `<div class="domain-card" onclick="navigate('${h(d.domain)}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')navigate('${h(d.domain)}')">` +
      `<div class="domain-card-title">${h(label)}</div>` +
      `<div class="domain-card-meta">${metaParts.join(' · ')}</div>` +
      `</div>`;
  }).join('');

  return `
<div class="index-layout">
  <div class="index-header">
    <h1>Data Dictionary</h1>
    <p class="index-sub">Field-level reference for the Safety Net Blueprint data model. Select a domain to browse its fields.</p>
  </div>
  <div class="domain-grid">${cards}</div>
</div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 14px; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #F3F3F3;
  color: #111;
  min-height: 100vh;
}
:root {
  --blue-dark:  #2B1A78;
  --blue-mid:   #5650BE;
  --blue-light: #C2C0E8;
  --sand:       #E9CCBE;
  --sand-light: #F5F0ED;
  --lb-light:   #E6EBF9;
  --green-dark: #006152;
  --green-light:#E2F9F6;
  --yellow-light:#FFF3E0;
  --red-dark:   #AF121D;
  --red-light:  #F9C8CB;
  --sidebar-w:  240px;
}

/* ── Index layout ─────────────────────────────────────────────────────────── */
.index-layout {
  max-width: 900px;
  margin: 0 auto;
  padding: 3rem 2rem;
}
.index-header { margin-bottom: 2.5rem; }
.index-header h1 { font-size: 2rem; font-weight: 700; color: var(--blue-dark); margin-bottom: 0.5rem; }
.index-sub { color: #555; font-size: 0.9rem; max-width: 560px; line-height: 1.5; }
.domain-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
.domain-card {
  background: #fff;
  border: 1px solid var(--sand);
  border-radius: 8px;
  padding: 1.25rem 1rem;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.domain-card:hover { border-color: var(--blue-mid); box-shadow: 0 2px 8px rgba(86,80,190,0.12); }
.domain-card-title { font-size: 1rem; font-weight: 700; color: var(--blue-dark); margin-bottom: 0.3rem; }
.domain-card-meta { font-size: 0.75rem; color: #888; }

/* ── Dictionary layout ────────────────────────────────────────────────────── */
.dict-layout { display: flex; min-height: 100vh; }

.sidebar {
  width: var(--sidebar-w);
  min-width: var(--sidebar-w);
  background: var(--blue-dark);
  color: #fff;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.sidebar-top {
  padding: 1.25rem 1rem 0.75rem;
  flex-shrink: 0;
}
.back-btn {
  background: none;
  border: none;
  color: var(--blue-light);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  margin-bottom: 0.75rem;
  display: block;
}
.back-btn:hover { color: #fff; }
.sidebar-domain { font-size: 0.9rem; font-weight: 700; color: #fff; margin-bottom: 0.15rem; }
.sidebar-meta { font-size: 0.7rem; color: var(--blue-light); }
.search-wrap {
  padding: 0.5rem 1rem;
  border-top: 1px solid rgba(255,255,255,0.1);
  border-bottom: 1px solid rgba(255,255,255,0.1);
  flex-shrink: 0;
}
.search-bar {
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 5px;
  background: rgba(255,255,255,0.1);
  color: #fff;
  font-size: 0.8rem;
  outline: none;
}
.search-bar::placeholder { color: rgba(255,255,255,0.4); }
.search-bar:focus { border-color: var(--blue-light); box-shadow: 0 0 0 2px rgba(194,192,232,0.3); }

.sidebar-nav { padding: 0.5rem 0; overflow-y: auto; flex: 1; }
.nav-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(255,255,255,0.7);
  text-decoration: none;
  cursor: pointer;
}
.nav-sub:hover { background: rgba(255,255,255,0.08); color: #fff; }
.nav-sub--active { background: rgba(255,255,255,0.15); color: #fff; }
.nav-count {
  font-size: 0.65rem;
  font-weight: 400;
  background: rgba(255,255,255,0.15);
  border-radius: 8px;
  padding: 0.1rem 0.35rem;
  text-transform: none;
  letter-spacing: 0;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
.dict-main { flex: 1; min-width: 0; padding: 0 2rem 3rem; }
.dict-header {
  position: sticky;
  top: 0;
  background: #F3F3F3;
  padding: 1.25rem 0 0.75rem;
  display: flex;
  align-items: baseline;
  gap: 1rem;
  z-index: 10;
  border-bottom: 1px solid var(--sand);
  margin-bottom: 1.5rem;
  margin-left: -2rem;
  margin-right: -2rem;
  padding-left: 2rem;
  padding-right: 2rem;
}
.dict-title { font-size: 1.3rem; font-weight: 700; color: var(--blue-dark); flex: 1; }
.csv-btn {
  font-size: 0.78rem;
  padding: 0.25rem 0.65rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  white-space: nowrap;
}
.csv-btn:hover { background: #f5f5f5; }

.no-results { padding: 2rem; text-align: center; color: #888; font-style: italic; }
.hidden { display: none !important; }

/* ── Section ──────────────────────────────────────────────────────────────── */
.dict-section { margin-bottom: 2.5rem; scroll-margin-top: 72px; }
.section-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--blue-dark);
  border-bottom: 2px solid var(--blue-light);
  padding-bottom: 0.35rem;
  margin-bottom: 0.75rem;
  scroll-margin-top: 72px;
}
.cards-grid { display: flex; flex-direction: column; gap: 0.5rem; }

/* ── Field card ───────────────────────────────────────────────────────────── */
.card {
  background: #fff;
  border: 1px solid var(--sand);
  border-left: 3px solid var(--blue-mid);
  border-radius: 6px;
  overflow: hidden;
}
.card.hidden { display: none; }
mark.search-hl { background: #fff176; color: inherit; border-radius: 2px; padding: 0 1px; }
.card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--lb-light);
}
.field-path {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--blue-dark);
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.type-badge {
  flex-shrink: 0;
  font-size: 0.65rem;
  font-weight: 600;
  background: var(--blue-light);
  color: var(--blue-dark);
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.card-body { padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.4rem; }
.ann-reason {
  font-size: 0.78rem;
  color: #333;
  line-height: 1.5;
  margin: 0;
}
.ann-modeling {
  font-size: 0.75rem;
  color: #555;
  line-height: 1.5;
  margin: 0;
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}
.ann-modeling .ann-label { flex-shrink: 0; }
.card-ann { display: flex; flex-direction: column; gap: 0.3rem; }
.ann-row { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; font-size: 0.75rem; }
.ann-label {
  display: inline-block;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-radius: 3px;
  padding: 0.1rem 0.35rem;
  margin-right: 0.1rem;
  vertical-align: middle;
  white-space: nowrap;
  flex-shrink: 0;
  background: var(--sand-light);
  color: #6b4c3b;
  border: 1px solid var(--sand);
}
.badge {
  font-size: 0.65rem;
  font-weight: 600;
  border-radius: 3px;
  padding: 0.1rem 0.35rem;
  letter-spacing: 0.03em;
  background: #e8e8e8;
  color: #444;
}
.val-list code {
  font-size: 0.72rem;
  background: #f0f0f0;
  border-radius: 3px;
  padding: 0.05rem 0.3rem;
  color: #444;
}
.rel-badge {
  flex-shrink: 0;
  font-size: 0.65rem;
  font-weight: 600;
  background: var(--green-light);
  color: var(--green-dark);
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
  letter-spacing: 0.02em;
}
.applies-expr {
  font-size: 0.72rem;
  background: var(--yellow-light);
  border-radius: 3px;
  padding: 0.05rem 0.4rem;
  color: #5a4000;
}
.ann-row--col { align-items: flex-start; }
.policy-list { display: flex; flex-direction: column; gap: 0.4rem; }
.policy-item { font-size: 0.75rem; }
.policy-item-head { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.15rem; }
.policy-id {
  font-size: 0.72rem;
  background: #f0f0f0;
  border-radius: 3px;
  padding: 0.05rem 0.3rem;
  color: #444;
}
.policy-citation {
  font-size: 0.7rem;
  color: var(--blue-mid);
  text-decoration: none;
}
.policy-citation:hover { text-decoration: underline; }
.policy-desc {
  font-size: 0.75rem;
  color: #555;
  line-height: 1.45;
  margin: 0;
}
`;

// ── JS ────────────────────────────────────────────────────────────────────────

const JS = `
const SECTION_OFFSET = 72;

function navigate(id) {
  if (!CONTENT[id]) return;
  document.getElementById('app').innerHTML = CONTENT[id];
  window.scrollTo(0, 0);
  if (id !== 'index') {
    initDictView();
  }
}

function initDictView() {
  const sections = Array.from(document.querySelectorAll('.dict-section'));
  const navLinks = Array.from(document.querySelectorAll('.nav-sub'));

  function setActive() {
    const scrollY = window.scrollY + SECTION_OFFSET + 10;
    let active = sections[0]?.id ?? null;
    for (const s of sections) {
      if (s.offsetTop <= scrollY) active = s.id;
    }
    navLinks.forEach(a => a.classList.toggle('nav-sub--active', a.dataset.section === active));
  }

  window.addEventListener('scroll', setActive, { passive: true });
  setActive();

  navLinks.forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const target = document.getElementById(a.dataset.section);
      if (target) {
        const top = target.getBoundingClientRect().top + window.scrollY - SECTION_OFFSET;
        window.scrollTo({ top, behavior: 'instant' });
      }
    });
  });

  document.getElementById('search').addEventListener('input', function () {
    applySearch(this.value);
  });
}

// ── Search (ported from steel thread visualizer) ─────────────────────────────

function clearHighlights() {
  document.querySelectorAll('mark.search-hl').forEach(el => {
    const parent = el.parentNode;
    el.replaceWith(document.createTextNode(el.textContent));
    if (parent) parent.normalize();
  });
}

function highlightInElement(root, q) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.textContent;
    const lower = text.toLowerCase();
    if (!lower.includes(q)) continue;
    const frag = document.createDocumentFragment();
    let last = 0, idx = lower.indexOf(q);
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement('mark');
      mark.className = 'search-hl';
      mark.textContent = text.slice(idx, idx + q.length);
      frag.appendChild(mark);
      last = idx + q.length;
      idx = lower.indexOf(q, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

function applySearch(q) {
  q = (q ?? '').trim().toLowerCase();
  clearHighlights();

  let anyVisible = false;
  document.querySelectorAll('.card').forEach(card => {
    const match = !q || card.textContent.toLowerCase().includes(q);
    card.classList.toggle('hidden', !match);
    if (match) anyVisible = true;
  });
  document.querySelectorAll('.dict-section').forEach(section => {
    const visible = section.querySelectorAll('.card:not(.hidden)').length > 0;
    section.style.display = visible ? '' : 'none';
  });

  const noResults = document.getElementById('no-results');
  if (noResults) noResults.classList.toggle('hidden', anyVisible || !q);

  if (q) {
    document.querySelectorAll('.card:not(.hidden)').forEach(el => highlightInElement(el, q));
  }
}

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

navigate('index');
`;

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  // Discover all data model YAMLs (one per domain)
  const dataModelFiles = readdirSync(outputDir)
    .filter(f => f.endsWith('-data-model.yaml'))
    .sort();

  if (dataModelFiles.length === 0) {
    console.warn('No data model YAML files found in output/ — run the data model generator first.');
    return;
  }

  const domains = [];

  for (const dmFile of dataModelFiles) {
    const domain = dmFile.replace('-data-model.yaml', '');
    const dataModelPath = resolve(outputDir, dmFile);

    console.log(`  Processing ${domain}...`);

    // Load structured annotations (programs, policies, dataClassification)
    const annPath = resolve(contractsDir, `${domain}-annotations.yaml`);
    let annotations = null;
    if (existsSync(annPath)) {
      try { annotations = safeLoad(annPath); } catch { /* ignore */ }
    }

    // Load prose annotations (reason, modeling)
    const docsPath = resolve(contractsDir, `${domain}-annotations-docs.yaml`);
    let docsAnnotations = null;
    if (existsSync(docsPath)) {
      try { docsAnnotations = safeLoad(docsPath); } catch { /* ignore */ }
    }

    const resolveAnn = buildAnnotationResolver(annotations?.schema, docsAnnotations?.schema);

    // Load data model sections
    const sections = parseDataModel(dataModelPath);

    // Load version from contracts spec (source of truth), fall back to resolved
    let version = null;
    const contractsSpec = resolve(contractsDir, `${domain}-openapi.yaml`);
    const resolvedSpec  = resolve(resolvedDir,  `${domain}-openapi.yaml`);
    for (const specPath of [contractsSpec, resolvedSpec]) {
      if (existsSync(specPath)) {
        try {
          const spec = safeLoad(specPath);
          version = spec?.info?.version ?? null;
          if (version) break;
        } catch { /* ignore */ }
      }
    }

    domains.push({ domain, sections, version, resolveAnn });
  }

  // Build CONTENT object
  const contentParts = domains.map(d => {
    const html = renderDomainContent(d.domain, d.sections, d.resolveAnn);
    return `${JSON.stringify(d.domain)}: ${JSON.stringify(html)}`;
  });
  contentParts.unshift(`"index": ${JSON.stringify(renderIndexContent(domains))}`);

  const contentJs = `const CONTENT = {\n${contentParts.join(',\n')}\n};`;

  // Remove legacy data-explorer.html if still present
  const oldOutput = resolve(outputDir, 'data-explorer.html');
  if (existsSync(oldOutput)) {
    rmSync(oldOutput);
    console.log('  Removed legacy data-explorer.html');
  }

  // Write output
  const outPath = resolve(outputDir, 'data-dictionary.html');
  writeFileSync(outPath, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Safety Net Blueprint — Data Dictionary</title>
  <style>${CSS}</style>
</head>
<body>
  <div id="app"></div>
  <script>
${contentJs}
${JS}
  </script>
</body>
</html>`);

  console.log(`  ✓ Generated data-dictionary.html (${domains.length} domain${domains.length === 1 ? '' : 's'})`);
}

main();
