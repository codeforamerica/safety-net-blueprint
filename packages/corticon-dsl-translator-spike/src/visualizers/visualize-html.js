#!/usr/bin/env node
/**
 * Combined pipeline visualizer: Graph, Source, Analysis, Debug.
 *
 * Usage: node src/visualizers/visualize-html.js <slug>
 *   --project     <input.json>
 *   --graph       <graph.json>
 *   --translation-log <translation-log.json>
 *   --out         <output.html>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { validateSchema } from '../validate-schema.js';
import { COLORS, FONT } from '../../../explorer/lib/theme.js';
import { esc } from '../../../explorer/lib/html.js';
import { FIELD_CSS } from '../../../explorer/lib/field-card.js';
import { PALETTE, box, rawSvgElement } from '../diagram-utils.js';
import { jsonPanel } from '../json-panel.js';
import { buildEntityAliasMap } from '../graph/attribute-path.js';
import { buildCandidateSubgraph } from '../graph/build-graph.js';
import { buildRulesDiagramContent, getRulesheetNavigationOrder } from '../sources/corticon/visualize-rules.js';
import { toFactGraphXml, parseCelExpr } from '../targets/irs-fact-graph/to-fact-graph-xml.js';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const DARK_BLUE = COLORS.darkBlue;

const STATUS_LABEL = { inferred: 'Inferred', unsupported: 'Unsupported', error: 'Error' };
const STATUS_STYLE = {
  inferred:    { bg: '#fef9c3', text: '#854d0e', border: '#fde047' },
  unsupported: { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa' },
  error:       { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
};

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const slug = args.find(a => !a.startsWith('--')) ?? 'output';
  return {
    slug,
    projectPath:         get('--project'),
    rulespecPath:        get('--rulespec'),
    translationLogPath:  get('--translation-log'),
    graphPath:           get('--graph'),
    outFile:             get('--out') ?? `generated/${slug}.html`,
  };
}

// ── Graph tab: candidate subgraph SVG ─────────────────────────────────────────

function buildCandidateSubgraphSvg(sinkKey, data, markerId) {
  const { nodes, edges, orderedLayers } = data;
  if (!nodes?.length || !orderedLayers?.length) return '';

  const maxL = orderedLayers.length - 1;
  const CHAR_W = 7.2, H_PAD = 28, NODE_H = 44, V_GAP = 40, H_GAP = 20, MARGIN = 20;
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

// ── Graph tab: Data Model ─────────────────────────────────────────────────────

function groupNodesByEntity(graphPath) {
  if (!graphPath) return new Map();
  try {
    const graphData = JSON.parse(readFileSync(graphPath, 'utf-8'));
    const byEntity = new Map();
    for (const [nodePath, nodeInfo] of Object.entries(graphData.nodes ?? {})) {
      const isInput = nodePath.startsWith('$.');
      const canonical = isInput ? nodePath.slice(2) : nodePath;
      const parts = canonical.split('.');
      if (parts.length < 2) continue;
      const entity = parts[0];
      const attr = parts.slice(1).join('.');
      if (!byEntity.has(entity)) byEntity.set(entity, []);
      byEntity.get(entity).push({ canonical, attr, nodeInfo, isInput });
    }
    return byEntity;
  } catch { return new Map(); }
}

function buildDataModelNavItems(graphPath) {
  const byEntity = groupNodesByEntity(graphPath);
  if (!byEntity.size) return '';
  return [...byEntity.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([entity, items]) =>
    `<a class="nav-link dm-entity-link" data-dm-entity="${esc(entity)}" title="${esc(entity)}" style="display:flex;align-items:center;justify-content:space-between;gap:4px">` +
    `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(entity)}</span>` +
    `<span style="opacity:0.45;font-size:9px;flex-shrink:0">${items.length}</span>` +
    `</a>`
  ).join('');
}

function renderDataModelContent(graphPath, projectPath) {
  if (!graphPath) return '<p style="color:#9ca3af;font-size:12px">No graph file provided.</p>';

  // Read vocabulary custom types for enum labels
  const vocabCustomTypes = new Map();
  if (projectPath) {
    try {
      const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
      for (const [, vocab] of Object.entries(project.vocabularies ?? {})) {
        for (const [typeName, typeInfo] of Object.entries(vocab.customTypes ?? {})) {
          vocabCustomTypes.set(typeName, typeInfo);
        }
      }
    } catch { /* ok */ }
  }

  const byEntity = groupNodesByEntity(graphPath);
  if (!byEntity.size) return '<p style="color:#9ca3af;font-size:12px">No nodes found.</p>';

  const sections = [...byEntity.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([entity, items]) => {
    items.sort((a, b) => a.attr.localeCompare(b.attr));
    const cards = items.map(({ attr, nodeInfo, canonical }) => {
      let typeBadge = '';
      let bodyHtml = '';

      if (nodeInfo.enum?.length) {
        typeBadge = `<span class="type-badge">enum</span>`;
        const values = nodeInfo.enum;
        const labels = nodeInfo.enumDescriptions ?? [];
        const valItems = values.map((v, i) => {
          const label = labels[i];
          return `<code>${esc(v)}</code>${label ? `<span style="font-size:0.7rem;color:#666;margin-left:4px">${esc(label)}</span>` : ''}`;
        }).join(' ');
        bodyHtml = `<div class="card-body"><div class="ann-row"><span class="ann-label">Values</span><span class="val-list">${valItems}</span></div></div>`;
      } else if (nodeInfo.entityType) {
        typeBadge = `<span class="rel-badge">→ ${esc(nodeInfo.entityType)}</span>`;
      } else if (nodeInfo.type === 'string' && nodeInfo.format) {
        typeBadge = `<span class="type-badge">${esc(nodeInfo.format)}</span>`;
      } else if (nodeInfo.type) {
        typeBadge = `<span class="type-badge">${esc(nodeInfo.type)}</span>`;
      }

      return `<div class="card" data-dm="${esc(canonical)}">` +
        `<div class="card-header"><code class="field-path">${esc(canonical)}</code>${typeBadge}</div>` +
        bodyHtml +
        `</div>`;
    }).join('');

    return `<div class="dict-section" id="dm-${esc(entity)}">` +
      `<div class="section-title" style="display:flex;justify-content:space-between;align-items:center">` +
      `<span>${esc(entity)}</span><span style="font-size:0.75rem;font-weight:400;opacity:0.5">${items.length}</span>` +
      `</div>` +
      `<div class="cards-grid" style="margin-top:0.75rem">${cards}</div>` +
      `</div>`;
  }).join('');

  return `<style>${FIELD_CSS}</style><div>${sections}</div>`;
}

// ── Graph tab: DSL node list ──────────────────────────────────────────────────

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

function renderDslNodeList(sinkKey, orderedNodes, corticonToFact, edges, nodeTypes, nodeEnumData) {
  if (!orderedNodes?.length) return '<p style="color:#9ca3af;font-size:11px;padding:8px 0">No nodes found.</p>';
  const hasIncoming = new Set((edges ?? []).filter(e => e.from !== e.to).map(e => e.to));
  const logic = orderedNodes.filter(n => n !== sinkKey && hasIncoming.has(n)).concat(sinkKey);

  const dataRows = orderedNodes.map(n => {
    const shortN = n.split('.').slice(-2).join('.');
    const type = nodeTypes?.[n] ?? nodeTypes?.[shortN] ?? (corticonToFact[n]?.datatype) ?? '—';
    const nameStyle = n === sinkKey
      ? `font-weight:700;color:#2B1A78;font-family:${MONO};font-size:11px`
      : `color:#374151;font-family:${MONO};font-size:11px`;
    const enumInfo = nodeEnumData?.[n] ?? nodeEnumData?.[shortN];
    const typeCellHtml = enumInfo
      ? `<button class="enum-open-btn" data-enum="${esc(JSON.stringify(enumInfo))}" style="font-size:11px;color:#92400e;cursor:pointer;text-decoration:underline dotted;background:none;border:none;padding:0;font-family:inherit">${esc(type)}</button>`
      : `<span style="font-size:11px;color:#6b7280">${esc(type)}</span>`;
    return `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:4px 12px 4px 0;white-space:nowrap"><span style="${nameStyle}">${n === sinkKey ? '● ' : ''}${esc(shortN)}</span></td>
      <td style="padding:4px 0;white-space:nowrap">${typeCellHtml}</td>
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

// ── IRS fact-graph fact table ──────────────────────────────────────────────────

/**
 * Build an IRS-style fact table from the graph data.
 * Shows each node as a row: IRS path, kind (Writable/Derived), data type, expression.
 */
function buildFactTable(graphData) {
  if (!graphData?.nodes) return '';
  const rows = [];
  for (const [nodePath, nodeInfo] of Object.entries(graphData.nodes)) {
    const isInput = nodePath.startsWith('$.');
    const hasDerived = nodeInfo.expression != null;
    if (!isInput && !hasDerived) continue; // skip schema-only nodes

    // IRS-style path: entity_attr single segment
    const canonical = isInput ? nodePath.slice(2) : nodePath;
    const dot = canonical.indexOf('.');
    const fgPath = dot < 0 ? `/${canonical}` : `/${canonical.slice(0, dot).toLowerCase()}_${canonical.slice(dot + 1)}`;

    const kind = isInput ? 'Writable' : 'Derived';
    const type = nodeInfo.type ?? 'number';
    const typeLabel = type === 'boolean' ? 'Boolean' : type === 'integer' ? 'Int' : 'Dollar';
    const kindStyle = isInput
      ? 'background:#dbeafe;color:#1e40af'
      : 'background:#ede9fe;color:#5b21b6';
    const defaultVal = nodeInfo.default;

    const badgeHtml = [
      `<span style="${kindStyle};padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;font-family:sans-serif">${kind}</span>`,
      `<span style="background:#f3f4f6;color:#374151;padding:1px 6px;border-radius:3px;font-size:10px;font-family:sans-serif">${esc(typeLabel)}</span>`,
      defaultVal !== undefined
        ? `<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:3px;font-size:10px;font-family:sans-serif">default: ${esc(String(defaultVal))}</span>`
        : '',
    ].filter(Boolean).join(' ');

    const exprHtml = nodeInfo.expression
      ? `<code style="font-size:10.5px;color:#374151;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(nodeInfo.expression)}</code>`
      : '';

    rows.push(`<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:5px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:#2B1A78;font-weight:600;white-space:nowrap;vertical-align:top">${esc(fgPath)}</td>
      <td style="padding:5px 10px;white-space:nowrap;vertical-align:top">${badgeHtml}</td>
      <td style="padding:5px 10px;vertical-align:top">${exprHtml}</td>
    </tr>`);
  }

  if (!rows.length) return '';
  const TH = 'padding:5px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;border-bottom:2px solid #e5e7eb';
  return `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr>
      <th style="${TH}">IRS Fact Path</th>
      <th style="${TH}">Kind</th>
      <th style="${TH}">Expression</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

function renderCandidatesNavAndPanels(candidates, subgraphs, corticonToFact, nodeTypes, nodeEnumData, factGraphXmlStr, graphData) {
  const entries = Object.entries(candidates);
  if (!entries.length) return { navHtml: '', panelsHtml: '', count: 0, firstTabId: null };

  const candidateKeySet = new Set(Object.keys(candidates));
  const appearsInSubgraph = new Set(
    Object.entries(subgraphs).flatMap(([key, sub]) =>
      (sub.nodes ?? []).filter((n) => n !== key && candidateKeySet.has(n)),
    ),
  );

  const navItems = [];
  const panels = [];
  let firstTabId = null;

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
      const nodeList = (subgraphs[key]?.nodes ?? []).join(' ');
      navItems.push(`<a class="nav-link cg-nav-item" data-tab="${esc(tabId)}" data-title="${esc(key)}" data-nodes="${esc(nodeList)}" style="font-size:10.5px">${esc(shortKey)}</a>`);
    }
  }

  for (const [key, info] of entries) {
    const subgraph = subgraphs[key] ?? {};
    const tabId = `cg-${encodeKey(key)}`;
    const nodeCount = subgraph.nodeCount ?? '?';
    const depth     = subgraph.depth     ?? '?';
    const posRatio  = info.latestPosition != null ? `${info.latestPosition}/${info.totalPositions}` : '—';
    const defRatio  = info.definitionCount != null ? `${info.definitionCount}/${info.totalDefinitions}` : '—';

    const hasSub = !!subgraphs[key];
    const graphHtml = hasSub ? subgraph.svg : '<p style="color:#9ca3af;font-size:12px">No subgraph data.</p>';

    panels.push(`<div id="${esc(tabId)}" class="tab-panel" style="padding:1.5rem 2rem;overflow:auto"
        data-node-count="${esc(String(nodeCount))}" data-depth="${esc(String(depth))}">
        <div style="margin-bottom:4px">${graphHtml}</div>
        ${hasSub ? `<p style="font-size:10px;color:#9ca3af;margin:0 0 16px;font-style:italic">Click a node to inspect its logic.</p>` : ''}
        <div class="sg-detail-pane" style="display:none;margin:0 0 20px;padding:12px 16px;border-left:3px solid #2B1A78;background:#f8f7ff;border-radius:0 6px 6px 0">
          <div class="sg-detail-content" style="font-size:12px;line-height:1.8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace"></div>
        </div>
      </div>`);
  }

  return { navHtml: navItems.join('\n'), panelsHtml: panels.join('\n'), count: entries.length, firstTabId };
}

// ── Source tab: Rulesheets nav ────────────────────────────────────────────────

function buildRulesheetNavItems(projectPath) {
  if (!projectPath) return '';
  try {
    const names = getRulesheetNavigationOrder(projectPath);
    const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
    // Build a map from basename → combined expression text for content search
    const textByName = new Map();
    for (const [rsPath, rsData] of Object.entries(project.rulesheets ?? {})) {
      const name = basename(rsPath, '.ers');
      const texts = [];
      for (const rule of rsData.rules ?? []) {
        for (const cell of [...(rule.conditions ?? []), ...(rule.actions ?? [])].filter(Boolean)) {
          if (cell.expression) texts.push(cell.expression);
          for (const term of [...(cell.referencedTerms ?? []), ...(cell.modifiedTerms ?? [])]) {
            if (term.fulltext) texts.push(term.fulltext);
          }
        }
      }
      textByName.set(name, texts.join(' '));
    }
    return names.map(name => {
      const content = textByName.get(name) ?? '';
      return `<a class="nav-link rs-nav-item" data-rs-name="${esc(name)}" data-content="${esc(content)}" title="${esc(name)}" style="font-family:${MONO};font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</a>`;
    }).join('');
  } catch { return ''; }
}

function buildRulesheetChips(projectPath) {
  if (!projectPath) return '';
  try {
    const names = getRulesheetNavigationOrder(projectPath);
    return names.map(name =>
      `<button class="src-rs-chip rs-nav-item" data-rs-name="${esc(name)}" title="${esc(name)}">${esc(name)}</button>`
    ).join('');
  } catch { return ''; }
}

// ── Source tab: Vocabulary nav ────────────────────────────────────────────────

function buildVocabNavItems(projectPath) {
  if (!projectPath) return '';
  try {
    const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
    const entities = new Set();
    for (const vocab of Object.values(project.vocabularies ?? {})) {
      for (const entityName of Object.keys(vocab.entities ?? {})) {
        entities.add(entityName);
      }
    }
    return [...entities].sort().map(entity =>
      `<a class="nav-link vocab-entity-link" data-vocab-entity="${esc(entity)}" title="${esc(entity)}" style="display:flex;align-items:center;justify-content:space-between;gap:4px">` +
      `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(entity)}</span>` +
      `</a>`
    ).join('');
  } catch { return ''; }
}

// ── Source tab: Vocabulary ────────────────────────────────────────────────────

function renderVocabularyContent(projectPath) {
  if (!projectPath) return '<p style="color:#9ca3af;font-size:12px">No project file provided.</p>';
  let project;
  try { project = JSON.parse(readFileSync(projectPath, 'utf-8')); }
  catch { return '<p style="color:#9ca3af;font-size:12px">Could not load project file.</p>'; }

  // Build from vocabulary declarations — all attributes declared in the vocabulary file,
  // whether or not they appear in any rule. This is the full available interface.
  const byEntity = new Map();
  for (const vocab of Object.values(project.vocabularies ?? {})) {
    for (const [entityName, entity] of Object.entries(vocab.entities ?? {})) {
      if (!byEntity.has(entityName)) byEntity.set(entityName, new Map());
      for (const [attrName, attr] of Object.entries(entity.attributes ?? {})) {
        if (!byEntity.get(entityName).has(attrName)) {
          byEntity.get(entityName).set(attrName, attr.dataType ?? '');
        }
      }
    }
  }

  if (!byEntity.size) return '<p style="color:#9ca3af;font-size:12px">No attributes found.</p>';

  const sections = [...byEntity.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([entityName, attrs]) => {
    const cards = [...attrs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([attrName, typeName]) => {
      const canonical = `${entityName}.${attrName}`;
      const typeBadge = typeName ? `<span class="type-badge">${esc(typeName)}</span>` : '';
      return `<div class="card" data-dm="${esc(canonical)}">` +
        `<div class="card-header"><code class="field-path">${esc(canonical)}</code>${typeBadge}</div>` +
        `</div>`;
    }).join('');
    return `<div class="dict-section" id="vocab-${esc(entityName)}">` +
      `<div class="section-title" style="display:flex;justify-content:space-between;align-items:center">` +
      `<span>${esc(entityName)}</span><span style="font-size:0.75rem;font-weight:400;opacity:0.5">${attrs.size}</span>` +
      `</div>` +
      `<div class="cards-grid" style="margin-top:0.75rem">${cards}</div>` +
      `</div>`;
  }).join('');

  return `<style>${FIELD_CSS}</style><div>${sections}</div>`;
}

// ── Sandbox tab ───────────────────────────────────────────────────────────────

/**
 * Build the Sandbox tab section. All evaluation runs client-side; the graph
 * data is embedded as JSON so the tab works from a local file:// URL.
 *
 * The evaluator logic is inlined (not imported) to keep the HTML self-contained.
 * It mirrors evaluate-graph.js — keep them in sync if the algorithm changes.
 */
function renderSandboxSection(graphData) {
  if (!graphData) {
    return `<div id="section-sandbox" class="top-section"><p style="color:#9ca3af;padding:2rem;font-size:12px">No graph data available.</p></div>`;
  }

  // Determine sink nodes (derived nodes that never appear as `from`)
  const allPairs = Object.values(graphData.edges ?? {}).flat();
  const fromSet = new Set(allPairs.map(e => e.from));
  const sinkSet = new Set(
    Object.keys(graphData.nodes ?? {}).filter(p => !p.startsWith('$.') && !fromSet.has(p))
  );

  return `
<div id="sb-panel" class="tab-panel" style="flex-direction:column">
  <div style="flex:1;display:flex;overflow:hidden">
    <!-- Left: inputs -->
    <div id="sb-input-col" style="width:280px;min-width:280px;flex-shrink:0;overflow-y:auto;border-right:1px solid #e5e7eb;padding:1.25rem;background:#fff">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;padding-bottom:6px;border-bottom:2px solid #e5e7eb">
        <h2 style="font-size:15px;font-weight:700;color:#111827">Inputs</h2>
        <button id="sb-reset" style="font-size:11px;padding:3px 10px;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;background:#f9fafb;color:#374151">Reset</button>
      </div>
      <div id="sb-form"></div>
    </div>
    <!-- Right: results -->
    <div style="flex:1;overflow-y:auto;padding:1.5rem 2rem;background:#fafafa">
      <div style="margin-bottom:1rem;padding-bottom:6px;border-bottom:2px solid #e5e7eb">
        <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0">Calculations</h2>
      </div>
      <div id="sb-results"></div>
    </div>
  </div>
  <script>
  (function() {
    var GRAPH = ${JSON.stringify(graphData)};
    var SINK_SET = ${JSON.stringify([...sinkSet])};
    var MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
    var _sbInitialized = false;
    var _activeNodeFilter = null; // Set of node paths to show; null = all
    var _activeSinkKey = null;

    // ── Inline evaluator (mirrors evaluate-graph.js) ─────────────────────────

    function localName(path) { return path.split('.').pop(); }

    function topoSort(derivedPaths, revDeps) {
      var derivedSet = new Set(derivedPaths);
      var inDegree = {}, outEdges = {};
      for (var i = 0; i < derivedPaths.length; i++) { inDegree[derivedPaths[i]] = 0; outEdges[derivedPaths[i]] = []; }
      for (var to in revDeps) {
        if (!derivedSet.has(to)) continue;
        var fromList = revDeps[to];
        for (var j = 0; j < fromList.length; j++) {
          var from = fromList[j];
          if (derivedSet.has(from)) { inDegree[to]++; outEdges[from].push(to); }
        }
      }
      var queue = derivedPaths.filter(function(n) { return inDegree[n] === 0; });
      var ordered = [];
      while (queue.length) {
        var n = queue.shift(); ordered.push(n);
        var outs = outEdges[n] || [];
        for (var k = 0; k < outs.length; k++) { inDegree[outs[k]]--; if (inDegree[outs[k]] === 0) queue.push(outs[k]); }
      }
      return ordered;
    }

    // ── Three-state AST evaluator ────────────────────────────────────────────
    // Matches IRS fact-graph semantics: Complete > Placeholder > Incomplete.
    // INCL is the singleton Incomplete result.
    var INCL = { s: 'incomplete' };
    function complete(v)     { return { s: 'complete',    v: v }; }
    function placeholder(v)  { return { s: 'placeholder', v: v }; }
    function minState(a, b) {
      // Returns the weaker state: complete > placeholder > incomplete
      if (a.s === 'incomplete' || b.s === 'incomplete') return 'incomplete';
      if (a.s === 'placeholder' || b.s === 'placeholder') return 'placeholder';
      return 'complete';
    }
    function wrapState(v, state) {
      return state === 'complete' ? complete(v) : state === 'placeholder' ? placeholder(v) : INCL;
    }

    function eval3(ast, scope) {
      if (!ast) return INCL;
      switch (ast.type) {
        case 'bool': return complete(ast.val);
        case 'num':  return complete(Number(ast.val));
        case 'id': {
          var r = scope[ast.name];
          return r !== undefined ? r : INCL;
        }
        case 'unary': {
          var operand = eval3(ast.operand, scope);
          if (operand.s === 'incomplete') return INCL;
          return wrapState(!operand.v, operand.s);
        }
        case 'binary': {
          var op = ast.op;
          if (op === '||') {
            // Any: Complete(true) short-circuits; then Placeholder(true); then Incomplete propagates
            var l = eval3(ast.left, scope), r = eval3(ast.right, scope);
            if (l.s !== 'incomplete' && l.v === true) return l;
            if (r.s !== 'incomplete' && r.v === true) return r;
            if (l.s === 'incomplete' || r.s === 'incomplete') return INCL;
            return wrapState(false, minState(l, r));
          }
          if (op === '&&') {
            // All: Complete(false) short-circuits; then Placeholder(false); then Incomplete propagates
            var l = eval3(ast.left, scope), r = eval3(ast.right, scope);
            if (l.s !== 'incomplete' && l.v === false) return l;
            if (r.s !== 'incomplete' && r.v === false) return r;
            if (l.s === 'incomplete' || r.s === 'incomplete') return INCL;
            return wrapState(true, minState(l, r));
          }
          // Arithmetic and comparisons: Incomplete if either operand is Incomplete
          var l = eval3(ast.left, scope), r = eval3(ast.right, scope);
          if (l.s === 'incomplete' || r.s === 'incomplete') return INCL;
          var lv = l.v, rv = r.v, result;
          if (op === '<')  result = lv <  rv;
          else if (op === '>') result = lv >  rv;
          else if (op === '<=') result = lv <= rv;
          else if (op === '>=') result = lv >= rv;
          else if (op === '==') result = lv === rv;
          else if (op === '!=') result = lv !== rv;
          else if (op === '+') result = lv + rv;
          else if (op === '-') result = lv - rv;
          else if (op === '*') result = lv * rv;
          else return INCL;
          return wrapState(result, minState(l, r));
        }
        case 'ternary': {
          var cond = eval3(ast.cond, scope);
          if (cond.s === 'incomplete') return INCL;
          var branch = cond.v ? eval3(ast.then, scope) : eval3(ast.els, scope);
          // If cond was Placeholder, result is at most Placeholder
          if (cond.s === 'placeholder' && branch.s === 'complete') return placeholder(branch.v);
          return branch;
        }
        default: return INCL;
      }
    }

    function evaluateGraph(graph, inputs) {
      var allPairs = [];
      var edgesObj = graph.edges || {};
      for (var eid in edgesObj) { var arr = edgesObj[eid]; for (var i = 0; i < arr.length; i++) allPairs.push(arr[i]); }

      var revDeps = {};
      for (var i = 0; i < allPairs.length; i++) {
        var from = allPairs[i].from, to = allPairs[i].to;
        if (!revDeps[to]) revDeps[to] = [];
        if (revDeps[to].indexOf(from) < 0) revDeps[to].push(from);
      }

      var nodesObj = graph.nodes || {};
      var derivedPaths = Object.keys(nodesObj).filter(function(p) { return p.charAt(0) !== '$'; });
      var ordered = topoSort(derivedPaths, revDeps);

      // Three-state evaluation matching IRS fact-graph semantics:
      //   Complete(value)    — determined from real user-provided inputs
      //   Placeholder(value) — determined using policy default values
      //   Incomplete         — cannot determine; required inputs are missing
      var completeVals = {}, placeholderVals = {}, states = {}, errors = {};

      // Seed input node states. The scope passed to eval3 maps local variable
      // names → three-state result objects so the evaluator can reason correctly.
      var scope = {};
      for (var path in nodesObj) {
        if (path.charAt(0) !== '$') continue;
        var nodeInfo = nodesObj[path];
        var uv = inputs[path];
        var lname = localName(path);
        if (uv !== undefined && uv !== null && uv !== '') {
          var cv = complete(uv);
          completeVals[path] = uv; placeholderVals[path] = uv;
          states[path] = 'complete';
          scope[lname] = cv;
        } else if (nodeInfo && nodeInfo.default !== undefined) {
          placeholderVals[path] = nodeInfo.default;
          states[path] = 'placeholder';
          scope[lname] = placeholder(nodeInfo.default);
        } else {
          states[path] = 'incomplete';
          // Absent from scope → eval3 returns INCL when referenced
        }
      }

      for (var oi = 0; oi < ordered.length; oi++) {
        var nodePath = ordered[oi];
        var ast = GRAPH_EXPRS[nodePath];
        if (!ast) { states[nodePath] = 'incomplete'; continue; }

        try {
          var res = eval3(ast, scope);
          states[nodePath] = res.s;
          var lname2 = localName(nodePath);
          scope[lname2] = res;
          if (res.s !== 'incomplete') {
            if (res.s === 'complete') { completeVals[nodePath] = res.v; placeholderVals[nodePath] = res.v; }
            else { placeholderVals[nodePath] = res.v; }
          }
        } catch (e) {
          errors[nodePath] = e.message;
          states[nodePath] = 'incomplete';
        }
      }

      // Post-evaluation: for Incomplete nodes, collect which user-facing input
      // nodes are still missing (excluding placeholder defaults).
      var missing = {}, provided = {};
      function collectMissing(np, visitedM) {
        if (visitedM[np]) return { miss: [], prov: [] };
        visitedM[np] = true;
        var deps = revDeps[np] || [];
        var miss = [], prov = [];
        for (var di = 0; di < deps.length; di++) {
          var dep = deps[di];
          if (dep.charAt(0) === '$') {
            var st = states[dep];
            if (st === 'complete') prov.push(dep);
            else if (st === 'incomplete') miss.push(dep);
            // placeholder inputs (policy defaults) are not shown as missing or provided
          } else {
            var sub = collectMissing(dep, visitedM);
            for (var mi = 0; mi < sub.miss.length; mi++) miss.push(sub.miss[mi]);
            for (var pi = 0; pi < sub.prov.length; pi++) prov.push(sub.prov[pi]);
          }
        }
        miss = miss.filter(function(x, i, a) { return a.indexOf(x) === i; });
        prov = prov.filter(function(x, i, a) { return a.indexOf(x) === i; });
        return { miss: miss, prov: prov };
      }
      for (var oi2 = 0; oi2 < ordered.length; oi2++) {
        var np = ordered[oi2];
        if (states[np] !== 'incomplete' || errors[np]) continue;
        var rc = collectMissing(np, {});
        if (rc.miss.length > 0) { missing[np] = rc.miss; provided[np] = rc.prov; }
      }

      return { completeVals: completeVals, placeholderVals: placeholderVals, states: states, missing: missing, provided: provided, errors: errors, ordered: ordered };
    }

    // ── Input form builder ───────────────────────────────────────────────────

    function buildInputForm() {
      var nodesObj = GRAPH.nodes || {};
      var inputPaths = Object.keys(nodesObj).filter(function(p) {
        return p.charAt(0) === '$' && (!_activeNodeFilter || _activeNodeFilter.has(p));
      }).sort();

      // Group by entity (second segment of $.Entity.attr)
      var byEntity = {};
      var entityOrder = [];
      for (var i = 0; i < inputPaths.length; i++) {
        var path = inputPaths[i];
        var canonical = path.slice(2); // strip $.
        var parts = canonical.split('.');
        var entity = parts[0];
        var attr = parts.slice(1).join('.');
        if (!byEntity[entity]) { byEntity[entity] = []; entityOrder.push(entity); }
        byEntity[entity].push({ path: path, attr: attr, info: nodesObj[path] || {} });
      }

      var html = '';
      for (var ei = 0; ei < entityOrder.length; ei++) {
        var entity = entityOrder[ei];
        var items = byEntity[entity];
        html += '<div style="margin-bottom:20px">';
        html += '<div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;margin-bottom:10px;padding-bottom:4px;border-bottom:1px solid #f3f4f6">' + entity + '</div>';
        for (var ii = 0; ii < items.length; ii++) {
          var item = items[ii];
          var fieldId = 'sb-' + item.path.replace(/[^a-zA-Z0-9]/g, '_');
          var type = item.info.type || 'number';
          var defVal = item.info.default;
          var hasDefault = defVal !== undefined;
          var inputStyle = 'width:100%;padding:5px 8px;border:1px solid '
            + (hasDefault ? '#c9c68a;background:#fafaf5' : '#d1d5db;background:#fff')
            + ';border-radius:4px;font-size:12px;font-family:' + MONO + ';color:#111827';
          var inputEl;
          if (type === 'boolean') {
            var selVal = hasDefault ? String(defVal) : '';
            inputEl = '<select id="' + fieldId + '" data-path="' + item.path + '" data-type="boolean" class="sb-field"'
              + ' style="' + inputStyle + '">'
              + '<option value=""' + (selVal === '' ? ' selected' : '') + '>—</option>'
              + '<option value="true"' + (selVal === 'true' ? ' selected' : '') + '>true</option>'
              + '<option value="false"' + (selVal === 'false' ? ' selected' : '') + '>false</option>'
              + '</select>';
          } else if (type === 'integer') {
            inputEl = '<input type="number" step="1" id="' + fieldId + '" data-path="' + item.path + '" data-type="integer" class="sb-field"'
              + ' style="' + inputStyle + '"'
              + (hasDefault ? ' value="' + defVal + '"' : '')
              + ' placeholder="integer"/>';
          } else {
            inputEl = '<input type="number" step="any" id="' + fieldId + '" data-path="' + item.path + '" data-type="number" class="sb-field"'
              + ' style="' + inputStyle + '"'
              + (hasDefault ? ' value="' + defVal + '"' : '')
              + ' placeholder="number"/>';
          }
          var paramBadge = hasDefault
            ? ' <span style="font-size:9px;font-weight:700;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:3px;letter-spacing:0.04em">param</span>'
            : '';
          var desc = (item.info.description || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          html += '<div style="margin-bottom:12px">';
          html += '<label for="' + fieldId + '" data-title="' + item.attr + '" style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;font-family:' + MONO + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + item.attr + paramBadge + '</label>';
          html += inputEl;
          if (desc) html += '<div style="font-size:10px;color:#9ca3af;margin-top:3px;line-height:1.4">' + desc + '</div>';
          html += '</div>';
        }
        html += '</div>';
      }
      document.getElementById('sb-form').innerHTML = html;
      document.querySelectorAll('.sb-field').forEach(function(el) {
        el.addEventListener('input', update);
        el.addEventListener('change', update);
      });
      update(); // evaluate with any pre-filled defaults
    }

    // ── Results renderer ─────────────────────────────────────────────────────

    function renderResults(result) {
      var ordered = result.ordered;
      var completeVals = result.completeVals || {};
      var placeholderVals = result.placeholderVals || {};
      var states = result.states || {};
      var missing = result.missing || {};
      var provided = result.provided || {};
      var errors = result.errors;
      var sinkSet = new Set(SINK_SET);
      var nodesObj = GRAPH.nodes || {};

      if (!ordered.length) {
        document.getElementById('sb-results').innerHTML = '<p style="color:#9ca3af;font-size:12px">No derived nodes.</p>';
        return;
      }

      // ── Determination summary (sink nodes only — what the API would return) ──
      var sinkPaths = ordered.filter(function(p) { return sinkSet.has(p); });
      var summaryHtml = '<div style="margin-bottom:20px;padding:14px 16px;border-radius:6px;background:#f5f3ff;border:1px solid #e0d9f7">';
      summaryHtml += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:10px">Results</div>';
      for (var si = 0; si < sinkPaths.length; si++) {
        var sp = sinkPaths[si];
        var sState = states[sp];
        var sShort = sp.split('.').slice(-2).join('.');
        summaryHtml += '<div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:6px">';
        summaryHtml += '<span style="font-family:' + MONO + ';font-size:12px;font-weight:700;color:#2B1A78">' + escHtml(sShort) + '</span>';
        if (sState === 'complete' || sState === 'placeholder') {
          var sv = sState === 'complete' ? completeVals[sp] : placeholderVals[sp];
          var sIsPlaceholder = sState === 'placeholder';
          if (typeof sv === 'boolean') {
            summaryHtml += sv
              ? '<span style="font-weight:700;color:' + (sIsPlaceholder ? '#65a30d' : '#16a34a') + ';font-size:14px">&#10003; true</span>'
              : '<span style="font-weight:700;color:' + (sIsPlaceholder ? '#d97706' : '#dc2626') + ';font-size:14px">&#10007; false</span>';
          } else {
            summaryHtml += '<span style="font-family:' + MONO + ';font-weight:600;color:#0369a1">' + escHtml(String(sv)) + '</span>';
          }
          if (sIsPlaceholder) summaryHtml += ' <span style="font-size:9px;font-weight:700;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:3px">default</span>';
        } else if (missing[sp] && missing[sp].length > 0) {
          var sMiss = missing[sp], sProv = provided[sp] || [], sParts = [];
          for (var spi = 0; spi < sProv.length; spi++) sParts.push('<s style="color:#c4b5fd">' + sProv[spi].split('.').pop() + '</s>');
          for (var smi = 0; smi < sMiss.length; smi++) sParts.push('<span style="color:#6b7280">' + sMiss[smi].split('.').pop() + '</span>');
          summaryHtml += '<span style="font-size:11px;font-style:italic;color:#6b7280">missing: ' + sParts.join(', ') + '</span>';
        } else {
          summaryHtml += '<span style="color:#9ca3af;font-size:11px">—</span>';
        }
        summaryHtml += '</div>';
      }
      summaryHtml += '</div>';

      var html = summaryHtml + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:8px">Calculations</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';

      for (var i = 0; i < ordered.length; i++) {
        var nodePath = ordered[i];
        var isSink = sinkSet.has(nodePath);
        var shortPath = nodePath.split('.').slice(-2).join('.');
        var nodeInfo = nodesObj[nodePath] || {};
        var desc = (nodeInfo.description || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        var nameStyle = 'font-family:' + MONO + ';font-size:11.5px;white-space:nowrap;';
        if (isSink) nameStyle += 'font-weight:700;color:#2B1A78';
        else nameStyle += 'color:#374151';

        var state = states[nodePath];
        var valueCellHtml;
        if (state === 'complete' || state === 'placeholder') {
          var v = state === 'complete' ? completeVals[nodePath] : placeholderVals[nodePath];
          var isPlaceholder = state === 'placeholder';
          var valHtml;
          if (typeof v === 'boolean') {
            valHtml = v
              ? '<span style="font-weight:700;color:' + (isPlaceholder ? '#65a30d' : '#16a34a') + ';font-size:13px">&#10003; true</span>'
              : '<span style="font-weight:700;color:' + (isPlaceholder ? '#d97706' : '#dc2626') + ';font-size:13px">&#10007; false</span>';
          } else if (typeof v === 'number') {
            valHtml = '<span style="font-family:' + MONO + ';color:' + (isPlaceholder ? '#92400e' : '#0369a1') + ';font-weight:600">' + v + '</span>';
          } else {
            valHtml = '<span style="font-family:' + MONO + ';color:#374151">' + String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>';
          }
          var badge = isPlaceholder
            ? ' <span style="font-size:9px;font-weight:700;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:3px;vertical-align:middle" title="Using policy default value">default</span>'
            : '';
          valueCellHtml = valHtml + badge;
        } else if (errors[nodePath]) {
          valueCellHtml = '<span style="color:#dc2626;font-size:11px" title="' + errors[nodePath].replace(/"/g,'&quot;') + '">error</span>';
        } else if (missing[nodePath] && missing[nodePath].length > 0) {
          var parts = [];
          var prov = provided[nodePath] || [];
          for (var pi = 0; pi < prov.length; pi++) {
            parts.push('<s style="color:#d1d5db">' + prov[pi].split('.').pop() + '</s>');
          }
          var miss = missing[nodePath];
          for (var mi2 = 0; mi2 < miss.length; mi2++) {
            parts.push('<span style="color:#9ca3af">' + miss[mi2].split('.').pop() + '</span>');
          }
          valueCellHtml = '<span style="font-size:11px;font-style:italic;color:#6b7280">missing: ' + parts.join(', ') + '</span>';
        } else {
          valueCellHtml = '<span style="color:#9ca3af;font-size:11px">—</span>';
        }

        var rowBg = isSink ? 'background:#f5f3ff' : '';
        html += '<tr data-sb-path="' + nodePath.replace(/"/g,'&quot;') + '"' + (isSink ? ' data-sink="1"' : '') + ' style="border-bottom:1px solid #f3f4f6;' + rowBg + '">';
        html += '<td style="padding:7px 16px 7px 0;vertical-align:top;width:45%">';
        html += '<span style="' + nameStyle + '">' + (isSink ? '&#9679; ' : '') + shortPath + '</span>';
        if (desc) html += '<div style="font-size:10px;color:#9ca3af;margin-top:2px;line-height:1.35;font-weight:400;font-family:sans-serif">' + desc + '</div>';
        html += '</td>';
        html += '<td style="padding:7px 8px 7px 0;vertical-align:top;word-break:break-word;overflow-wrap:anywhere">' + valueCellHtml + '</td>';
        html += '<td class="fg-col" style="padding:7px 0;vertical-align:top;display:none"></td>';
        html += '</tr>';
      }

      html += '</table>';
      document.getElementById('sb-results').innerHTML = html;
    }

    // ── Update ───────────────────────────────────────────────────────────────

    function readInputs() {
      var inputs = {};
      document.querySelectorAll('.sb-field').forEach(function(el) {
        var path = el.dataset.path;
        var type = el.dataset.type;
        var raw = el.value;
        if (raw === '' || raw === undefined) return;
        if (type === 'boolean') { inputs[path] = raw === 'true'; }
        else if (type === 'integer') { var n = parseInt(raw, 10); if (!isNaN(n)) inputs[path] = n; }
        else { var f = parseFloat(raw); if (!isNaN(f)) inputs[path] = f; }
      });
      return inputs;
    }

    function update() {
      var result = evaluateGraph(GRAPH, readInputs());
      renderResults(result);
      if (_fgEnabled) applyFgComparison();
    }

    // ── Fact-graph comparison ─────────────────────────────────────────────────

    var _fgEnabled = false, _fgReady = false, _fgGraph = null;

    // Extract state + primitive value from a Scala Result object.
    // Complete and Placeholder are case classes with productPrefix__T() and
    // productElement__I__O(0); Incomplete is a singleton with no value.
    function getFgState(r) {
      if (!r) return { state: 'incomplete' };
      try {
        var prefix = typeof r.productPrefix__T === 'function' ? r.productPrefix__T() : null;
        if (prefix === 'Complete' || prefix === 'Placeholder') {
          var raw = r.productElement__I__O(0);
          // Unbox Scala-boxed primitives to JS values
          var val = raw;
          if (raw !== null && raw !== undefined && typeof raw === 'object') {
            if (typeof raw.booleanValue === 'function') val = raw.booleanValue();
            else if (typeof raw.intValue    === 'function') val = raw.intValue();
            else if (typeof raw.doubleValue === 'function') val = raw.doubleValue();
            else val = String(raw);
          }
          return { state: prefix === 'Complete' ? 'complete' : 'placeholder', value: val };
        }
        return { state: 'incomplete' };
      } catch(e) { return { state: 'incomplete' }; }
    }

    // Determine the type declared for a writable fact path in the FG XML.
    // Parses the XML string once and caches the result.
    var _fgPathTypes = null;
    function getFgPathType(fgPath) {
      if (!_fgPathTypes) {
        _fgPathTypes = {};
        var matches = FG_XML.match(/<Fact path="([^"]+)">[^]*?<Writable>\\s*<([A-Za-z]+)/g) || [];
        matches.forEach(function(m) {
          var pm = m.match(/<Fact path="([^"]+)">/);
          var tm = m.match(/<Writable>\\s*<([A-Za-z]+)/);
          if (pm && tm) _fgPathTypes[pm[1]] = tm[1];
        });
      }
      return _fgPathTypes[fgPath] || 'String';
    }

    function fgTypedValue(fgPath, strVal) {
      if (!strVal && strVal !== '0') return null; // empty → don't set
      var type = getFgPathType(fgPath); // populates _fgPathTypes on first call
      if (!type || type === 'String') return null; // Derived or unknown — don't try to set
      try {
        if (type === 'Boolean') return strVal === 'true';
        if (type === 'Dollar') return window.__fg._makeDollar(strVal);
        if (type === 'Int')    return window.__fg._makeInt(strVal);
        return null;
      } catch(e) { return null; }
    }

    function runFgComparison(inputs) {
      if (!_fgReady || !_fgGraph) return {};
      var nodesObj = GRAPH.nodes || {};
      // Reset graph by recreating it from the same dictionary
      try {
        var dict = window.__fg.FactDictionaryFactory.importFromXml(FG_XML);
        _fgGraph = window.__fg.GraphFactory.apply(dict);
      } catch(e) { return {}; }

      // Set user-provided inputs on the fact-graph with correct types
      for (var path in inputs) {
        if (path.charAt(0) !== '$') continue;
        var fgPath = nodePathToFgPath(path);
        var typed = fgTypedValue(fgPath, String(inputs[path]));
        if (typed !== null) {
          try { _fgGraph.set(fgPath, typed); } catch(e) { /* type mismatch — skip */ }
        }
      }
      try { _fgGraph.save(); } catch(e) { /* ok */ }

      // Read results for all derived nodes
      var comparison = {};
      for (var nodePath in nodesObj) {
        if (nodePath.charAt(0) === '$') continue;
        var fgPath2 = nodePathToFgPath(nodePath);
        try {
          var r = _fgGraph.get(fgPath2);
          comparison[nodePath] = getFgState(r);
        } catch(e) { comparison[nodePath] = { state: 'error', message: e.message }; }
      }
      return comparison;
    }

    function applyFgComparison() {
      var inputs = readInputs();
      var comparison = runFgComparison(inputs);
      var resultsEl = document.getElementById('sb-results');
      if (!resultsEl) return;

      // Show the fg column header if not already present
      var table = resultsEl.querySelector('table');
      if (!table) return;

      // Show all fg-col cells
      var fgCells = table.querySelectorAll('td.fg-col');
      fgCells.forEach(function(td) { td.style.display = ''; });

      // Populate each cell
      var tableMismatches = {}; // nodePath → true if mismatch
      var rows = table.querySelectorAll('tr[data-sb-path]');
      rows.forEach(function(row) {
        var nodePath = row.dataset.sbPath;
        var cell = row.querySelector('td.fg-col');
        if (!cell) return;
        var cmp = comparison[nodePath];
        if (!cmp) { cell.innerHTML = '<span style="color:#9ca3af;font-size:11px">—</span>'; return; }

        // What our engine says (from the value cell)
        var ourEl = row.querySelectorAll('td')[1];
        var ourText = ourEl ? ourEl.textContent.trim() : '';
        var ourResolved = ourText && ourText !== '—' && ourText.indexOf('missing') < 0 && ourText.indexOf('error') < 0;

        // Render fact-graph result
        function fgValHtml(c) {
          if (c.state === 'error') {
            return '<span style="color:#dc2626;font-size:10px" title="' + escHtml(c.message || '') + '">fg error</span>';
          }
          if (c.state === 'incomplete') {
            return '<span style="color:#9ca3af;font-size:11px">—</span>';
          }
          var v = c.value;
          var h = typeof v === 'boolean'
            ? (v ? '<span style="font-weight:700;color:#16a34a;font-size:13px">&#10003; true</span>'
                 : '<span style="font-weight:700;color:#dc2626;font-size:13px">&#10007; false</span>')
            : '<span style="font-family:' + MONO + ';color:#0369a1;font-weight:600;font-size:11px">' + escHtml(String(v)) + '</span>';
          return h;
        }

        var fgResolved = cmp.state === 'complete' || cmp.state === 'placeholder';
        var agrees;
        if (fgResolved && ourResolved) {
          var fgVal = String(cmp.value);
          // Compare numerically when both sides look like numbers (handles "2750" vs "2750.00")
          var fgNum = parseFloat(fgVal), ourNum = parseFloat(ourText);
          if (!isNaN(fgNum) && !isNaN(ourNum) && String(ourNum) === ourText.trim()) {
            agrees = fgNum === ourNum;
          } else {
            agrees = ourText.indexOf(fgVal) >= 0 || (ourText.indexOf('true') >= 0 && fgVal === 'true') || (ourText.indexOf('false') >= 0 && fgVal === 'false');
          }
        } else {
          agrees = !fgResolved && !ourResolved;
        }

        if (agrees) {
          cell.innerHTML = fgValHtml(cmp);
          row.style.background = row.dataset.sink === '1' ? '#f5f3ff' : '';
          tableMismatches[nodePath] = false;
        } else {
          // Show both sides so the difference is visible
          var ourDisplay = ourResolved ? ourText : '—';
          cell.innerHTML = '<div style="font-size:10px;line-height:1.5">'
            + '<div><span style="color:#6b7280;font-size:9px">ours:&nbsp;</span>' + escHtml(ourDisplay) + '</div>'
            + '<div><span style="color:#6b7280;font-size:9px">fg:&nbsp;&nbsp;&nbsp;</span>' + fgValHtml(cmp) + '</div>'
            + '</div>';
          row.style.background = '#fff1f2';
          tableMismatches[nodePath] = true;
        }
      });

      // Update determination badge
      updateFgDeterminationBadge(tableMismatches);
    }

    function updateFgDeterminationBadge(tableMismatches) {
      var resultsEl = document.getElementById('sb-results');
      if (!resultsEl) return;
      var existing = resultsEl.querySelector('#fg-det-badge');
      if (existing) existing.remove();

      // Count rows that are highlighted as mismatches in the table
      var mismatchCount = Object.values(tableMismatches).filter(Boolean).length;

      var badge = document.createElement('div');
      badge.id = 'fg-det-badge';
      var text, style;
      if (mismatchCount === 0) {
        text = '&#10003; fact-graph agrees';
        style = 'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0';
      } else {
        text = '&#9888; ' + mismatchCount + ' value mismatch' + (mismatchCount > 1 ? 'es' : '') + ' with fact-graph';
        style = 'background:#fff1f2;color:#dc2626;border:1px solid #fecaca';
      }
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;' + style;
      badge.innerHTML = text;

      // Insert after the determination card
      var detCard = resultsEl.querySelector('div');
      if (detCard) detCard.appendChild(badge);
    }

    function loadFg() {
      if (!FG_AVAILABLE || _fgReady) return;
      // Lazy-load fg.js: inject as a plain script tag (not a module) so it works
      // on file:// pages. FG_SRC is JSON-encoded with closing tags escaped.
      // Plain script injection executes synchronously, so __fg is available
      // immediately after appendChild.
      try {
        var s = document.createElement('script');
        s.textContent = FG_SRC;
        document.head.appendChild(s);
        var dict = window.__fg.FactDictionaryFactory.importFromXml(FG_XML);
        _fgGraph = window.__fg.GraphFactory.apply(dict);
        _fgReady = true;
        _fgEnabled = true;
        applyFgComparison();
      } catch(e) {
        // Show error in fg column cells
        document.querySelectorAll('td.fg-col').forEach(function(td) {
          td.style.display = '';
          td.innerHTML = '<span style="color:#9ca3af;font-size:10px" title="' + String(e.message).replace(/"/g,'&quot;') + '">fg error</span>';
        });
      }
    }

    // ── Init (called once when sandbox is first opened) ──────────────────────

    window.__sbInit = function() {
      if (_sbInitialized) return;
      _sbInitialized = true;
      buildInputForm();
      update(); // show initial state (constants resolve immediately)
      document.getElementById('sb-reset').addEventListener('click', function() {
        document.querySelectorAll('.sb-field').forEach(function(el) { el.value = ''; });
        update();
      });
      // Auto-load fact-graph for side-by-side comparison column.
      // Deferred slightly so the sandbox renders first before the 7MB parse.
      if (FG_AVAILABLE) setTimeout(loadFg, 0);
    };

    // Called from outer page when the user switches to a different sink candidate
    // while the sandbox is open. Filters inputs to those in nodeList and re-evaluates.
    window.__sbSetContext = function(sinkKey, nodeList) {
      var nodeSet = new Set(nodeList);
      _activeSinkKey = sinkKey || null;
      _activeNodeFilter = nodeSet.size ? nodeSet : null;
      if (sinkKey) SINK_SET = [sinkKey];
      if (_sbInitialized) { buildInputForm(); update(); }
    };
  })();
  </script>
</div>`;
}

// ── Analysis tab: Exceptions ──────────────────────────────────────────────────

function readTranslationLogEntries(translationLogPath) {
  const raw = JSON.parse(readFileSync(translationLogPath, 'utf-8'));
  if (Array.isArray(raw)) return raw;
  const entries = raw?.entries;
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === 'object') return Object.values(entries).flat();
  return [];
}


function renderExceptionsContent(translationLogPath) {
  if (!translationLogPath) return '<p style="color:#9ca3af;font-size:12px">No translation log provided.</p>';
  let entries;
  try { entries = readTranslationLogEntries(translationLogPath); }
  catch { return '<p style="color:#9ca3af;font-size:12px">Could not load translation log.</p>'; }
  if (!entries.length) return '<p style="color:#9ca3af;font-size:12px">No entries.</p>';

  const patterns = [...new Set(entries.map(e => e.pattern).filter(Boolean))].sort();
  const statuses = [...new Set(entries.map(e => e.status).filter(Boolean))].sort();
  const hasStatus = statuses.length > 0;

  const patternBtns = patterns.map(p =>
    `<button class="af-btn" data-filter="pattern" data-val="${esc(p)}">${esc(p)}</button>`
  ).join('');

  const statusBtns = statuses.map(s =>
    `<button class="af-btn" data-filter="status" data-val="${esc(s)}">${esc(s)}</button>`
  ).join('');

  return `
<style>
.af-btn { font-size:10px;font-weight:600;padding:3px 8px;border-radius:3px;cursor:pointer;border:1px solid #d1d5db;background:#f9fafb;color:#374151;margin:0 2px 4px 0; }
.af-btn.active { background:#2B1A78 !important;color:white !important;border-color:#2B1A78 !important; }
.af-row { border-bottom:1px solid #f3f4f6; }
.af-row.hidden { display:none; }
</style>
<div style="margin-bottom:1rem">
  <div style="margin-bottom:6px;display:flex;flex-wrap:wrap;align-items:center;gap:2px">
    <span style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-right:6px;white-space:nowrap">Translated</span>
    <button class="af-btn active" data-filter="translated" data-val="all">All</button>
    <button class="af-btn" data-filter="translated" data-val="yes">Translated</button>
    <button class="af-btn" data-filter="translated" data-val="no">Not Translated</button>
  </div>
  ${hasStatus ? `<div style="margin-bottom:6px;display:flex;flex-wrap:wrap;align-items:center;gap:2px">
    <span style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-right:6px;white-space:nowrap">Status</span>
    <button class="af-btn active" data-filter="status" data-val="all">All</button>
    ${statusBtns}
  </div>` : ''}
  <div style="margin-bottom:6px;display:flex;flex-wrap:wrap;align-items:center;gap:2px">
    <span style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-right:6px;white-space:nowrap">Pattern</span>
    <button class="af-btn active" data-filter="pattern" data-val="all">All</button>
    ${patternBtns}
  </div>
</div>
<div id="af-count" style="font-size:11px;color:#6b7280;margin-bottom:8px"></div>
<div id="af-table-wrap" style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:11px" id="af-table">
    <thead>
      <tr style="border-bottom:2px solid #e5e7eb">
        <th style="padding:5px 8px 5px 0;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;white-space:nowrap">Pattern</th>
        <th style="padding:5px 8px 5px 0;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;white-space:nowrap">Variant</th>
        <th style="padding:5px 8px 5px 0;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;white-space:nowrap">Translated</th>
        ${hasStatus ? `<th style="padding:5px 8px 5px 0;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;white-space:nowrap">Status</th>` : ''}
        <th style="padding:5px 8px 5px 0;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af">Node</th>
        <th style="padding:5px 0;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af">Details</th>
      </tr>
    </thead>
    <tbody id="af-tbody"></tbody>
  </table>
</div>
<div id="af-more-wrap" style="margin-top:8px"></div>
<script>
(function(){
  var entries = ${JSON.stringify(entries.map(e => ({
    pattern:     e.pattern ?? '',
    variant:     e.variant ?? '',
    translated:  e.translated ? 'yes' : 'no',
    status:      e.status ?? '',
    node:        e.node ?? '',
    edgeId:      e.edgeId ?? '',
    nodeType:    e.compiled?.type ?? e.raw?.type ?? e.nodeType ?? '',
    nodeDefault: e.raw?.default !== undefined ? String(e.raw.default) : (e.nodeDefault ?? ''),
    nodeExpr:    e.compiled?.expression ?? e.nodeExpr ?? '',
    note:        e.note ?? e.raw?.expression ?? '',
  })))};
  var STATUS_STYLE = ${JSON.stringify(Object.fromEntries(
    Object.entries(STATUS_STYLE).map(([k, v]) => [k, v])
  ))};
  var HAS_STATUS = ${hasStatus ? 'true' : 'false'};
  var PAGE = 200;
  var filters = { translated: 'all', status: 'all', pattern: 'all' };
  var visible = [];

  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function matches(e) {
    if (filters.translated !== 'all' && e.translated !== filters.translated) return false;
    if (filters.status !== 'all' && e.status !== filters.status) return false;
    if (filters.pattern !== 'all' && e.pattern !== filters.pattern) return false;
    return true;
  }

  function shortLoc(edgeId) {
    var m = edgeId.match(/([^/\\\\]+\\.ers)(?::(\\d+|\\*))?$/i);
    return m ? m[1] + (m[2] ? ' #'+m[2] : '') : edgeId;
  }

  function rowHtml(e) {
    var st = STATUS_STYLE[e.status] || { bg:'#f3f4f6', text:'#374151', border:'#e5e7eb' };
    var translatedHtml = e.translated === 'yes'
      ? '<span style="color:#16a34a;font-weight:700">&#10003;</span>'
      : '<span style="color:#dc2626;font-weight:700">&#10007;</span>';
    var statusHtml = e.status
      ? '<span style="font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;background:'+esc(st.bg)+';color:'+esc(st.text)+';border:1px solid '+esc(st.border)+'">'+esc(e.status)+'</span>'
      : '';
    var nodeHtml = e.node ? '<span style="font-family:ui-monospace,monospace;font-size:10px;color:#374151;font-weight:600">'+esc(e.node)+'</span>' : '';
    // Details: CEL expression if present, else type/default for data nodes, else classify note
    var detailsHtml;
    if (e.nodeExpr) {
      detailsHtml = '<code style="font-size:10px;color:#374151;font-family:ui-monospace,monospace;word-break:break-word">'+esc(e.nodeExpr)+'</code>';
    } else if (e.nodeType) {
      var meta = '<span style="font-size:10px;color:#6b7280">type: <span style="color:#374151;font-family:ui-monospace,monospace">'+esc(e.nodeType)+'</span></span>';
      if (e.nodeDefault !== '') meta += ' <span style="font-size:10px;color:#6b7280;margin-left:6px">default: <span style="color:#374151;font-family:ui-monospace,monospace">'+esc(e.nodeDefault)+'</span></span>';
      detailsHtml = meta;
    } else {
      detailsHtml = e.note ? '<span style="font-size:10px;color:#4b5563;font-style:italic">'+esc(e.note)+'</span>' : '';
    }
    return '<tr class="af-row" style="border-bottom:1px solid #f3f4f6">'
      + '<td style="padding:4px 8px 4px 0;white-space:nowrap;vertical-align:top"><span style="font-size:10px;font-weight:600;color:#374151">'+esc(e.pattern)+'</span></td>'
      + '<td style="padding:4px 8px 4px 0;white-space:nowrap;font-size:10px;color:#6b7280;vertical-align:top">'+esc(e.variant)+'</td>'
      + '<td style="padding:4px 8px 4px 0;text-align:center;vertical-align:top">'+translatedHtml+'</td>'
      + (HAS_STATUS ? '<td style="padding:4px 8px 4px 0;white-space:nowrap;vertical-align:top">'+statusHtml+'</td>' : '')
      + '<td style="padding:4px 8px 4px 0;vertical-align:top">'+nodeHtml+'</td>'
      + '<td style="padding:4px 0;vertical-align:top;max-width:240px">'+detailsHtml+'</td>'
      + '</tr>';
  }

  function applyFilters() {
    visible = entries.filter(matches);
    var tbody = document.getElementById('af-tbody');
    var moreWrap = document.getElementById('af-more-wrap');
    var count = document.getElementById('af-count');
    tbody.innerHTML = visible.slice(0, PAGE).map(rowHtml).join('');
    count.textContent = visible.length + ' of ' + entries.length + ' entries';
    moreWrap.innerHTML = '';
    if (visible.length > PAGE) {
      var offset = PAGE;
      function addMore() {
        var slice = visible.slice(offset, offset + PAGE);
        tbody.insertAdjacentHTML('beforeend', slice.map(rowHtml).join(''));
        offset += slice.length;
        if (offset >= visible.length) { moreWrap.innerHTML = ''; }
        else { renderMoreBtn(); }
      }
      function renderMoreBtn() {
        moreWrap.innerHTML = '';
        var btn = document.createElement('button');
        btn.textContent = 'Show next ' + Math.min(PAGE, visible.length - offset) + ' of ' + (visible.length - offset) + ' remaining';
        btn.style.cssText = 'padding:4px 10px;font-size:11px;cursor:pointer;background:#f9fafb;color:#374151;border:1px solid #d1d5db;border-radius:4px';
        btn.onclick = addMore;
        moreWrap.appendChild(btn);
      }
      renderMoreBtn();
    }
  }

  document.querySelectorAll('.af-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var filterType = btn.dataset.filter;
      document.querySelectorAll('.af-btn[data-filter="'+filterType+'"]').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      filters[filterType] = btn.dataset.val;
      applyFilters();
    });
  });

  applyFilters();
})();
</script>`;
}

function countExceptions(translationLogPath) {
  try {
    return readTranslationLogEntries(translationLogPath).length;
  } catch { return 0; }
}

// ── Fact Graph XML panel ──────────────────────────────────────────────────────

function renderFactGraphPanel(xmlStr, errors, graph) {
  const nodeCount = Object.keys(graph?.nodes ?? {}).length;
  const xmlLines  = xmlStr.split('\n').length;
  const inputCount   = Object.keys(graph?.nodes ?? {}).filter(p => p.startsWith('$.')).length;
  const derivedCount = nodeCount - inputCount;

  const errorBanner = errors.length > 0
    ? `<div style="background:#fef9c3;border:1px solid #fde047;border-radius:4px;padding:8px 12px;margin-bottom:12px;font-size:11px;color:#854d0e">
        <strong>${errors.length} translation note${errors.length > 1 ? 's' : ''}:</strong>
        ${errors.map(e => `<div style="margin-top:2px;opacity:0.85">${esc(e.path)}: ${esc(e.message)}</div>`).join('')}
      </div>`
    : '';

  return `<div id="fact-graph-xml" class="tab-panel" style="display:flex;flex-direction:column;overflow:hidden">
  <div style="flex-shrink:0;padding:1.25rem 2rem 0.75rem;border-bottom:2px solid #e5e7eb;background:#F3F3F3">
    <h2 style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px">IRS Fact Graph XML</h2>
    <p style="font-size:11px;color:#6b7280;line-height:1.5">
      Equivalent representation in the
      <a href="https://github.com/IRS-Public/fact-graph" target="_blank" style="color:#2563eb">IRS fact-graph format</a>
      (Scala + XML). Our format: <strong>${nodeCount} nodes</strong>
      (${inputCount} input, ${derivedCount} derived) in compact JSON.
      Fact-graph: <strong>${xmlLines} lines</strong> of XML for the same logic.
    </p>
  </div>
  <div style="flex:1;overflow:auto;padding:1.5rem 2rem;background:#fafafa">
    ${errorBanner}
    <pre style="font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;line-height:1.55;background:#fff;padding:1.25rem 1.5rem;border-radius:6px;border:1px solid #e5e7eb;overflow:auto;tab-size:2">${esc(xmlStr)}</pre>
  </div>
</div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────

async function render(opts) {
  const { slug, projectPath, rulespecPath, translationLogPath, graphPath } = opts;

  if (graphPath) { const d = JSON.parse(readFileSync(graphPath, 'utf-8')); validateSchema('graph', d, graphPath); }

  // ── nodeTypes + corticonToFact: sourced from graph.json ─────────────────────
  function formatNodeType(nodeInfo) {
    if (!nodeInfo) return '';
    if (nodeInfo.enum?.length) return `enum (${nodeInfo.enum.length})`;
    if (nodeInfo.entityType) return nodeInfo.entityType;
    if (nodeInfo.format) return `${nodeInfo.type} (${nodeInfo.format})`;
    return nodeInfo.type ?? '';
  }

  let nodeTypes = {};
  let nodeEnumData = {}; // canonical → {enum, enumDescriptions} for popover
  const corticonToFact = {};
  try {
    const graphData = JSON.parse(readFileSync(graphPath, 'utf-8'));
    for (const [nodePath, nodeInfo] of Object.entries(graphData.nodes ?? {})) {
      const canonical = nodePath.startsWith('$.') ? nodePath.slice(2) : nodePath;
      const typeLabel = formatNodeType(nodeInfo);
      if (typeLabel) nodeTypes[canonical] = typeLabel;
      if (nodeInfo.enum?.length) {
        nodeEnumData[canonical] = { enum: nodeInfo.enum, enumDescriptions: nodeInfo.enumDescriptions ?? [] };
      }
      corticonToFact[canonical] = nodeInfo.expression ? { expression: nodeInfo.expression } : {};
    }
  } catch { /* ok */ }

  // ── Sink candidates: derived leaf nodes from graph (no outgoing edges) ───────
  let tlSinkCandidates = {};
  try {
    if (translationLogPath) {
      const logRaw = JSON.parse(readFileSync(translationLogPath, 'utf-8'));
      tlSinkCandidates = logRaw?.sinkCandidates ?? {};
    }
  } catch { /* ok */ }

  // Sink candidates and subgraph data come from the translation log when available.
  // For hand-authored graphs with no translation log, derive sink candidates directly
  // from the graph: any derived node that is never a `from` in any edge.
  let sinkCandidates = { ...tlSinkCandidates };
  if (!Object.keys(sinkCandidates).length && graphPath) {
    try {
      const gd = JSON.parse(readFileSync(graphPath, 'utf-8'));
      const allPairs = Object.values(gd.edges ?? {}).flat();
      const fromSet  = new Set(allPairs.map(e => e.from));
      const toSet    = new Set(allPairs.map(e => e.to));
      const graphNorm = { ...gd, edges: allPairs };
      for (const key of [...toSet].filter(k => !fromSet.has(k) && !k.startsWith('$.'))) {
        try {
          const sub = buildCandidateSubgraph(key, graphNorm);
          sinkCandidates[key] = {
            nodeCount:     sub.nodeCount,
            depth:         sub.depth,
            nodes:         sub.nodes,
            orderedLayers: sub.orderedLayers,
            edges:         sub.edges.map(e => ({ from: e.from, to: e.to })),
          };
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  const subgraphs = {};
  let markerSerial = 0;
  for (const [key, info] of Object.entries(sinkCandidates)) {
    try {
      subgraphs[key] = {
        nodeCount:     info.nodeCount,
        depth:         info.depth,
        nodes:         info.nodes         ?? [],
        edges:         info.edges         ?? [],
        orderedLayers: info.orderedLayers ?? [],
        svg:           buildCandidateSubgraphSvg(key, info, `arrow-cg-${markerSerial++}`),
        orderedNodes:  orderSubgraphNodes(info),
      };
    } catch { /* skip */ }
  }

  // ── Graph data + fact-graph XML (needed before candidate panels) ────────────
  let sandboxGraphData = null;
  try { if (graphPath) sandboxGraphData = JSON.parse(readFileSync(graphPath, 'utf-8')); } catch { /* ok */ }
  const sandboxHtml = renderSandboxSection(sandboxGraphData);

  let factGraphXmlStr = '';
  if (sandboxGraphData) {
    try { factGraphXmlStr = toFactGraphXml(sandboxGraphData).xml; } catch { /* ok */ }
  }

  // Vendor fg.js: embed for lazy-loading (user clicks "Compare with fact-graph").
  // fg.js is an ES module; we strip the export lines and assign the two exports
  // we need to window.__fg so it can be injected as a plain <script> (no modules,
  // no blob URLs — both break on file:// pages).
  // The content is JSON.stringify'd so </script> sequences are safely escaped.
  let fgJsSrc = '';
  try {
    const fgVendorPath = new URL('../vendor/fg.js', import.meta.url).pathname;
    let fgRaw = readFileSync(fgVendorPath, 'utf-8');
    // Strip all ES module export lines; add explicit global assignment instead.
    fgRaw = fgRaw.replace(/^export \{[^}]+\};\s*$/gm, '');
    fgRaw += '\nwindow.__fg = { FactDictionaryFactory: $e_FactDictionaryFactory, GraphFactory: $e_GraphFactory, _makeDollar: function(s) { return $m_Lgov_irs_factgraph_types_Dollar$package$Dollar$().apply__T__Z__s_math_BigDecimal(String(s), false); }, _makeInt: function(s) { var bd = $m_s_math_BigDecimal$(); return bd.apply__I__Ljava_math_MathContext__s_math_BigDecimal(parseInt(s, 10), bd.s_math_BigDecimal$__f_defaultMathContext); } };\n';
    fgJsSrc = fgRaw;
  } catch { /* fg.js not available — Compare button will remain disabled */ }

  // Pre-parse all node expressions into ASTs so the client can evaluate with
  // proper three-state logic instead of relying on JS's native || / && semantics.
  const graphExprs = {};
  if (sandboxGraphData?.nodes) {
    for (const [path, info] of Object.entries(sandboxGraphData.nodes)) {
      if (info?.expression) {
        try { graphExprs[path] = parseCelExpr(info.expression.trim()); }
        catch { /* leave absent — evaluator will treat as Incomplete */ }
      }
    }
  }

  // ── Assemble section content ────────────────────────────────────────────────
  let candidatesNavHtml = '', candidatesPanelsHtml = '', candidateCount = 0, firstCandidateTabId = null;
  try {
    const result = renderCandidatesNavAndPanels(sinkCandidates, subgraphs, corticonToFact, nodeTypes, nodeEnumData, factGraphXmlStr, sandboxGraphData);
    candidatesNavHtml = result.navHtml;
    candidatesPanelsHtml = result.panelsHtml;
    candidateCount = result.count;
    firstCandidateTabId = result.firstTabId;
  } catch (e) { candidatesPanelsHtml = `<p style="color:#991b1b;padding:1rem">Error: ${esc(e.message)}</p>`; }

  const dataModelHtml = renderDataModelContent(graphPath, projectPath);
  const dataModelNavItems = buildDataModelNavItems(graphPath);
  const vocabHtml = renderVocabularyContent(projectPath);
  const rsChipsHtml = buildRulesheetChips(projectPath);

  let rulesSvg = '';
  try { rulesSvg = buildRulesDiagramContent(projectPath, 'arrow-rules', { skipStrips: true }); }
  catch (e) { rulesSvg = `<p style="color:#991b1b;padding:1rem">Error: ${esc(e.message)}</p>`; }

  const exceptionsHtml = renderExceptionsContent(translationLogPath);
  const exceptionCount = translationLogPath ? countExceptions(translationLogPath) : 0;

  const jsonFiles = [
    { id: 'json-project',         label: 'source.json',          path: projectPath,        opts: { maxDepth: 3 } },
    { id: 'json-graph',           label: 'graph.json',           path: graphPath,           opts: { maxDepth: 2, expandDeepOnOpen: true } },
    { id: 'json-translation-log', label: 'translation-log.json', path: translationLogPath,  opts: { maxDepth: 2, expandAllOnOpen: true } },
  ].filter(f => f.path);
  const debugNavItems   = jsonFiles.map(f => jsonPanel(f.id, f.label, f.path, f.opts).navHtml).join('\n')
    + (factGraphXmlStr ? `\n<a class="nav-link" data-tab="debug-fg-xml">fact-graph.xml</a>` : '');
  const debugFgPanel = factGraphXmlStr ? `
<div id="debug-fg-xml" class="tab-panel" style="padding:1.5rem 2rem;overflow:auto">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">
    <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0;flex:1">fact-graph.xml</h2>
    <button onclick="xmlExpandAll(document.getElementById('fg-xml-tree'))" style="font-size:10px;padding:2px 8px;cursor:pointer;background:#f9fafb;border:1px solid #d1d5db;border-radius:4px;color:#374151">Expand all</button>
    <button onclick="xmlCollapseAll(document.getElementById('fg-xml-tree'))" style="font-size:10px;padding:2px 8px;cursor:pointer;background:#f9fafb;border:1px solid #d1d5db;border-radius:4px;color:#374151">Collapse all</button>
  </div>
  <div id="fg-xml-tree" style="font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.65;background:#fff;overflow:auto">
    <span style="color:#9ca3af;font-style:italic">Loading\u2026</span>
  </div>
</div>` : '';
  const debugPanelsHtml = jsonFiles.map(f => jsonPanel(f.id, f.label, f.path, f.opts).panelHtml).join('\n') + debugFgPanel;

  // Inline source panel for debug VIEWS section
  let rulespecYaml = '';
  if (rulespecPath) {
    try { rulespecYaml = readFileSync(rulespecPath, 'utf-8'); } catch { /* ok */ }
  }

  const debugSourcePanelHtml = projectPath ? `
<div id="debug-source" class="tab-panel" style="overflow:hidden">
  <div style="position:absolute;top:0;left:0;right:0;height:40px;padding:5px 12px;border-bottom:1px solid #e5e7eb;background:#f9fafb;display:flex;align-items:center;gap:6px;z-index:1">
    <button id="btn-src-rules" onclick="showDebugSourceView('rules')" style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;border:1px solid #2B1A78;cursor:pointer;background:#2B1A78;color:white">Rules</button>
    <button id="btn-src-vocab" onclick="showDebugSourceView('vocab')" style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;border:1px solid #d1d5db;cursor:pointer;background:#f9fafb;color:#374151">Vocabulary</button>
    <div style="flex:1"></div>
    <input id="rs-search" type="search" placeholder="Filter rulesheets\u2026"
      style="width:200px;padding:3px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;background:#fff;outline:none"
      aria-label="Filter"/>
  </div>
  <div id="src-rules-view" style="position:absolute;top:40px;bottom:0;left:0;right:0;display:flex;flex-direction:column">
    <div id="src-rulesheet-list" style="flex-shrink:0;padding:4px 8px;border-bottom:1px solid #f3f4f6;overflow-x:auto;white-space:nowrap;background:#fafafa;min-height:32px">
      ${rsChipsHtml}
    </div>
    <div id="rules-svg-scroll" style="flex:1;overflow:auto">${rulesSvg}</div>
  </div>
  <div id="src-vocab-view" style="position:absolute;top:40px;bottom:0;left:0;right:0;overflow:auto;display:none;padding:1.5rem 2rem">
    <div id="vocab-content">${vocabHtml}</div>
  </div>
</div>` : rulespecPath ? `
<div id="debug-source" class="tab-panel" style="overflow:auto;padding:1.5rem 2rem">
  <pre style="font-size:11px;line-height:1.6;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:6px;white-space:pre-wrap;word-break:break-word">${esc(rulespecYaml)}</pre>
</div>` : '';

  // Translation analysis panel for debug VIEWS section
  const debugAnalysisPanelHtml = translationLogPath ? `
<div id="debug-analysis" class="tab-panel" style="padding:1.5rem 2rem;overflow:auto">
  <div style="margin-bottom:16px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">
    <h2 style="font-size:15px;font-weight:700;color:#111827">Translation Analysis</h2>
  </div>
  ${exceptionsHtml}
</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${esc(slug)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { font-family: ${FONT}; background: #F3F3F3; color: #1a1a1a; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

    /* Page header */
    #page-header { flex-shrink: 0; background: ${DARK_BLUE}; color: white; padding: 10px 20px; font-size: 14px; font-weight: 700; }
    #page-header span { font-weight: 400; opacity: 0.6; margin-left: 8px; font-size: 12px; }

    /* Top tab bar */
    #top-tab-bar { flex-shrink: 0; background: #e5e7eb; border-bottom: none; display: flex; align-items: flex-end; padding: 6px 16px 0; gap: 2px; }
    .top-tab-btn { background: transparent; border: 1px solid transparent; border-bottom: none; border-radius: 5px 5px 0 0; padding: 7px 14px 8px; font-size: 12px; font-weight: 600; color: #6b7280; cursor: pointer; transition: background 0.1s, color 0.1s; }
    .top-tab-btn:hover { background: rgba(255,255,255,0.5); color: #374151; }
    .top-tab-btn.active { background: #F3F3F3; color: #111827; border-color: #d1d5db; border-bottom-color: #F3F3F3; }

    /* Top content area */
    #top-content { flex: 1; min-height: 0; position: relative; overflow: hidden; }

    /* Top-level sections */
    .top-section { display: none; position: absolute; inset: 0; flex-direction: column; }
    .top-section.active { display: flex; }

    /* Two-pane layout (Graph, Source, Debug) */
    .two-pane { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    .pane-sidebar { flex-shrink: 0; background: ${DARK_BLUE}; display: flex; flex-direction: column; overflow: hidden; }
    .pane-sidebar-nav { flex: 1; overflow-y: auto; padding: 0.5rem 0; }
    .pane-content { flex: 1; min-width: 0; position: relative; overflow: hidden; }

    /* Inner panels within pane-content */
    .tab-panel { display: none; position: absolute; inset: 0; overflow: auto; }
    .tab-panel.active { display: block; }
    .inner-svg-panel { display: none; position: absolute; inset: 0; flex-direction: column; }
    .inner-svg-panel.active { display: flex; }
    .svg-panel-header { flex-shrink: 0; padding: 1.25rem 2rem 0.75rem; border-bottom: 2px solid #e5e7eb; background: #F3F3F3; }
    .svg-panel-header h2 { font-size: 15px; font-weight: 700; color: #111827; }
    .svg-scroll { flex: 1; min-height: 0; overflow: auto; background: #fafafa; }

    /* Analysis section (full-width, scrollable) */
    #section-analysis.active { display: block; overflow: auto; }

    /* Sidebar nav shared styles */
    a.nav-link { display: block; padding: 5px 0.75rem; font-size: 11px; color: rgba(255,255,255,0.65); text-decoration: none; cursor: pointer; transition: background 0.1s; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    a.nav-link:hover { background: rgba(255,255,255,0.08); color: white; }
    a.nav-link.nav-active { background: rgba(255,255,255,0.15); color: white; font-weight: 700; }
    @keyframes nav-flash { 0% { background: rgba(250,204,21,0.45); } 100% { background: transparent; } }
    a.nav-link.nav-flash { animation: nav-flash 2s ease-out forwards; }
    .nav-section-label { font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.35); padding: 0.75rem 0.75rem 0.2rem; }
    .nav-divider { border-top: 1px solid rgba(255,255,255,0.1); margin: 0.4rem 0.75rem; }

    tr[id]:target td { background: #fff9c4; }
    mark.search-hl { background: #fef08a; border-radius: 2px; padding: 0 1px; font-style: normal; }

    /* SVG graph node hover affordance */
    .sg-node { cursor: pointer; }
    .sg-node rect { transition: filter 0.1s, stroke-width 0.1s; }
    .sg-node:hover rect { filter: brightness(0.93); stroke-width: 2.5px; }
    .sg-node.sg-selected rect { stroke: #f59e0b; stroke-width: 3px; filter: brightness(0.97); }

    /* Sandbox backdrop */
    #sb-panel.active { display: flex !important; }

    /* Inline rulesheet chips (debug Source view) */
    .src-rs-chip { display:inline-flex;align-items:center;padding:3px 8px;margin:2px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#374151;border-radius:3px;cursor:pointer;background:transparent;border:1px solid transparent; }
    .src-rs-chip:hover { background:#e5e7eb;border-color:#d1d5db; }
    .src-rs-chip.nav-active { background:#2B1A78;color:white;border-color:#2B1A78; }
  </style>
</head>
<body>
  <div id="page-header">${esc(slug)}</div>
  <div id="top-tab-bar">
    <button class="top-tab-btn active" data-section="graph">Graph</button>
    ${graphPath ? `<button class="top-tab-btn" data-section="data-model">Data Model</button>` : ''}
    <button class="top-tab-btn" data-section="debug">Debug</button>
  </div>
  <div id="top-content">

    <!-- ── GRAPH ── -->
    <div id="section-graph" class="top-section active">
      <div class="two-pane">
        <nav class="pane-sidebar" style="width:220px" id="graph-sidebar">
          <div class="pane-sidebar-nav" id="graph-sidebar-nav" style="overflow-y:auto">
            <div style="padding:4px 8px 6px">
              <input id="candidate-search" type="search" placeholder="Filter…"
                style="width:100%;padding:3px 6px;border:1px solid rgba(255,255,255,0.2);border-radius:3px;font-size:10px;background:rgba(255,255,255,0.08);color:white;outline:none;"
                aria-label="Filter sink candidates"/>
            </div>
            ${candidatesNavHtml}
          </div>
        </nav>
        <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden">
          <div id="graph-cand-header" style="flex-shrink:0;padding:7px 20px;border-bottom:1px solid #e5e7eb;background:#fff">
            <div style="display:flex;align-items:center;gap:8px">
              <span id="graph-cand-name" style="font-family:${MONO};font-size:13px;font-weight:700;color:#111827;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
              ${sandboxGraphData ? `<div style="display:flex;border:1px solid #e5e7eb;border-radius:5px;overflow:hidden;flex-shrink:0">
                <button id="graph-mode-view" onclick="setGraphMode('view')" style="font-size:11px;padding:3px 12px;border:none;border-right:1px solid #e5e7eb;cursor:pointer;background:#2B1A78;color:#fff;font-weight:600">View</button>
                <button id="graph-mode-eval" onclick="setGraphMode('evaluate')" style="font-size:11px;padding:3px 12px;border:none;cursor:pointer;background:#fff;color:#374151">Evaluate</button>
              </div>` : ''}
            </div>
            <span id="graph-cand-stats" style="font-size:10px;color:#9ca3af;margin-top:2px;display:block"></span>
          </div>
          <main class="pane-content" id="graph-content">
            ${candidatesPanelsHtml}
            ${sandboxHtml}
          </main>
        </div>
      </div>
    </div>

    <!-- ── DATA MODEL ── -->
    <div id="section-data-model" class="top-section">
      <div class="two-pane">
        <nav class="pane-sidebar" style="width:220px" id="dm-sidebar">
          <div class="pane-sidebar-nav" style="overflow-y:auto">
            <div style="padding:4px 8px 6px">
              <input id="dm-search" type="search" placeholder="Filter…"
                style="width:100%;padding:3px 6px;border:1px solid rgba(255,255,255,0.2);border-radius:3px;font-size:10px;background:rgba(255,255,255,0.08);color:white;outline:none;"
                aria-label="Filter entities"/>
            </div>
            ${dataModelNavItems}
          </div>
        </nav>
        <main class="pane-content" id="dm-content">
          <div id="data-model" class="tab-panel active" style="padding:1.5rem 2rem">
            ${dataModelHtml}
          </div>
        </main>
      </div>
    </div>

    <!-- ── DEBUG ── -->
    <div id="section-debug" class="top-section">
      <div class="two-pane">
        <nav class="pane-sidebar" style="width:190px" id="debug-sidebar">
          <div class="pane-sidebar-nav">
            ${(projectPath || rulespecPath || translationLogPath) ? `<div class="nav-section-label">VIEWS</div>` : ''}
            ${(projectPath || rulespecPath) ? `<a class="nav-link" data-tab="debug-source">Source</a>` : ''}
            ${translationLogPath ? `<a class="nav-link" data-tab="debug-analysis">Translation Analysis</a>` : ''}
            <div class="nav-section-label">FILES</div>
            <div style="padding:4px 8px 6px">
              <input id="json-search" type="search" placeholder="Filter…"
                style="width:100%;padding:3px 6px;border:1px solid rgba(255,255,255,0.2);border-radius:3px;font-size:10px;background:rgba(255,255,255,0.08);color:white;outline:none;"
                aria-label="Filter JSON"/>
            </div>
            ${debugNavItems}
          </div>
        </nav>
        <main class="pane-content" id="debug-content">
          ${debugSourcePanelHtml}
          ${debugAnalysisPanelHtml}
          ${debugPanelsHtml}
        </main>
      </div>
    </div>

  </div>
  <script>
    // ── Graph data (for node detail pane) ─────────────────────────────────────
    var GRAPH_NODES = ${JSON.stringify(sandboxGraphData?.nodes ?? {})};
    var GRAPH_EDGES = ${JSON.stringify(sandboxGraphData?.edges ?? {})};
    var GRAPH_EXPRS = ${JSON.stringify(graphExprs)};
    var FG_XML = ${JSON.stringify(factGraphXmlStr)};
    var FG_AVAILABLE = ${fgJsSrc ? 'true' : 'false'};
    var FG_SRC = ${fgJsSrc ? JSON.stringify(fgJsSrc).replace(/<\//g, '<\\/') : 'null'};

    // ── Graph View/Evaluate mode state ─────────────────────────────────────────
    var _currentGraphMode = 'view';
    var _currentCandTabId = null;
    var _currentCandLink = null;

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── XML tree viewer ────────────────────────────────────────────────────────
    var _xmlNodeId = 0;
    var _xmlMaxDepth = 2; // controls initial expand depth

    // Client-side path conversion matching server-side nodePathToFgPath
    function nodePathToFgPath(nodePath) {
      var canonical = nodePath.startsWith('$.') ? nodePath.slice(2) : nodePath;
      var dot = canonical.indexOf('.');
      if (dot < 0) return '/' + canonical;
      return '/' + canonical.slice(0, dot).toLowerCase() + '_' + canonical.slice(dot + 1);
    }

    function buildXmlNodeHtml(el, depth) {
      var tag = el.tagName;
      var attrs = Array.from(el.attributes).map(function(a) {
        return ' <span style="color:#b45309">' + escHtml(a.name) + '</span>=<span style="color:#0369a1">"' + escHtml(a.value) + '"</span>';
      }).join('');
      var childEls = Array.from(el.children);
      var textContent = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) ? el.textContent.trim() : '';
      var p = depth * 8;
      var tagColor = depth === 0 ? '#6b7280' : depth === 1 ? '#6b7280' : '#374151';
      var nameColor = depth === 0 ? '#9ca3af' : depth === 1 ? '#6b7280' : '#2B1A78';
      var openTag = '<span style="color:' + tagColor + '">&lt;</span><span style="color:' + nameColor + ';font-weight:600">' + tag + '</span>' + attrs;

      if (!childEls.length && !textContent) {
        return '<div style="margin-left:' + p + 'px;line-height:1.65;white-space:nowrap"><span style="display:inline-block;width:10px"></span>' + openTag + '<span style="color:' + tagColor + '">/&gt;</span></div>';
      }
      if (!childEls.length) {
        return '<div style="margin-left:' + p + 'px;line-height:1.65;white-space:nowrap"><span style="display:inline-block;width:10px"></span>' + openTag + '<span style="color:' + tagColor + '">&gt;</span><span style="color:#374151">' + escHtml(textContent) + '</span><span style="color:' + tagColor + '">&lt;/' + tag + '&gt;</span></div>';
      }
      var id = 'xe' + (++_xmlNodeId);
      var expanded = depth < _xmlMaxDepth;
      var childrenHtml = childEls.map(function(c) { return buildXmlNodeHtml(c, depth + 1); }).join('');
      return '<div style="margin-left:' + p + 'px;line-height:1.65">'
        + '<span data-xid="' + id + '" style="cursor:pointer;user-select:none;color:#9ca3af;display:inline-block;width:10px;text-align:center;font-size:9px">' + (expanded ? '▾' : '▸') + '</span>'
        + openTag + '<span style="color:' + tagColor + '">&gt;</span>'
        + '<span id="' + id + '-ell" style="color:#9ca3af;font-style:italic' + (expanded ? ';display:none' : '') + '"> \u2026</span>'
        + '<div id="' + id + '"' + (!expanded ? ' style="display:none"' : '') + '>'
        + childrenHtml
        + '<div style="white-space:nowrap"><span style="display:inline-block;width:10px"></span><span style="color:' + tagColor + '">&lt;/' + tag + '&gt;</span></div>'
        + '</div>'
        + '</div>';
    }

    function renderFgXmlTree(container, xmlStr, maxDepth) {
      if (!container || !xmlStr) return;
      _xmlMaxDepth = maxDepth !== undefined ? maxDepth : 2;
      var doc = new DOMParser().parseFromString(xmlStr, 'text/xml');
      var root = doc.documentElement;
      // Do NOT reset _xmlNodeId — IDs must stay unique across all rendered trees.
      container.innerHTML = buildXmlNodeHtml(root, 0);
    }

    // Event delegation for XML toggle buttons (data-xid attribute)
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-xid]');
      if (!btn) return;
      var id = btn.dataset.xid;
      var div = document.getElementById(id);
      var ell = document.getElementById(id + '-ell');
      if (!div) return;
      var hidden = div.style.display === 'none';
      div.style.display = hidden ? '' : 'none';
      if (ell) ell.style.display = hidden ? 'none' : '';
      btn.textContent = hidden ? '▾' : '▸';
    });

    function xmlExpandAll(container) {
      if (!container) return;
      container.querySelectorAll('[data-xid]').forEach(function(btn) {
        var id = btn.dataset.xid;
        var div = document.getElementById(id);
        var ell = document.getElementById(id + '-ell');
        if (div) div.style.display = '';
        if (ell) ell.style.display = 'none';
        btn.textContent = '▾';
      });
    }

    function xmlCollapseAll(container) {
      if (!container) return;
      container.querySelectorAll('[data-xid]').forEach(function(btn) {
        var id = btn.dataset.xid;
        var div = document.getElementById(id);
        var ell = document.getElementById(id + '-ell');
        if (div) div.style.display = 'none';
        if (ell) ell.style.display = '';
        btn.textContent = '▸';
      });
    }

    // Build reverse-dependency map: nodePath → [from, ...]
    var _revDeps = null;
    function getRevDeps() {
      if (_revDeps) return _revDeps;
      _revDeps = {};
      for (var eid in GRAPH_EDGES) {
        var pairs = GRAPH_EDGES[eid];
        for (var i = 0; i < pairs.length; i++) {
          var from = pairs[i].from, to = pairs[i].to;
          if (!_revDeps[to]) _revDeps[to] = [];
          if (_revDeps[to].indexOf(from) < 0) _revDeps[to].push(from);
        }
      }
      return _revDeps;
    }

    /**
     * Render a recursive "where" expansion for a graph node as HTML.
     * Derived deps are expanded recursively; input ($.prefix) deps are listed as leaves.
     */
    function renderLogicTree(nodePath, revDeps, depth, visited) {
      if (!nodePath || visited[nodePath] || depth > 4) return '';
      var nextVisited = Object.assign({}, visited);
      nextVisited[nodePath] = true;

      var node = GRAPH_NODES[nodePath];
      if (!node) return '';

      var isInput = nodePath.charAt(0) === '$';
      var localName = nodePath.split('.').pop();
      var expr = node.expression;
      var desc = node.description || '';
      var type = node.type || '';

      var indent = depth * 16; // px
      var bullet = depth === 0 ? '' : '<span style="color:#9ca3af;margin-right:4px">↳</span>';

      var nameHtml, valueHtml;
      if (isInput) {
        var hasDefault = node.default !== undefined;
        nameHtml = '<span style="color:' + (hasDefault ? '#92400e' : '#0369a1') + ';font-weight:600">' + escHtml(localName) + '</span>';
        if (hasDefault) {
          valueHtml = ' <span style="color:#9ca3af;font-size:10px">(param)</span>'
            + ' <span style="color:#d97706;font-size:10px">default: <b>' + escHtml(String(node.default)) + '</b></span>';
        } else {
          valueHtml = type
            ? ' <span style="color:#9ca3af;font-size:10px">(' + escHtml(type) + ' input)</span>'
            : ' <span style="color:#9ca3af;font-size:10px">(input)</span>';
        }
      } else if (expr !== undefined && expr !== null) {
        nameHtml = '<span style="color:#2B1A78;font-weight:700">' + escHtml(localName) + '</span>';
        valueHtml = ' = <code style="color:#374151;background:transparent">' + escHtml(expr) + '</code>';
      } else {
        nameHtml = '<span style="color:#6b7280">' + escHtml(localName) + '</span>';
        valueHtml = '';
      }

      var descHtml = (desc && depth === 0)
        ? '<div style="font-size:10px;color:#6b7280;font-family:sans-serif;font-weight:400;margin-top:2px;margin-left:' + indent + 'px">' + escHtml(desc) + '</div>'
        : '';

      var rowHtml = '<div style="margin-left:' + indent + 'px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
        + bullet + nameHtml + valueHtml + '</div>' + descHtml;

      // Recurse into derived deps (not inputs)
      var deps = (revDeps[nodePath] || []);
      var childrenHtml = '';
      for (var i = 0; i < deps.length; i++) {
        var dep = deps[i];
        if (!dep.startsWith('$.')) {
          childrenHtml += renderLogicTree(dep, revDeps, depth + 1, nextVisited);
        }
      }
      // List input deps as leaves only at the deepest derived level
      var hasNoDerivedChildren = childrenHtml === '';
      if (hasNoDerivedChildren && depth > 0) {
        for (var j = 0; j < deps.length; j++) {
          if (deps[j].startsWith('$.')) {
            childrenHtml += renderLogicTree(deps[j], revDeps, depth + 1, nextVisited);
          }
        }
      }

      return rowHtml + childrenHtml;
    }

    function showNodeDetail(nodePath, panel) {
      var pane = panel ? panel.querySelector('.sg-detail-pane') : null;
      if (!pane) return;
      var node = GRAPH_NODES[nodePath];
      if (!node) { pane.style.display = 'none'; return; }
      var revDeps = getRevDeps();
      var treeHtml = renderLogicTree(nodePath, revDeps, 0, {});
      var pathLabel = '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;margin-bottom:6px">'
        + escHtml(nodePath) + '</div>';
      pane.querySelector('.sg-detail-content').innerHTML = pathLabel + treeHtml;
      pane.style.display = '';
    }


    function hideNodeDetail(panel) {
      var pane = panel ? panel.querySelector('.sg-detail-pane') : null;
      if (pane) pane.style.display = 'none';
    }

    // ── Top section switching ──────────────────────────────────────────────────
    var debugInitialized = false;
    document.querySelectorAll('.top-tab-btn[data-section]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sectionId = this.dataset.section;
        document.querySelectorAll('.top-tab-btn').forEach(function(b) { b.classList.toggle('active', b === btn); });
        document.querySelectorAll('.top-section').forEach(function(s) { s.classList.toggle('active', s.id === 'section-' + sectionId); });
        // Activate first debug tab only when Debug section is first opened
        if (sectionId === 'debug' && !debugInitialized) {
          debugInitialized = true;
          if (FG_XML && document.getElementById('debug-fg-xml')) {
            if (!window.__jsonPanels) window.__jsonPanels = {};
            window.__jsonPanels['debug-fg-xml'] = function() {
              var c = document.getElementById('fg-xml-tree');
              if (c) renderFgXmlTree(c, FG_XML, 2);
            };
          }
          var link = document.querySelector('#debug-sidebar a.nav-link[data-tab]');
          if (link) activateInnerTab(link);
        }
      });
    });

    // ── Inner tab switching within each pane ──────────────────────────────────
    function activateInnerTab(link) {
      var tabId = link.dataset.tab;
      var sidebar = link.closest('.pane-sidebar');
      var content = link.closest('.two-pane').querySelector('.pane-content');
      sidebar.querySelectorAll('a.nav-link[data-tab], .dm-entity-link').forEach(function(a) { a.classList.remove('nav-active'); });
      link.classList.add('nav-active');
      content.querySelectorAll('.tab-panel, .inner-svg-panel').forEach(function(p) { p.classList.remove('active'); });
      var panel = document.getElementById(tabId);
      if (panel) {
        panel.classList.add('active');
        // Lazy-render json panels on first activation
        if (window.__jsonPanels && window.__jsonPanels[tabId]) {
          window.__jsonPanels[tabId]();
          delete window.__jsonPanels[tabId];
        }
      }
      // Clear JSON search when switching debug panels
      var jsonSearch = document.getElementById('json-search');
      if (jsonSearch && sidebar.id === 'debug-sidebar') {
        jsonSearch.value = '';
        filterJsonPanel('');
      }
    }

    document.querySelectorAll('.pane-sidebar a.nav-link[data-tab]').forEach(function(link) {
      link.addEventListener('click', function() {
        if (link.closest('#graph-sidebar-nav')) {
          _currentCandLink = link;
          _currentCandTabId = link.dataset.tab;
          _updateCandHeader(link);
          var q = (document.getElementById('candidate-search')?.value || '').trim().toLowerCase();
          var panel = document.getElementById(link.dataset.tab);
          if (panel) {
            clearHighlights(panel);
            clearSvgHighlights(panel);
            if (q) { highlightInElement(panel, q); highlightInSvg(panel, q); }
          }
          if (_currentGraphMode === 'evaluate') {
            // Stay in evaluate mode: switch sandbox context to the new candidate
            var gcontent = document.getElementById('graph-content');
            if (gcontent) gcontent.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
            var sb = document.getElementById('sb-panel');
            if (sb) sb.classList.add('active');
            link.closest('.pane-sidebar').querySelectorAll('a.nav-link').forEach(function(a) { a.classList.remove('nav-active'); });
            link.classList.add('nav-active');
            _setSandboxContext(link);
          } else {
            activateInnerTab(link);
          }
        } else {
          activateInnerTab(link);
        }
      });
    });

    // ── Graph default: activate first candidate ────────────────────────────────
    (function() {
      var defaultTabId = ${JSON.stringify(firstCandidateTabId ?? null)};
      var link = defaultTabId ? document.querySelector('#graph-sidebar-nav a.nav-link[data-tab="' + defaultTabId + '"]') : null;
      if (!link) link = document.querySelector('#graph-sidebar-nav a.nav-link[data-tab]');
      if (link) {
        _currentCandLink = link;
        _currentCandTabId = link.dataset.tab;
        activateInnerTab(link);
        _updateCandHeader(link);
      }
    })();

    // ── Data Model entity nav links ────────────────────────────────────────────
    document.querySelectorAll('.dm-entity-link').forEach(function(link) {
      link.addEventListener('click', function() {
        document.querySelectorAll('.dm-entity-link').forEach(function(a) { a.classList.remove('nav-active'); });
        link.classList.add('nav-active');
        var entity = link.dataset.dmEntity;
        var sec = document.getElementById('dm-' + entity);
        if (sec) sec.scrollIntoView({ block: 'start' });
      });
    });

    // ── Graph View / Evaluate toggle ──────────────────────────────────────────
    function _updateCandHeader(link) {
      var nameEl  = document.getElementById('graph-cand-name');
      var statsEl = document.getElementById('graph-cand-stats');
      if (nameEl) nameEl.textContent = link ? (link.dataset.title || link.title || '') : '';
      if (statsEl && link) {
        var panel = document.getElementById(link.dataset.tab);
        var nc = panel ? panel.dataset.nodeCount : null;
        var d  = panel ? panel.dataset.depth : null;
        statsEl.textContent = (nc && d) ? nc + ' nodes · depth ' + d : '';
      } else if (statsEl) { statsEl.textContent = ''; }
    }
    function _setSandboxContext(link) {
      if (!link || !window.__sbSetContext) return;
      var nodeList = (link.dataset.nodes || '').split(' ').filter(Boolean);
      window.__sbSetContext(link.dataset.title || link.title, nodeList);
    }
    function setGraphMode(mode) {
      _currentGraphMode = mode;
      var ACTIVE_BTN  = 'font-size:11px;padding:4px 14px;border:none;cursor:pointer;background:#2B1A78;color:#fff;font-weight:600';
      var INACTIVE_BTN = 'font-size:11px;padding:4px 14px;border:none;cursor:pointer;background:#fff;color:#374151';
      var viewBtn = document.getElementById('graph-mode-view');
      var evalBtn = document.getElementById('graph-mode-eval');
      var gcontent = document.getElementById('graph-content');
      if (!gcontent) return;
      if (mode === 'view') {
        if (viewBtn) viewBtn.style.cssText = ACTIVE_BTN + ';border-right:1px solid #e5e7eb';
        if (evalBtn) evalBtn.style.cssText = INACTIVE_BTN;
        gcontent.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
        if (_currentCandTabId) {
          var panel = document.getElementById(_currentCandTabId);
          if (panel) panel.classList.add('active');
        }
      } else {
        if (viewBtn) viewBtn.style.cssText = INACTIVE_BTN + ';border-right:1px solid #e5e7eb';
        if (evalBtn) evalBtn.style.cssText = ACTIVE_BTN;
        gcontent.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
        var sb = document.getElementById('sb-panel');
        if (sb) sb.classList.add('active');
        if (window.__sbInit) window.__sbInit();
        if (_currentCandLink) _setSandboxContext(_currentCandLink);
      }
    }

    // ── Debug Source: inline Rules / Vocabulary toggle ─────────────────────────
    function showDebugSourceView(which) {
      var isVocab = which === 'vocab';
      var rulesBtn = document.getElementById('btn-src-rules');
      var vocabBtn = document.getElementById('btn-src-vocab');
      var rulesView = document.getElementById('src-rules-view');
      var vocabView = document.getElementById('src-vocab-view');
      var search = document.getElementById('rs-search');
      if (rulesBtn) { rulesBtn.style.background = isVocab ? '#f9fafb' : '#2B1A78'; rulesBtn.style.color = isVocab ? '#374151' : 'white'; rulesBtn.style.borderColor = isVocab ? '#d1d5db' : '#2B1A78'; }
      if (vocabBtn) { vocabBtn.style.background = isVocab ? '#2B1A78' : '#f9fafb'; vocabBtn.style.color = isVocab ? 'white' : '#374151'; vocabBtn.style.borderColor = isVocab ? '#2B1A78' : '#d1d5db'; }
      if (rulesView) rulesView.style.display = isVocab ? 'none' : '';
      if (vocabView) vocabView.style.display = isVocab ? '' : 'none';
      if (search) { search.value = ''; search.placeholder = isVocab ? 'Filter vocabulary\u2026' : 'Filter rulesheets\u2026'; }
      // Clear active filters
      document.querySelectorAll('.rs-nav-item').forEach(function(el) { el.style.display = ''; });
      document.querySelectorAll('#vocab-content .card, #vocab-content .dict-section').forEach(function(el) { el.style.display = ''; });
    }

    // ── Rulesheet chip click: scroll SVG to matching box ──────────────────────
    document.querySelectorAll('.rs-nav-item').forEach(function(link) {
      link.addEventListener('click', function() {
        document.querySelectorAll('.rs-nav-item').forEach(function(a) { a.classList.remove('nav-active'); });
        link.classList.add('nav-active');
        var name = link.dataset.rsName;
        var scroll = document.getElementById('rules-svg-scroll');
        if (!scroll || !name) return;
        var texts = scroll.querySelectorAll('text');
        for (var i = 0; i < texts.length; i++) {
          if (texts[i].textContent.includes(name)) {
            var rect = texts[i].getBoundingClientRect();
            var containerRect = scroll.getBoundingClientRect();
            scroll.scrollTop += rect.top - containerRect.top - 24;
            break;
          }
        }
      });
    });

    // ── Rulesheet / vocabulary search filter ───────────────────────────────────
    function clearSvgHighlights(container) {
      (container || document).querySelectorAll('[data-svg-hl]').forEach(function(el) {
        el.innerHTML = el.dataset.svgHlOrig || '';
        el.removeAttribute('data-svg-hl');
        el.removeAttribute('data-svg-hl-orig');
      });
    }
    function highlightInSvg(svgContainer, q) {
      if (!q || !svgContainer) return;
      function escSvg(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      svgContainer.querySelectorAll('text').forEach(function(el) {
        var text = el.textContent;
        var lower = text.toLowerCase();
        if (!lower.includes(q)) return;
        el.dataset.svgHlOrig = el.innerHTML;
        el.setAttribute('data-svg-hl', '1');
        var result = '', last = 0, idx = lower.indexOf(q);
        while (idx !== -1) {
          if (idx > last) result += '<tspan>' + escSvg(text.slice(last, idx)) + '</tspan>';
          result += '<tspan fill="#92400e" font-weight="700">' + escSvg(text.slice(idx, idx + q.length)) + '</tspan>';
          last = idx + q.length;
          idx = lower.indexOf(q, last);
        }
        if (last < text.length) result += '<tspan>' + escSvg(text.slice(last)) + '</tspan>';
        el.innerHTML = result;
      });
    }
    document.getElementById('rs-search')?.addEventListener('input', function() {
      var q = this.value.trim().toLowerCase();
      var vocabView = document.getElementById('src-vocab-view');
      var isVocab = vocabView && vocabView.style.display !== 'none';
      if (isVocab) {
        var vocabContent = document.getElementById('vocab-content');
        clearHighlights(vocabContent);
        document.querySelectorAll('#vocab-content .card[data-dm]').forEach(function(card) {
          card.style.display = !q || (card.dataset.dm || '').toLowerCase().includes(q) ? '' : 'none';
        });
        document.querySelectorAll('#vocab-content .dict-section').forEach(function(sec) {
          var anyCard = sec.querySelector('.card:not([style*="display: none"]):not([style*="display:none"])');
          sec.style.display = !q || anyCard ? '' : 'none';
        });
        if (q && vocabContent) {
          document.querySelectorAll('#vocab-content .card:not([style*="display: none"]):not([style*="display:none"])').forEach(function(card) {
            highlightInElement(card, q);
          });
        }
      } else {
        var rsList = document.getElementById('src-rulesheet-list');
        var svgScroll = document.getElementById('rules-svg-scroll');
        if (rsList) clearHighlights(rsList);
        clearSvgHighlights(svgScroll);
        document.querySelectorAll('.rs-nav-item').forEach(function(item) {
          var show = !q || item.title.toLowerCase().includes(q);
          item.style.display = show ? '' : 'none';
          if (show && q) highlightInElement(item, q);
        });
        if (q) highlightInSvg(svgScroll, q);
      }
    });

    // Debug section: first tab activated on first click of the Debug button (see top section switching above)

    // ── Shared search highlight helpers ───────────────────────────────────────
    function clearHighlights(container) {
      (container || document).querySelectorAll('mark.search-hl').forEach(function(m) {
        var parent = m.parentNode;
        m.replaceWith(document.createTextNode(m.textContent));
        if (parent) parent.normalize();
      });
    }
    function highlightInElement(root, q) {
      function walk(node) {
        if (node.nodeType === 1 && node.nodeName.toLowerCase() === 'svg') return; // skip SVG subtrees
        if (node.nodeType === 3) { // TEXT_NODE
          var text = node.textContent;
          var lower = text.toLowerCase();
          if (!lower.includes(q)) return;
          var frag = document.createDocumentFragment();
          var last = 0, idx = lower.indexOf(q);
          while (idx !== -1) {
            if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
            var mark = document.createElement('mark');
            mark.className = 'search-hl';
            mark.textContent = text.slice(idx, idx + q.length);
            frag.appendChild(mark);
            last = idx + q.length;
            idx = lower.indexOf(q, last);
          }
          if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
          node.parentNode.replaceChild(frag, node);
          return;
        }
        for (var i = 0, kids = [...node.childNodes]; i < kids.length; i++) walk(kids[i]);
      }
      walk(root);
    }

    // ── Candidate search filter ────────────────────────────────────────────────
    document.getElementById('candidate-search')?.addEventListener('input', function() {
      var q = this.value.trim().toLowerCase();
      var cgNav = document.getElementById('graph-sidebar-nav');
      clearHighlights(cgNav);
      document.querySelectorAll('.cg-nav-item').forEach(function(item) {
        var show = !q || item.title.toLowerCase().includes(q) || (item.dataset.nodes || '').toLowerCase().includes(q);
        item.style.display = show ? '' : 'none';
        if (show && q) highlightInElement(item, q);
      });
      var activePanel = document.querySelector('#graph-content .tab-panel.active');
      if (activePanel) {
        clearHighlights(activePanel);
        clearSvgHighlights(activePanel);
        if (q) { highlightInElement(activePanel, q); highlightInSvg(activePanel, q); }
      }
    });

    // ── Data model search filter ───────────────────────────────────────────────
    document.getElementById('dm-search')?.addEventListener('input', function() {
      var q = this.value.trim().toLowerCase();
      var dmPanel = document.getElementById('data-model');
      var dmNav = document.getElementById('graph-nav-dm');
      clearHighlights(dmPanel);
      clearHighlights(dmNav);
      document.querySelectorAll('#data-model .card[data-dm]').forEach(function(card) {
        card.style.display = !q || (card.dataset.dm || '').toLowerCase().includes(q) ? '' : 'none';
      });
      document.querySelectorAll('#data-model .dict-section').forEach(function(sec) {
        var anyVisible = sec.querySelector('.card:not([style*="display: none"]):not([style*="display:none"])');
        sec.style.display = !q || anyVisible ? '' : 'none';
      });
      document.querySelectorAll('.dm-entity-link').forEach(function(link) {
        var entity = (link.dataset.dmEntity || '').toLowerCase();
        var sec = document.getElementById('dm-' + link.dataset.dmEntity);
        var sectionVisible = sec && sec.style.display !== 'none';
        var show = !q || entity.includes(q) || sectionVisible;
        link.style.display = show ? '' : 'none';
        if (show && q) highlightInElement(link, q);
      });
      if (q && dmPanel) {
        document.querySelectorAll('#data-model .card:not([style*="display: none"]):not([style*="display:none"])').forEach(function(card) {
          highlightInElement(card, q);
        });
      }
    });

    // ── Vocabulary search filter ───────────────────────────────────────────────
    document.getElementById('vocab-search')?.addEventListener('input', function() {
      var q = this.value.trim().toLowerCase();
      var vocabContent = document.getElementById('vocab-content');
      var vocabNav = document.getElementById('source-nav-vocab');
      clearHighlights(vocabContent);
      clearHighlights(vocabNav);
      document.querySelectorAll('#vocab-content .card[data-dm]').forEach(function(card) {
        card.style.display = !q || (card.dataset.dm || '').toLowerCase().includes(q) ? '' : 'none';
      });
      document.querySelectorAll('#vocab-content .dict-section').forEach(function(sec) {
        var anyCard = sec.querySelector('.card:not([style*="display: none"]):not([style*="display:none"])');
        sec.style.display = !q || anyCard ? '' : 'none';
      });
      document.querySelectorAll('.vocab-entity-link').forEach(function(link) {
        var entity = (link.dataset.vocabEntity || '').toLowerCase();
        var sec = document.getElementById('vocab-' + link.dataset.vocabEntity);
        var sectionVisible = sec && sec.style.display !== 'none';
        var show = !q || entity.includes(q) || sectionVisible;
        link.style.display = show ? '' : 'none';
        if (show && q) highlightInElement(link, q);
      });
      if (q && vocabContent) {
        document.querySelectorAll('#vocab-content .card:not([style*="display: none"]):not([style*="display:none"])').forEach(function(card) {
          highlightInElement(card, q);
        });
      }
    });

    // ── JSON panel search filter ───────────────────────────────────────────────
    function filterJsonPanel(q) {
      var activePanel = document.querySelector('#debug-content .tab-panel.active');
      if (!activePanel) return;
      var tree = activePanel.querySelector('[id$="-tree"]');
      if (!tree) return;
      clearHighlights(tree);
      var items = tree.querySelectorAll(':scope > div, :scope > details');
      items.forEach(function(item) {
        var show = !q || item.textContent.toLowerCase().includes(q);
        item.style.display = show ? '' : 'none';
        if (show && q) highlightInElement(item, q);
      });
    }
    document.getElementById('json-search')?.addEventListener('input', function() {
      filterJsonPanel(this.value.trim().toLowerCase());
    });

    // ── Enum popover ──────────────────────────────────────────────────────────
    var _enumPop = null;
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.enum-open-btn');
      if (_enumPop && (!btn || _enumPop._btn === btn)) { _enumPop.remove(); _enumPop = null; return; }
      if (_enumPop) { _enumPop.remove(); _enumPop = null; }
      if (!btn) return;
      var data = JSON.parse(btn.dataset.enum || '{"enum":[],"enumDescriptions":[]}');
      var values = data.enum || [];
      var labels = data.enumDescriptions || [];
      var pop = document.createElement('div');
      pop.style.cssText = 'position:fixed;z-index:300;background:#fff;border:1px solid #e5e7eb;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);padding:8px 10px;max-height:240px;overflow-y:auto;min-width:180px;font-size:11px';
      pop.innerHTML = '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-bottom:6px">Values</div>' +
        values.map(function(v, i) {
          var l = labels[i] || '';
          return '<div style="display:flex;gap:8px;align-items:baseline;padding:2px 0">' +
            '<code style="font-size:10px;color:#374151;background:#f3f4f6;border-radius:3px;padding:1px 4px;white-space:nowrap">' + v.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</code>' +
            (l ? '<span style="font-size:10px;color:#6b7280">' + l.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>' : '') +
            '</div>';
        }).join('');
      document.body.appendChild(pop);
      pop._btn = btn;
      _enumPop = pop;
      var rect = btn.getBoundingClientRect();
      pop.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
      pop.style.top = Math.min(rect.bottom + 4, window.innerHeight - 250) + 'px';
    });

    // ── SVG node click: highlight edges + flash nav link ──────────────────────
    document.addEventListener('click', function(e) {
      var nodeEl = e.target.closest('.sg-node');
      var svg = e.target.closest('svg');
      if (!svg) return;
      var allNodes = svg.querySelectorAll('.sg-node');
      var allEdges = svg.querySelectorAll('.sg-edge');
      var panel = svg.closest('.tab-panel');
      if (!nodeEl || !svg.contains(nodeEl)) {
        allNodes.forEach(function(n) { n.style.opacity = ''; n.classList.remove('sg-selected'); });
        allEdges.forEach(function(l) { l.style.opacity = ''; l.setAttribute('stroke', '#6b7280'); l.setAttribute('stroke-width', '1.5'); });
        svg._activeNode = null;
        hideNodeDetail(panel);
        return;
      }
      var node = nodeEl.dataset.node;
      if (svg._activeNode === node) {
        allNodes.forEach(function(n) { n.style.opacity = ''; n.classList.remove('sg-selected'); });
        allEdges.forEach(function(l) { l.style.opacity = ''; l.setAttribute('stroke', '#6b7280'); l.setAttribute('stroke-width', '1.5'); });
        svg._activeNode = null;
        hideNodeDetail(panel);
        return;
      }
      svg._activeNode = node;
      allNodes.forEach(function(n) { n.classList.remove('sg-selected'); });
      nodeEl.classList.add('sg-selected');
      var connected = new Set([node]);
      allEdges.forEach(function(l) {
        if (l.dataset.from === node) connected.add(l.dataset.to);
        if (l.dataset.to === node) connected.add(l.dataset.from);
      });
      allNodes.forEach(function(n) { n.style.opacity = connected.has(n.dataset.node) ? '1' : '0.15'; });
      allEdges.forEach(function(l) {
        var isConnected = l.dataset.from === node || l.dataset.to === node;
        l.style.opacity = isConnected ? '1' : '0.1';
        l.setAttribute('stroke', isConnected ? '#2B1A78' : '#6b7280');
        l.setAttribute('stroke-width', isConnected ? '2.5' : '1.5');
      });
      // Show node detail pane
      showNodeDetail(node, panel);
    });

    // ── Instant nav tooltip ───────────────────────────────────────────────────
    (function() {
      var tip = document.createElement('div');
      tip.style.cssText = 'position:fixed;z-index:9999;background:#1e293b;color:#f1f5f9;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 8px;border-radius:4px;pointer-events:none;display:none;max-width:360px;word-break:break-all;line-height:1.4';
      document.body.appendChild(tip);
      document.addEventListener('mouseover', function(e) {
        var el = e.target.closest('[data-title]');
        if (!el) { tip.style.display = 'none'; return; }
        tip.textContent = el.dataset.title;
        tip.style.display = 'block';
      }, true);
      document.addEventListener('mouseout', function(e) {
        var el = e.target.closest('[data-title]');
        if (el) tip.style.display = 'none';
      }, true);
      document.addEventListener('mousemove', function(e) {
        if (tip.style.display === 'none') return;
        var x = e.clientX + 14, y = e.clientY + 14;
        if (x + tip.offsetWidth > window.innerWidth) x = e.clientX - tip.offsetWidth - 8;
        tip.style.left = x + 'px';
        tip.style.top  = y + 'px';
      });
    })();
  </script>
</body>
</html>`;
}

const opts = parseArgs(process.argv);
if (!opts.graphPath) {
  console.error('Usage: node src/targets/blueprint-dsl/visualize-html.js <slug> --graph <graph.json> [--project <input.json>] [--translation-log <file.json>] [--out <file.html>]');
  process.exit(1);
}

writeFileSync(opts.outFile, await render(opts));
console.log(`Wrote visualizer to ${opts.outFile}`);
