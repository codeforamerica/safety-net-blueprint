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
 * live experimentation. Browser-side evaluation uses window.RulesEngine.evaluate
 * exposed by the rules-engine.js IIFE — no mock server required.
 */

import { writeFileSync } from 'fs';
import { join, relative } from 'path';
import { COLORS, FONT } from '../lib/theme.js';
import { esc, titleCase, breadcrumb, apiReferenceLink, apiReferenceHref } from '../lib/html.js';
import { singleColumnPage } from '../lib/layout.js';
import { PALETTE, MONOSPACE, box, rawSvgElement } from '../lib/diagram.js';

const ZOOM_BUTTON = 'font:inherit;font-size:12px;min-width:28px;height:26px;padding:0 8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;color:#374151;cursor:pointer;';

// ── Data adapter ──────────────────────────────────────────────────────────────
// Converts a *-graph.yaml document into nodes and what each one reads: inputs
// grouped by their top-level binding ("$.household.members[]" → "household"),
// the ruleset's constants as one node, then every fact.
//
// A graph records no dependency on a constant — constants are bound values,
// not inputs or facts — so a fact reads the constants node when its
// expression names `constants.`.

/** The node a ruleset's constants share; no input or fact can take the name. */
export const CONSTANTS_NODE = 'constants';

function buildGraphData(graph) {
  const outputSet = new Set(graph.outputs);
  const hasConstants = Object.keys(graph.constants ?? {}).length > 0;
  const inputNodes = [
    ...new Set(Object.keys(graph.inputs).map(path => path.slice(2).split('.')[0])),
    ...(hasConstants ? [CONSTANTS_NODE] : []),
  ];
  const reads = {};
  for (const [factName, fact] of Object.entries(graph.facts)) {
    const deps = graph.dependencies[factName] ?? [];
    const from = [...new Set(deps.map(dep => dep.startsWith('$.') ? dep.slice(2).split('.')[0] : dep))]
      .filter(dep => dep !== factName);
    if (hasConstants && /(^|[^A-Za-z0-9_.])constants\./.test(fact?.expression ?? '')) from.push(CONSTANTS_NODE);
    if (from.length) reads[factName] = from;
  }
  return {
    nodes: [...inputNodes, ...Object.keys(graph.facts)],
    reads,
    inputNodes,
    inputSet: new Set(inputNodes),
    outputSet,
  };
}

// ── Layout ────────────────────────────────────────────────────────────────────
// On its side: inputs in the first column, every fact one column right of the
// furthest thing it reads (its longest path from an input), each node as level
// with what it reads as its neighbors allow, and each line from the right edge
// of what is read to the left edge of what reads it.
//
// These two functions are also written into the page, so the per-output view
// lays out a subset the same way the build laid out the whole. They take plain
// objects and use no template strings, so their source can be inlined as is.

function graphLayout(nodes, reads, inputs, widths) {
  var NODE_H = 44, V_GAP = 16, COL_GAP = 90, MARGIN = 20, STEP = NODE_H + V_GAP;
  var present = {};
  nodes.forEach(function (n) { present[n] = true; });
  var readsOf = function (n) { return (reads[n] || []).filter(function (m) { return present[m]; }); };

  // Column = longest path from an input. Validation refuses cycles; `visiting`
  // only keeps a malformed graph from recursing forever.
  var column = {}, visiting = {};
  inputs.forEach(function (n) { if (present[n]) column[n] = 0; });
  function columnOf(n) {
    if (column[n] !== undefined) return column[n];
    if (visiting[n]) return 0;
    visiting[n] = true;
    var from = readsOf(n);
    var c = from.length ? 1 + Math.max.apply(null, from.map(columnOf)) : 1;
    delete visiting[n];
    column[n] = c;
    return c;
  }
  nodes.forEach(columnOf);
  var columns = [];
  nodes.forEach(function (n) { (columns[column[n]] = columns[column[n]] || []).push(n); });
  columns = columns.filter(Boolean);

  // x: each column as wide as its widest node.
  var colX = [], x = MARGIN;
  columns.forEach(function (col) {
    colX.push(x);
    x += Math.max.apply(null, col.map(function (n) { return widths[n]; })) + COL_GAP;
  });

  // y: each node as near as it can get to the middle of what it reads, pushed
  // down past the one above, then the column shifted back by its average push.
  var centerY = {};
  columns.forEach(function (col) {
    var wanted = col.map(function (n, i) {
      var from = readsOf(n).filter(function (m) { return centerY[m] !== undefined; });
      var y = from.length ? from.reduce(function (sum, m) { return sum + centerY[m]; }, 0) / from.length : i * STEP;
      return { n: n, y: y };
    }).sort(function (a, b) { return a.y - b.y; });
    var last = -Infinity;
    var placed = wanted.map(function (w) { var at = Math.max(w.y, last + STEP); last = at; return { n: w.n, at: at, y: w.y }; });
    var drift = placed.reduce(function (sum, p) { return sum + (p.at - p.y); }, 0) / placed.length;
    placed.forEach(function (p) { centerY[p.n] = p.at - drift; });
  });
  var top = Math.min.apply(null, Object.keys(centerY).map(function (n) { return centerY[n]; })) - NODE_H / 2;
  var pos = {}, bottom = 0;
  columns.forEach(function (col, c) {
    col.forEach(function (n) {
      pos[n] = { x: colX[c], y: centerY[n] - NODE_H / 2 - top + MARGIN };
      bottom = Math.max(bottom, pos[n].y + NODE_H);
    });
  });
  return { pos: pos, width: x - COL_GAP + MARGIN, height: bottom + MARGIN };
}

function graphEdgePath(from, to, pos, widths) {
  var NODE_H = 44;
  var x1 = pos[from].x + widths[from], y1 = pos[from].y + NODE_H / 2;
  var x2 = pos[to].x - 2, y2 = pos[to].y + NODE_H / 2;
  var bend = Math.max(24, (x2 - x1) / 2);
  return 'M' + x1 + ',' + y1 + ' C' + (x1 + bend) + ',' + y1 + ' ' + (x2 - bend) + ',' + y2 + ' ' + x2 + ',' + y2;
}

// ── SVG graph ─────────────────────────────────────────────────────────────────
// Each node carries where the build put it and its width, so the per-output
// view can move it, and each line has an arrowhead. The SVG fills a viewport the
// page zooms and pans (see the script below), so a large ruleset stays readable.

const CHAR_W = 7.2, H_PAD = 28;

function nodeWidths(nodes) {
  const shortOf = n => n.split('.').slice(-2).join('.');
  const shortCounts = new Map();
  for (const n of nodes) shortCounts.set(shortOf(n), (shortCounts.get(shortOf(n)) ?? 0) + 1);
  const labels = {}, widths = {};
  for (const n of nodes) {
    labels[n] = shortCounts.get(shortOf(n)) === 1 ? shortOf(n) : n;
    widths[n] = Math.max(140, Math.ceil(labels[n].length * CHAR_W) + H_PAD);
  }
  return { labels, widths };
}

function buildGraphSvg(graph, markerId) {
  const { nodes, reads, inputNodes, inputSet, outputSet } = buildGraphData(graph);
  if (!nodes?.length) return '';

  const nodeStyle = n => {
    if (n === CONSTANTS_NODE && graph.constants) return PALETTE.purple;
    if (inputSet.has(n))  return PALETTE.teal;
    if (outputSet.has(n)) return PALETTE.navy;
    return PALETTE.amber;
  };

  const { labels, widths } = nodeWidths(nodes);
  const { pos, width, height } = graphLayout(nodes, reads, inputNodes, widths);

  const parts = [];
  for (const [to, froms] of Object.entries(reads)) {
    for (const from of froms) {
      if (!pos[from] || !pos[to]) continue;
      parts.push(`<path class="sg-edge" data-from="${esc(from)}" data-to="${esc(to)}" d="${graphEdgePath(from, to, pos, widths)}" fill="none" stroke="#6b7280" stroke-width="1.5" marker-end="url(#arrow)"/>`);
    }
  }
  for (const n of nodes) {
    const p = pos[n]; if (!p) continue;
    const { svg: boxSvg } = box(p.x, p.y, widths[n], labels[n], null, [], nodeStyle(n));
    parts.push(`<g class="sg-node" data-node="${esc(n)}" data-x="${p.x}" data-y="${p.y}" title="${esc(n)}" style="cursor:pointer">${boxSvg}</g>`);
  }

  // The viewport script sets the viewBox; the SVG fills the viewport.
  const svg = rawSvgElement(markerId, width, height, parts.join('\n'));
  return svg
    .replace(`width="${width}"`, `width="100%" data-graph-width="${width}"`)
    .replace(`height="${height}"`, `height="100%" data-graph-height="${height}" preserveAspectRatio="xMidYMid meet" style="display:block;"`);
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
        <button id="evaluate-btn" onclick="runEval()" style="display:${hasExamples ? 'none' : 'inline-block'};padding:3px 10px;background:#2B1A78;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Evaluate</button>
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
    extraStyle: `.ann-chip { display:inline-block; font-size:10px; font-weight:600; padding:2px 6px; border-radius:3px; background:#E6EBF9; color:#2B1A78; border:1px solid #C2C0E8; margin-right:4px; margin-bottom:4px; text-decoration:none; } .ann-chip:hover { background:#d4daf5; }`,
  });
}

// ── Legend ────────────────────────────────────────────────────────────────────

function legendHtml(hasConstants) {
  const items = [
    { style: PALETTE.teal,  label: 'Input' },
    ...(hasConstants ? [{ style: PALETTE.purple, label: 'Constants' }] : []),
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

export function generateRulesetHtml(graph, annotations, registries, examples, rulesetInputs, opts) {
  const { hubHref, endpointInfo, registryTypes = new Set(), constantAnnotations = {} } = opts;
  const rulesetName = graph.ruleset;
  const domainBadge = `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:100px;background:#E6EBF9;color:#2B1A78;border:1px solid #C2C0E8;margin-left:8px;">${esc(graph.domain)}</span>`;

  let apiLinkHtml = '';
  if (endpointInfo) {
    const { path, method, page = graph.domain } = endpointInfo;
    apiLinkHtml = apiReferenceLink(apiReferenceHref(page, method, path), 'API endpoint →', 'font-size:11px;border-radius:4px;padding:2px 8px;margin-left:10px;');
  }

  const svgHtml = buildGraphSvg(graph, `arrow-${rulesetName}`);
  const graphData = buildGraphData(graph);
  const graphLayoutJson = JSON.stringify({
    nodes: graphData.nodes,
    reads: graphData.reads,
    inputs: graphData.inputNodes,
    widths: nodeWidths(graphData.nodes).widths,
  });
  const outputOptions = [...(graph.outputs ?? [])].sort()
    .map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  const detailStripHtml = renderDetailStrip();
  const bottomHtml = renderBottomPanel(graph, examples);

  // Serialize graph + annotations + examples + ruleset inputs schema for inline JS
  const graphJson = JSON.stringify(graph);
  const annotJson = JSON.stringify(annotations);
  const registriesJson = JSON.stringify(registries);
  const examplesJson = JSON.stringify(examples);
  const rulesetInputsJson = JSON.stringify(rulesetInputs);
  const registryFieldsJson = JSON.stringify([...registryTypes]);
  const constantAnnotJson = JSON.stringify(constantAnnotations);
  const constantCount = Object.keys(graph.constants ?? {}).length;

  const body = `
<div style="margin-bottom:1.5rem">
  <div style="display:flex;align-items:baseline;gap:0;flex-wrap:wrap;">
    <h1 style="font-size:1.25rem;font-weight:800;color:#111827;display:inline;margin:0;">${esc(rulesetName)}</h1>${domainBadge}${apiLinkHtml}
  </div>
  <div style="font-size:12px;color:#6b7280;margin-top:4px;">${esc(graph.facts ? Object.keys(graph.facts).length : 0)} facts &middot; ${esc(graph.outputs?.length ?? 0)} outputs &middot; ${esc(Object.keys(graph.inputs ?? {}).length)} inputs${constantCount ? ` &middot; ${esc(constantCount)} constants` : ''}</div>
</div>

${legendHtml(constantCount > 0)}
<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;color:#374151;">
  <label for="graph-output">Show</label>
  <select id="graph-output" style="font:12px ui-monospace,monospace;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;background:#fff;max-width:100%;">
    <option value="">every fact</option>${outputOptions}
  </select>
  <span style="color:#9ca3af;">or one output and what it depends on</span>
</div>
<div class="graph-viewport" style="position:relative;height:440px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;overflow:hidden;cursor:grab;touch-action:none;">
  ${svgHtml}
  <div style="position:absolute;top:8px;right:8px;display:flex;gap:4px;">
    <button type="button" class="graph-zoom" data-zoom="in" title="Zoom in" style="${ZOOM_BUTTON}">+</button>
    <button type="button" class="graph-zoom" data-zoom="out" title="Zoom out" style="${ZOOM_BUTTON}">&minus;</button>
    <button type="button" class="graph-zoom" data-zoom="fit" title="Show the whole graph" style="${ZOOM_BUTTON}">Fit</button>
  </div>
  <div style="position:absolute;bottom:6px;left:10px;font-size:11px;color:#9ca3af;pointer-events:none;">Scroll to zoom, drag to move</div>
</div>
${detailStripHtml}
${bottomHtml}

<script>
const GRAPH = ${graphJson};
const GRAPH_LAYOUT = ${graphLayoutJson};
${graphLayout.toString()}
${graphEdgePath.toString()}
const ANNOTATIONS = ${annotJson};
const CONSTANT_ANNOTATIONS = ${constantAnnotJson};
const CONSTANTS_NODE = ${JSON.stringify(CONSTANTS_NODE)};
const REGISTRIES = ${registriesJson};
const EXAMPLES = ${examplesJson};
const RULESET_INPUTS = ${rulesetInputsJson};
const REGISTRY_FIELDS = new Set(${registryFieldsJson});
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
  refreshConstantsDetail();
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
  // The contract's constants come back with the example.
  for (const name of Object.keys(CONSTANT_OVERRIDES)) delete CONSTANT_OVERRIDES[name];
  runEval();
  refreshConstantsDetail();
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

// ── Annotation field rendering ────────────────────────────────────────────────
const ANN_EXPLORER = '../annotations-explorer';
const ANN_LABEL_STYLE = 'font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;';

// A registry entry declares only description; everything else it carries is
// type-specific. Showing the description plus whatever else is there keeps the
// tooltip useful without the renderer knowing any registry type or field name.
function registryTooltip(entry, id) {
  if (!entry) return id;
  const extras = Object.entries(entry)
    .filter(([k]) => k !== 'description' && k !== 'deprecated')
    .map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v));
  return [entry.description, ...extras].filter(Boolean).join('\\n');
}

function renderAnnotFields(annot) {
  let html = '';
  for (const [key, val] of Object.entries(annot)) {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    html += '<div style="' + ANN_LABEL_STYLE + '">' + escHtml(label) + '</div>';
    if (REGISTRY_FIELDS.has(key) && Array.isArray(val)) {
      const typeSlug = key.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      html += '<div style="margin-bottom:10px;">' + val.map(id => {
        const entrySlug = String(id).replace(/[^a-z0-9]/gi, '-').toLowerCase();
        const href = ANN_EXPLORER + '/' + typeSlug + '.html#entry--' + entrySlug;
        // Registry entries render the same way whatever their type: the ID is
        // the name, and the tooltip is the description followed by whatever
        // other fields the entry happens to carry. Naming a type or a field
        // here would put domain knowledge back into the tooling.
        return '<a href="' + escHtml(href) + '" title="' + escHtml(registryTooltip(REGISTRIES[key]?.[id], id)) +
               '" class="ann-chip">' + escHtml(id) + '</a>';
      }).join('') + '</div>';
    } else if (Array.isArray(val) && val.length === 1) {
      html += '<div style="font-size:11px;color:#374151;margin-bottom:10px;">' + escHtml(String(val[0]).trim()) + '</div>';
    } else if (Array.isArray(val)) {
      html += '<ol style="margin:0 0 10px;padding-left:16px;">' + val.map(item =>
        '<li style="font-size:11px;color:#374151;margin-bottom:6px;line-height:1.5;">' + escHtml(String(item).trim()) + '</li>'
      ).join('') + '</ol>';
    } else if (typeof val === 'string') {
      html += '<div style="font-size:11px;color:#374151;margin-bottom:10px;">' + escHtml(val.trim()) + '</div>';
    }
  }
  return html;
}

// ── Constants ─────────────────────────────────────────────────────────────────
// The values the ruleset fixes, each editable here to try what a state's
// overlay would change. A caller can't send them. They behave as the inputs
// do: editable in Try-it mode, applied by Evaluate, and restored with the
// example by Reset.
const CONSTANT_OVERRIDES = {};

/** The graph with any edited constants in place of the contract's values. */
function graphWithOverrides() {
  if (!Object.keys(CONSTANT_OVERRIDES).length) return GRAPH;
  const constants = {};
  for (const [name, c] of Object.entries(GRAPH.constants ?? {})) {
    constants[name] = name in CONSTANT_OVERRIDES ? Object.assign({}, c, { value: CONSTANT_OVERRIDES[name] }) : c;
  }
  return Object.assign({}, GRAPH, { constants: constants });
}

function constantField(name, c) {
  const value = name in CONSTANT_OVERRIDES ? CONSTANT_OVERRIDES[name] : c.value;
  const id = 'constant-' + name;
  const edited = name in CONSTANT_OVERRIDES
    ? ' <span style="font-size:9px;font-weight:600;color:#5650BE;background:#E6EBF9;padding:1px 4px;border-radius:2px;">edited, was ' + escHtml(JSON.stringify(c.value)) + '</span>'
    : '';
  const locked = isExperimentMode ? '' : ' disabled';
  const control = typeof c.value === 'boolean'
    ? '<input type="checkbox" id="' + escHtml(id) + '" data-constant="' + escHtml(name) + '"' + (value ? ' checked' : '') + locked + '>'
    : '<input type="' + (typeof c.value === 'number' ? 'number' : 'text') + '" id="' + escHtml(id) + '" data-constant="' + escHtml(name) + '"' + locked +
      (c.type === 'integer' ? ' step="1"' : typeof c.value === 'number' ? ' step="any"' : '') +
      ' value="' + escHtml(String(value)) + '" style="font:12px ui-monospace,monospace;width:110px;padding:2px 4px;border:1px solid #d1d5db;border-radius:3px;">';
  return '<div style="padding:8px 0;border-top:1px solid #f3f4f6;">' +
    '<label for="' + escHtml(id) + '" style="display:flex;align-items:center;gap:8px;font-size:12px;font-family:ui-monospace,monospace;color:#111827;">' +
      '<b>' + escHtml(name) + '</b>' + control + (c.type ? '<span style="color:#9ca3af;">(' + escHtml(c.type) + ')</span>' : '') + edited +
    '</label>' +
    (c.description ? '<div style="font-size:11px;color:#374151;margin:4px 0;">' + escHtml(c.description.trim()) + '</div>' : '') +
    (CONSTANT_ANNOTATIONS[name] ? '<div style="margin-top:6px;">' + renderAnnotFields(CONSTANT_ANNOTATIONS[name]) + '</div>' : '') +
  '</div>';
}

function constantsDetail() {
  let html = "<div style='font-size:11px;color:#374151;margin-bottom:8px;'>The values this ruleset fixes, which a state changes by overlay. " +
    "A caller can't send them; edit one here to see what a different choice would do to the inputs below. " +
    (isExperimentMode ? 'Click Evaluate to apply your edits.' : 'Click Try it to edit them.') + '</div>';
  return html + Object.entries(GRAPH.constants ?? {}).map(([name, c]) => constantField(name, c)).join('');
}

/** Show the constants again if they're open, so their fields follow the panel's mode and edits. */
function refreshConstantsDetail() {
  if (activeNode === CONSTANTS_NODE) showDetail(CONSTANTS_NODE);
}

document.addEventListener('change', function (event) {
  const name = event.target?.dataset?.constant;
  if (!name || !GRAPH.constants?.[name]) return;
  const original = GRAPH.constants[name];
  let value;
  if (event.target.type === 'checkbox') value = event.target.checked;
  else if (typeof original.value === 'number') {
    value = original.type === 'integer' ? parseInt(event.target.value, 10) : parseFloat(event.target.value);
    if (Number.isNaN(value)) return;
  } else value = event.target.value;
  if (value === original.value) delete CONSTANT_OVERRIDES[name];
  else CONSTANT_OVERRIDES[name] = value;
  refreshConstantsDetail();
});


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
  if (nodeName === CONSTANTS_NODE && !fact && GRAPH.constants) {
    panel.innerHTML = '<div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:3px;font-family:ui-monospace,monospace">constants</div>' +
      '<div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#5650BE;margin-bottom:10px;">Constants</div>' +
      constantsDetail();
    strip.style.display = '';
    return;
  }
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

  if (annot) {
    html += renderAnnotFields(annot);
  }

  panel.innerHTML = html;
  strip.style.display = '';
}

// Apply ruleset input schema defaults for any namespace absent from userInputs.
// Returns { scope, defaultedNamespaces } for use with window.RulesEngine.evaluate(GRAPH, scope).
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
    const nodes = window.RulesEngine.evaluate(graphWithOverrides(), scope);
    const prevNodes = lastNodes;
    lastNodes = reclassifyPlaceholders(nodes, defaultedNamespaces);
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

// ── Zoom and pan ──────────────────────────────────────────────────────────────
// The graph fills a fixed-height viewport, and the viewBox is the camera: wheel
// zooms about the cursor, drag moves, + and − zoom about the middle, Fit shows
// everything. The view keeps the viewport's aspect ratio, so nothing letterboxes,
// and it opens at actual size when fitting the whole graph would shrink it past
// reading. A drag doesn't select the node it ends on.
(function () {
  const viewport = document.querySelector('.graph-viewport');
  const svg = viewport && viewport.querySelector('svg');
  if (!svg) return;
  let W = Number(svg.dataset.graphWidth), H = Number(svg.dataset.graphHeight);
  const aspect = () => viewport.clientWidth / viewport.clientHeight;
  // Never wider than the graph needs to fit, or narrower than actual size: a small
  // graph shows at its own size, in the middle.
  const fitWidth = () => Math.max(W, H * aspect(), viewport.clientWidth);
  const MIN_WIDTH = 200;
  let view;

  function clamp() {
    // Never zoomed in past MIN_WIDTH or out past a little more than everything,
    // and never moved so far that the graph leaves the viewport.
    view.w = Math.min(Math.max(view.w, MIN_WIDTH), fitWidth() * 1.25);
    view.h = view.w / aspect();
    const minX = Math.min(0, W - view.w) - view.w / 2, maxX = Math.max(0, W - view.w) + view.w / 2;
    const minY = Math.min(0, H - view.h) - view.h / 2, maxY = Math.max(0, H - view.h) + view.h / 2;
    view.x = Math.min(Math.max(view.x, minX), maxX);
    view.y = Math.min(Math.max(view.y, minY), maxY);
    svg.setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
  }
  function fit() {
    const w = fitWidth();
    view = { w, h: w / aspect(), x: (W - w) / 2, y: (H - w / aspect()) / 2 };
    clamp();
  }
  function zoomAbout(gx, gy, factor) {
    const before = view.w;
    view.w *= factor;
    view.h = view.w / aspect();
    const ratio = view.w / before;
    view.x = gx - (gx - view.x) * ratio;
    view.y = gy - (gy - view.y) * ratio;
    clamp();
  }
  const toGraph = (clientX, clientY) => {
    const r = viewport.getBoundingClientRect();
    return [view.x + (clientX - r.left) / r.width * view.w, view.y + (clientY - r.top) / r.height * view.h];
  };

  // Open at actual size, against the left edge where the inputs are and centered
  // top to bottom, when the whole graph would be too small to read; otherwise
  // show all of it.
  function open(width, height) {
    W = width; H = height;
    if (fitWidth() > viewport.clientWidth * 1.6) {
      view = { w: viewport.clientWidth, h: viewport.clientHeight, x: 0, y: (H - viewport.clientHeight) / 2 };
      clamp();
    } else {
      fit();
    }
  }
  open(W, H);
  window.graphViewport = { open };

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [gx, gy] = toGraph(e.clientX, e.clientY);
    zoomAbout(gx, gy, Math.exp(e.deltaY * 0.0015));
  }, { passive: false });

  viewport.querySelectorAll('.graph-zoom').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.zoom === 'fit') return fit();
      zoomAbout(view.x + view.w / 2, view.y + view.h / 2, button.dataset.zoom === 'in' ? 0.8 : 1.25);
    });
  });

  // Drag to move. The pointer is only captured once it has moved a few pixels,
  // so a click still selects a node; the click that ends a drag is swallowed.
  let drag = null, dragged = false;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; viewport.setPointerCapture(e.pointerId); viewport.style.cursor = 'grabbing'; }
    const r = viewport.getBoundingClientRect();
    view.x = drag.vx - dx / r.width * view.w;
    view.y = drag.vy - dy / r.height * view.h;
    clamp();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    dragged = drag.moved;
    if (drag.moved) viewport.releasePointerCapture(e.pointerId);
    viewport.style.cursor = 'grab';
    drag = null;
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('click', (e) => {
    if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; }
  }, true);

  // Keep what's in view centered when the viewport changes width.
  window.addEventListener('resize', () => {
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    view.h = view.w / aspect();
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
    clamp();
  });
})();

// ── One output on its own ─────────────────────────────────────────────────────
// Past a few dozen facts the whole graph is too much to follow, but each output's
// own graph — the output and everything it transitively reads — stays small. The
// picker lays that subset out with the same function the build used, moves the
// nodes there and hides the rest, so clicking, highlighting and the detail panel
// work as they do on the whole graph.
(function () {
  const select = document.getElementById('graph-output');
  const svg = document.querySelector('.graph-viewport svg');
  if (!select || !svg || !window.graphViewport) return;
  const nodes = Array.from(svg.querySelectorAll('.sg-node'));
  const edges = Array.from(svg.querySelectorAll('.sg-edge'));
  const whole = { width: Number(svg.dataset.graphWidth), height: Number(svg.dataset.graphHeight) };
  edges.forEach(e => { e.dataset.d = e.getAttribute('d'); });

  function show(output) {
    resetHighlight(svg);
    if (!output) {
      nodes.forEach(g => { g.removeAttribute('transform'); g.style.display = ''; });
      edges.forEach(e => { e.setAttribute('d', e.dataset.d); e.style.display = ''; });
      window.graphViewport.open(whole.width, whole.height);
      return;
    }
    const keep = new Set();
    (function walk(n) {
      if (keep.has(n)) return;
      keep.add(n);
      (GRAPH_LAYOUT.reads[n] || []).forEach(walk);
    })(output);
    const subset = GRAPH_LAYOUT.nodes.filter(n => keep.has(n));
    const layout = graphLayout(subset, GRAPH_LAYOUT.reads, GRAPH_LAYOUT.inputs, GRAPH_LAYOUT.widths);
    nodes.forEach(g => {
      const p = layout.pos[g.dataset.node];
      if (!p) { g.style.display = 'none'; return; }
      g.style.display = '';
      g.setAttribute('transform', 'translate(' + (p.x - Number(g.dataset.x)) + ',' + (p.y - Number(g.dataset.y)) + ')');
    });
    edges.forEach(e => {
      const from = e.dataset.from, to = e.dataset.to;
      if (!layout.pos[from] || !layout.pos[to]) { e.style.display = 'none'; return; }
      e.style.display = '';
      e.setAttribute('d', graphEdgePath(from, to, layout.pos, GRAPH_LAYOUT.widths));
    });
    window.graphViewport.open(layout.width, layout.height);
  }
  // A link can open one output's view: #output-risks.cashIncome.
  function fromHash() {
    const hash = window.location.hash;
    if (!hash.startsWith('#output-')) return;
    const output = decodeURIComponent(hash.slice('#output-'.length));
    if (!GRAPH.outputs.includes(output)) return;
    select.value = output;
    show(output);
  }
  select.addEventListener('change', () => {
    show(select.value);
    history.replaceState(null, '', select.value ? '#output-' + encodeURIComponent(select.value) : location.pathname + location.search);
  });
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();

// ── Hash-based fact navigation ─────────────────────────────────────────────
// Navigating to #fact-{factName} simulates a click on that node so the full
// highlight + detail-strip behavior fires, exactly as if the user clicked it.
function activateFactFromHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#fact-')) return;
  const factName = decodeURIComponent(hash.slice('#fact-'.length));
  const svg = document.querySelector('svg');
  if (!svg) return;
  let nodeEl = null;
  svg.querySelectorAll('.sg-node').forEach(el => {
    if (el.dataset.node === factName) nodeEl = el;
  });
  if (nodeEl) {
    nodeEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setTimeout(() => {
      document.getElementById('detail-strip')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }
}
document.addEventListener('DOMContentLoaded', activateFactFromHash);
window.addEventListener('hashchange', activateFactFromHash);
</script>`;

  return shell(rulesetName, body, hubHref);
}

// ── Index page ────────────────────────────────────────────────────────────────

export function generateIndexHtml(rulesets, outputDir, hubHref) {
  // Group rulesets by domain
  const byDomain = {};
  for (const r of rulesets) {
    if (!byDomain[r.domain]) byDomain[r.domain] = [];
    byDomain[r.domain].push(r);
  }

  const cards = Object.entries(byDomain).map(([domain, items]) => {
    const domainTitle = domain.replace(/\b\w/g, c => c.toUpperCase());
    const rows = items.map(({ rulesetName, slug }) => {
      const label = rulesetName.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
      return `<a href="${esc(slug)}.html" class="ruleset-row" onmouseover="this.style.background='#E6EBF9'" onmouseout="this.style.background=''">
        <span class="ruleset-row-label">${esc(label)}</span>
      </a>`;
    }).join('');
    return `<div class="domain-card">
      <div class="domain-card-title">${esc(domainTitle)}</div>
      <div class="ruleset-list">${rows}</div>
    </div>`;
  }).join('');

  const bodyHtml = `
<div class="index-layout">
  <div class="index-header">
    <h1>Rules Docs</h1>
    <p class="index-sub">Dependency graph visualizer for blueprint rulesets — inputs, intermediate facts, outputs, and policy citations.</p>
  </div>
  <div class="domain-grid">${cards}</div>
</div>`;

  const extraStyle = `
.index-layout { max-width: 900px; margin: 0 auto; padding: 3rem 2rem; }
.index-header { margin-bottom: 2.5rem; }
.index-header h1 { font-size: 2rem; font-weight: 700; color: ${COLORS.darkBlue}; margin-bottom: 0.5rem; }
.index-sub { color: #555; font-size: 0.9rem; max-width: 560px; line-height: 1.5; }
.domain-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
.domain-card { background: #fff; border: 1px solid ${COLORS.sandDark}; border-radius: 8px; padding: 1.25rem 1.25rem 1rem; }
.domain-card-title { font-size: 1rem; font-weight: 800; color: ${COLORS.darkBlue}; margin-bottom: 0.5rem; }
.ruleset-list { border: 1px solid ${COLORS.sandDark}; border-radius: 4px; overflow: hidden; }
.ruleset-row { display: flex; align-items: center; padding: 6px 8px; text-decoration: none; color: ${COLORS.text}; }
.ruleset-row-label { font-size: 12px; font-weight: 600; color: ${COLORS.midBlue}; }`;

  const html = singleColumnPage({
    title: 'Rules Docs',
    breadcrumbs: [
      { label: 'Explorer',   href: hubHref },
      { label: 'Rules Docs', href: '#' },
    ],
    bodyHtml,
    extraStyle,
  });
  writeFileSync(join(outputDir, 'index.html'), html);
}
