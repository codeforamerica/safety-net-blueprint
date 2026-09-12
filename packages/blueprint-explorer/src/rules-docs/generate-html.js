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
 * Each ruleset page has a browse/experiment panel below the graph. Browse mode
 * shows example inputs (read-only, navigable); "Try it" unlocks the textarea for
 * live experimentation. Browser-side evaluation uses window.RulesEngine.toGraph
 * exposed by the rules-engine.js IIFE — no mock server required.
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

// ── Two-column panel: Inputs (left) + Outputs (right) ─────────────────────────
// Browse mode (default): textarea is read-only, example nav is visible.
// Experiment mode: "Try it" unlocks textarea (pre-seeded with current example),
//   hides nav, and changes the button to "Reset".
// "Reset" restores the current example, re-locks the textarea, and re-enables nav.

function renderBottomPanel(graph, examples) {
  const template = buildInputTemplate(graph.inputs);
  const hasExamples = examples.length > 0;
  const initialJson = hasExamples
    ? JSON.stringify(examples[0].inputs, null, 2)
    : JSON.stringify(template, null, 2);
  const textareaRows = Math.min(Math.max(initialJson.split('\n').length + 1, 6), 20);
  const examplesNav = hasExamples ? `
  <div id="example-nav" style="display:flex;align-items:flex-start;gap:6px;margin-bottom:8px;">
    <button onclick="loadExample(-1)" style="flex-shrink:0;padding:2px 8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;line-height:1;margin-top:1px;">‹</button>
    <span id="example-label" style="font-size:11px;color:#374151;flex:1;">${esc(examples[0].description)}</span>
    <button onclick="loadExample(1)" style="flex-shrink:0;padding:2px 8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;line-height:1;margin-top:1px;">›</button>
  </div>` : '';

  const tryItBtn = hasExamples
    ? `<button id="experiment-btn" onclick="toggleExperimentMode()" style="padding:3px 10px;background:none;color:#2B1A78;border:1px solid #2B1A78;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Try it</button>`
    : '';

  const textareaStyle = `width:100%;font-family:${MONOSPACE};font-size:11px;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;resize:vertical;box-sizing:border-box;`;
  const lockedStyle  = `${textareaStyle}background:#f9fafb;color:#374151;`;
  const initialStyle = hasExamples ? lockedStyle : `${textareaStyle}background:#fff;`;

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #e5e7eb;border-radius:6px;margin-top:8px;background:#fafafa;">

  <div style="padding:16px;border-right:1px solid #e5e7eb;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Inputs</div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button id="evaluate-btn" onclick="runEval()" style="display:none;padding:3px 10px;background:#2B1A78;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Evaluate</button>
        ${tryItBtn}
      </div>
    </div>
    ${examplesNav}
    <textarea id="eval-inputs" rows="${textareaRows}"
      style="${initialStyle}"
      ${hasExamples ? 'readonly' : ''}>${esc(initialJson)}</textarea>
  </div>

  <div style="padding:16px;">
    <div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">Outputs</div>
    <div id="eval-errors" style="margin-bottom:6px;font-size:10px;color:#991b1b;font-family:${MONOSPACE};display:none;white-space:pre-wrap;"></div>
    <div id="eval-results-body" style="font-family:${MONOSPACE};font-size:10.5px;color:#9ca3af;">Evaluating…</div>
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
let isExperimentMode = !EXAMPLES.length; // start unlocked when no examples

function loadExample(delta) {
  if (!EXAMPLES.length || isExperimentMode) return;
  exampleIndex = (exampleIndex + delta + EXAMPLES.length) % EXAMPLES.length;
  const ex = EXAMPLES[exampleIndex];
  document.getElementById('eval-inputs').value = JSON.stringify(ex.inputs, null, 2);
  const label = document.getElementById('example-label');
  if (label) { label.textContent = ex.description; label.title = ex.description; }
  runEval();
}

function toggleExperimentMode() {
  if (isExperimentMode) { resetToExample(); } else { enterExperimentMode(); }
}

function experimentEls() {
  return {
    textarea:    document.getElementById('eval-inputs'),
    nav:         document.getElementById('example-nav'),
    btn:         document.getElementById('experiment-btn'),
    evaluateBtn: document.getElementById('evaluate-btn'),
  };
}

function enterExperimentMode() {
  isExperimentMode = true;
  const { textarea, nav, btn, evaluateBtn } = experimentEls();
  textarea.removeAttribute('readonly');
  textarea.style.background    = '#fff';
  textarea.style.borderColor   = '#2B1A78';
  if (nav)         nav.style.display         = 'none';
  if (btn)         btn.textContent            = 'Reset';
  if (evaluateBtn) evaluateBtn.style.display  = '';
}

function resetToExample() {
  isExperimentMode = false;
  const { textarea, nav, btn, evaluateBtn } = experimentEls();
  if (EXAMPLES.length) {
    const ex = EXAMPLES[exampleIndex];
    textarea.value = JSON.stringify(ex.inputs, null, 2);
    const label = document.getElementById('example-label');
    if (label) { label.textContent = ex.description; label.title = ex.description; }
  }
  textarea.setAttribute('readonly', '');
  textarea.style.background  = '#f9fafb';
  textarea.style.borderColor = '#d1d5db';
  if (nav)         nav.style.display        = '';
  if (btn)         btn.textContent          = 'Try it';
  if (evaluateBtn) evaluateBtn.style.display = 'none';
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

  // Build transitive connected set via two separate passes:
  // upstream (toward inputs) and downstream (toward outputs).
  // Mixing directions in one BFS causes household's descendants to fan out incorrectly.
  const upstream = new Set([node]);
  const upQueue = [node];
  while (upQueue.length) {
    const cur = upQueue.shift();
    allEdges.forEach(l => {
      if (l.dataset.to === cur && !upstream.has(l.dataset.from)) { upstream.add(l.dataset.from); upQueue.push(l.dataset.from); }
    });
  }
  const downstream = new Set([node]);
  const downQueue = [node];
  while (downQueue.length) {
    const cur = downQueue.shift();
    allEdges.forEach(l => {
      if (l.dataset.from === cur && !downstream.has(l.dataset.to)) { downstream.add(l.dataset.to); downQueue.push(l.dataset.to); }
    });
  }
  const connected = new Set([...upstream, ...downstream]);

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
    const hit = connected.has(l.dataset.from) && connected.has(l.dataset.to);
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
let lastNodes = null; // plain { factName: { type, state, value, ... } } map
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
  const isIntermediate = !isInput && !isOutput;
  const role = isInput ? 'Input' : isOutput ? 'Output' : 'Intermediate fact';
  const roleColor = isInput ? '#00AD93' : isOutput ? '#2B1A78' : '#E65100';

  let html = '<div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:3px;font-family:ui-monospace,monospace">' + escHtml(nodeName) + '</div>';
  html += '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:' + roleColor + ';margin-bottom:10px;">' + role + '</div>';

  // Current value — only for intermediate facts (outputs shown in panel, inputs have no computed value)
  if (isIntermediate && lastNodes) {
    const node = lastNodes[nodeName];
    if (node && (node.state === 'complete' || node.state === 'placeholder')) {
      const stateLabel = node.state === 'placeholder' ? ' <span style="font-size:9px;font-weight:600;color:#92400e;background:#fef3c7;padding:1px 4px;border-radius:2px;margin-left:4px;">placeholder</span>' : '';
      html += '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;">Current value' + stateLabel + '</div>';
      html += '<code style="display:block;font-size:11px;padding:6px 8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:3px;word-break:break-all;margin-bottom:10px;font-family:ui-monospace,monospace;color:#166534;">' + escHtml(JSON.stringify(node.value)) + '</code>';
    } else if (node?.state === 'error') {
      html += '<div style="font-size:10px;color:#991b1b;margin-bottom:10px;font-style:italic;">Error: ' + escHtml(node.message) + '</div>';
    } else if (node?.state === 'missing') {
      html += '<div style="font-size:10px;color:#9ca3af;margin-bottom:10px;font-style:italic;">Missing inputs: ' + escHtml((node.missing ?? []).join(', ')) + '</div>';
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

// Apply ruleset input schema defaults for any namespace absent from userInputs.
// Returns { scope, defaultedNamespaces } mirroring toGraph(rulesDoc).evaluate() behavior.
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

// Walk the dependency graph to find facts that transitively depend on any
// defaulted namespace and promote them from complete → placeholder.
function reclassifyPlaceholders(nodes, defaultedNamespaces) {
  if (!defaultedNamespaces.size) return nodes;
  const deps = GRAPH.dependencies;

  function touchesDefault(factName, visited = new Set()) {
    if (visited.has(factName)) return false;
    visited.add(factName);
    for (const dep of (deps[factName] ?? [])) {
      if (dep.startsWith('$.')) {
        if (defaultedNamespaces.has(dep.slice(2).split('.')[0])) return true;
      } else if (touchesDefault(dep, visited)) {
        return true;
      }
    }
    return false;
  }

  const result = Object.assign({}, nodes);
  for (const name of Object.keys(result)) {
    if (result[name].state === 'complete' && touchesDefault(name)) {
      result[name] = Object.assign({}, result[name], { state: 'placeholder' });
    }
  }
  return result;
}

// Render output facts into the results panel.
// prevNodes (optional): previous eval result — rows whose value changed get a flash highlight.
function renderOutputs(nodes, prevNodes) {
  const el = document.getElementById('eval-results-body');
  if (!nodes) { el.textContent = 'Evaluating\u2026'; el.style.color = '#9ca3af'; return; }
  const outputEntries = GRAPH.outputs.map(name => [name, nodes[name]]).filter(([, node]) => node);
  if (!outputEntries.length) { el.textContent = 'No outputs.'; el.style.color = '#9ca3af'; return; }
  const rows = outputEntries.map(([name, node]) => {
    const stateColor = node.state === 'complete' ? '#111827' : node.state === 'placeholder' ? '#92400e' : node.state === 'error' ? '#991b1b' : '#9ca3af';
    const indicator  = node.state === 'complete' ? '\u25cf' : node.state === 'placeholder' ? '\u25d0' : node.state === 'error' ? '\u2715' : '\u25cb';
    const valueStr   = node.state === 'error' ? node.message : node.state === 'missing' ? 'missing' : JSON.stringify(node.value);
    return '<div data-name="' + escHtml(name) + '" style="padding:4px 0;border-bottom:1px solid #f3f4f6;">'
      + '<div style="color:#374151;margin-bottom:1px;">' + escHtml(name) + '</div>'
      + '<div style="color:' + stateColor + ';word-break:break-word;">' + indicator + ' ' + escHtml(valueStr) + '</div>'
      + '</div>';
  });
  el.innerHTML = rows.join('');
  el.style.color = '#111827';

  // Flash rows whose value changed since the previous eval
  if (prevNodes) {
    for (const [name, node] of outputEntries) {
      const prev = prevNodes[name];
      if (!prev || prev.state !== node.state || JSON.stringify(prev.value) !== JSON.stringify(node.value)) {
        const row = el.querySelector('[data-name="' + name + '"]');
        if (row) flashHighlight(row);
      }
    }
  }
}

function flashHighlight(el) {
  el.style.transition = 'none';
  el.style.background = '#fef9c3';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transition = 'background 1.5s ease-out';
    el.style.background = '';
  }));
}

function runEval() {
  if (!window.RulesEngine) return;
  const errEl = document.getElementById('eval-errors');
  const inputVal = (document.getElementById('eval-inputs')?.value ?? '').trim();
  if (!inputVal) return;
  let userInputs;
  try { userInputs = JSON.parse(inputVal); } catch (e) {
    errEl.textContent = 'Invalid JSON: ' + e.message;
    errEl.style.display = 'block';
    return;
  }
  try {
    const { scope, defaultedNamespaces } = applyDefaults(userInputs);
    const result = window.RulesEngine.toGraph(GRAPH).evaluate(scope);
    const prevNodes = lastNodes;
    lastNodes = reclassifyPlaceholders(result.toJSON(), defaultedNamespaces);
    errEl.style.display = 'none';
    renderOutputs(lastNodes, prevNodes);
    if (activeNode) showDetail(activeNode);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

runEval();
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
