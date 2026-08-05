#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCliArgs } from './cli-utils.js';
import { formatRuleText } from './corticon/rulesheet.js';
import { resolveRuleflowContext } from './classify/ruleflow-context.js';
import { entriesOf, keysOf } from './map-utils.js';

function normalizeProject(raw) {
  const project = raw.project ?? raw;
  return { ...project, rulesheets: new Map(entriesOf(project.rulesheets)), ruleflows: new Map(entriesOf(project.ruleflows)) };
}

function printUsage() {
  console.error('Usage: node src/visualize-crosswalk.js <classified.json> <crosswalk.json> [--translated <translated.json>] [--out <file.html>]');
}

function esc(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  'no-op':                          { label: 'no-op (no actions)',          color: '#6b7280', bg: '#f3f4f6' },
  'gap':                            { label: 'no mapping',                  color: '#6b7280', bg: '#fafafa' },
};

function badge(type) {
  const m = TYPE_META[type] ?? TYPE_META['gap'];
  return `<span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:11px;font-weight:600;background:${m.bg};color:${m.color};white-space:nowrap">${m.label}</span>`;
}

function hl(code) {
  // Minimal syntax highlight for CEL/Corticon expressions
  if (!code || code === '—') return `<span style="color:#d1d5db">—</span>`;
  return `<code style="font-size:11px;color:#374151;white-space:pre-wrap;word-break:break-all">${esc(code)}</code>`;
}

// ── Build rule rows from rulesheet data ───────────────────────────────────

function buildRuleRows(rsName, rsData, crosswalk, factsByPath, nodeName = null) {
  const rows = [];
  const rules = rsData.rules ?? [];
  let ruleNum = 0; // 0-based counter for non-empty rules, matching the rules diagram

  for (let idx = 0; idx < rules.length; idx++) {
    const rule = rules[idx];
    const { conditionText, actionTexts } = formatRuleText(rule.conditions, rule.actions);
    const comment    = rule.comment?.text ?? null;

    // Find crosswalk entries for this rulesheet+index
    const cwEntries = crosswalk.filter(e =>
      e.rulesheet === rsName && (e.ruleIndex === idx || e.ruleIndices?.includes(idx))
    );

    // Skip no-ops (blank template rows, label columns, rules with no actions) --
    // determined by classify, not by structural inspection here.
    if (cwEntries.some(e => e.kind === 'no-op')) continue;

    const ruleId = `${rsName.replace(/\.ers$/, '')}.Rule.${ruleNum}`;
    ruleNum++;

    // Find what attribute(s) this rule writes -- corticonPath is already on the
    // crosswalk entries for this rulesheet+index, no separate writes index needed.
    const writtenPaths = cwEntries.map(e => e.corticonPath).filter(Boolean);

    // Determine fact path(s) by looking up each written corticonPath in the full crosswalk
    const factPaths = writtenPaths
      .map(cp => crosswalk.find(e => e.corticonPath === cp)?.factPath)
      .filter(Boolean);
    const uniqueFactPaths = [...new Set(factPaths)];

    const compiledExprs = uniqueFactPaths
      .map(fp => factsByPath[fp])
      .filter(Boolean)
      .map(f => f.derived ?? f.value ?? null)
      .filter(Boolean);

    // Determine mapping type
    let type = 'gap';
    const kinds = cwEntries.map(e => e.kind);
    // Also look up the attribute-level crosswalk kind for each written path
    // (e.g. ordinary-writable-placeholder has no rulesheet/ruleIndex, only corticonPath)
    const writtenKinds = writtenPaths
      .map(cp => crosswalk.find(e => e.corticonPath === cp && !e.rulesheet)?.kind)
      .filter(Boolean);
    if (rsData.unreachable) {
      type = 'excluded';
    } else if (kinds.includes('genuine-cycle') || kinds.includes('no-ordinary-writer')) {
      type = 'blocked';
    } else if (kinds.some(k => ['no-fallback-row', 'assembly-rulesheet-mismatch', 'unconditional-row-out-of-order'].includes(k))) {
      type = kinds.find(k => ['no-fallback-row', 'assembly-rulesheet-mismatch', 'unconditional-row-out-of-order'].includes(k));
    } else if (kinds.includes('expression-pattern')) {
      type = 'expression';
    } else if (kinds.includes('no-op')) {
      type = 'no-op';
    } else if (kinds.includes('service-callout') || kinds.includes('filter')) {
      type = 'special';
    } else if (kinds.includes('entity-creation') || writtenKinds.includes('ordinary-writable-placeholder') || writtenKinds.includes('ordinary-writable-input')) {
      // Null-default rules: Corticon sets a default when the value is null.
      // The dependency graph has no equivalent — it assumes the caller supplies the value with defaults already applied.
      type = 'caller-provides';
    } else if (uniqueFactPaths.length > 0) {
      type = '1:1';
    }

    const notes = cwEntries.map(e => e.note).filter(Boolean);
    const entityType = cwEntries.find(e => e.kind === 'entity-creation')?.entityType ?? null;

    rows.push({ ruleId, nodeName, conditionText, actionTexts, comment, factPaths: uniqueFactPaths, compiledExprs, type, entityType, notes });

  }

  return rows;
}

// ── HTML rendering ────────────────────────────────────────────────────────

function renderRow(row) {
  const reviewTypes = new Set(['no-fallback-row', 'assembly-rulesheet-mismatch', 'unconditional-row-out-of-order']);
  const rowBg = row.type === 'blocked'        ? '#fff5f5'
              : reviewTypes.has(row.type)     ? '#fffdf0'
              : row.type === 'excluded'        ? '#fafafa'
              : '';

  // Corticon side: "IF ... THEN ..." when conditions present; actions only otherwise.
  const condPart = row.conditionText ? `IF ${row.conditionText}` : null;
  const actPart  = row.actionTexts.length ? (row.conditionText ? `THEN ${row.actionTexts.join('; ')}` : row.actionTexts.join('; ')) : null;
  const ifThenText = [condPart, actPart].filter(Boolean).join(' ');
  const commentHtml = row.comment
    ? `<div style="font-size:10px;color:#9ca3af;margin-top:3px">${esc(row.comment)}</div>`
    : '';
  const corticonCell = `<code style="font-size:11px;color:#374151;white-space:pre-wrap;word-break:break-all">${esc(ifThenText)}</code>` + commentHtml;

  // Dependency graph side: path(s) + compiled expression(s), or explanatory text for caller-provides
  let graphCell;
  if (row.type === 'caller-provides') {
    if (row.entityType) {
      graphCell = `<span style="font-size:11px;color:#0369a1;font-family:monospace">List(${esc(row.entityType)})</span><span style="font-size:11px;color:#6b7280"> — caller pre-assembles instances</span>`;
    } else if (row.factPaths.length) {
      graphCell = row.factPaths.map(fp =>
        `<div style="font-family:monospace;font-size:11px;color:#374151">${esc(fp)}</div>`
      ).join('');
    } else {
      graphCell = `<span style="color:#d1d5db">—</span>`;
    }
  } else if (row.type === 'special') {
    graphCell = `<span style="font-size:11px;color:#6b7280;font-style:italic">Orchestration step — not represented as a graph fact.</span>`;
  } else if (row.factPaths.length) {
    graphCell = row.factPaths.map((fp, i) => {
        const expr = row.compiledExprs[i] ?? null;
        return `<div style="margin-bottom:${i < row.factPaths.length - 1 ? '6px' : '0'}">` +
          `<div style="font-family:monospace;font-size:11px;color:#374151">${esc(fp)}</div>` +
          (expr ? `<div style="font-size:10px;color:#6b7280;margin-top:2px">${esc(expr)}</div>` : '') +
          `</div>`;
      }).join('');
  } else {
    graphCell = `<span style="color:#d1d5db">—</span>`;
  }

  const noteCell = row.notes.length
    ? row.notes.map(n => `<div style="font-size:11px;color:#6b7280;white-space:normal;line-height:1.5">${esc(n)}</div>`).join('')
    : '';

  const ruleLabel = row.nodeName
    ? `<div style="font-weight:700;font-size:12px;color:#111827;margin-bottom:2px">${esc(row.nodeName)}</div>` +
      `<div style="font-family:monospace;font-size:11px;color:#9ca3af">${esc(row.ruleId)}</div>`
    : `<div style="font-family:monospace;font-size:11px;color:#9ca3af">${esc(row.ruleId)}</div>`;

  return `<tr style="background:${rowBg}" data-type="${row.type}">
    <td style="padding:7px 12px;white-space:nowrap;vertical-align:top">${ruleLabel}</td>
    <td style="padding:7px 12px;vertical-align:top">${corticonCell}</td>
    <td style="padding:7px 12px;vertical-align:top">${graphCell}</td>
    <td style="padding:7px 12px;white-space:nowrap;vertical-align:top">${badge(row.type)}</td>
    <td style="padding:7px 12px;vertical-align:top">${noteCell}</td>
  </tr>`;
}

function renderRulesheetGroup(rsName, rows) {
  return rows.map(renderRow).join('\n');
}

// ── Summary bar ───────────────────────────────────────────────────────────

function summaryBar(allRows) {
  const counts = {};
  for (const r of allRows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return Object.entries(TYPE_META)
    .filter(([k]) => counts[k])
    .map(([k, m]) =>
      `<button data-filter="${k}" onclick="toggleFilter('${k}')" style="padding:8px 16px;border-radius:6px;background:${m.bg};color:${m.color};font-weight:700;font-size:13px;border:2px solid ${m.color};cursor:pointer;opacity:1;transition:opacity .15s" title="Click to hide/show these rows">${counts[k]} ${m.label}</button>`
    ).join('');
}

// ── Main render ───────────────────────────────────────────────────────────

function render(classifiedPath, crosswalkPath, translatedPath) {
  const { project, classification } = JSON.parse(readFileSync(classifiedPath, 'utf8'));
  const { crosswalk } = JSON.parse(readFileSync(crosswalkPath, 'utf8'));
  const translated = translatedPath ? JSON.parse(readFileSync(translatedPath, 'utf8')) : null;

  // Index compiled facts by path for quick lookup
  const factsByPath = {};
  for (const f of (translated?.facts ?? [])) {
    if (f.path) factsByPath[f.path] = f;
  }

  // Get rulesheet execution order from the top-level ruleflow
  const ruleflowEntries = Object.entries(project.ruleflows ?? {});
  const topLevel = ruleflowEntries.find(([f]) => f.includes('top-level-flow'));
  const unreachable = new Set(classification?.ruleflowContext?.unreachableRulesheets ?? []);

  // Build ordered list of rulesheets from flow, then append any not in flow
  const orderedSheets = [];
  if (topLevel) {
    const ruleflowByFile = Object.fromEntries(ruleflowEntries);
    for (const node of topLevel[1].nodes ?? []) {
      const filePart = (node.invokes ?? '').split('#')[0];
      if (filePart.endsWith('.ers')) orderedSheets.push(filePart);
      else if (filePart.endsWith('.erf')) {
        const sub = ruleflowByFile[filePart];
        for (const n of sub?.nodes ?? []) {
          const f = (n.invokes ?? '').split('#')[0];
          if (f.endsWith('.ers')) orderedSheets.push(f);
        }
      }
    }
  }
  // Append any sheets not reachable from the flow
  for (const name of Object.keys(project.rulesheets ?? {})) {
    if (!orderedSheets.includes(name)) orderedSheets.push(name);
  }

  // Build a map from rulesheet filename → ruleflow node name
  const sheetToNodeName = {};
  for (const [, rf] of ruleflowEntries) {
    for (const node of rf.nodes ?? []) {
      const invokes = (node.invokes ?? '').split('#')[0];
      if (invokes.endsWith('.ers')) sheetToNodeName[invokes] = node.name;
    }
  }

  // Build all rows grouped by rulesheet
  const allRows = [];
  const groups = orderedSheets.map(rsName => {
    const rsData = (project.rulesheets ?? {})[rsName];
    if (!rsData) return null;
    if (unreachable.has(rsName)) rsData.unreachable = true;
    const nodeName = sheetToNodeName[rsName] ?? null;
    const rows = buildRuleRows(rsName, rsData, crosswalk, factsByPath, nodeName);
    allRows.push(...rows);
    return { rsName, rows };
  }).filter(Boolean);

  const tableBody = groups.map(g => renderRulesheetGroup(g.rsName, g.rows)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Corticon → Dependency Graph Crosswalk</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; }
  h1 { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  p.sub { font-size: 13px; color: #6b7280; margin-bottom: 20px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  thead th { padding: 8px 12px; font-size: 11px; font-weight: 600; color: #6b7280; background: #f3f4f6; text-align: left; text-transform: uppercase; letter-spacing: 0.05em; }
  tbody tr:hover td { background: #f0f9ff !important; }
  tbody tr td { border-bottom: 1px solid #f3f4f6; }
  tbody tr[data-type].hidden { display: none; }
  button[data-filter].off { opacity: 0.35; text-decoration: line-through; }
</style>
<script>
  const hidden = new Set();
  function toggleFilter(type) {
    const btn = document.querySelector('[data-filter="' + type + '"]');
    if (hidden.has(type)) {
      hidden.delete(type);
      btn.classList.remove('off');
      document.querySelectorAll('tr[data-type="' + type + '"]').forEach(r => r.classList.remove('hidden'));
    } else {
      hidden.add(type);
      btn.classList.add('off');
      document.querySelectorAll('tr[data-type="' + type + '"]').forEach(r => r.classList.add('hidden'));
    }
  }
</script>
</head>
<body>
<h1>Corticon &rarr; Dependency Graph Crosswalk</h1>
<p class="sub">One row per rule (in flow order), showing the Corticon action and the compiled dependency graph expression.</p>
<div class="summary">${summaryBar(allRows)}</div>
<table>
  <thead>
    <tr>
      <th style="width:16%">Rule</th>
      <th style="width:26%">Corticon logic</th>
      <th style="width:26%">Dependency graph</th>
      <th style="width:12%">Mapping</th>
      <th style="width:20%">Notes</th>
    </tr>
  </thead>
  <tbody>
    ${tableBody}
  </tbody>
</table>
</body>
</html>`;
}

const args = parseCliArgs(process.argv);
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const [classifiedPath, crosswalkPath] = positional;
if (!classifiedPath || !crosswalkPath) { printUsage(); process.exit(1); }

// Optional translated.json for compiled expressions
const translatedArg = process.argv.find(a => a.startsWith('--translated='));
const translatedPath = translatedArg
  ? translatedArg.slice('--translated='.length)
  : positional[2] ?? null;

const outFile = args.outFile ?? 'generated/crosswalk.html';
writeFileSync(outFile, render(classifiedPath, crosswalkPath, translatedPath));
console.log(`Wrote crosswalk to ${outFile}`);
