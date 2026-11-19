/**
 * annotations-explorer/build.js
 *
 * Generates the annotation explorer (mirrors rules-docs pattern):
 *   index.html      — landing page listing all annotation types
 *   {type}.html     — per-type twoColumnPage: entries in left nav, usages on right
 *
 * Two kinds of annotation field values:
 *   - Array  (patterns, policies, programs, dataClassification): each array item is an entry.
 *     Registry-backed types are enriched with descriptions from the registry.
 *   - String (reason, modeling): each annotation key is listed with its text value,
 *     grouped by domain.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, relative, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { discover, load } from '@codeforamerica/blueprint-core';
import { twoColumnPage, singleColumnPage } from '../lib/layout.js';
import { esc, usageChip, dataDictFieldHref, stateMachineDocsHref, rulesDocsHref, eventCatalogHref } from '../lib/html.js';
import { COLORS } from '../lib/theme.js';
import { loadConfig } from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ANNOTATION_METADATA_FIELDS = new Set(['$schema', 'version', 'domain', 'capability']);

// ── Registry loading ───────────────────────────────────────────────────────────

/**
 * Returns: Map<type, { entries: Map<id, entryData>, domain: string }>
 */
function loadRegistries(resolvedDir) {
  const registries = new Map();

  for (const file of discover(resolvedDir, 'registry')) {
    const doc = load(file).content;
    if (!doc || typeof doc !== 'object') continue;

    const domain = file.domain;
    const type = doc.type;
    if (!type || typeof doc.entries !== 'object') continue;
    if (!registries.has(type)) registries.set(type, { entries: new Map(), domain });
    for (const [id, entry] of Object.entries(doc.entries ?? {})) {
      registries.get(type).entries.set(id, entry ?? {});
    }
  }

  return registries;
}

// ── Annotation scanning ────────────────────────────────────────────────────────

/**
 * Returns: Map<type, {
 *   isArray: boolean,
 *   data:
 *     isArray=true  → Map<entryId, Map<domain, Array<{section, key}>>>
 *     isArray=false → Map<domain, Array<{section, key, value}>>
 * }>
 */
function scanAnnotations(resolvedDir) {
  const byType = new Map();

  function recordArray(type, entryId, domain, section, key) {
    if (!byType.has(type)) byType.set(type, { isArray: true, data: new Map() });
    const { data } = byType.get(type);
    if (!data.has(entryId)) data.set(entryId, new Map());
    const domainMap = data.get(entryId);
    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain).push({ section, key });
  }

  function recordString(type, domain, section, key, value) {
    if (!byType.has(type)) byType.set(type, { isArray: false, data: new Map() });
    const { data } = byType.get(type);
    if (!data.has(domain)) data.set(domain, []);
    data.get(domain).push({ section, key, value });
  }

  for (const file of discover(resolvedDir, 'annotations')) {
    const doc = load(file).content;
    if (!doc || typeof doc !== 'object') continue;

    const domain = file.domain;

    for (const [sectionName, section] of Object.entries(doc)) {
      if (ANNOTATION_METADATA_FIELDS.has(sectionName)) continue;
      if (typeof section !== 'object' || Array.isArray(section)) continue;

      for (const [key, entry] of Object.entries(section)) {
        if (!entry || typeof entry !== 'object') continue;

        for (const [fieldName, fieldValue] of Object.entries(entry)) {
          if (Array.isArray(fieldValue)) {
            for (const item of fieldValue) {
              if (typeof item === 'string') recordArray(fieldName, item, domain, sectionName, key);
            }
          } else if (typeof fieldValue === 'string') {
            recordString(fieldName, domain, sectionName, key, fieldValue);
          }
        }
      }
    }
  }

  return byType;
}

/**
 * What each domain's generated TypeScript client exports as `Annotations`:
 * its annotation files merged, section by section (schema, operations,
 * events, facts). The page runs its client calls on this.
 *
 * Returns: Record<domain, Record<section, Record<key, entry>>>
 */
function loadClientAnnotations(resolvedDir) {
  const byDomain = {};
  for (const file of discover(resolvedDir, 'annotations')) {
    const doc = load(file).content;
    if (!doc || typeof doc !== 'object') continue;
    const merged = (byDomain[file.domain] ??= {});
    for (const [sectionName, section] of Object.entries(doc)) {
      if (ANNOTATION_METADATA_FIELDS.has(sectionName)) continue;
      if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
      Object.assign((merged[sectionName] ??= {}), section);
    }
  }
  return byDomain;
}

// ── The client call beside each entry ──────────────────────────────────────────

const CLIENT_STYLE = `
  .ann-card { border-radius: 6px; margin-bottom: 0.4rem; background: #fff; }
  .ann-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 1rem; cursor: pointer; list-style: none; }
  .ann-row::-webkit-details-marker { display: none; }
  .ann-row::before { content: '\\25B8'; font-size: 10px; color: #888; }
  details[open] > .ann-row::before { content: '\\25BE'; }
  details[open] > .ann-row { border-bottom: 1px solid #eee; }
  .ann-entry { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 0.75rem 1rem 0.9rem; }
  @media (min-width: 1100px) { .ann-entry { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
  .ann-side { min-width: 0; font-size: 12px; }
  .ann-side .row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font: 600 12px monospace; color: #333; }
  .ann-side select { font: 12px monospace; padding: 3px 6px; border: 1px solid #c7c4ea; border-radius: 4px; background: #fff; }
  .try-code { border: 1px solid #e3e1f5; border-radius: 4px; overflow: hidden; }
  .try-code .tabs { display: flex; align-items: center; gap: 2px; padding: 4px 6px; background: #f6f5fd; border-bottom: 1px solid #e3e1f5; font-size: 11px; }
  .try-code .tabs .tab { font: 600 11px sans-serif; padding: 3px 10px; border-radius: 3px; background: #2B1A78; color: #fff; }
  .try-code .tabs .target { margin-left: auto; color: #777; font: 11px monospace; }
  .try-code .tabs button.copy { margin-left: 8px; font: 600 11px sans-serif; padding: 3px 10px; border: 1px solid #c7c4ea; border-radius: 3px; background: #fff; color: #555; cursor: pointer; }
  .try-code pre { margin: 0; padding: 10px 12px; background: #1e1b3a; color: #e6e4f5; font: 11.5px/1.5 monospace; overflow: auto; white-space: pre; }
  .try-code .foot { display: flex; justify-content: flex-end; padding: 6px 8px; background: #1e1b3a; border-top: 1px solid #2f2a5c; }
  .try-code .run { font: 600 12px sans-serif; padding: 4px 16px; border-radius: 4px; border: 0; background: #fff; color: #2B1A78; cursor: pointer; }
  .ann-result { margin-top: 8px; }
  .ann-result .label { font: 600 12px monospace; border-bottom: 2px solid ${COLORS.deepGreen ?? '#15803d'}; display: inline-block; padding: 2px 8px; }
  .ann-result .note { color: #15803d; font-weight: 700; margin: 6px 0 0; }
  .ann-result pre { margin: 6px 0 0; padding: 8px 10px; background: #fff; border: 1px solid #eee; border-radius: 4px; max-height: 22rem; overflow: auto; white-space: pre-wrap; font-size: 11px; }
`;

// Runs in the page: writes each entry's client call for the chosen domain,
// and Run works out what that call returns from the same merged annotations.
const CLIENT_SCRIPT = `
(() => {
  const data = JSON.parse(document.getElementById('client-annotations').textContent);
  const namespaceOf = (domain) => domain.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const prop = (name) => (/^[A-Za-z_$][\\w$]*$/.test(name) ? '.' + name : "['" + name + "']");
  const has = (entry, type, id) => Array.isArray(entry && entry[type]) && entry[type].includes(id);

  // The fields that carry an entry, and the call that finds them.
  const findCall = (type, id, domain) => {
    const all = data[domain] || {};
    const sections = Object.keys(all).filter((s) => Object.values(all[s]).some((e) => has(e, type, id)));
    const at = namespaceOf(domain) + '.Annotations';
    const found = sections.flatMap((s) => Object.entries(all[s]).filter(([, e]) => has(e, type, id)).map(([key]) => [s, key]));
    const code = sections.length === 1
      ? ['// The ' + sections[0] + ' entries marked ' + id,
         'const found = Object.entries(' + at + prop(sections[0]) + ')',
         '  .filter(([, a]) => a' + prop(type) + "?.includes('" + id + "'))",
         '  .map(([key]) => key);']
      : ['// Everything marked ' + id + ', as section.key',
         'const found = Object.entries(' + at + ').flatMap(([section, entries]) =>',
         '  Object.entries(entries)',
         '    .filter(([, a]) => a' + prop(type) + "?.includes('" + id + "'))",
         "    .map(([key]) => section + '.' + key));"];
    const value = sections.length === 1 ? found.map(([, key]) => key) : found.map(([s, key]) => s + '.' + key);
    return { code, value, first: found[0] };
  };

  // The call that reads everything annotated on one key.
  const lookupCall = (domain, section, key, field) => {
    const at = namespaceOf(domain) + '.Annotations' + prop(section) + "['" + key + "']";
    const entry = ((data[domain] || {})[section] || {})[key];
    return field
      ? { code: ['const ' + field + ' = ' + at + prop(field) + ';'], value: entry ? entry[field] : undefined }
      : { code: ['// Everything annotated on one of them', 'const annotations = ' + at + ';'], value: entry };
  };

  // An entry opens when the address or the sidebar goes to it, as an
  // operation does on the API pages.
  const openTarget = () => {
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    const details = target && target.querySelector(':scope > details');
    if (details && !details.open) details.open = true;
  };
  addEventListener('hashchange', openTarget);
  openTarget();
  document.addEventListener('click', (event) => {
    const link = event.target.closest('#sidebar a.nav-link[href^="#"]');
    const target = link && document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
    const details = target && target.querySelector(':scope > details');
    if (!details) return;
    event.preventDefault();
    details.open = true;
    target.scrollIntoView({ block: 'start' });
  });

  for (const side of document.querySelectorAll('.ann-side')) {
    const { type, id, section, key, field } = side.dataset;
    const domains = JSON.parse(side.dataset.domains);
    const row = document.createElement('div');
    row.className = 'row';
    const pick = document.createElement('select');
    for (const d of domains) pick.append(Object.assign(document.createElement('option'), { value: d, textContent: d }));
    row.append('Domain', pick);
    if (domains.length < 2) pick.disabled = true;
    const block = document.createElement('div');
    block.className = 'try-code';
    block.innerHTML = '<div class="tabs"><span class="tab">TypeScript (local)</span><span class="target">runs in your code</span><button type="button" class="copy">Copy</button></div><pre></pre><div class="foot"><button type="button" class="run">Run</button></div>';
    const result = document.createElement('div');
    result.className = 'ann-result';
    side.append(row, block, result);
    const pre = block.querySelector('pre');
    let value;
    const draw = () => {
      const domain = pick.value;
      const head = ["import { " + namespaceOf(domain) + " } from './generated'; // where you generated the client", ''];
      let lines;
      if (field) {
        const read = lookupCall(domain, section, key, field);
        lines = read.code;
        value = read.value;
      } else {
        const find = findCall(type, id, domain);
        const read = find.first ? lookupCall(domain, find.first[0], find.first[1]) : null;
        lines = [...find.code, ...(read ? ['', ...read.code] : [])];
        value = read ? { found: find.value, annotations: read.value } : { found: find.value };
      }
      pre.textContent = [...head, ...lines].join('\\n');
      result.replaceChildren();
    };
    pick.onchange = draw;
    block.querySelector('.copy').onclick = async (event) => {
      try { await navigator.clipboard.writeText(pre.textContent); event.target.textContent = 'Copied'; } catch { event.target.textContent = 'Select and copy'; }
      setTimeout(() => { event.target.textContent = 'Copy'; }, 1500);
    };
    block.querySelector('.run').onclick = () => {
      result.innerHTML = '<span class="label">local</span><p class="note">Worked out in the page from the annotations the client is built from. Nothing was sent to a server.</p><pre></pre>';
      result.querySelector('pre').textContent = JSON.stringify(value, null, 2);
    };
    draw();
  }
})();
`;

const clientDataTag = (clientData) =>
  `<script type="application/json" id="client-annotations">${JSON.stringify(clientData).replace(/</g, '\\u003c')}</script>`;

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.replace(/[^a-z0-9]/gi, '-').toLowerCase();
}

function entryAnchor(id) {
  return `entry--${slugify(id)}`;
}

function buildUsageHref(section, key, domain) {
  switch (section) {
    case 'schema':
      return dataDictFieldHref(domain, key);
    case 'operations': {
      const dot = key.indexOf('.');
      const actionId = dot >= 0 ? key.slice(dot + 1) : key;
      return stateMachineDocsHref(domain, actionId);
    }
    case 'events':
      return eventCatalogHref(key);
    case 'facts': {
      const dot = key.indexOf('.');
      if (dot < 0) return null;
      const rulesetName = key.slice(0, dot);
      const factName = key.slice(dot + 1);
      return rulesDocsHref(domain, rulesetName, factName);
    }
    default:
      return null;
  }
}

// ── Index page ─────────────────────────────────────────────────────────────────

function generateIndexHtml(annotationTypes, registries, outputDir, hubHref, projectName) {
  const sorted = [...annotationTypes.entries()].sort(([a], [b]) => {
    const aReg = registries.has(a), bReg = registries.has(b);
    if (aReg !== bReg) return aReg ? -1 : 1;
    return a.localeCompare(b);
  });

  const cards = sorted.map(([type, { isArray, data }]) => {
    const slug = slugify(type);
    const isRegistry = registries.has(type);
    const registry = registries.get(type);

    let entryCount, usageCount;
    if (isArray) {
      entryCount = isRegistry ? registry.entries.size : data.size;
      usageCount = [...data.values()].reduce((n, domainMap) =>
        n + [...domainMap.values()].reduce((m, locs) => m + locs.length, 0), 0);
    } else {
      entryCount = [...data.values()].reduce((n, arr) => n + arr.length, 0);
      usageCount = entryCount;
    }

    const registryBadge = isRegistry
      ? `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:1px 6px;border-radius:100px;background:rgba(59,91,152,0.1);color:${COLORS.midBlue};border:1px solid rgba(59,91,152,0.2);">Registry</span>`
      : '';

    const definingDomain = isRegistry ? registry.domain : null;
    const domainChip = definingDomain
      ? `<span style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:100px;background:${COLORS.sandMid};color:#6B3A2A;border:1px solid ${COLORS.sandDark};">${esc(definingDomain)}</span>`
      : '';

    return `<a href="${esc(slug)}.html" style="display:flex;align-items:center;gap:0.6rem;padding:0.7rem 1rem;border:1px solid ${COLORS.sandDark};border-radius:6px;text-decoration:none;background:#fff;color:${COLORS.text};" onmouseover="this.style.background='#f5f7fb'" onmouseout="this.style.background='#fff'">
      <code style="font-size:12px;font-weight:700;color:${COLORS.midBlue};">${esc(type)}</code>
      ${registryBadge}
      ${domainChip}
      <span style="margin-left:auto;font-size:11px;color:#888;">${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} · ${usageCount} usage${usageCount === 1 ? '' : 's'}</span>
    </a>`;
  }).join('\n');

  const bodyHtml = `
<div style="max-width:680px;margin:0 auto;padding:3rem 2rem;">
  <div style="margin-bottom:2.5rem;">
    <h1 style="font-size:2rem;font-weight:700;color:${COLORS.darkBlue};margin-bottom:0.5rem;">Annotation Explorer</h1>
    <p style="color:#555;font-size:0.9rem;max-width:520px;line-height:1.5;">All annotation types across contract artifacts. Click a type to browse its entries and usages.</p>
  </div>
  <div style="display:flex;flex-direction:column;gap:0.4rem;">${cards}</div>
</div>`;

  writeFileSync(join(outputDir, 'index.html'), singleColumnPage({
    title: `Annotation Explorer — ${projectName}`,
    breadcrumbs: [
      { label: projectName, href: hubHref },
      { label: 'Annotation Explorer', href: '#' },
    ],
    bodyHtml,
  }));
}

// ── Per-type page ──────────────────────────────────────────────────────────────

function generateTypePage(type, typeData, registry, outputDir, hubHref, indexHref, projectName, clientData = {}) {
  const { isArray, data } = typeData;
  const slug = slugify(type);

  let navHtml, mainHtml;

  if (isArray) {
    const allEntries = registry
      ? [...registry.entries.entries()]
      : [...data.entries()].map(([id]) => [id, {}]).sort(([a], [b]) => a.localeCompare(b));

    const countUsages = (domainMap) =>
      [...domainMap.values()].reduce((n, locs) => n + locs.length, 0);

    const unusedCount = allEntries.filter(([id]) => !countUsages(data.get(id) ?? new Map())).length;

    navHtml = allEntries.map(([entryId]) => {
      const domainMap = data.get(entryId) ?? new Map();
      const count = countUsages(domainMap);
      const unused = count === 0;
      const countStyle = unused ? 'background:rgba(220,80,80,0.25);color:#f88;' : '';
      return `<a class="nav-link" href="#${entryAnchor(entryId)}">
        <code style="font-size:10px;">${esc(entryId)}</code>
        <span class="nav-count" style="${countStyle}">${count}</span>
      </a>`;
    }).join('\n');

    mainHtml = allEntries.map(([entryId, entryMeta]) => {
      const domainMap = data.get(entryId) ?? new Map();
      const totalUsages = countUsages(domainMap);
      const unused = totalUsages === 0;

      const description = entryMeta?.description
        ? `<div style="font-size:13px;color:${COLORS.text};margin:0.4rem 0 0.75rem;line-height:1.5;">${esc(String(entryMeta.description).trim())}</div>`
        : '';

      const domainRows = [...domainMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([domain, locs]) => {
        const chips = locs.sort((a, b) => a.key.localeCompare(b.key)).map(({ section, key }) =>
          usageChip(section, key, buildUsageHref(section, key, domain))
        ).join(' ');
        return `<div style="margin-bottom:0.5rem;">
          <div style="font-size:10px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:${COLORS.midBlue};margin-bottom:0.3rem;padding-bottom:0.2rem;border-bottom:1px solid ${COLORS.sandDark};">${esc(domain)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:0.3rem;">${chips}</div>
        </div>`;
      }).join('');

      const usageSection = unused
        ? `<div style="font-size:12px;color:#c0392b;font-style:italic;margin-top:0.5rem;">No usages found</div>`
        : `<div style="margin-top:0.25rem;">${domainRows}</div>`;

      // The client call that finds this entry's usages, in a domain whose
      // client exports Annotations.
      const clientDomains = [...domainMap.keys()].filter((d) => clientData[d]).sort();
      const side = clientDomains.length
        ? `<aside class="ann-side" data-type="${esc(type)}" data-id="${esc(entryId)}" data-domains='${esc(JSON.stringify(clientDomains))}'></aside>`
        : '';

      // Closed, a row like an operation's on the API pages; open, the
      // entry's usages beside its client call.
      return `<div id="${entryAnchor(entryId)}" class="content-item">
        <details class="ann-card" style="border:1px solid ${unused ? 'rgba(220,80,80,0.4)' : COLORS.sandDark};${unused ? 'background:rgba(220,80,80,0.04);' : ''}">
          <summary class="ann-row">
            <code style="font-size:12px;font-weight:700;">${esc(entryId)}</code>
            <span style="margin-left:auto;font-size:11px;color:${unused ? '#c0392b' : COLORS.midBlue};font-weight:600;">${totalUsages} usage${totalUsages === 1 ? '' : 's'}</span>
          </summary>
          <div class="ann-entry"><div>${description}${usageSection}</div>${side}</div>
        </details>
      </div>`;
    }).join('');

    const totalEntries = allEntries.length;
    mainHtml = `<div style="padding:2rem 0.5rem;">
      <h1 style="font-size:1.5rem;font-weight:700;color:${COLORS.darkBlue};margin-bottom:0.3rem;"><code>${esc(type)}</code></h1>
      <p style="color:#555;font-size:0.875rem;margin-bottom:1.5rem;">${totalEntries} entr${totalEntries === 1 ? 'y' : 'ies'}${unusedCount > 0 ? ` · <span style="color:#c0392b;">${unusedCount} unused</span>` : ''}</p>
      ${mainHtml}
    </div>`;

  } else {
    // String type: entries in nav are annotation keys grouped by domain
    const allDomains = [...data.entries()].sort(([a], [b]) => a.localeCompare(b));
    const totalCount = allDomains.reduce((n, [, items]) => n + items.length, 0);

    navHtml = allDomains.map(([domain, items]) => {
      const rows = [...items].sort((a, b) => a.key.localeCompare(b.key)).map(({ key }) =>
        `<a class="nav-link" href="#${entryAnchor(key)}" style="padding-left:1.25rem;">
          <code style="font-size:10px;">${esc(key)}</code>
        </a>`
      ).join('');
      return `<div class="nav-section">
        <div class="nav-section-label">${esc(domain)}</div>
        ${rows}
      </div>`;
    }).join('\n');

    const entryBlocks = allDomains.map(([domain, items]) =>
      [...items].sort((a, b) => a.key.localeCompare(b.key)).map(({ section, key, value }) =>
        `<div id="${entryAnchor(key)}" class="content-item">
          <details class="ann-card" style="border:1px solid ${COLORS.sandDark};">
            <summary class="ann-row">
              <span style="font-size:10px;font-weight:600;color:${COLORS.midBlue};background:#e8ecf5;padding:1px 6px;border-radius:3px;border:1px solid ${COLORS.sandDark};">${esc(section)}</span>
              <code style="font-size:12px;font-weight:700;">${esc(key)}</code>
            </summary>
            <div class="ann-entry"><div>
              <div style="font-size:13px;color:${COLORS.text};line-height:1.5;">${esc(value)}</div>
            </div>${clientData[domain]
              ? `<aside class="ann-side" data-section="${esc(section)}" data-key="${esc(key)}" data-field="${esc(type)}" data-domains='${esc(JSON.stringify([domain]))}'></aside>`
              : ''}</div>
          </details>
        </div>`
      ).join('')
    ).join('');

    mainHtml = `<div style="padding:2rem 0.5rem;">
      <h1 style="font-size:1.5rem;font-weight:700;color:${COLORS.darkBlue};margin-bottom:0.3rem;"><code>${esc(type)}</code></h1>
      <p style="color:#555;font-size:0.875rem;margin-bottom:1.5rem;">${totalCount} annotation${totalCount === 1 ? '' : 's'}</p>
      ${entryBlocks}
    </div>`;
  }

  writeFileSync(join(outputDir, `${slug}.html`), twoColumnPage({
    title: `${type} — Annotation Explorer — ${projectName}`,
    breadcrumbs: [
      { label: projectName, href: hubHref },
      { label: 'Annotation Explorer', href: indexHref },
      { label: type, href: '#' },
    ],
    headerHtml: `
      <div style="background:${COLORS.darkBlue};padding:0.75rem 1.25rem 0.9rem;border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:16px;font-weight:700;color:white;"><code style="color:rgba(255,255,255,0.9);background:transparent;">${esc(type)}</code></div>
        <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:0.2rem;">Annotation Explorer</div>
      </div>`,
    navHtml,
    mainHtml: mainHtml + clientDataTag(clientData),
    navSearch: true,
    navWidth: 260,
    extraStyle: CLIENT_STYLE,
    extraScript: CLIENT_SCRIPT,
  }));
}

// ── Build entry point ──────────────────────────────────────────────────────────

/**
 * @param {{ contentDir: string, resolvedDir: string }} opts
 */
export function build({ contentDir, resolvedDir }) {
  const outputDir = join(contentDir, 'annotations-explorer');
  const hubHref = relative(outputDir, join(contentDir, 'index.html'));
  const indexHref = 'index.html';
  const config = loadConfig(contentDir);
  const { name: projectName } = config;
  const allowedAnnotations = config.annotations ? new Set(config.annotations) : null;

  mkdirSync(outputDir, { recursive: true });
  readdirSync(outputDir).filter(f => f.endsWith('.html'))
    .forEach(f => rmSync(join(outputDir, f)));

  const registries = loadRegistries(resolvedDir);
  const allAnnotationTypes = scanAnnotations(resolvedDir);
  const clientData = loadClientAnnotations(resolvedDir);

  // Filter to allowed annotation types if configured
  const annotationTypes = allowedAnnotations
    ? new Map([...allAnnotationTypes].filter(([type]) => allowedAnnotations.has(type)))
    : allAnnotationTypes;

  if (annotationTypes.size === 0) {
    console.log('  annotations-explorer: no annotation files found, skipping.');
    return;
  }

  generateIndexHtml(annotationTypes, registries, outputDir, hubHref, projectName);

  for (const [type, typeData] of annotationTypes) {
    const registry = registries.get(type) ?? null;
    generateTypePage(type, typeData, registry, outputDir, hubHref, indexHref, projectName, clientData);
  }

  console.log(`  annotations-explorer: ${annotationTypes.size} types`);
}

// ── CLI shim ───────────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const contentArg = args.find(a => a.startsWith('--content='));
  const resolvedArg = args.find(a => a.startsWith('--resolved='));
  if (!contentArg || !resolvedArg) {
    console.error('Usage: node build.js --content=<path> --resolved=<path>');
    process.exit(1);
  }
  build({
    contentDir: contentArg.slice('--content='.length),
    resolvedDir: resolvedArg.slice('--resolved='.length),
  });
}
