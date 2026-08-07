#!/usr/bin/env node
/**
 * Produces a graph.html per fixture: sink candidate dependency graphs with
 * DSL expression panels, and the patterns.json + graph.json + dsl.json
 * source files for reference.
 *
 * Usage: node src/visualize-graph-html.js <slug>
 *   --classified  <patterns.json>
 *   --translated  <dsl.json>
 *   --graph       <graph.json>
 *   --out         <output.html>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { COLORS, FONT } from '../../../../explorer/lib/theme.js';
import { esc } from '../../../../explorer/lib/html.js';
import { PALETTE, box, rawSvgElement } from '../../diagram-utils.js';
import { jsonPanel } from '../../json-panel.js';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const DARK_BLUE = COLORS.darkBlue;

// Derived from translation-patterns.yaml — maps pattern → translation status.
// 'confirmed' = clean translation; anything else surfaces in the Exceptions tab.
const PATTERN_STATUS = {
  // Confirmed — translate cleanly
  'decision-table':                  'confirmed',
  'decision-table-alternative-row':  'confirmed',
  'explicit-override':               'confirmed',
  'composition':                     'confirmed',
  'conditional':                     'confirmed',
  'null-guard-default':              'confirmed',
  'null-guard-fallback':             'confirmed',
  'null-guard-table':                'confirmed',
  'no-op':                           'confirmed',
  'unreachable':                     'confirmed',
  'operator-precedence':             'confirmed',
  'logical-operators':               'confirmed',
  'membership-test':                 'confirmed',
  'membership-test-range':           'confirmed',
  'membership-test-list':            'confirmed',
  'constructor-output':              'confirmed',
  'constructor-input':               'confirmed',
  'date-arithmetic':                 'confirmed',
  'cycle':                           'confirmed',
  'derived':                         'confirmed',
  'input':                           'confirmed',
  'guard':                           'confirmed',
  'expression-pattern':              'confirmed',
  // Ambiguous — translate with assumption; flag for review
  'hit-policy-unverified':           'ambiguous',
  'no-default':                      'ambiguous',
  'unconditional-row-out-of-order':  'ambiguous',
  'composition-mismatch':            'ambiguous',
  // Unverified — translation exists but confidence is lower
  'fixpoint':                        'unverified',
  'call-procedure':                  'unverified',
  'call-function':                   'unverified',
  'rounding':                        'unverified',
  'sort-rank':                       'unverified',
  'sort':                            'unverified',
  'coercion':                        'unverified',
  'scalar-accumulator':              'unverified',
  'quantifier':                      'unverified',
  // Unknown — no translation strategy yet
  'cycle-unclassified':              'unknown',
  'context-conflict':                'unknown',
  'no-writer':                       'unknown',
};

const STATUS_LABEL = { ambiguous: 'Ambiguous', unverified: 'Unverified', unknown: 'Unknown' };
const STATUS_STYLE = {
  ambiguous:  { bg: '#fef9c3', text: '#854d0e', border: '#fde047' },
  unverified: { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa' },
  unknown:    { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const slug = args.find(a => !a.startsWith('--')) ?? 'output';
  return {
    slug,
    classifiedPath: get('--classified'),
    translatedPath: get('--translated'),
    graphPath:      get('--graph'),
    outFile:        get('--out') ?? `generated/${slug}-graph.html`,
  };
}

// ── Candidate subgraph SVG ───────────────────────────────────────────────────

function buildCandidateSubgraphSvg(sinkKey, data, markerId) {
  const { nodes, edges, orderedLayers } = data;
  if (!nodes?.length || !orderedLayers?.length) return '';

  const maxL = orderedLayers.length - 1;
  const CHAR_W = 7.2, H_PAD = 28, NODE_H = 44, V_GAP = 40, H_GAP = 20, MARGIN = 20;
  // Use last-two-segment label (e.g. Program.runDate) unless two nodes share the same
  // short form, in which case fall back to the full path to avoid ambiguity.
  const shortOf = n => n.split('.').slice(-2).join('.');
  const shortCounts = new Map();
  for (const n of nodes) shortCounts.set(shortOf(n), (shortCounts.get(shortOf(n)) ?? 0) + 1);
  const label = n => shortCounts.get(shortOf(n)) === 1 ? shortOf(n) : n;
  const nodeW = n => Math.max(140, Math.ceil(label(n).length * CHAR_W) + H_PAD);
  const layerY = l => MARGIN + (maxL - l) * (NODE_H + V_GAP);
  const layerTotalW = l => (orderedLayers[l] ?? []).reduce((s, n) => s + nodeW(n), 0)
    + Math.max(0, (orderedLayers[l] ?? []).length - 1) * H_GAP;
  const svgW = Math.max(200, ...orderedLayers.map((_, l) => layerTotalW(l))) + 2 * MARGIN;
  const svgH = MARGIN + (maxL + 1) * (NODE_H + V_GAP) - V_GAP + MARGIN;

  const pos = {};
  for (let l = 0; l <= maxL; l++) {
    let x = (svgW - layerTotalW(l)) / 2;
    for (const n of (orderedLayers[l] ?? [])) {
      pos[n] = { x, y: layerY(l) };
      x += nodeW(n) + H_GAP;
    }
  }

  const seen = new Set(), uniqueEdges = [];
  for (const e of edges) {
    if (e.from === e.to) continue;
    const k = `${e.from}\u2192${e.to}`;
    if (!seen.has(k) && pos[e.from] && pos[e.to]) { seen.add(k); uniqueEdges.push(e); }
  }

  const parts = [];
  for (const e of uniqueEdges) {
    const fp = pos[e.from], tp = pos[e.to];
    const x1 = fp.x + nodeW(e.from) / 2, y1 = fp.y + NODE_H;
    const x2 = tp.x + nodeW(e.to)   / 2, y2 = tp.y;
    parts.push(`<line class="sg-edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6b7280" stroke-width="1.5"/>`);
  }
  for (const n of nodes) {
    const p = pos[n]; if (!p) continue;
    const { svg: boxSvg } = box(p.x, p.y, nodeW(n), label(n), null, [], n === sinkKey ? PALETTE.navy : PALETTE.teal);
    parts.push(`<g class="sg-node" data-node="${esc(n)}" title="${esc(n)}" style="cursor:pointer">${boxSvg}</g>`);
  }

  return rawSvgElement(markerId, svgW, svgH, parts.join('\n'));
}

function orderSubgraphNodes(data) {
  const { orderedLayers } = data;
  if (!orderedLayers?.length) return [];
  return [...orderedLayers].reverse().flat();
}

// ── Data Model tab ───────────────────────────────────────────────────────────

function renderDataModelTab(translatedPath) {
  if (!translatedPath) return '<p style="color:#9ca3af;font-size:12px">No translated file provided.</p>';
  let facts;
  try { ({ facts } = JSON.parse(readFileSync(translatedPath, 'utf-8'))); }
  catch { return '<p style="color:#9ca3af;font-size:12px">Could not load translated file.</p>'; }

  const inputs  = (facts ?? []).filter(f => f.writable);
  const outputs = (facts ?? []).filter(f => f.expression !== undefined || f.entityCreationOutput);

  function groupByEntity(factList) {
    const byEntity = new Map();
    for (const f of factList) {
      const entity = f.path?.split('/').filter(Boolean)[0] ?? '(unknown)';
      if (!byEntity.has(entity)) byEntity.set(entity, []);
      byEntity.get(entity).push(f);
    }
    return byEntity;
  }

  function renderSection(factList, sectionTitle) {
    if (!factList.length) return '';
    const groupHtml = [...groupByEntity(factList).entries()].map(([entity, items]) => {
      const rows = items.map(f => {
        const typeHtml = f.datatype ? `<span style="color:#6b7280;font-size:11px">${esc(f.datatype)}</span>` : '';
        const tbdHtml  = f.entityCreationOutput ? `<span style="color:#b45309;font-size:10px;font-style:italic;margin-left:4px">CEL TBD</span>` : '';
        return `<tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:4px 12px 4px 0;font-family:${MONO};font-size:11px;color:#374151;white-space:nowrap">${esc(f.path ?? '')}</td>
          <td style="padding:4px 0;white-space:nowrap">${typeHtml}${tbdHtml}</td>
        </tr>`;
      }).join('');
      return `<div style="break-inside:avoid;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:#111827;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb">${esc(entity)}</div>
        <table style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:2rem">
      <h3 style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;padding-bottom:5px;border-bottom:1px solid #e5e7eb">${esc(sectionTitle)}</h3>
      <div style="columns:3 280px;column-gap:32px">${groupHtml}</div>
    </div>`;
  }

  return renderSection(inputs, 'Inputs — caller-supplied') + renderSection(outputs, 'Outputs — derived by rules');
}

// ── DSL expression list ──────────────────────────────────────────────────────

function encodeKey(key) { return key.replace(/[^a-zA-Z0-9-]/g, '_'); }

function renderDslNodeRow(node, isSink, fact) {
  const shortNode = node.split('.').slice(-2).join('.');
  const expr = fact?.expression ?? fact?.value ?? null;
  const nameStyle = isSink
    ? `font-weight:700;color:#2B1A78;font-family:${MONO};font-size:11.5px`
    : `color:#374151;font-family:${MONO};font-size:11.5px`;
  let exprHtml;
  if (expr && fact?.entityCreationOutput) {
    exprHtml = `<code style="font-size:11px;color:#b45309;font-style:italic;white-space:nowrap;font-family:${MONO}">${esc(expr)}</code><span style="color:#b45309;font-size:10px;margin-left:6px">(Corticon source — CEL TBD)</span>`;
  } else if (expr) {
    exprHtml = `<code style="font-size:11px;color:#374151;white-space:nowrap;font-family:${MONO}">${esc(expr)}</code>`;
  } else if (fact?.placeholder) {
    exprHtml = `<span style="color:#9ca3af;font-size:11px;font-style:italic">input</span><span style="color:#6b7280;font-size:11px"> (default: </span><code style="font-size:11px;color:#374151;font-family:${MONO}">${esc(fact.placeholder)}</code><span style="color:#6b7280;font-size:11px">)</span>`;
  } else if (fact?._meta) {
    exprHtml = `<span style="color:#b45309;font-size:11px;font-style:italic" title="${esc(fact.note ?? '')}">${esc(fact.kind)}</span>`;
  } else if (fact) {
    exprHtml = fact.datatype
      ? `<span style="color:#9ca3af;font-size:11px;font-style:italic">${esc(fact.datatype)}</span>`
      : `<span style="color:#9ca3af;font-size:11px;font-style:italic">input</span>`;
  } else {
    exprHtml = `<span style="color:#9ca3af;font-size:11px;font-style:italic">—</span>`;
  }
  return `<tr style="border-bottom:1px solid #f3f4f6">
    <td style="padding:5px 16px 5px 0;white-space:nowrap;vertical-align:top;width:40%"><span style="${nameStyle}">${isSink ? '● ' : ''}${esc(shortNode)}</span></td>
    <td style="padding:5px 0;vertical-align:top">${exprHtml}</td>
  </tr>`;
}

function colHeader(label) {
  return `<tr><th style="padding:6px 16px 4px 0;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;text-align:left">${esc(label)}</th><th></th></tr>`;
}

function renderDslNodeList(sinkKey, orderedNodes, corticonToFact, edges, nodeTypes) {
  if (!orderedNodes?.length) return '<p style="color:#9ca3af;font-size:11px;padding:8px 0">No nodes found.</p>';
  const hasIncoming = new Set((edges ?? []).filter(e => e.from !== e.to).map(e => e.to));
  const logic = orderedNodes.filter(n => n !== sinkKey && hasIncoming.has(n)).concat(sinkKey);

  const dataRows = orderedNodes.map(n => {
    const shortN = n.split('.').slice(-2).join('.');
    const type = nodeTypes?.[n] ?? nodeTypes?.[shortN] ?? (corticonToFact[n]?.datatype) ?? '—';
    const nameStyle = n === sinkKey
      ? `font-weight:700;color:#2B1A78;font-family:${MONO};font-size:11px`
      : `color:#374151;font-family:${MONO};font-size:11px`;
    return `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:4px 12px 4px 0;white-space:nowrap"><span style="${nameStyle}">${n === sinkKey ? '● ' : ''}${esc(shortN)}</span></td>
      <td style="padding:4px 0;font-size:11px;color:#6b7280;white-space:nowrap">${esc(type)}</td>
    </tr>`;
  }).join('');
  const dataTable = `<table style="width:100%;border-collapse:collapse">${colHeader('Data')}${dataRows}</table>`;

  function logicTable(nodes) {
    const rows = [colHeader('Logic'), ...nodes.map(n => renderDslNodeRow(n, n === sinkKey, corticonToFact[n]))];
    return `<table style="width:100%;border-collapse:collapse">${rows.join('')}</table>`;
  }

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid #e5e7eb;margin-top:8px">
    <div style="padding:12px 20px 12px 0;border-right:1px solid #e5e7eb">${dataTable}</div>
    <div style="padding:12px 0 12px 20px">${logicTable(logic)}</div>
  </div>`;
}

function renderCandidatesNavAndPanels(candidates, subgraphs, corticonToFact, nodeTypes) {
  const entries = Object.entries(candidates);
  if (!entries.length) return { navHtml: '', panelsHtml: '', count: 0, firstTabId: null };

  const candidateKeySet = new Set(Object.keys(candidates));
  const appearsInSubgraph = new Set(
    Object.entries(subgraphs).flatMap(([key, sub]) =>
      (sub.nodes ?? []).filter((n) => n !== key && candidateKeySet.has(n)),
    ),
  );
  const topLevel = entries.filter(([k]) => !appearsInSubgraph.has(k));

  const navItems = [];
  const panels = [];
  let firstTabId = null;

  // Group by subgraph depth, order groups depth desc, items within each group by flow position desc
  const byDepth = new Map();
  for (const [key, info] of entries) {
    const depth = subgraphs[key]?.depth ?? 0;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push([key, info]);
  }
  const depthGroups = [...byDepth.keys()].sort((a, b) => b - a);
  for (const depth of depthGroups) {
    const group = byDepth.get(depth).sort((a, b) => {
      const posA = a[1].latestPosition ?? -1;
      const posB = b[1].latestPosition ?? -1;
      return posB - posA;
    });
    const label = depth === 0 ? 'No graph' : depth === 1 ? 'Depth 1' : `Depth ${depth}`;
    navItems.push(`<div class="nav-section-label" style="margin-top:0.5rem">${esc(label)}</div>`);
    for (const [key] of group) {
      const tabId = `cg-${encodeKey(key)}`;
      if (!firstTabId) firstTabId = tabId;
      const shortKey = key.split('.').slice(-2).join('.');
      navItems.push(`<a class="nav-link cg-nav-item" data-tab="${esc(tabId)}" title="${esc(key)}">
          <span style="font-family:${MONO};font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block">${esc(shortKey)}</span>
        </a>`);
    }
  }

  for (const [key, info] of entries) {
    const subgraph = subgraphs[key] ?? {};
    const tabId = `cg-${encodeKey(key)}`;
    const nodeCount = subgraph.nodeCount ?? '?';
    const depth     = subgraph.depth     ?? '?';
    const posRatio  = info.latestPosition != null ? `${info.latestPosition}/${info.totalPositions}` : '—';
    const rsRatio   = info.rulesheetCount != null ? `${info.rulesheetCount}/${info.totalRulesheets}` : '—';

    const hasSub = !!subgraphs[key];
    const graphHtml = hasSub ? subgraph.svg : '<p style="color:#9ca3af;font-size:12px">No subgraph data.</p>';
    const dslHtml   = hasSub ? renderDslNodeList(key, subgraph.orderedNodes, corticonToFact, subgraph.edges, nodeTypes, shortenPath) : '';

    panels.push(`<div id="${esc(tabId)}" class="tab-panel" style="padding:1.5rem 2rem">
        <div style="margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #e5e7eb">
          <h2 style="font-size:15px;font-weight:700;color:#111827;font-family:${MONO};margin-bottom:6px">${esc(key)}</h2>
          <div style="display:flex;gap:16px;font-size:11px;color:#6b7280">
            <span><b>${esc(String(nodeCount))}</b> nodes</span>
            <span><b>${esc(String(depth))}</b> depth</span>
            <span><b>${esc(String(rsRatio))}</b> rulesheets</span>
            <span>flow position <b>${esc(String(posRatio))}</b></span>
          </div>
        </div>
        <div style="margin-bottom:28px">${graphHtml}</div>
        ${dslHtml}
      </div>`);
  }

  return { navHtml: navItems.join('\n'), panelsHtml: panels.join('\n'), count: entries.length, firstTabId };
}

// ── Exceptions tab ───────────────────────────────────────────────────────────

function renderExceptionsTab(translatedPath) {
  if (!translatedPath) return '<p style="color:#9ca3af;font-size:12px">No translation log provided.</p>';
  let translationLog;
  try { ({ translationLog } = JSON.parse(readFileSync(translatedPath, 'utf-8'))); }
  catch { return '<p style="color:#9ca3af;font-size:12px">Could not load translation log.</p>'; }

  const exceptions = (translationLog ?? []).filter(e => {
    const status = PATTERN_STATUS[e.pattern];
    return status !== undefined && status !== 'confirmed';
  });

  if (!exceptions.length) {
    return '<p style="color:#9ca3af;font-size:12px">No exceptions — all patterns translate cleanly.</p>';
  }

  const byStatus = { ambiguous: [], unverified: [], unknown: [] };
  for (const e of exceptions) {
    const s = PATTERN_STATUS[e.pattern] ?? 'unknown';
    if (byStatus[s]) byStatus[s].push(e);
  }

  const sections = ['ambiguous', 'unverified', 'unknown']
    .filter(s => byStatus[s].length)
    .map(s => {
      const items = byStatus[s];
      const { bg, text, border } = STATUS_STYLE[s];
      const rows = items.map(e => {
        const path = e.corticonPath ?? e.path ?? '';
        const loc  = `${e.rulesheet ?? ''}${e.ruleIndex != null ? ` #${e.ruleIndex}` : ''}`;
        return `<tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:5px 12px 5px 0;white-space:nowrap;font-family:${MONO};font-size:11px;color:#6b7280">${esc(loc)}</td>
          <td style="padding:5px 12px 5px 0;white-space:nowrap">
            <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:${bg};color:${text};border:1px solid ${border}">${esc(e.pattern)}</span>
          </td>
          <td style="padding:5px 12px 5px 0;white-space:nowrap;font-family:${MONO};font-size:11px;color:#374151">${esc(path)}</td>
          <td style="padding:5px 0;font-size:11px;color:#4b5563;font-style:italic">${esc(e.note ?? '')}</td>
        </tr>`;
      }).join('');
      return `<div style="margin-bottom:2rem">
        <h3 style="font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #e5e7eb;color:${text}">${STATUS_LABEL[s]}<span style="font-weight:400;color:#9ca3af;margin-left:6px">${items.length}</span></h3>
        <table style="width:100%;border-collapse:collapse"><tbody>${rows}</tbody></table>
      </div>`;
    }).join('');

  return `<div>
    <p style="font-size:12px;color:#6b7280;margin-bottom:1.5rem">${exceptions.length} pattern${exceptions.length !== 1 ? 's' : ''} where translation is unconfirmed, requires review, or cannot be automated.</p>
    ${sections}
  </div>`;
}

// ── Main render ──────────────────────────────────────────────────────────────

async function render(opts) {
  const { slug, classifiedPath, translatedPath, graphPath } = opts;

  const corticonToFact = {};
  try {
    if (translatedPath) {
      const { facts, translationLog } = JSON.parse(readFileSync(translatedPath, 'utf-8'));
      const factsByPath = {};
      for (const f of (facts ?? [])) if (f.path) factsByPath[f.path] = f;
      for (const entry of (translationLog ?? [])) {
        if (entry.sourcePath && entry.factPath && factsByPath[entry.factPath]) {
          corticonToFact[entry.sourcePath] = factsByPath[entry.factPath];
        } else if (entry.path && entry.pattern && !entry.factPath) {
          corticonToFact[entry.path] = corticonToFact[entry.path] ?? { _meta: true, kind: entry.pattern, note: entry.note };
        }
      }
    }
  } catch { /* DSL tab will show blanks */ }

  let sinkCandidates = {};
  let rawCandidateGraphs = {};
  try {
    const { sourceFile, classification } = JSON.parse(readFileSync(classifiedPath, 'utf-8'));
    sinkCandidates = classification?.sinkCandidates ?? {};
    if (graphPath) {
      const { buildCandidateSubgraph, buildDependencyGraph } = await import('../../graph/build-graph.js');
      const project = JSON.parse(readFileSync(sourceFile, 'utf-8'));
      const graph = buildDependencyGraph(project);
      for (const [key] of Object.entries(sinkCandidates)) {
        rawCandidateGraphs[key] = buildCandidateSubgraph(key, graph);
      }
    }
  } catch { /* ok */ }

  const subgraphs = {};
  let markerSerial = 0;
  for (const [key, data] of Object.entries(rawCandidateGraphs)) {
    try {
      subgraphs[key] = {
        nodeCount: data.nodeCount,
        depth: data.depth,
        nodes: data.nodes ?? [],
        edges: data.edges ?? [],
        orderedLayers: data.orderedLayers ?? [],
        svg: buildCandidateSubgraphSvg(key, data, `arrow-cg-${markerSerial++}`),
        orderedNodes: orderSubgraphNodes(data),
      };
    } catch { /* skip */ }
  }

  let nodeTypes = {};
  try {
    const { sourceFile } = JSON.parse(readFileSync(classifiedPath, 'utf-8'));
    const project = JSON.parse(readFileSync(sourceFile, 'utf-8'));
    // Primary: vocabulary gives authoritative types (including enums) keyed by declared entity name.
    for (const [, vocab] of Object.entries(project.vocabularies ?? {})) {
      const customTypes = new Map(Object.entries(vocab.customTypes ?? {}));
      for (const [entityName, entity] of Object.entries(vocab.entities ?? {})) {
        for (const [attrName, attr] of Object.entries(entity.attributes ?? {})) {
          let datatype;
          if (attr.kind === 'association') {
            datatype = attr.isCollection ? `List(${attr.type?.name ?? '?'})` : (attr.type?.name ?? '?');
          } else if (attr.type?.kind === 'customType') {
            const ct = customTypes.get(attr.type.name);
            datatype = (ct?.isEnum && ct.values?.length) ? ct.values.join(' | ') : attr.type.name;
          } else {
            datatype = attr.type?.name ?? null;
          }
          if (datatype) nodeTypes[`${entityName}.${attrName}`] = datatype;
        }
      }
    }
    // Scan rule terms: use the canonical entity type (term.parent.datatype) as the key,
    // matching what canonicalAttributePath and the graph use, so lookups by graph node key work.
    for (const [, rulesheet] of Object.entries(project.rulesheets ?? {})) {
      for (const rule of rulesheet.rules ?? []) {
        for (const cell of [...(rule.conditions ?? []), ...(rule.actions ?? [])].filter(Boolean)) {
          for (const term of [...(cell.referencedTerms ?? []), ...(cell.modifiedTerms ?? [])]) {
            if (term.termtype !== 'ATTRIBUTE' || !term.parent?.datatype || !term.datatype) continue;
            const key = `${term.parent.datatype}.${term.text}`;
            if (!nodeTypes[key]) nodeTypes[key] = term.datatype;
          }
        }
      }
    }
  } catch { /* ok */ }

  let candidatesNavHtml = '', candidatesPanelsHtml = '', candidateCount = 0, firstCandidateTabId = null;
  try {
    const result = renderCandidatesNavAndPanels(sinkCandidates, subgraphs, corticonToFact, nodeTypes);
    candidatesNavHtml = result.navHtml;
    candidatesPanelsHtml = result.panelsHtml;
    candidateCount = result.count;
    firstCandidateTabId = result.firstTabId;
  } catch (e) { candidatesPanelsHtml = `<p style="color:#991b1b;padding:1rem">Error: ${esc(e.message)}</p>`; }

  const dataModelHtml = renderDataModelTab(translatedPath);
  const exceptionsHtml = renderExceptionsTab(translatedPath);

  let exceptionCount = 0;
  try {
    const { translationLog } = JSON.parse(readFileSync(translatedPath, 'utf-8'));
    exceptionCount = (translationLog ?? []).filter(e => {
      const s = PATTERN_STATUS[e.pattern]; return s !== undefined && s !== 'confirmed';
    }).length;
  } catch { /* ok */ }

  const jsonFiles = [
    { id: 'json-classified',       label: 'patterns.json',      path: classifiedPath },
    { id: 'json-graph',            label: 'graph.json',         path: graphPath },
    { id: 'json-translated',       label: 'blueprint-dsl.json', path: translatedPath },
  ];
  const jsonNavItems   = jsonFiles.map(f => jsonPanel(f.id, f.label, f.path).navHtml).join('\n');
  const jsonPanelsHtml = jsonFiles.map(f => jsonPanel(f.id, f.label, f.path).panelHtml).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${esc(slug)} — Graph</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { font-family: ${FONT}; background: #F3F3F3; color: #1a1a1a; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    #page-header { flex-shrink: 0; background: ${DARK_BLUE}; color: white; padding: 10px 20px; font-size: 14px; font-weight: 700; }
    #page-header span { font-weight: 400; opacity: 0.6; margin-left: 8px; font-size: 12px; }
    .page-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    #sidebar { width: 220px; min-width: 220px; background: ${DARK_BLUE}; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden; }
    #sidebar-nav { padding: 0.5rem 0; overflow-y: auto; flex: 1; }
    a.nav-link { display: block; padding: 5px 0.75rem; font-size: 11px; color: rgba(255,255,255,0.65); text-decoration: none; cursor: pointer; transition: background 0.1s; }
    a.nav-link:hover { background: rgba(255,255,255,0.08); color: white; }
    a.nav-link.nav-active { background: rgba(255,255,255,0.15); color: white; font-weight: 700; }
    @keyframes nav-flash { 0% { background: rgba(250,204,21,0.45); } 100% { background: transparent; } }
    a.nav-link.nav-flash { animation: nav-flash 2s ease-out forwards; }
    .nav-section-label { font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.35); padding: 0.75rem 0.75rem 0.2rem; }
    #content { flex: 1; min-width: 0; position: relative; overflow: hidden; }
    .tab-panel { display: none; position: absolute; inset: 0; overflow: auto; }
    .tab-panel.active { display: block; }
    tr[id]:target td { background: #fff9c4; }
  </style>
</head>
<body>
  <div id="page-header">${esc(slug)}<span>Graph</span></div>
  <div class="page-layout">
    <nav id="sidebar">
      <div id="sidebar-nav">
        <div class="nav-section-label">VIEWS</div>
        <a class="nav-link" data-tab="data-model">Data Model</a>
        <a class="nav-link" data-tab="exceptions">Exceptions${exceptionCount > 0 ? ` <span style="opacity:0.6;font-size:10px">${esc(String(exceptionCount))}</span>` : ''}</a>
        <div class="nav-section-label" style="margin-top:0.5rem">GRAPH <span style="opacity:0.5;font-weight:400">${esc(String(candidateCount))}</span></div>
        <div style="padding:4px 8px 6px">
          <input id="candidate-search" type="search" placeholder="Filter…"
            style="width:100%;padding:3px 6px;border:1px solid rgba(255,255,255,0.2);border-radius:3px;font-size:10px;background:rgba(255,255,255,0.08);color:white;outline:none;"
            aria-label="Filter sink candidates" />
        </div>
        ${candidatesNavHtml}
        <div class="nav-section-label" style="margin-top:0.5rem">JSON</div>
        ${jsonNavItems}
      </div>
    </nav>
    <main id="content">
      <div id="data-model" class="tab-panel" style="padding:1.5rem 2rem">
        <h2 style="font-size:15px;font-weight:700;color:#111827;margin-bottom:16px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">Data Model</h2>
        ${dataModelHtml}
      </div>
      <div id="exceptions" class="tab-panel" style="padding:1.5rem 2rem">
        <h2 style="font-size:15px;font-weight:700;color:#111827;margin-bottom:16px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">Exceptions</h2>
        ${exceptionsHtml}
      </div>
      ${candidatesPanelsHtml}
      ${jsonPanelsHtml}
    </main>
  </div>
  <script>
    document.getElementById('candidate-search')?.addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      document.querySelectorAll('.cg-nav-item').forEach(item => {
        item.style.display = !q || item.title.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    (function () {
      function activate(tabId, source, flash) {
        document.querySelectorAll('#sidebar .nav-link[data-tab]').forEach(a => {
          const match = a.dataset.tab === tabId;
          a.classList.toggle('nav-active', match && a === source);
          if (flash && match && a !== source) {
            a.classList.remove('nav-flash');
            void a.offsetWidth; // restart animation
            a.classList.add('nav-flash');
            a.addEventListener('animationend', () => a.classList.remove('nav-flash'), { once: true });
          } else if (!match) {
            a.classList.remove('nav-flash');
          }
        });
        document.querySelectorAll('#content .tab-panel').forEach(p => p.classList.remove('active'));
        const panel = document.getElementById(tabId);
        if (panel) panel.classList.add('active');
      }
      document.querySelectorAll('#sidebar .nav-link[data-tab]').forEach(a => {
        a.addEventListener('click', () => activate(a.dataset.tab, a, true));
      });
      const firstCandidate = document.querySelector('#sidebar .cg-nav-item[data-tab]');
      const first = firstCandidate ?? document.querySelector('#sidebar .nav-link[data-tab]');
      if (first) activate(first.dataset.tab, first, false);
    })();

    // Click-to-highlight: clicking a node dims all edges and highlights only those
    // connected to it. Clicking the same node or the SVG background resets.
    document.addEventListener('click', function (e) {
      const nodeEl = e.target.closest('.sg-node');
      const svg = e.target.closest('svg');
      if (!svg) return;
      const allNodes = svg.querySelectorAll('.sg-node');
      const allEdges = svg.querySelectorAll('.sg-edge');
      if (!nodeEl || !svg.contains(nodeEl)) {
        // Click on background — reset
        allNodes.forEach(n => n.style.opacity = '');
        allEdges.forEach(l => { l.style.opacity = ''; l.setAttribute('stroke', '#6b7280'); l.setAttribute('stroke-width', '1.5'); });
        svg._activeNode = null;
        return;
      }
      const node = nodeEl.dataset.node;
      if (svg._activeNode === node) {
        // Click same node again — reset
        allNodes.forEach(n => n.style.opacity = '');
        allEdges.forEach(l => { l.style.opacity = ''; l.setAttribute('stroke', '#6b7280'); l.setAttribute('stroke-width', '1.5'); });
        svg._activeNode = null;
        return;
      }
      svg._activeNode = node;
      // Collect all nodes directly connected to the clicked node via any edge.
      const connected = new Set([node]);
      allEdges.forEach(l => {
        if (l.dataset.from === node) connected.add(l.dataset.to);
        if (l.dataset.to === node) connected.add(l.dataset.from);
      });
      allNodes.forEach(n => n.style.opacity = connected.has(n.dataset.node) ? '1' : '0.15');
      allEdges.forEach(l => {
        const isConnected = l.dataset.from === node || l.dataset.to === node;
        l.style.opacity = isConnected ? '1' : '0.1';
        l.setAttribute('stroke', isConnected ? '#2B1A78' : '#6b7280');
        l.setAttribute('stroke-width', isConnected ? '2.5' : '1.5');
      });
    });
  </script>
</body>
</html>`;
}

const opts = parseArgs(process.argv);
if (!opts.classifiedPath || !opts.translatedPath) {
  console.error('Usage: node src/visualize-graph-html.js <slug> --classified <f> --translated <f> [--graph <f>] [--out <file.html>]');
  process.exit(1);
}

writeFileSync(opts.outFile, await render(opts));
console.log(`Wrote graph output to ${opts.outFile}`);
