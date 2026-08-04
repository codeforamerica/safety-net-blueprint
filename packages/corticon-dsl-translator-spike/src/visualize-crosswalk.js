#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCliArgs } from './cli-utils.js';

function printUsage() {
  console.error('Usage: node src/visualize-crosswalk.js <classified.json> <crosswalk.json> [--out <file.html>]');
  console.error('Example: node src/visualize-crosswalk.js generated/all-patterns-classified.json generated/all-patterns-translated.crosswalk.json --out generated/all-patterns-crosswalk.html');
}

// Status priority: higher = worse
const STATUS_RANK = { clean: 0, special: 1, warning: 2, blocked: 3, excluded: 4 };

const KIND_META = {
  'ordinary-derived':              { status: 'clean',    label: 'derived',            color: '#166534', bg: '#dcfce7' },
  'ordinary-writable-input':       { status: 'clean',    label: 'input',              color: '#1e3a5f', bg: '#dbeafe' },
  'ordinary-writable-placeholder': { status: 'clean',    label: 'placeholder',        color: '#1e3a5f', bg: '#dbeafe' },
  'expression-pattern':            { status: 'special',  label: 'custom function',    color: '#5b21b6', bg: '#ede9fe' },
  'filter':                        { status: 'special',  label: 'filter',             color: '#5b21b6', bg: '#ede9fe' },
  'service-callout':               { status: 'special',  label: 'service callout',    color: '#92400e', bg: '#fef3c7' },
  'entity-creation':               { status: 'special',  label: 'entity creation',    color: '#374151', bg: '#f3f4f6' },
  'hit-policy-unverified':         { status: 'warning',  label: 'hit policy?',        color: '#92400e', bg: '#fef9c3' },
  'no-fallback-row':               { status: 'warning',  label: 'no fallback',        color: '#92400e', bg: '#fef9c3' },
  'assembly-rulesheet-mismatch':   { status: 'warning',  label: 'assembly mismatch',  color: '#92400e', bg: '#fef9c3' },
  'unconditional-row-out-of-order':{ status: 'warning',  label: 'row order',          color: '#92400e', bg: '#fef9c3' },
  'genuine-cycle':                 { status: 'blocked',  label: 'cycle — manual',     color: '#991b1b', bg: '#fee2e2' },
  'no-ordinary-writer':            { status: 'blocked',  label: 'no writer',          color: '#991b1b', bg: '#fee2e2' },
  'unreachable-rulesheet':         { status: 'excluded', label: 'unreachable',        color: '#6b7280', bg: '#f3f4f6' },
};

function worstStatus(kinds) {
  return kinds.reduce((worst, k) => {
    const rank = STATUS_RANK[KIND_META[k]?.status ?? 'clean'] ?? 0;
    return rank > STATUS_RANK[worst] ? (KIND_META[k]?.status ?? 'clean') : worst;
  }, 'clean');
}

const SECTION_COLORS = {
  clean:    { border: '#16a34a', bg: '#f0fdf4', text: '#14532d' },
  special:  { border: '#7c3aed', bg: '#faf5ff', text: '#4c1d95' },
  warning:  { border: '#d97706', bg: '#fffbeb', text: '#78350f' },
  blocked:  { border: '#dc2626', bg: '#fef2f2', text: '#7f1d1d' },
  excluded: { border: '#9ca3af', bg: '#f9fafb', text: '#374151' },
};

function badge(kind) {
  const meta = KIND_META[kind] ?? { label: kind, color: '#374151', bg: '#f3f4f6' };
  return `<span style="display:inline-block;padding:1px 7px;border-radius:9999px;font-size:11px;font-weight:600;background:${meta.bg};color:${meta.color};white-space:nowrap">${meta.label}</span>`;
}

function escapeHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, max = 120) {
  if (!str || str.length <= max) return str ?? '';
  return str.slice(0, max) + '…';
}

// Expand top-level-flow nodes: ActivityNodes that invoke sub-ruleflows are
// replaced with their child nodes grouped under the parent name.
function buildFlowSections(project, unreachableRulesheets) {
  const ruleflowEntries = Object.entries(project.ruleflows);
  const topLevel = ruleflowEntries.find(([f]) => f.includes('top-level-flow'));
  if (!topLevel) return [];

  const ruleflowByFile = Object.fromEntries(ruleflowEntries);
  const sections = [];

  for (const node of topLevel[1].nodes) {
    const invokes = node.invokes ?? '';
    const filePart = invokes.split('#')[0];

    if (filePart.endsWith('.ers')) {
      sections.push({ flowNode: node.name, rulesheets: [filePart], kind: node.kind });
    } else if (filePart.endsWith('.erf')) {
      const subRf = ruleflowByFile[filePart];
      if (subRf) {
        const subSheets = subRf.nodes
          .map((n) => n.invokes?.split('#')[0])
          .filter((f) => f?.endsWith('.ers'));
        sections.push({ flowNode: node.name, rulesheets: subSheets, kind: 'sub-ruleflow', subFlow: filePart });
      } else {
        // Service callout or unresolved sub-ruleflow
        sections.push({ flowNode: node.name, rulesheets: [], kind: 'service-callout', subFlow: filePart });
      }
    }
  }

  // Unreachable rulesheets at the end
  if (unreachableRulesheets?.length) {
    sections.push({ flowNode: null, rulesheets: unreachableRulesheets, kind: 'unreachable' });
  }

  return sections;
}

// For each corticon path, collect all crosswalk entries that mention it.
// Returns Map<corticonPath, entry[]>
function indexCrosswalkByPath(crosswalk) {
  const byPath = new Map();
  function add(path, entry) {
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(entry);
  }
  for (const entry of crosswalk) {
    const path = entry.corticonPath ?? entry.path;
    if (path) add(path, entry);
  }
  return byPath;
}

// Rulesheet-level entries (not tied to a specific path)
function getRulesheetLevelEntries(crosswalk, rulesheet) {
  return crosswalk.filter(
    (e) => e.rulesheet === rulesheet && !e.corticonPath && !e.path
  );
}

function renderPathRow(corticonPath, pathAnnotations, writes) {
  const entries = pathAnnotations.get(corticonPath) ?? [];
  const kinds = entries.map((e) => e.kind);
  const status = worstStatus(kinds);

  // The primary mapping entry
  const mappingEntry = entries.find((e) => e.corticonPath && e.factPath);
  const factPath = mappingEntry?.factPath ?? '—';

  // Warning/error entries (not the mapping entry itself)
  const issues = entries.filter((e) => !e.factPath || e.kind !== 'ordinary-derived' && e.kind !== 'ordinary-writable-input' && e.kind !== 'ordinary-writable-placeholder');

  // All unique kinds for badge display
  const badgeKinds = [...new Set(kinds.filter((k) => k !== 'ordinary-derived' || !mappingEntry?.factPath))];
  // Always show the mapping kind
  if (mappingEntry) badgeKinds.unshift(mappingEntry.kind);
  const uniqueBadgeKinds = [...new Set(badgeKinds)];

  const noteTexts = issues.map((e) => e.note).filter(Boolean);
  const noteHtml = noteTexts.length
    ? `<span title="${escapeHtml(noteTexts.join(' | '))}" style="cursor:help;color:#6b7280;font-size:11px">${escapeHtml(truncate(noteTexts[0]))}</span>`
    : '';

  const rowBg = status === 'blocked' ? '#fff5f5' : status === 'warning' ? '#fffdf0' : '';

  return `<tr style="background:${rowBg}">
    <td style="padding:6px 10px;font-family:monospace;font-size:12px;color:#374151;white-space:nowrap">${escapeHtml(corticonPath)}</td>
    <td style="padding:6px 10px;font-family:monospace;font-size:12px;color:#6b7280;white-space:nowrap">${factPath !== '—' ? `<a href="#" style="color:#2563eb;text-decoration:none">${escapeHtml(factPath)}</a>` : '<span style="color:#d1d5db">—</span>'}</td>
    <td style="padding:6px 10px;white-space:nowrap">${uniqueBadgeKinds.map(badge).join(' ')}</td>
    <td style="padding:6px 10px;font-size:12px;color:#6b7280">${noteHtml}</td>
  </tr>`;
}

function renderSection(section, crosswalk, writes, pathAnnotations) {
  const rows = [];
  const allKinds = [];

  for (const rulesheet of section.rulesheets) {
    // Rulesheet-level entries (entity-creation, filter, expression-pattern, unreachable)
    const sheetEntries = getRulesheetLevelEntries(crosswalk, rulesheet);
    for (const e of sheetEntries) allKinds.push(e.kind);

    // Paths written by this rulesheet
    const writtenPaths = Object.entries(writes)
      .filter(([, writers]) => writers.some((w) => w.rulesheet === rulesheet))
      .map(([path]) => path);

    for (const path of writtenPaths) {
      const entries = pathAnnotations.get(path) ?? [];
      entries.forEach((e) => allKinds.push(e.kind));
      rows.push(renderPathRow(path, pathAnnotations, writes));
    }

    // Sheet-level badges (no path row)
    if (sheetEntries.length && writtenPaths.length === 0) {
      for (const e of sheetEntries) {
        const noteHtml = e.note
          ? `<span title="${escapeHtml(e.note)}" style="cursor:help;color:#6b7280;font-size:11px">${escapeHtml(truncate(e.note))}</span>`
          : '';
        rows.push(`<tr>
          <td style="padding:6px 10px;font-size:12px;color:#9ca3af;font-style:italic" colspan="2">${escapeHtml(e.entityType ?? e.rulesheet ?? '')}</td>
          <td style="padding:6px 10px">${badge(e.kind)}</td>
          <td style="padding:6px 10px;font-size:12px">${noteHtml}</td>
        </tr>`);
      }
    }
  }

  // Handle service callout sections (no rulesheets)
  if (section.kind === 'service-callout') {
    const scEntry = crosswalk.find((e) => e.kind === 'service-callout');
    allKinds.push('service-callout');
    const note = scEntry?.note ?? '';
    rows.push(`<tr>
      <td style="padding:6px 10px;font-size:12px;color:#9ca3af;font-style:italic">${escapeHtml(scEntry?.connector?.serviceName ?? section.subFlow ?? '')}</td>
      <td style="padding:6px 10px;color:#d1d5db;font-size:12px">—</td>
      <td style="padding:6px 10px">${badge('service-callout')}</td>
      <td style="padding:6px 10px;font-size:12px;color:#6b7280"><span title="${escapeHtml(note)}" style="cursor:help">${escapeHtml(truncate(note))}</span></td>
    </tr>`);
  }

  const status = section.kind === 'unreachable' ? 'excluded' : worstStatus(allKinds);
  const col = SECTION_COLORS[status] ?? SECTION_COLORS.clean;
  const headerLabel = section.flowNode
    ? `${section.flowNode}${section.subFlow ? ` <span style="font-weight:400;opacity:.7">via ${section.subFlow}</span>` : ''}`
    : 'Unreachable';
  const rulesheetLabel = section.rulesheets.join(', ') || section.subFlow || '';

  return `
  <tr>
    <td colspan="4" style="padding:10px 12px;background:${col.bg};border-left:4px solid ${col.border};border-top:8px solid #f9fafb">
      <span style="font-weight:700;font-size:13px;color:${col.text}">${headerLabel}</span>
      ${rulesheetLabel ? `<span style="margin-left:10px;font-size:11px;font-family:monospace;color:#9ca3af">${escapeHtml(rulesheetLabel)}</span>` : ''}
    </td>
  </tr>
  ${rows.join('\n')}`;
}

function render(classifiedPath, crosswalkPath) {
  const classifiedData = JSON.parse(readFileSync(classifiedPath, 'utf8'));
  const crosswalkData = JSON.parse(readFileSync(crosswalkPath, 'utf8'));

  const { project, graph, classification } = classifiedData;
  const crosswalk = crosswalkData.crosswalk;
  const writes = graph.writes;

  const pathAnnotations = indexCrosswalkByPath(crosswalk);
  const sections = buildFlowSections(project, classification.ruleflowContext?.unreachableRulesheets);

  // Summary counts
  const allKinds = crosswalk.map((e) => e.kind);
  const clean = allKinds.filter((k) => ['ordinary-derived', 'ordinary-writable-input', 'ordinary-writable-placeholder'].includes(k)).length;
  const warnings = allKinds.filter((k) => KIND_META[k]?.status === 'warning').length;
  const blocked = allKinds.filter((k) => KIND_META[k]?.status === 'blocked').length;
  const special = allKinds.filter((k) => KIND_META[k]?.status === 'special').length;
  const excluded = allKinds.filter((k) => KIND_META[k]?.status === 'excluded').length;

  const summaryHtml = `
  <div style="display:flex;gap:16px;padding:16px 0;flex-wrap:wrap">
    <div style="padding:10px 18px;border-radius:8px;background:#dcfce7;color:#166534;font-weight:700">${clean} clean</div>
    <div style="padding:10px 18px;border-radius:8px;background:#fef9c3;color:#92400e;font-weight:700">${warnings} needs review</div>
    <div style="padding:10px 18px;border-radius:8px;background:#fee2e2;color:#991b1b;font-weight:700">${blocked} blocked</div>
    <div style="padding:10px 18px;border-radius:8px;background:#ede9fe;color:#5b21b6;font-weight:700">${special} special</div>
    <div style="padding:10px 18px;border-radius:8px;background:#f3f4f6;color:#6b7280;font-weight:700">${excluded} excluded</div>
  </div>`;

  const tableHtml = `
  <table style="width:100%;border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <thead>
      <tr style="background:#f3f4f6;text-align:left">
        <th style="padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600;width:25%">Corticon attribute</th>
        <th style="padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600;width:22%">Fact path</th>
        <th style="padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600;width:20%">Status</th>
        <th style="padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600">Notes</th>
      </tr>
    </thead>
    <tbody>
      ${sections.map((s) => renderSection(s, crosswalk, writes, pathAnnotations)).join('\n')}
    </tbody>
  </table>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Corticon → Fact Crosswalk</title>
<style>
  body { margin: 0; padding: 24px; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  h1 { font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 4px; }
  p.sub { font-size: 13px; color: #6b7280; margin: 0 0 16px; }
  table tr:hover td { background: #f0f9ff !important; }
</style>
</head>
<body>
<h1>Corticon → Fact Crosswalk</h1>
<p class="sub">Mapping from Corticon rulesheets (in flow order) to compiled Fact paths, with translation status per field.</p>
${summaryHtml}
${tableHtml}
</body>
</html>`;
}

const args = parseCliArgs(process.argv);
if (!args || args.positional?.split?.(' ')?.length < 1) {
  printUsage();
  process.exit(0);
}

const [classifiedPath, crosswalkPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!classifiedPath || !crosswalkPath) { printUsage(); process.exit(1); }

const outFile = args.outFile ?? 'generated/crosswalk.html';
const html = render(classifiedPath, crosswalkPath);
writeFileSync(outFile, html);
console.log(`Wrote crosswalk to ${outFile}`);
