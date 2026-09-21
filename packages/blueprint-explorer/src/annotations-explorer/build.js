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
import { detectType } from '@codeforamerica/blueprint-core/openapi';
import { twoColumnPage, singleColumnPage } from '../lib/layout.js';
import { esc, usageChip, dataDictFieldHref, stateMachineDocsHref, rulesDocsHref, eventCatalogHref } from '../lib/html.js';
import { COLORS } from '../lib/theme.js';
import { loadConfig } from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ANNOTATION_METADATA_FIELDS = new Set(['$schema', 'version', 'domain']);

// ── File discovery ─────────────────────────────────────────────────────────────

function walkYaml(dir) {
  return readdirSync(dir, { recursive: true })
    .filter(f => typeof f === 'string' && f.endsWith('.yaml'))
    .map(f => join(dir, f));
}

// ── Registry loading ───────────────────────────────────────────────────────────

/**
 * Returns: Map<type, { entries: Map<id, entryData>, domain: string }>
 */
function loadRegistries(resolvedDir) {
  const registries = new Map();

  for (const filePath of walkYaml(resolvedDir)) {
    let doc;
    try { doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA }); }
    catch { continue; }
    if (!doc || typeof doc !== 'object') continue;

    const schema = String(doc.$schema ?? '').split('/').pop();
    const domain = doc.domain ?? null;

    if (schema === 'registry-schema.yaml') {
      const type = doc.type;
      if (!type || typeof doc.entries !== 'object') continue;
      if (!registries.has(type)) registries.set(type, { entries: new Map(), domain });
      for (const [id, entry] of Object.entries(doc.entries ?? {})) {
        registries.get(type).entries.set(id, entry ?? {});
      }
    } else if (schema === 'policies-schema.yaml') {
      if (!registries.has('policies')) registries.set('policies', { entries: new Map(), domain });
      for (const [id, entry] of Object.entries(doc.policies ?? {})) {
        registries.get('policies').entries.set(id, entry ?? {});
      }
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

  for (const filePath of walkYaml(resolvedDir)) {
    const file = basename(filePath);
    let doc;
    try { doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA }); }
    catch { continue; }
    if (!doc || typeof doc !== 'object') continue;
    if (detectType(file, doc) !== 'annotations') continue;

    const domain = doc.domain ?? file.split('-')[0];

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

function generateTypePage(type, typeData, registry, outputDir, hubHref, indexHref, projectName) {
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

      return `<div id="${entryAnchor(entryId)}" class="content-item" style="border:1px solid ${unused ? 'rgba(220,80,80,0.4)' : COLORS.sandDark};border-radius:6px;padding:0.9rem 1rem;margin-bottom:0.6rem;${unused ? 'background:rgba(220,80,80,0.04);' : ''}">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <code style="font-size:12px;font-weight:700;">${esc(entryId)}</code>
          <span style="margin-left:auto;font-size:11px;color:${unused ? '#c0392b' : COLORS.midBlue};font-weight:600;">${totalUsages} usage${totalUsages === 1 ? '' : 's'}</span>
        </div>
        ${description}${usageSection}
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

    const entryBlocks = allDomains.map(([, items]) =>
      [...items].sort((a, b) => a.key.localeCompare(b.key)).map(({ section, key, value }) =>
        `<div id="${entryAnchor(key)}" class="content-item" style="border:1px solid ${COLORS.sandDark};border-radius:6px;padding:0.9rem 1rem;margin-bottom:0.6rem;">
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span style="font-size:10px;font-weight:600;color:${COLORS.midBlue};background:#e8ecf5;padding:1px 6px;border-radius:3px;border:1px solid ${COLORS.sandDark};">${esc(section)}</span>
            <code style="font-size:12px;font-weight:700;">${esc(key)}</code>
          </div>
          <div style="font-size:13px;color:${COLORS.text};margin-top:0.35rem;line-height:1.5;">${esc(value)}</div>
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
    mainHtml,
    navSearch: true,
    navWidth: 260,
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
    generateTypePage(type, typeData, registry, outputDir, hubHref, indexHref, projectName);
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
