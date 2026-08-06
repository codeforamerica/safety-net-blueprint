#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from '../../cli-utils.js';
import { formatRuleText } from './corticon/rulesheet.js';
import { esc, nextEid, expandHidden, expandChip } from '../../../../explorer/lib/html.js';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

function printUsage() {
  console.error('Usage: node src/visualize-crosswalk.js <patterns.json> <crosswalk.json> [--translated <translated.json>] [--out <file.html>]');
}

// ── Mapping type metadata ─────────────────────────────────────────────────

const TYPE_META = {
  '1:1':                            { label: '1 : 1',                       color: '#166534', bg: '#dcfce7' },
  'caller-provides':                { label: 'caller provided',             color: '#0369a1', bg: '#e0f2fe' },
  'expression':                     { label: 'custom function required',    color: '#5b21b6', bg: '#ede9fe' },
  'no-fallback-row':                { label: 'no fallback row',             color: '#92400e', bg: '#fef9c3' },
  'assembly-rulesheet-mismatch':    { label: 'assembly mismatch',           color: '#92400e', bg: '#fef9c3' },
  'unconditional-row-out-of-order': { label: 'row order ambiguous',         color: '#92400e', bg: '#fef9c3' },
  'blocked':                        { label: 'blocked',                     color: '#991b1b', bg: '#fee2e2' },
  'special':                        { label: 'orchestration (not a fact)',  color: '#374151', bg: '#f3f4f6' },
  'excluded':                       { label: 'unreachable in flow',         color: '#6b7280', bg: '#f3f4f6' },
  'gap':                            { label: 'no mapping',                  color: '#6b7280', bg: '#fafafa' },
};

function badge(type) {
  const m = TYPE_META[type] ?? TYPE_META['gap'];
  return `<span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:11px;font-weight:600;background:${m.bg};color:${m.color};white-space:nowrap">${m.label}</span>`;
}

// ── Type resolution ───────────────────────────────────────────────────────

function resolveType(isUnreachable, kinds, attrLevelKind, factPath) {
  if (isUnreachable) return 'excluded';
  if (kinds.includes('genuine-cycle') || kinds.includes('no-ordinary-writer')) return 'blocked';
  const reviewKind = kinds.find(k => ['no-fallback-row', 'assembly-rulesheet-mismatch', 'unconditional-row-out-of-order'].includes(k));
  if (reviewKind) return reviewKind;
  if (kinds.includes('expression-pattern')) return 'expression';
  if (kinds.includes('service-callout') || kinds.includes('collection-filter')) return 'special';
  if (kinds.includes('entity-creation') || attrLevelKind === 'ordinary-writable-placeholder' || attrLevelKind === 'ordinary-writable-input') return 'caller-provides';
  if (factPath) return '1:1';
  return 'gap';
}

// ── Attribute index (graph-driven) ────────────────────────────────────────

/**
 * Builds one record per written attribute using the graph's `writes` map as
 * the primary index — it authoritatively lists every (rulesheet, ruleIndex)
 * pair that writes each attribute, without needing corticonPath on every
 * crosswalk entry.
 */
function buildAttributeIndex(graphWrites, orderedSheets, project, crosswalk, factsByPath, unreachable, sheetToNodeName) {
  // Pre-compute sequential rule numbers within each rulesheet (matching the
  // Rules diagram numbering) so ruleId labels are consistent.
  const ruleNumMap = new Map();
  for (const rsName of orderedSheets) {
    const rsData = (project.rulesheets ?? {})[rsName];
    if (!rsData) continue;
    let ruleNum = 0;
    for (let idx = 0; idx < (rsData.rules ?? []).length; idx++) {
      const cwE = crosswalk.filter(e => e.rulesheet === rsName && (e.ruleIndex === idx || e.ruleIndices?.includes(idx)));
      if (!cwE.some(e => e.kind === 'no-op')) ruleNumMap.set(`${rsName}:${idx}`, ruleNum++);
    }
  }

  const attributes = [];

  for (const [corticonPath, writers] of Object.entries(graphWrites)) {
    const rules = [];
    const allKinds = [];
    const allNotes = [];
    let hasReachableWriter = false;

    for (const { rulesheet, ruleIndex } of (writers ?? [])) {
      const rsData = (project.rulesheets ?? {})[rulesheet];
      if (!rsData) continue;
      if (!unreachable.has(rulesheet)) hasReachableWriter = true;

      const rule = rsData.rules?.[ruleIndex];
      if (!rule) continue;

      const cwEntries = crosswalk.filter(e =>
        e.rulesheet === rulesheet && (e.ruleIndex === ruleIndex || e.ruleIndices?.includes(ruleIndex))
      );
      if (cwEntries.some(e => e.kind === 'no-op')) continue;

      const ruleNum = ruleNumMap.get(`${rulesheet}:${ruleIndex}`) ?? ruleIndex;
      const ruleId = `${rulesheet.replace(/\.ers$/, '')}.Rule.${ruleNum}`;
      const nodeName = sheetToNodeName[rulesheet] ?? null;
      const { conditionText, actionTexts } = formatRuleText(rule.conditions, rule.actions);
      const comment = rule.comment?.text ?? null;
      const kinds = cwEntries.map(e => e.kind);
      const notes = cwEntries.map(e => e.note).filter(Boolean);

      rules.push({ ruleId, nodeName, conditionText, actionTexts, comment, kinds, notes });
      allKinds.push(...kinds);
      allNotes.push(...notes);
    }

    // Attribute-level crosswalk entry (no rulesheet) carries factPath and kind
    // for writable/placeholder attributes.
    const attrEntry = crosswalk.find(e => e.corticonPath === corticonPath && !e.rulesheet);
    const attrLevelKind = attrEntry?.kind ?? null;
    const factPath = crosswalk.find(e => e.corticonPath === corticonPath && e.factPath)?.factPath ?? null;
    const fact = factPath ? factsByPath[factPath] : null;
    const dslExpression = fact?.derived ?? fact?.value ?? null;
    const datatype = fact?.datatype ?? null;
    const entityType = crosswalk.find(e => e.corticonPath === corticonPath && e.kind === 'entity-creation')?.entityType ?? null;

    const type = resolveType(!hasReachableWriter, allKinds, attrLevelKind, factPath);
    const notes = [...new Set(allNotes)];
    const [entity, attribute] = corticonPath.split('.');

    attributes.push({
      corticonPath, entity: entity ?? corticonPath, attribute: attribute ?? '',
      datatype, factPath, dslExpression, type, rules, notes, entityType,
    });
  }

  return attributes.sort((a, b) => a.corticonPath.localeCompare(b.corticonPath));
}

// ── HTML rendering ────────────────────────────────────────────────────────

function renderCorticonSide(rules) {
  if (!rules.length) return `<span style="color:#9ca3af;font-size:11px">No rules found</span>`;

  return rules.map(r => {
    const condPart = r.conditionText ? `IF ${r.conditionText}` : null;
    const actPart  = r.actionTexts.length
      ? (r.conditionText ? `THEN ${r.actionTexts.join('; ')}` : r.actionTexts.join('; '))
      : null;
    const text = [condPart, actPart].filter(Boolean).join('\n');
    const commentHtml = r.comment
      ? `<div style="font-size:10px;color:#9ca3af;margin-top:3px">${esc(r.comment)}</div>`
      : '';
    const metaLabel = r.nodeName ? `${r.nodeName} · ${r.ruleId}` : r.ruleId;
    const exprHtml = `<code style="font-size:11px;color:#374151;white-space:pre-wrap;word-break:break-all;font-family:${MONO}">${esc(text)}</code>${commentHtml}`;

    if (rules.length === 1) {
      return `<div style="font-size:10px;color:#9ca3af;margin-bottom:4px">${esc(metaLabel)}</div>${exprHtml}`;
    }
    // Multiple rules: each collapsed behind an expandChip — same pattern as Graph tab
    const eid = nextEid();
    return expandChip(esc(metaLabel), eid,
      'display:block;margin-bottom:4px;padding:3px 8px;border-radius:4px;background:#f3f4f6;font-size:10px;color:#374151;') +
      expandHidden(eid, `<div style="padding:6px 8px">${exprHtml}</div>`);
  }).join('\n');
}

function renderDslSide(attr) {
  const { type, factPath, dslExpression, corticonPath, entityType } = attr;
  if (type === 'caller-provides') {
    if (entityType) return `<code style="font-family:${MONO};font-size:11px;color:#0369a1">List(${esc(entityType)})</code><div style="font-size:11px;color:#6b7280;margin-top:4px">caller pre-assembles instances</div>`;
    if (factPath) return `<code style="font-family:${MONO};font-size:11px;color:#374151">${esc(factPath)}</code><div style="font-size:11px;color:#6b7280;margin-top:4px">caller-supplied input</div>`;
    return `<span style="color:#d1d5db">—</span>`;
  }
  if (type === 'special')   return `<span style="font-size:11px;color:#6b7280;font-style:italic">Orchestration step — not a graph fact.</span>`;
  if (type === 'excluded')  return `<span style="font-size:11px;color:#9ca3af;font-style:italic">Unreachable in flow.</span>`;
  if (type === 'blocked')   return `<span style="font-size:11px;color:#991b1b;font-style:italic">Blocked — see notes.</span>`;
  if (dslExpression) {
    const pathLabel = factPath && factPath !== corticonPath
      ? `<div style="font-size:10px;color:#9ca3af;margin-bottom:2px">${esc(factPath)}</div>`
      : '';
    return pathLabel + `<code style="font-size:11px;color:#374151;white-space:pre-wrap;word-break:break-all;font-family:${MONO}">${esc(dslExpression)}</code>`;
  }
  if (factPath) return `<code style="font-family:${MONO};font-size:11px;color:#374151">${esc(factPath)}</code>`;
  return `<span style="color:#d1d5db">—</span>`;
}

/**
 * Each attribute section starts collapsed — click the header to expand,
 * same pattern as the Graph tab's inline subgraph rows.
 */
function renderAttributeSection(attr) {
  const { attribute, corticonPath, datatype, type, notes } = attr;
  const eid = nextEid();
  const datatypeHtml = datatype ? ` <span style="font-size:10px;color:#9ca3af;font-family:${MONO}">${esc(datatype)}</span>` : '';
  const notesHtml = notes.length
    ? `<div style="padding:8px 12px;border-top:1px solid #f3f4f6;font-size:11px;color:#6b7280">${notes.map(n => esc(n)).join('<br>')}</div>`
    : '';

  const body = `<div style="display:grid;grid-template-columns:1fr 1fr">
    <div style="padding:10px 12px;border-right:1px solid #f3f4f6">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px">Corticon</div>
      ${renderCorticonSide(attr.rules)}
    </div>
    <div style="padding:10px 12px">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px">DSL</div>
      ${renderDslSide(attr)}
    </div>
  </div>
  ${notesHtml}`;

  return `<div class="content-item" style="margin-bottom:8px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;background:white">
  <div data-expand-id="${esc(eid)}" style="display:flex;align-items:center;gap:8px;padding:7px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;cursor:pointer">
    <span class="chip-arrow" style="font-size:9px;color:#9ca3af">&#9654;</span>
    <code style="font-size:12px;font-weight:600;color:#111827;font-family:${MONO}">${esc(attribute || corticonPath)}</code>${datatypeHtml}
    <span style="margin-left:auto">${badge(type)}</span>
  </div>
  ${expandHidden(eid, body, 'border:none;border-radius:0;')}
</div>`;
}

function renderAttributeGroups(attributes) {
  const byEntity = new Map();
  for (const attr of attributes) {
    if (!byEntity.has(attr.entity)) byEntity.set(attr.entity, []);
    byEntity.get(attr.entity).push(attr);
  }

  return [...byEntity.entries()].map(([entity, attrs]) =>
    `<div style="margin-bottom:2rem">
  <h3 style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid #e5e7eb">${esc(entity)}</h3>
  ${attrs.map(renderAttributeSection).join('\n')}
</div>`
  ).join('\n');
}

// ── Summary bar ───────────────────────────────────────────────────────────

function summaryBar(attributes) {
  const counts = {};
  for (const a of attributes) counts[a.type] = (counts[a.type] ?? 0) + 1;
  return Object.entries(TYPE_META)
    .filter(([k]) => counts[k])
    .map(([k, m]) =>
      `<button data-filter="${k}" onclick="toggleFilter('${k}')" style="padding:8px 16px;border-radius:6px;background:${m.bg};color:${m.color};font-weight:700;font-size:13px;border:2px solid ${m.color};cursor:pointer;transition:opacity .15s" title="Click to hide/show">${counts[k]} ${m.label}</button>`
    ).join('');
}

// ── Exportable content builder ────────────────────────────────────────────

/**
 * Builds the crosswalk content grouped by attribute (one section per written
 * attribute, showing Corticon logic and DSL translation side by side).
 * Requires graphPath to use the graph's `writes` map as the attribute index.
 */
export function buildCrosswalkContent(classifiedPath, crosswalkPath, translatedPath, graphPath) {
  const { sourceFile, classification } = JSON.parse(readFileSync(classifiedPath, 'utf8'));
  const project = JSON.parse(readFileSync(sourceFile, 'utf8'));
  const { crosswalk } = JSON.parse(readFileSync(crosswalkPath, 'utf8'));
  const translated = translatedPath ? JSON.parse(readFileSync(translatedPath, 'utf8')) : null;
  const graph = graphPath ? JSON.parse(readFileSync(graphPath, 'utf8')) : null;

  const factsByPath = {};
  for (const f of (translated?.facts ?? [])) {
    if (f.path) factsByPath[f.path] = f;
  }

  const unreachable = new Set(classification?.ruleflowContext?.unreachableRulesheets ?? []);
  const ruleflowEntries = Object.entries(project.ruleflows ?? {});
  const topLevel = ruleflowEntries.find(([f]) => f.includes('top-level-flow'));

  const orderedSheets = [];
  if (topLevel) {
    const ruleflowByFile = Object.fromEntries(ruleflowEntries);
    for (const node of topLevel[1].nodes ?? []) {
      const filePart = (node.invokes ?? '').split('#')[0];
      if (filePart.endsWith('.ers')) orderedSheets.push(filePart);
      else if (filePart.endsWith('.erf')) {
        for (const n of ruleflowByFile[filePart]?.nodes ?? []) {
          const f = (n.invokes ?? '').split('#')[0];
          if (f.endsWith('.ers')) orderedSheets.push(f);
        }
      }
    }
  }
  for (const name of Object.keys(project.rulesheets ?? {})) {
    if (!orderedSheets.includes(name)) orderedSheets.push(name);
  }

  const sheetToNodeName = {};
  for (const [, rf] of ruleflowEntries) {
    for (const node of rf.nodes ?? []) {
      const invokes = (node.invokes ?? '').split('#')[0];
      if (invokes.endsWith('.ers')) sheetToNodeName[invokes] = node.name;
    }
  }

  const graphWrites = graph?.writes ?? {};
  const allAttributes = buildAttributeIndex(graphWrites, orderedSheets, project, crosswalk, factsByPath, unreachable, sheetToNodeName);
  const contentHtml = renderAttributeGroups(allAttributes);
  const summaryBarHtml = summaryBar(allAttributes);

  return { summaryBarHtml, contentHtml, allAttributes };
}

// ── Main render (standalone HTML page) ────────────────────────────────────

function render(classifiedPath, crosswalkPath, translatedPath, graphPath) {
  const { summaryBarHtml, contentHtml } = buildCrosswalkContent(classifiedPath, crosswalkPath, translatedPath, graphPath);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Corticon → DSL translation guide</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; }
  h1 { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  p.sub { font-size: 13px; color: #6b7280; margin-bottom: 20px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
  .content-item { transition: border-color 0.1s; }
  .content-item:hover { border-color: #93c5fd; }
  button[data-filter].off { opacity: 0.35; text-decoration: line-through; }
</style>
</head>
<body>
<h1>Corticon → DSL translation guide</h1>
<p class="sub">One section per written attribute. Click an attribute to expand its Corticon logic and DSL translation.</p>
<div class="summary">${summaryBarHtml}</div>
${contentHtml}
<script>
  document.querySelectorAll('[data-expand-id]').forEach(btn => {
    const target = document.getElementById(btn.getAttribute('data-expand-id'));
    if (!target) return;
    btn.addEventListener('click', () => {
      const visible = target.style.display !== 'none';
      target.style.display = visible ? 'none' : '';
      const ch = btn.querySelector('.chevron, .chip-arrow');
      if (ch) ch.textContent = visible ? '\u25B6' : '\u25BC';
    });
  });
</script>
</body>
</html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseCliArgs(process.argv);
  const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const [classifiedPath, crosswalkPath] = positional;
  if (!classifiedPath || !crosswalkPath) { printUsage(); process.exit(1); }

  const translatedPath = process.argv.find(a => a.startsWith('--translated='))?.slice('--translated='.length) ?? positional[2] ?? null;
  const graphPath = process.argv.find(a => a.startsWith('--graph='))?.slice('--graph='.length) ?? null;

  const outFile = args.outFile ?? 'generated/crosswalk.html';
  writeFileSync(outFile, render(classifiedPath, crosswalkPath, translatedPath, graphPath));
  console.log(`Wrote crosswalk to ${outFile}`);
}
