/**
 * generate-html.js
 *
 * HTML output for rules-docs pages.
 * Generates index.html and per-ruleset pages into the output directory.
 *
 * The graph visualisation reuses buildCandidateSubgraphSvg from the spike's
 * visualize-graph-html.js, with a thin adapter that converts the *-graph.yaml
 * structure into the data format those functions expect.
 *
 * The page uses a Graph / Evaluate tab layout. Clicking a node shows a detail
 * panel inline below the graph. Browser-side evaluation uses
 * window.RulesEngine.evaluateGraph exposed by the rules-engine.js IIFE —
 * no mock server required.
 */

import { writeFileSync } from 'fs';
import { join, relative } from 'path';
import { COLORS, FONT } from '../lib/theme.js';
import { esc, titleCase, breadcrumb } from '../lib/html.js';
import { singleColumnPage } from '../lib/layout.js';
import { PALETTE, MONOSPACE, box, rawSvgElement } from '../lib/diagram.js';

// ── Data adapter ──────────────────────────────────────────────────────────────
// Converts a *-graph.yaml document into the { nodes, edges, orderedLayers }
// format expected by buildCandidateSubgraphSvg (ported from spike).

function buildGraphData(graph) {
  const outputSet = new Set(graph.outputs);
  const allFactNames = Object.keys(graph.facts);
  const intermediates = allFactNames.filter(n => !outputSet.has(n));
  const outputs = [...outputSet];

  // Group inputs by top-level binding name (e.g. "$.household.members[]" → "household")
  const bindingSet = new Set();
  for (const path of Object.keys(graph.inputs)) {
    bindingSet.add(path.slice(2).split('.')[0]);
  }
  const inputNodes = [...bindingSet];

  // Build edges, deduplicating and mapping input paths to their top-level binding
  const edgeSet = new Set();
  const edges = [];
  for (const [factName, deps] of Object.entries(graph.dependencies)) {
    for (const dep of deps) {
      const from = dep.startsWith('$.') ? dep.slice(2).split('.')[0] : dep;
      const key = `${from}\u2192${factName}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ from, to: factName });
      }
    }
  }

  return {
    nodes: [...inputNodes, ...intermediates, ...outputs],
    edges,
    // Layer 0 = bottom (outputs), layer N = top (inputs) — matches spike convention
    orderedLayers: [outputs, intermediates, inputNodes],
    inputSet:  new Set(inputNodes),
    outputSet,
  };
}

// ── SVG graph ─────────────────────────────────────────────────────────────────
// Ported verbatim from spike's buildCandidateSubgraphSvg, with two changes:
//   1. nodeStyle() picks color by input/intermediate/output role
//   2. data comes from buildGraphData() above, not from Corticon subgraph builder

function buildGraphSvg(graph, markerId) {
  const { nodes, edges, orderedLayers, inputSet, outputSet } = buildGraphData(graph);
  if (!nodes?.length || !orderedLayers?.length) return '';

  const nodeStyle = n => {
    if (inputSet.has(n))  return PALETTE.teal;
    if (outputSet.has(n)) return PALETTE.navy;
    return PALETTE.amber;
  };

  const maxL = orderedLayers.length - 1;
  const CHAR_W = 7.2, H_PAD = 28, NODE_H = 44, V_GAP = 60, H_GAP = 20, MARGIN = 20;
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
    const { svg: boxSvg } = box(p.x, p.y, nodeW(n), label(n), null, [], nodeStyle(n));
    parts.push(`<g class="sg-node" data-node="${esc(n)}" title="${esc(n)}" style="cursor:pointer">${boxSvg}</g>`);
  }

  // width="100%" + height="auto" lets the SVG scale to fill its container
  // while the viewBox preserves proportions.
  const svg = rawSvgElement(markerId, svgW, svgH, parts.join('\n'));
  return svg.replace(`width="${svgW}"`, 'width="100%"').replace(`height="${svgH}"`, 'height="auto" style="display:block;"');
}

// ── Input template builder ─────────────────────────────────────────────────────
// Builds a nested JSON object from graph.inputs paths so users see the exact
// structure to fill in. Arrays → [], booleans → false, numbers → 0, strings → "".

function leafValue(type) {
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'array') return [];
  if (type === 'object') return {};
  return '';
}

function buildInputTemplate(inputs) {
  const root = {};
  for (const [path, def] of Object.entries(inputs)) {
    const parts = path.slice(2).split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i].replace(/\[\]$/, '');
      if (!cur[key]) cur[key] = {};
      cur = cur[key];
    }
    const lastKey = parts[parts.length - 1].replace(/\[\]$/, '');
    cur[lastKey] = leafValue(def?.type);
  }
  return root;
}

// ── Detail strip (full-width, between graph and columns) ──────────────────────
// Hidden by default; appears when a node is clicked.

function renderDetailStrip() {
  return `<div id="detail-strip" style="display:none;border:1px solid #e5e7eb;border-radius:6px;background:#fff;padding:16px;margin-top:8px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
    <div id="detail-strip-content" style="flex:1;min-width:0;"></div>
    <button onclick="closeDetail()" style="flex-shrink:0;background:none;border:none;color:#9ca3af;cursor:pointer;font-size:16px;line-height:1;padding:0;">✕</button>
  </div>
</div>`;
}

// ── Two-column panel: Try it (left) + Evaluate & Results (right) ──────────────

function renderBottomPanel(graph, examples) {
  const template = buildInputTemplate(graph.inputs);
  const hasExamples = examples.length > 0;
  const initialJson = hasExamples
    ? JSON.stringify(examples[0].inputs, null, 2)
    : JSON.stringify(template, null, 2);
  const textareaRows = Math.min(Math.max(initialJson.split('\n').length + 1, 6), 20);

  const examplesNav = hasExamples ? `
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
    <button onclick="loadExample(-1)" style="padding:2px 8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;line-height:1;">‹</button>
    <span id="example-label" style="font-size:11px;color:#374151;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(examples[0].description)}">${esc(examples[0].description)}</span>
    <button onclick="loadExample(1)" style="padding:2px 8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;line-height:1;">›</button>
  </div>` : '';

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #e5e7eb;border-radius:6px;margin-top:8px;background:#fafafa;">

  <div style="padding:16px;border-right:1px solid #e5e7eb;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Try it</div>
      <button onclick="runEval()" style="padding:3px 10px;background:#2B1A78;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Evaluate</button>
    </div>
    ${examplesNav}
    <textarea id="eval-inputs" rows="${textareaRows}"
      style="width:100%;font-family:${MONOSPACE};font-size:11px;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;resize:vertical;background:#fff;box-sizing:border-box;"
      oninput="scheduleEval()">${esc(initialJson)}</textarea>
  </div>

  <div style="padding:16px;">
    <div style="margin-bottom:8px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Results</div>
    </div>
    <div id="eval-errors" style="margin-bottom:6px;font-size:10px;color:#991b1b;font-family:${MONOSPACE};display:none;white-space:pre-wrap;"></div>
    <pre id="eval-results-body" style="font-family:${MONOSPACE};font-size:10.5px;background:#f3f4f6;padding:8px 10px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:#9ca3af;margin:0;">Evaluate to see results.</pre>
  </div>

</div>`;
}

// ── Page shell ────────────────────────────────────────────────────────────────

function shell(title, body, hubHref) {
  return singleColumnPage({
    title: `${title} — Rules Docs`,
    breadcrumbs: [
      { label: 'Explorer',   href: hubHref },
      { label: 'Rules Docs', href: 'index.html' },
      { label: title },
    ],
    bodyHtml: `<script src="rules-engine.js"></script>\n<div style="max-width:1100px;margin:0 auto;padding:2.5rem 1.5rem 4rem;">${body}</div>`,
  });
}

// ── Legend ────────────────────────────────────────────────────────────────────

function legendHtml() {
  const items = [
    { style: PALETTE.teal,  label: 'Input' },
    { style: PALETTE.amber, label: 'Intermediate fact' },
    { style: PALETTE.navy,  label: 'Output' },
  ];
  return `<div style="display:flex;gap:16px;margin-bottom:12px;align-items:center;">
  ${items.map(({ style, label }) =>
    `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#374151;">
      <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${style.fill};border:1.5px solid ${style.stroke};"></span>${esc(label)}
    </span>`
  ).join('')}
  <span style="font-size:11px;color:#9ca3af;margin-left:8px;">Click a node to see its expression and annotations</span>
</div>`;
}

// ── Per-ruleset page ──────────────────────────────────────────────────────────

export function generateRulesetHtml(graph, annotations, policies, examples, rulesetInputs, opts) {
  const { hubHref } = opts;
  const rulesetName = graph.ruleset;
  const domainBadge = `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:100px;background:#E6EBF9;color:#2B1A78;border:1px solid #C2C0E8;margin-left:8px;">${esc(graph.domain)}</span>`;

  const svgHtml = buildGraphSvg(graph, `arrow-${rulesetName}`);
  const detailStripHtml = renderDetailStrip();
  const bottomHtml = renderBottomPanel(graph, examples);

  // Serialize graph + annotations + examples + ruleset inputs schema for inline JS
  const graphJson = JSON.stringify(graph);
  const annotJson = JSON.stringify(annotations);
  const policiesJson = JSON.stringify(policies);
  const examplesJson = JSON.stringify(examples);
  const rulesetInputsJson = JSON.stringify(rulesetInputs);

  const body = `
<div style="margin-bottom:1.5rem">
  <h1 style="font-size:1.25rem;font-weight:800;color:#111827;display:inline">${esc(rulesetName)}</h1>${domainBadge}
  <div style="font-size:12px;color:#6b7280;margin-top:4px;">${esc(graph.facts ? Object.keys(graph.facts).length : 0)} facts &middot; ${esc(graph.outputs?.length ?? 0)} outputs &middot; ${esc(Object.keys(graph.inputs ?? {}).length)} inputs</div>
</div>

${legendHtml()}
<div style="border:1px solid #e5e7eb;border-radius:6px;background:#fff;padding:16px;">
  ${svgHtml}
</div>
${detailStripHtml}
${bottomHtml}

<script>
const GRAPH = ${graphJson};
const ANNOTATIONS = ${annotJson};
const POLICIES = ${policiesJson};
const EXAMPLES = ${examplesJson};
const RULESET_INPUTS = ${rulesetInputsJson};
let exampleIndex = 0;

function loadExample(delta) {
  if (!EXAMPLES.length) return;
  exampleIndex = (exampleIndex + delta + EXAMPLES.length) % EXAMPLES.length;
  const ex = EXAMPLES[exampleIndex];
  document.getElementById('eval-inputs').value = JSON.stringify(ex.inputs, null, 2);
  const label = document.getElementById('example-label');
  if (label) { label.textContent = ex.description; label.title = ex.description; }
  runEval();
}

// ── Click-to-highlight (ported from spike's visualize-graph-html.js) ──────────
// Clicking a node dims unconnected nodes/edges, highlights connected ones,
// adds a selection ring, and scrolls to the corresponding row in the bottom panel.
function resetHighlight(svg) {
  svg.querySelectorAll('.sg-node').forEach(n => {
    n.style.opacity = '';
    const ring = n.querySelector('.sg-selected-ring');
    if (ring) ring.remove();
  });
  svg.querySelectorAll('.sg-edge').forEach(l => {
    l.style.opacity = ''; l.setAttribute('stroke', '#6b7280'); l.setAttribute('stroke-width', '1.5');
  });
  svg._activeNode = null;
  closeDetail();
}

document.addEventListener('click', function (e) {
  const nodeEl = e.target.closest('.sg-node');
  const svg = e.target.closest('svg');
  if (!svg) return;
  const allNodes = svg.querySelectorAll('.sg-node');
  const allEdges = svg.querySelectorAll('.sg-edge');
  if (!nodeEl || !svg.contains(nodeEl)) { resetHighlight(svg); return; }
  const node = nodeEl.dataset.node;
  if (svg._activeNode === node) { resetHighlight(svg); return; }

  svg.querySelectorAll('.sg-selected-ring').forEach(r => r.remove());
  svg._activeNode = node;
  const connected = new Set([node]);
  allEdges.forEach(l => {
    if (l.dataset.from === node) connected.add(l.dataset.to);
    if (l.dataset.to === node) connected.add(l.dataset.from);
  });
  allNodes.forEach(n => {
    const isActive = n.dataset.node === node;
    n.style.opacity = connected.has(n.dataset.node) ? '1' : '0.15';
    if (isActive) {
      const rect = n.querySelector('rect');
      if (rect) {
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        ring.setAttribute('x', parseFloat(rect.getAttribute('x')) - 3);
        ring.setAttribute('y', parseFloat(rect.getAttribute('y')) - 3);
        ring.setAttribute('width', parseFloat(rect.getAttribute('width')) + 6);
        ring.setAttribute('height', parseFloat(rect.getAttribute('height')) + 6);
        ring.setAttribute('rx', parseFloat(rect.getAttribute('rx') || 0) + 2);
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#2B1A78');
        ring.setAttribute('stroke-width', '2.5');
        ring.setAttribute('stroke-dasharray', '4 2');
        ring.classList.add('sg-selected-ring');
        n.insertBefore(ring, n.firstChild);
      }
    }
  });
  allEdges.forEach(l => {
    const hit = l.dataset.from === node || l.dataset.to === node;
    l.style.opacity = hit ? '1' : '0.1';
    l.setAttribute('stroke', hit ? '#2B1A78' : '#6b7280');
    l.setAttribute('stroke-width', hit ? '2.5' : '1.5');
  });
  showDetail(node);
});

function closeDetail() {
  document.getElementById('detail-strip').style.display = 'none';
  activeNode = null;
}

// ── Detail strip ──────────────────────────────────────────────────────────────
// Full-width strip between graph and columns. Shows on node click, hides on
// close button or clicking empty graph area.
let lastResult = null;
let activeNode = null;

function showDetail(nodeName) {
  activeNode = nodeName;
  const strip = document.getElementById('detail-strip');
  const panel = document.getElementById('detail-strip-content');
  const outputSet = new Set(GRAPH.outputs);
  const fact = GRAPH.facts[nodeName];
  const annot = ANNOTATIONS[nodeName];
  const isInput = !fact;
  const isOutput = outputSet.has(nodeName);
  const role = isInput ? 'Input' : isOutput ? 'Output' : 'Intermediate fact';
  const roleColor = isInput ? '#00AD93' : isOutput ? '#2B1A78' : '#E65100';

  let html = '<div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:3px;font-family:ui-monospace,monospace">' + escHtml(nodeName) + '</div>';
  html += '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:' + roleColor + ';margin-bottom:10px;">' + role + '</div>';

  // Computed value (if we have a result)
  if (!isInput && lastResult) {
    const allFacts = Object.assign({}, lastResult.complete, lastResult.placeholder);
    const val = allFacts[nodeName];
    if (val !== undefined) {
      html += '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">Current value</div>';
      html += '<code style="display:block;font-size:11px;padding:6px 8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:3px;word-break:break-all;margin-bottom:10px;font-family:ui-monospace,monospace;color:#166534;">' + escHtml(JSON.stringify(val)) + '</code>';
    } else {
      html += '<div style="font-size:10px;color:#9ca3af;margin-bottom:10px;font-style:italic;">Could not evaluate — check inputs.</div>';
    }
  }

  if (isInput) {
    const paths = Object.entries(GRAPH.inputs).filter(([p]) => p.slice(2).split('.')[0] === nodeName);
    html += '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">Paths</div>';
    html += '<ul style="margin:0 0 10px;padding-left:14px;">' + paths.map(([p, def]) =>
      '<li style="font-size:10.5px;font-family:ui-monospace,monospace;color:#374151;margin-bottom:3px;">' + escHtml(p) +
      (def?.type ? ' <span style="color:#9ca3af;">(' + escHtml(def.type) + ')</span>' : '') +
      (def?.description ? '<br><span style="font-size:10px;color:#9ca3af;">' + escHtml(def.description) + '</span>' : '') +
      '</li>'
    ).join('') + '</ul>';
  }

  if (fact?.description) {
    html += '<div style="font-size:11px;color:#374151;margin-bottom:10px;">' + escHtml(fact.description.trim()) + '</div>';
  }

  if (fact?.expression) {
    html += '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">Expression</div>';
    html += '<code style="display:block;font-size:10.5px;padding:6px 8px;background:#f3f4f6;border-radius:3px;word-break:break-all;margin-bottom:10px;font-family:ui-monospace,monospace;">' + escHtml(fact.expression) + '</code>';
  }

  if (annot?.reason) {
    html += '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">Why</div>';
    html += '<div style="font-size:11px;color:#374151;margin-bottom:10px;">' + escHtml(annot.reason.trim()) + '</div>';
  }

  if (annot?.policies?.length) {
    html += '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">Policy</div>';
    html += '<div style="margin-bottom:10px;">' + annot.policies.map(id => {
      const p = POLICIES[id];
      return '<span title="' + escHtml(p?.description ?? id) + '" style="display:inline-block;font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;background:#E6EBF9;color:#2B1A78;border:1px solid #C2C0E8;margin-right:4px;margin-bottom:4px;">' + escHtml(p?.citation ?? id) + '</span>';
    }).join('') + '</div>';
  }

  if (annot?.interviewQuestions?.length) {
    html += '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">Interview Questions</div>';
    html += '<ul style="margin:0;padding-left:14px;">' + annot.interviewQuestions.map(q =>
      '<li style="font-size:11px;color:#374151;margin-bottom:4px;">' + escHtml(q) + '</li>'
    ).join('') + '</ul>';
  }

  panel.innerHTML = html;
  strip.style.display = '';
}

// ── Auto-evaluate with debounce ────────────────────────────────────────────────
// The textarea holds a single JSON object whose top-level keys are the binding
// names (e.g. { household: {...}, program: {...} }). evaluateGraph receives this
// directly. After evaluation, refreshes the left panel if a node is selected.
let evalTimer;
function scheduleEval() {
  clearTimeout(evalTimer);
  evalTimer = setTimeout(runEval, 350);
}

// Apply ruleset input schema defaults for any namespace absent from userInputs.
// Returns { scope, defaultedNamespaces } mirroring evaluate()'s behavior.
function applyDefaults(userInputs) {
  const scope = Object.assign({}, userInputs);
  const defaultedNamespaces = new Set();
  for (const [ns, schema] of Object.entries(RULESET_INPUTS)) {
    if (userInputs[ns] !== undefined) continue;
    if (schema.type !== 'object') continue;
    const defaults = {};
    for (const [prop, propSchema] of Object.entries(schema.properties ?? {})) {
      if (propSchema.default !== undefined) defaults[prop] = propSchema.default;
    }
    if (Object.keys(defaults).length > 0) {
      scope[ns] = defaults;
      defaultedNamespaces.add(ns);
    }
  }
  return { scope, defaultedNamespaces };
}

// Walk the dependency graph to find which output facts transitively depend on
// any of the defaulted namespaces, then move them from complete → placeholder.
function reclassifyPlaceholders(result, defaultedNamespaces) {
  if (!defaultedNamespaces.size) return result;
  const deps = GRAPH.dependencies;

  function touchesDefault(factName, visited = new Set()) {
    if (visited.has(factName)) return false;
    visited.add(factName);
    for (const dep of (deps[factName] ?? [])) {
      if (dep.startsWith('$.')) {
        const ns = dep.slice(2).split('.')[0];
        if (defaultedNamespaces.has(ns)) return true;
      } else if (touchesDefault(dep, visited)) {
        return true;
      }
    }
    return false;
  }

  const complete = Object.assign({}, result.complete);
  const placeholder = Object.assign({}, result.placeholder);
  for (const name of Object.keys(complete)) {
    if (touchesDefault(name)) {
      placeholder[name] = complete[name];
      delete complete[name];
    }
  }
  return { ...result, complete, placeholder };
}

function runEval() {
  if (!window.RulesEngine) return;
  const errEl = document.getElementById('eval-errors');
  const raw = (document.getElementById('eval-inputs')?.value ?? '').trim();
  if (!raw) return;
  let userInputs;
  try { userInputs = JSON.parse(raw); } catch (e) {
    errEl.textContent = 'Invalid JSON: ' + e.message;
    errEl.style.display = 'block';
    return;
  }
  try {
    const { scope, defaultedNamespaces } = applyDefaults(userInputs);
    const raw = window.RulesEngine.evaluateGraph(GRAPH, scope);
    lastResult = reclassifyPlaceholders(raw, defaultedNamespaces);
    errEl.style.display = 'none';
    const pre = document.getElementById('eval-results-body');
    pre.style.color = '#111827';
    pre.textContent = JSON.stringify(lastResult, null, 2);
    if (activeNode) showDetail(activeNode);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

if (EXAMPLES.length) { loadExample(0); } else { runEval(); }
</script>`;

  return shell(rulesetName, body, hubHref);
}

// ── Index page ────────────────────────────────────────────────────────────────

export function generateIndexHtml(rulesets, outputDir, hubHref) {
  const rows = rulesets.map(({ domain, rulesetName, slug }) =>
    `<tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px 16px 8px 0;font-family:${MONOSPACE};font-size:13px;font-weight:700;color:#2B1A78;">
        <a href="${esc(slug)}.html" style="color:inherit;text-decoration:none;">${esc(rulesetName)}</a>
      </td>
      <td style="padding:8px 0;font-size:12px;color:#6b7280;">${esc(domain)}</td>
    </tr>`
  ).join('');

  const body = `
<h1 style="font-size:1.25rem;font-weight:800;color:#111827;margin-bottom:1.5rem">Rules Docs</h1>
<table style="width:100%;border-collapse:collapse">
  <thead>
    <tr>
      <th style="padding:6px 16px 4px 0;font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;text-align:left">Ruleset</th>
      <th style="padding:6px 0 4px;font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;text-align:left">Domain</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;

  const html = shell('Rules Docs', body, hubHref);
  writeFileSync(join(outputDir, 'index.html'), html);
}
