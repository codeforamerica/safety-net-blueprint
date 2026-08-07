#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from '../../cli-utils.js';
import { formatRuleText } from './corticon/rulesheet.js';
import { esc, nextEid, expandHidden, expandChip } from '../../../../explorer/lib/html.js';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

function printUsage() {
  console.error('Usage: node src/visualize-translation-log.js <patterns.json> <blueprint-dsl.json> [--graph <graph.json>] [--out <file.html>]');
}

// ── Badge metadata ────────────────────────────────────────────────────────

const TYPE_META = {
  'translated':                     { label: 'translated',                color: '#166534', bg: '#dcfce7' },
  'input':                          { label: 'input',                     color: '#0369a1', bg: '#e0f2fe' },
  'output':                         { label: 'output',                    color: '#0369a1', bg: '#e0f2fe' },
  'modifier':                       { label: 'modifier',                  color: '#5b21b6', bg: '#ede9fe' },
  'no-default':                     { label: 'no default row',            color: '#92400e', bg: '#fef9c3' },
  'composition-mismatch':           { label: 'composition mismatch',      color: '#92400e', bg: '#fef9c3' },
  'unconditional-row-out-of-order': { label: 'row order ambiguous',       color: '#92400e', bg: '#fef9c3' },
  'needs-redesign':                 { label: 'needs redesign',            color: '#991b1b', bg: '#fee2e2' },
  'no-writer':                      { label: 'no writer',                 color: '#991b1b', bg: '#fee2e2' },
  'excluded':                       { label: 'excluded',                  color: '#6b7280', bg: '#f3f4f6' },
  'gap':                            { label: 'no mapping',                color: '#6b7280', bg: '#fafafa' },
};

function badge(type) {
  const m = TYPE_META[type] ?? TYPE_META['gap'];
  return `<span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:11px;font-weight:600;background:${m.bg};color:${m.color};white-space:nowrap">${m.label}</span>`;
}

// ── Rulesheet/ruleIndex extraction from ruleId ────────────────────────────

function ruleIdParts(ruleId) {
  if (!ruleId) return { rulesheet: null, ruleIndex: null };
  const colonIdx = ruleId.lastIndexOf(':');
  if (colonIdx < 0) return { rulesheet: ruleId, ruleIndex: null };
  const idx = parseInt(ruleId.slice(colonIdx + 1), 10);
  return { rulesheet: ruleId.slice(0, colonIdx), ruleIndex: isNaN(idx) ? null : idx };
}

// ── Display type resolution ───────────────────────────────────────────────

function resolveDisplayType(patterns, role, translated) {
  if (!translated) {
    if (role === 'excluded') return 'excluded';
    if (patterns.includes('cycle') || patterns.includes('no-writer')) return 'needs-redesign';
    if (role === 'input') return 'input';
    if (role === 'output') return 'output';
  }
  if (role === 'modifier') return 'modifier';
  if (role === 'input') return 'input';
  if (role === 'output') return 'output';
  const warningPattern = patterns.find(p => ['no-default', 'composition-mismatch', 'unconditional-row-out-of-order'].includes(p));
  if (warningPattern) return warningPattern;
  if (translated) return 'translated';
  return 'gap';
}

// ── Attribute index (graph-driven) ────────────────────────────────────────

/**
 * Builds one record per written attribute using the graph's `writes` map as
 * the primary index, cross-referencing translation log entries by ruleId.
 */
function buildAttributeIndex(graphWrites, orderedSheets, project, translationLog, factsByPath, unreachable, sheetToNodeName) {
  // Pre-compute sequential rule numbers within each rulesheet (matching the
  // rules diagram numbering) so ruleId labels are consistent.
  const ruleNumMap = new Map();
  for (const rsName of orderedSheets) {
    const rsData = (project.rulesheets ?? {})[rsName];
    if (!rsData) continue;
    let ruleNum = 0;
    for (let idx = 0; idx < (rsData.rules ?? []).length; idx++) {
      const isNoOp = translationLog.some(e => {
        const p = ruleIdParts(e.ruleId);
        return p.rulesheet === rsName && p.ruleIndex === idx && e.pattern === 'no-op';
      });
      if (!isNoOp) ruleNumMap.set(`${rsName}:${idx}`, ruleNum++);
    }
  }

  const attributes = [];

  for (const [sourcePath, writers] of Object.entries(graphWrites)) {
    const rules = [];
    const allPatterns = [];
    let hasReachableWriter = false;
    let role = null;
    let translated = false;

    for (const { rulesheet, ruleIndex } of (writers ?? [])) {
      const rsData = (project.rulesheets ?? {})[rulesheet];
      if (!rsData) continue;
      if (!unreachable.has(rulesheet)) hasReachableWriter = true;

      const rule = rsData.rules?.[ruleIndex];
      if (!rule) continue;

      const logEntries = translationLog.filter(e => {
        const p = ruleIdParts(e.ruleId);
        return p.rulesheet === rulesheet &&
          (p.ruleIndex === ruleIndex || (e.ruleIndices?.includes(ruleIndex)));
      });
      if (logEntries.some(e => e.pattern === 'no-op')) continue;

      const ruleFullId = `${rulesheet}:${ruleIndex}`;
      const ruleNum = ruleNumMap.get(ruleFullId) ?? ruleIndex;
      const ruleLabel = `${rulesheet.replace(/\.ers$/, '')}.Rule.${ruleNum}`;
      const nodeName = sheetToNodeName[rulesheet] ?? null;
      const { conditionText, actionTexts } = formatRuleText(rule.conditions, rule.actions);
      const comment = rule.comment?.text ?? null;
      const patterns = logEntries.map(e => e.pattern);

      rules.push({ ruleId: ruleLabel, nodeName, conditionText, actionTexts, comment, patterns });
      allPatterns.push(...patterns);
    }

    // Find the attribute-level translation log entry for this sourcePath.
    const attrEntry = translationLog.find(e => e.sourcePath === sourcePath);
    if (attrEntry) {
      role = attrEntry.role;
      translated = attrEntry.translated ?? false;
    }

    const factPath = translationLog.find(e => e.sourcePath === sourcePath && e.factPath)?.factPath ?? null;
    const fact = factPath ? factsByPath[factPath] : null;
    const dslExpression = fact?.expression ?? null;
    const datatype = fact?.datatype ?? null;
    const suggestedName = translationLog.find(e => e.sourcePath === sourcePath && e.suggestedName)?.suggestedName ?? null;
    const entityType = translationLog.find(e => e.sourcePath === sourcePath && e.entityType)?.entityType ?? null;

    const displayType = resolveDisplayType(allPatterns, role ?? (hasReachableWriter ? 'derived' : 'excluded'), translated);
    const [entity, attribute] = sourcePath.split('.');

    attributes.push({
      sourcePath, entity: entity ?? sourcePath, attribute: attribute ?? '',
      datatype, factPath, dslExpression, displayType, rules, entityType, suggestedName,
    });
  }

  return attributes.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
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
    const eid = nextEid();
    return expandChip(esc(metaLabel), eid,
      'display:block;margin-bottom:4px;padding:3px 8px;border-radius:4px;background:#f3f4f6;font-size:10px;color:#374151;') +
      expandHidden(eid, `<div style="padding:6px 8px">${exprHtml}</div>`);
  }).join('\n');
}

function renderDslSide(attr) {
  const { displayType, factPath, dslExpression, sourcePath, entityType, suggestedName } = attr;
  if (displayType === 'input' && !factPath) {
    if (entityType) return `<code style="font-family:${MONO};font-size:11px;color:#0369a1">List(${esc(entityType)})</code><div style="font-size:11px;color:#6b7280;margin-top:4px">caller pre-assembles instances${suggestedName ? ` — suggested name: ${esc(suggestedName)}` : ''}</div>`;
    return `<span style="color:#d1d5db">—</span>`;
  }
  if (displayType === 'modifier')      return `<span style="font-size:11px;color:#6b7280;font-style:italic">Filter folded into compiled guards — not a standalone fact.</span>`;
  if (displayType === 'excluded')      return `<span style="font-size:11px;color:#9ca3af;font-style:italic">Unreachable in flow.</span>`;
  if (displayType === 'needs-redesign') return `<span style="font-size:11px;color:#991b1b;font-style:italic">Cannot translate automatically — see translation log.</span>`;
  if (dslExpression) {
    const pathLabel = factPath && factPath !== sourcePath
      ? `<div style="font-size:10px;color:#9ca3af;margin-bottom:2px">${esc(factPath)}</div>`
      : '';
    return pathLabel + `<code style="font-size:11px;color:#374151;white-space:pre-wrap;word-break:break-all;font-family:${MONO}">${esc(dslExpression)}</code>`;
  }
  if (factPath) return `<code style="font-family:${MONO};font-size:11px;color:#374151">${esc(factPath)}</code>`;
  return `<span style="color:#d1d5db">—</span>`;
}

function renderAttributeSection(attr) {
  const { attribute, sourcePath, datatype, displayType } = attr;
  const eid = nextEid();
  const datatypeHtml = datatype ? ` <span style="font-size:10px;color:#9ca3af;font-family:${MONO}">${esc(datatype)}</span>` : '';

  const body = `<div style="display:grid;grid-template-columns:1fr 1fr">
    <div style="padding:10px 12px;border-right:1px solid #f3f4f6">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px">Corticon</div>
      ${renderCorticonSide(attr.rules)}
    </div>
    <div style="padding:10px 12px">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px">DSL</div>
      ${renderDslSide(attr)}
    </div>
  </div>`;

  return `<div class="content-item" style="margin-bottom:8px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;background:white">
  <div data-expand-id="${esc(eid)}" style="display:flex;align-items:center;gap:8px;padding:7px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;cursor:pointer">
    <span class="chip-arrow" style="font-size:9px;color:#9ca3af">&#9654;</span>
    <code style="font-size:12px;font-weight:600;color:#111827;font-family:${MONO}">${esc(attribute || sourcePath)}</code>${datatypeHtml}
    <span style="margin-left:auto">${badge(displayType)}</span>
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
  for (const a of attributes) counts[a.displayType] = (counts[a.displayType] ?? 0) + 1;
  return Object.entries(TYPE_META)
    .filter(([k]) => counts[k])
    .map(([k, m]) =>
      `<button data-filter="${k}" onclick="toggleFilter('${k}')" style="padding:8px 16px;border-radius:6px;background:${m.bg};color:${m.color};font-weight:700;font-size:13px;border:2px solid ${m.color};cursor:pointer;transition:opacity .15s" title="Click to hide/show">${counts[k]} ${m.label}</button>`
    ).join('');
}

// ── Exportable content builder ────────────────────────────────────────────

/**
 * Builds the translation log view grouped by attribute (one section per written
 * attribute, showing Corticon logic and DSL translation side by side).
 * Requires graphPath to use the graph's `writes` map as the attribute index.
 */
export function buildTranslationLogContent(classifiedPath, blueprintDslPath, graphPath) {
  const { sourceFile, classification } = JSON.parse(readFileSync(classifiedPath, 'utf8'));
  const project = JSON.parse(readFileSync(sourceFile, 'utf8'));
  const { facts, translationLog } = JSON.parse(readFileSync(blueprintDslPath, 'utf8'));
  const graph = graphPath ? JSON.parse(readFileSync(graphPath, 'utf8')) : null;

  const factsByPath = {};
  for (const f of (facts ?? [])) {
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
  const allAttributes = buildAttributeIndex(graphWrites, orderedSheets, project, translationLog, factsByPath, unreachable, sheetToNodeName);
  const contentHtml = renderAttributeGroups(allAttributes);
  const summaryBarHtml = summaryBar(allAttributes);

  return { summaryBarHtml, contentHtml, allAttributes };
}

// ── Main render (standalone HTML page) ────────────────────────────────────

function render(classifiedPath, blueprintDslPath, graphPath) {
  const { summaryBarHtml, contentHtml } = buildTranslationLogContent(classifiedPath, blueprintDslPath, graphPath);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Corticon → DSL translation log</title>
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
<h1>Corticon → DSL translation log</h1>
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
  const [classifiedPath, blueprintDslPath] = positional;
  if (!classifiedPath || !blueprintDslPath) { printUsage(); process.exit(1); }

  const graphPath = process.argv.find(a => a.startsWith('--graph='))?.slice('--graph='.length) ?? null;

  const outFile = args.outFile ?? 'generated/translation-log.html';
  writeFileSync(outFile, render(classifiedPath, blueprintDslPath, graphPath));
  console.log(`Wrote translation log to ${outFile}`);
}
