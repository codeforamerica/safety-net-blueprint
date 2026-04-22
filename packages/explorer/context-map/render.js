#!/usr/bin/env node
/**
 * render.js
 *
 * Generates per-domain detail SVGs and an overview SVG from config.yaml.
 * Output goes to output/ directory.
 *
 * Usage:
 *   node render.js
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Package-level: domain registry and event definitions
const pkgConfig = yaml.load(readFileSync(resolve(__dirname, '..', 'config.yaml'), 'utf8'));
// Diagram-level: title, subtitle, overview layout positions
const mapConfig = yaml.load(readFileSync(resolve(__dirname, 'config.yaml'), 'utf8'));

// Merged config: attach layout positions (x, y) to each domain
const config = {
  title: mapConfig.title,
  subtitle: mapConfig.subtitle,
  cross_cutting: pkgConfig.cross_cutting,
  events: pkgConfig.events,
  apis: pkgConfig.apis,
  domains: (pkgConfig.domains || []).map(d => ({
    ...d,
    ...(mapConfig.layout?.[d.id] || {}),
  })),
};

const OUT_DIR = resolve(__dirname, 'output');
mkdirSync(OUT_DIR, { recursive: true });

// ── Constants ──────────────────────────────────────────────────────────────

const BOX_W = 220;
const BOX_H = 105;

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const STATUS_STYLE = {
  partial:          { fill: '#eff6ff', stroke: '#2563eb', dash: false, labelColor: '#2563eb' },
  'not-started':    { fill: '#f9fafb', stroke: '#9ca3af', dash: true,  labelColor: '#9ca3af' },
  'design-complete':{ fill: '#f0fdf4', stroke: '#16a34a', dash: false, labelColor: '#16a34a' },
};

// Text color per event/api status — used to color individual event name labels
const EVENT_TEXT_COLOR = {
  implemented: '#16a34a',   // green — matches design-complete
  partial:     '#2563eb',   // blue — matches partial
  planned:     '#9ca3af',   // gray — matches not-started
  api:         '#d97706',
};

// All flow lines are the same neutral gray — direction is shown by arrowheads,
// status is shown by the text label colors (EVENT_TEXT_COLOR), not line colors.
const FLOW_LINE_COLOR = '#b0b7c3';
const FLOW_MARKER_ID  = 'arrow-gray';

// ── Geometry helpers ───────────────────────────────────────────────────────

/** Where does the line from (cx,cy) toward (tx,ty) exit the box centered at (cx,cy)? */
function boxEdge(cx, cy, tx, ty, bw = BOX_W, bh = BOX_H) {
  const dx = tx - cx;
  const dy = ty - cy;
  const hw = bw / 2;
  const hh = bh / 2;
  if (dx === 0 && dy === 0) return [cx, cy];
  const tX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  return [cx + dx * t, cy + dy * t];
}

/** Perpendicular offset vector of magnitude d, left of the (x1,y1)→(x2,y2) direction. */
function perpOffset(x1, y1, x2, y2, d) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return [-dy / len * d, dx / len * d];
}

/**
 * Where should an arrowhead tip sit when the arrow approaches the box at (boxCx, boxCy)
 * from (fromX, fromY)? Re-intersects the actual (offset) line with the box boundary
 * and pulls back ARROW_GAP px so the triangle is fully visible.
 */
const ARROW_GAP = 6;
function gappedEdge(boxCx, boxCy, fromX, fromY, bw = BOX_W, bh = BOX_H) {
  const [ex, ey] = boxEdge(boxCx, boxCy, fromX, fromY, bw, bh);
  const dx = fromX - boxCx;
  const dy = fromY - boxCy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return [ex + dx / len * ARROW_GAP, ey + dy / len * ARROW_GAP];
}

/**
 * Groups events and apis into flow objects for arrow drawing.
 * All events between the same pair land on one flow; statuses[] tracks per-event status
 * so event name labels can be individually colored.
 */
function groupIntoFlows(cfg) {
  const flowMap = new Map();

  for (const e of cfg.events || []) {
    const status = e.status || 'planned';
    const subs = Array.isArray(e.subscribers) ? e.subscribers : (e.subscribers ? [e.subscribers] : []);
    for (const sub of subs) {
      const key = `${e.publisher}→${sub}`;
      if (!flowMap.has(key)) {
        flowMap.set(key, { from: e.publisher, to: sub, type: 'event', names: [], statuses: [] });
      }
      if (e.name) {
        flowMap.get(key).names.push(e.name);
        flowMap.get(key).statuses.push(status);
      }
    }
  }

  for (const a of cfg.apis || []) {
    const callers = Array.isArray(a.callers) ? a.callers : (a.callers ? [a.callers] : []);
    for (const caller of callers) {
      const key = `${caller}→${a.domain}:api`;
      if (!flowMap.has(key)) {
        flowMap.set(key, { from: caller, to: a.domain, type: 'api', names: [], statuses: [] });
      }
      flowMap.get(key).names.push(a.call);
      flowMap.get(key).statuses.push('api');
    }
  }

  // styleKey retained only for determining if lines are dashed (planned) or solid.
  // Line color is always FLOW_LINE_COLOR — status is conveyed by text color only.
  for (const f of flowMap.values()) {
    if (f.type === 'api') {
      f.styleKey = 'api';
    } else if (f.statuses.includes('implemented')) {
      f.styleKey = 'implemented';
    } else {
      f.styleKey = 'planned';
    }
  }

  return [...flowMap.values()];
}


// ── SVG primitives ─────────────────────────────────────────────────────────

/** Single gray arrowhead marker used by all flow lines. */
function defsForFlows() {
  return `  <defs>
    <marker id="${FLOW_MARKER_ID}" markerWidth="10" markerHeight="10"
      refX="10" refY="5" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L0,10 L10,5 z" fill="${FLOW_LINE_COLOR}"/>
    </marker>
  </defs>`;
}

/**
 * HTML domain box for detail views. Absolutely positioned within .dt-wrap.
 * cx/cy are the center of the box; CSS transform: translate(-50%,-50%) centers it.
 */
function domainBoxHtml(d, cx, cy, navigable = false) {
  const s = STATUS_STYLE[d.status] || STATUS_STYLE['not-started'];
  const border = s.dash ? `1.5px dashed ${s.stroke}` : `1.5px solid ${s.stroke}`;
  const isNavigable = navigable && d.status !== 'not-started';
  const navAttr = isNavigable ? ` data-navigate="${d.id}"` : '';
  const entities = (d.entities || []).join(' · ');
  const desc = d.description || '';
  const boxStyle = [
    'position:absolute',
    `width:${BOX_W}px`,
    `min-height:${BOX_H}px`,
    'border-radius:8px',
    'padding:12px 14px',
    `left:${cx}px`,
    `top:${cy}px`,
    'transform:translate(-50%,-50%)',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:4px',
    'text-align:center',
    'box-sizing:border-box',
    'z-index:2',
    `background:${s.fill}`,
    `border:${border}`,
    isNavigable ? 'cursor:pointer' : '',
  ].filter(Boolean).join(';');
  return `<div style="${boxStyle}"${navAttr}>
  <div style="font-size:15px;font-weight:700;color:#111827;line-height:1.2;">${d.label}</div>
  ${desc ? `<div style="font-size:11px;color:#6b7280;">${desc}</div>` : ''}
  ${entities ? `<div style="font-size:9px;color:#9ca3af;width:100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${entities}</div>` : ''}
</div>`;
}

function arrowLine(x1, y1, x2, y2, lineColor, markerId, dash = null, offset = 0) {
  const [ox, oy] = offset !== 0 ? perpOffset(x1, y1, x2, y2, offset) : [0, 0];
  const ax1 = x1 + ox, ay1 = y1 + oy;
  const ax2 = x2 + ox, ay2 = y2 + oy;
  const dashAttr = dash ? `stroke-dasharray="${dash}"` : '';
  return `  <line x1="${ax1.toFixed(1)}" y1="${ay1.toFixed(1)}" x2="${ax2.toFixed(1)}" y2="${ay2.toFixed(1)}"
    stroke="${lineColor}" stroke-width="1.5" ${dashAttr} marker-end="url(#${markerId})"/>`;
}

// ── Legend helpers ─────────────────────────────────────────────────────────

/** HTML legend for detail views — lives inside .dt-wrap at the bottom. */
function detailLegendHtml() {
  const swatchStyle = (fill, stroke, dash) =>
    `display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;` +
    `margin-right:4px;background:${fill};border:1.5px ${dash ? 'dashed' : 'solid'} ${stroke};`;
  const legendStyle = 'position:absolute;bottom:16px;left:25px;right:25px;display:flex;gap:16px;' +
    'padding:8px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;' +
    'align-items:center;flex-wrap:wrap;font-size:9px;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;z-index:10;';
  return `<div style="${legendStyle}">
  <span><span style="${swatchStyle('#f0fdf4','#16a34a',false)}"></span>Domain complete</span>
  <span><span style="${swatchStyle('#eff6ff','#2563eb',false)}"></span>Domain partially complete</span>
  <span><span style="${swatchStyle('#f9fafb','#9ca3af',true )}"></span>Domain planned</span>
  <span>&#x26a1; Domain event</span>
  <span>&#x21c4; Direct API call</span>
  <button id="toggle-int" style="margin-left:auto;font-size:9px;font-family:inherit;cursor:pointer;padding:3px 10px;border:1px solid #d1d5db;border-radius:4px;background:white;color:#374151;">Hide integrations</button>
</div>`;
}

// ── Overview HTML ──────────────────────────────────────────────────────────

/**
 * Renders the overview as an HTML fragment (no SVG).
 * HTML+CSS handles text wrapping, overflow, and grid layout natively —
 * no manual pixel math needed.
 */
function renderOverview() {
  // Sort by y then x so CSS grid order matches the config layout grid
  const sortedDomains = [...config.domains].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
  const crossCutting = (config.cross_cutting || []).join(' · ');

  const cards = sortedDomains.map(d => {
    const cls = d.status || 'not-started';
    const entities = (d.entities || []).join(' · ');
    const clickable = cls !== 'not-started';
    const navAttr  = clickable ? ` data-navigate="${d.id}"` : '';
    const titleAttr = clickable ? ` title="Click to explore ${d.label}"` : '';
    return `<div class="cm-domain ${cls}"${navAttr}${titleAttr}>
      <div class="cm-title">${d.label}</div>
      ${entities ? `<div class="cm-entities">${entities}</div>` : ''}
      <div class="cm-desc">${d.description || ''}</div>
    </div>`;
  }).join('\n    ');

  return `<div class="cm">
  <div class="cm-banner">
    <div class="cm-banner-label">Cross-cutting concerns</div>
    <div class="cm-banner-items">${crossCutting}</div>
  </div>
  <div class="cm-grid">
    ${cards}
  </div>
  <div class="cm-legend">
    <div class="cm-legend-item"><div class="cm-swatch design-complete"></div> Domain complete</div>
    <div class="cm-legend-item"><div class="cm-swatch partial"></div> Domain in progress</div>
    <div class="cm-legend-item"><div class="cm-swatch not-started"></div> Domain planned</div>
    <div style="margin-left:auto;font-size:9px;color:#9ca3af;font-style:italic;">Click a domain card to explore it</div>
  </div>
</div>`;
}

// ── Detail SVG ─────────────────────────────────────────────────────────────

function renderDetail(domainId) {
  const W = 1400, H = 1100, CX = W / 2, CY = H / 2;

  const center = config.domains.find(d => d.id === domainId);
  if (!center) throw new Error(`Unknown domain: ${domainId}`);

  const domainMap = Object.fromEntries(config.domains.map(d => [d.id, d]));
  const flows = groupIntoFlows(config);

  // Collect partner domains
  const partnerIds = new Set();
  for (const f of flows) {
    if (f.from === domainId && f.to !== domainId) partnerIds.add(f.to);
    if (f.to === domainId && f.from !== domainId) partnerIds.add(f.from);
  }
  const partners = [...partnerIds].filter(id => domainMap[id]);

  // Compute radius from the tallest event label block across all partner connections.
  // Each event line ≈ 14px; each direction header ≈ 12px; assume up to 2 directions per pair.
  const eventCountsByPartner = {};
  for (const f of flows) {
    let pid = null;
    if (f.from === domainId && domainMap[f.to])   pid = f.to;
    else if (f.to === domainId && domainMap[f.from]) pid = f.from;
    if (!pid) continue;
    eventCountsByPartner[pid] = (eventCountsByPartner[pid] || 0) + Math.max(f.names.length, 1);
  }
  const maxEvents = Math.max(0, ...Object.values(eventCountsByPartner));
  const maxLabelH = maxEvents * 14 + 2 * 12; // events + two direction headers

  // Estimate the widest integration box across all connections for this domain.
  // Helvetica Neue at 8.5px ≈ 6px/char average; add icon (16px) + box padding (24px).
  let maxNameChars = 0;
  for (const f of flows) {
    if (f.from !== domainId && f.to !== domainId) continue;
    for (const name of f.names) maxNameChars = Math.max(maxNameChars, name.length);
  }
  const maxLabelW = maxNameChars * 6 + 40; // icon + padding

  // The integration box sits at the midpoint of the connection. For it to fit without
  // overlapping either domain box, the gap between box edges must exceed the box extent.
  // Use the larger of height and width to cover both horizontal and vertical connections.
  const maxLabelExtent = Math.max(maxLabelH, maxLabelW);

  const n = partners.length;
  const minRadius = n <= 2 ? 280 : n <= 4 ? 320 : 360;
  // Max safe radius: partners must stay fully within the canvas.
  // Binding constraint is the bottom (legend takes ~80px) and top (nav bar ~60px).
  const maxRadius = Math.min(
    CX - BOX_W / 2 - 20,           // left/right
    CY - BOX_H / 2 - 70,           // top (nav bar clearance)
    H - CY - BOX_H / 2 - 90,       // bottom (legend clearance)
  );
  const radius = Math.max(minRadius, Math.min(maxRadius, BOX_W + maxLabelExtent + 120));
  const partnerPositions = {};
  partners.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    partnerPositions[id] = {
      cx: CX + radius * Math.cos(angle),
      cy: CY + radius * Math.sin(angle),
    };
  });

  // Group flows by partner
  const flowsByPartner = {};
  for (const f of flows) {
    let partnerId = null, direction = null;
    if (f.from === domainId && partnerPositions[f.to])  { partnerId = f.to;   direction = 'out'; }
    else if (f.to === domainId && partnerPositions[f.from]) { partnerId = f.from; direction = 'in';  }
    if (!partnerId) continue;
    if (!flowsByPartner[partnerId]) flowsByPartner[partnerId] = [];
    flowsByPartner[partnerId].push({ ...f, direction });
  }

  const arrowLines = [];
  const labelDivs  = [];

  for (const [partnerId, partnerFlows] of Object.entries(flowsByPartner)) {
    const p = partnerPositions[partnerId];
    const [ex1, ey1] = boxEdge(CX, CY, p.cx, p.cy);
    const [ex2, ey2] = boxEdge(p.cx, p.cy, CX, CY);
    const bidi = partnerFlows.some(f => f.direction === 'out') &&
                 partnerFlows.some(f => f.direction === 'in');

    // SVG arrows
    for (const f of partnerFlows) {
      const off = bidi ? (f.direction === 'out' ? 10 : -10) : 0;
      const [ox, oy] = off !== 0 ? perpOffset(ex1, ey1, ex2, ey2, off) : [0, 0];
      let lx1, ly1, lx2, ly2;
      if (f.direction === 'out') {
        lx1 = ex1 + ox; ly1 = ey1 + oy;
        [lx2, ly2] = gappedEdge(p.cx, p.cy, lx1, ly1);
      } else {
        lx1 = ex2 + ox; ly1 = ey2 + oy;
        [lx2, ly2] = gappedEdge(CX, CY, lx1, ly1);
      }
      arrowLines.push(
        `  <line x1="${lx1.toFixed(1)}" y1="${ly1.toFixed(1)}" ` +
        `x2="${lx2.toFixed(1)}" y2="${ly2.toFixed(1)}" ` +
        `stroke="${FLOW_LINE_COLOR}" stroke-width="1.5" marker-end="url(#${FLOW_MARKER_ID})"/>`
      );
    }

    // Place label box centered at the midpoint of the connection.
    const ax = Math.max(120, Math.min(W - 120, (ex1 + ex2) / 2));
    const ay = Math.max(100, Math.min(H - 60,  (ey1 + ey2) / 2));
    const transformX = '-50%';
    const textAlign  = 'left';
    const partnerLabel = domainMap[partnerId]?.label || partnerId;

    let labelHtml = '';
    for (const f of partnerFlows) {
      const items = f.names.length > 0 ? f.names : (f.type === 'api' ? ['direct API'] : []);
      if (!items.length) continue;
      const icon = f.type === 'api' ? '\u21c4' : '\u26a1';
      const header = f.direction === 'in' ? `${partnerLabel} \u2192` : `\u2192 ${partnerLabel}`;
      labelHtml += `<div style="font-size:7.5px;color:#9ca3af;margin-top:4px;">${header}</div>`;
      for (const name of items) {
        labelHtml += `<div style="color:#374151;"><span style="margin-right:3px;">${icon}</span>${name}</div>`;
      }
    }
    if (labelHtml) {
      labelDivs.push([ax, ay, transformX, textAlign, labelHtml]);
    }
  }

  const partnerBoxes = partners
    .map(id => domainBoxHtml(domainMap[id], partnerPositions[id].cx, partnerPositions[id].cy, true))
    .join('\n');

  const labelDivsHtml = labelDivs.map(([ax, ay, transformX, textAlign, html]) =>
    `<div class="int-box" style="position:absolute;left:${ax.toFixed(1)}px;top:${ay.toFixed(1)}px;` +
    `transform:translate(${transformX},-50%);text-align:${textAlign};` +
    `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:8.5px;line-height:1.65;` +
    `white-space:nowrap;z-index:3;` +
    `background:white;border:1px solid #e5e7eb;border-radius:5px;` +
    `padding:5px 8px;box-shadow:0 1px 4px rgba(0,0,0,0.08);">${html}</div>`
  ).join('\n');

  return `<div style="position:relative;width:${W}px;height:${H}px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:white;overflow:visible;" data-domain="${domainId}">
  <div style="position:absolute;top:16px;left:20px;font-size:12px;z-index:10;">
    <span data-navigate="__overview__" style="color:#2563eb;cursor:pointer;">← Context Map</span>
    <span style="color:#6b7280;"> / ${center.label}</span>
  </div>
  <svg style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible;" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${defsForFlows()}
${arrowLines.join('\n')}
  </svg>
${partnerBoxes}
${domainBoxHtml(center, CX, CY, false)}
${labelDivsHtml}
${detailLegendHtml()}
</div>`;
}

// ── Main ───────────────────────────────────────────────────────────────────

const overviewHtml = renderOverview();
writeFileSync(resolve(OUT_DIR, 'overview.html'), overviewHtml, 'utf8');
console.log('Written: output/overview.html');

for (const d of config.domains) {
  if (d.status === 'not-started') continue;
  const html = renderDetail(d.id);
  writeFileSync(resolve(OUT_DIR, `${d.id}.html`), html, 'utf8');
  console.log(`Written: output/${d.id}.html`);
}
