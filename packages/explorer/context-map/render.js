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
const MONO = "'Courier New', Courier, monospace";

const STATUS_STYLE = {
  partial:          { fill: '#eff6ff', stroke: '#2563eb', dash: false, labelColor: '#2563eb' },
  'not-started':    { fill: '#f9fafb', stroke: '#9ca3af', dash: true,  labelColor: '#9ca3af' },
  'design-complete':{ fill: '#f0fdf4', stroke: '#16a34a', dash: false, labelColor: '#16a34a' },
};

// Text color per event/api status — used to color individual event name labels
const EVENT_TEXT_COLOR = {
  implemented: '#1e40af',
  planned:     '#9ca3af',
  api:         '#d97706',
};

// Arrow/line color for a pair: determined by dominant status across all flows on that arrow
// Colors mirror domain box border colors for visual consistency
const PAIR_LINE_COLOR = {
  implemented: '#2563eb',   // matches partial domain stroke
  api:         '#d97706',   // amber
  planned:     '#9ca3af',   // matches not-started domain stroke
};

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
    const key = `${a.caller}→${a.callee}:api`;
    if (!flowMap.has(key)) {
      flowMap.set(key, { from: a.caller, to: a.callee, type: 'api', names: [], statuses: [] });
    }
    for (const call of (a.calls || [])) {
      flowMap.get(key).names.push(call);
      flowMap.get(key).statuses.push('api');
    }
  }

  // Compute dominant style: implemented > api > planned
  for (const f of flowMap.values()) {
    if (f.type === 'api') {
      f.styleKey = 'api';
    } else if (f.statuses.includes('implemented')) {
      f.styleKey = 'implemented';
    } else {
      f.styleKey = 'planned';
    }
    f.lineColor = PAIR_LINE_COLOR[f.styleKey];
  }

  return [...flowMap.values()];
}

/** Dominant style across a set of flows between two domains. */
function dominantStyle(flows) {
  if (flows.some(f => f.styleKey === 'implemented')) return 'implemented';
  if (flows.some(f => f.styleKey === 'api')) return 'api';
  return 'planned';
}

// ── SVG primitives ─────────────────────────────────────────────────────────

/** Generate <defs> with one marker per unique line color used in the diagram. */
function defsForFlows(flows) {
  const seen = new Set();
  const markers = [];
  for (const f of flows) {
    const id = `arrow-${f.lineColor.replace('#', '')}`;
    if (!seen.has(id)) {
      seen.add(id);
      markers.push(
        `    <marker id="${id}" markerWidth="10" markerHeight="10"\n` +
        `      refX="10" refY="5" orient="auto" markerUnits="userSpaceOnUse">\n` +
        `      <path d="M0,0 L0,10 L10,5 z" fill="${f.lineColor}"/>\n` +
        `    </marker>`
      );
    }
    f.markerId = id;
  }
  return `  <defs>\n${markers.join('\n')}\n  </defs>`;
}

/** Full domain box: title, entities, description. Used everywhere. */
function domainBox(d, cx, cy, navigable = false) {
  const s = STATUS_STYLE[d.status] || STATUS_STYLE['not-started'];
  const x = cx - BOX_W / 2;
  const y = cy - BOX_H / 2;
  const dashAttr = s.dash ? 'stroke-dasharray="5,3"' : '';
  const navAttr = navigable ? ` data-navigate="${d.id}" style="cursor:pointer"` : '';

  const entityLine = d.entities ? d.entities.join(' · ') : '';
  const desc = d.description || '';

  return `  <g${navAttr}>
    <rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="8"
      fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5" ${dashAttr}/>
    <text x="${cx}" y="${y + 28}" text-anchor="middle"
      font-family="${FONT}" font-size="14" font-weight="600" fill="#111827">${d.label}</text>
    ${entityLine
      ? `<text x="${cx}" y="${y + 46}" text-anchor="middle"
      font-family="${MONO}" font-size="8.5" fill="${s.labelColor}"
      textLength="${BOX_W - 20}" lengthAdjust="spacingAndGlyphs">${entityLine}</text>`
      : ''}
    <text x="${cx}" y="${y + 67}" text-anchor="middle"
      font-family="${FONT}" font-size="10" fill="#6b7280"
      textLength="${BOX_W - 20}" lengthAdjust="spacingAndGlyphs">${desc}</text>
  </g>`;
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

/** Compact legend for the overview (domain status only). */
function overviewLegendSvg(x, y, width) {
  const items = [
    { label: 'Partial implementation', fill: '#eff6ff', stroke: '#2563eb', dashBox: null },
    { label: 'Design complete',         fill: '#f0fdf4', stroke: '#16a34a', dashBox: null },
    { label: 'Not started',             fill: '#f9fafb', stroke: '#9ca3af', dashBox: '5,3' },
  ];
  const col = width / 3;
  return `  <g transform="translate(${x}, ${y})">
    <rect x="0" y="0" width="${width}" height="30" rx="4"
      fill="#f9fafb" stroke="#e5e7eb" stroke-width="1"/>
    ${items.map((li, i) => `
    <rect x="${12 + i * col}" y="9" width="12" height="12" rx="2"
      fill="${li.fill}" stroke="${li.stroke}" stroke-width="1.5"${li.dashBox ? ` stroke-dasharray="${li.dashBox}"` : ''}/>
    <text x="${28 + i * col}" y="20" font-family="${FONT}" font-size="9" fill="#374151">${li.label}</text>`).join('')}
  </g>`;
}

/** Full legend for detail views: domain status + event line types. */
function detailLegendSvg(x, y, width) {
  const domainItems = [
    { label: 'Partial implementation', fill: '#eff6ff', stroke: '#2563eb', dashBox: null },
    { label: 'Design complete',         fill: '#f0fdf4', stroke: '#16a34a', dashBox: null },
    { label: 'Not started',             fill: '#f9fafb', stroke: '#9ca3af', dashBox: '5,3' },
  ];
  // Event line legend mirrors domain colors
  const lineItems = [
    { label: 'Events implemented',        color: PAIR_LINE_COLOR.implemented },
    { label: 'Events not yet implemented', color: PAIR_LINE_COLOR.planned },
    { label: 'Direct API call',            color: PAIR_LINE_COLOR.api },
  ];
  const col = width / 3;
  return `  <g transform="translate(${x}, ${y})">
    <rect x="0" y="0" width="${width}" height="50" rx="4"
      fill="#f9fafb" stroke="#e5e7eb" stroke-width="1"/>
    ${domainItems.map((li, i) => `
    <rect x="${12 + i * col}" y="8" width="12" height="12" rx="2"
      fill="${li.fill}" stroke="${li.stroke}" stroke-width="1.5"${li.dashBox ? ` stroke-dasharray="${li.dashBox}"` : ''}/>
    <text x="${28 + i * col}" y="19" font-family="${FONT}" font-size="9" fill="#374151">${li.label}</text>`).join('')}
    ${lineItems.map((li, i) => `
    <line x1="${12 + i * col}" y1="35" x2="${34 + i * col}" y2="35"
      stroke="${li.color}" stroke-width="2"/>
    <text x="${40 + i * col}" y="39" font-family="${FONT}" font-size="9" fill="#374151">${li.label}</text>`).join('')}
  </g>`;
}

// ── Overview SVG ───────────────────────────────────────────────────────────

function renderOverview() {
  const W = 1080;
  const H = 760;
  const legendY = H - 48;

  const domainMap = Object.fromEntries(
    config.domains.map(d => [d.id, { ...d, cx: d.x + BOX_W / 2, cy: d.y + BOX_H / 2 }])
  );

  // No flow lines on the overview — detail views show per-domain relationships
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs></defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="white"/>

  <!-- Title -->
  <text x="25" y="26" font-family="${FONT}" font-size="16" font-weight="700" fill="#111827">${config.title}</text>
  <text x="25" y="43" font-family="${FONT}" font-size="11" fill="#6b7280">${config.subtitle || ''}</text>

  <!-- Cross-cutting banner -->
  <rect x="25" y="54" width="${W - 50}" height="36" rx="6"
    fill="#f0fdf4" stroke="#16a34a" stroke-width="1"/>
  <text x="${W / 2}" y="68" text-anchor="middle"
    font-family="${FONT}" font-size="8" font-weight="700" fill="#15803d" letter-spacing="0.07em">CROSS-CUTTING CONCERNS</text>
  <text x="${W / 2}" y="81" text-anchor="middle"
    font-family="${FONT}" font-size="10" fill="#166534">${(config.cross_cutting || []).join('  ·  ')}</text>

  <!-- Domains (click to drill in) -->
${config.domains.map(d => domainBox(d, d.x + BOX_W / 2, d.y + BOX_H / 2, true)).join('\n')}

${overviewLegendSvg(25, legendY, W - 50)}
</svg>`;
}

// ── Detail SVG ─────────────────────────────────────────────────────────────

function renderDetail(domainId) {
  const W = 960;
  const H = 800;
  const CX = W / 2;
  const CY = H / 2 - 20;   // 380 — shifted up slightly to make room for legend
  const legendY = H - 68;

  const center = config.domains.find(d => d.id === domainId);
  if (!center) throw new Error(`Unknown domain: ${domainId}`);

  const domainMap = Object.fromEntries(config.domains.map(d => [d.id, d]));

  const flows = groupIntoFlows(config);
  const defsStr = defsForFlows(flows);

  // Collect partner domains
  const partnerIds = new Set();
  for (const f of flows) {
    if (f.from === domainId && f.to !== domainId) partnerIds.add(f.to);
    if (f.to === domainId && f.from !== domainId) partnerIds.add(f.from);
  }
  const partners = [...partnerIds].filter(id => domainMap[id]);

  // Arrange partners in a circle. Smaller radius keeps arrows shorter and labels readable.
  const n = partners.length;
  const radius = n <= 2 ? 220 : n <= 4 ? 248 : 272;
  const partnerPositions = {};
  partners.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    partnerPositions[id] = {
      cx: CX + radius * Math.cos(angle),
      cy: CY + radius * Math.sin(angle),
    };
  });

  const arrowLines = [];
  const labelGroups = [];

  // Group flows by partner
  const flowsByPartner = {};
  for (const f of flows) {
    let partnerId = null, direction = null;
    if (f.from === domainId && partnerPositions[f.to]) {
      partnerId = f.to; direction = 'out';
    } else if (f.to === domainId && partnerPositions[f.from]) {
      partnerId = f.from; direction = 'in';
    }
    if (!partnerId) continue;
    if (!flowsByPartner[partnerId]) flowsByPartner[partnerId] = [];
    flowsByPartner[partnerId].push({ ...f, direction });
  }

  for (const [partnerId, partnerFlows] of Object.entries(flowsByPartner)) {
    const p = partnerPositions[partnerId];

    // Raw box edges on the center-to-partner axis (no offset)
    const [ex1, ey1] = boxEdge(CX, CY, p.cx, p.cy);
    const [ex2, ey2] = boxEdge(p.cx, p.cy, CX, CY);

    const hasOut = partnerFlows.some(f => f.direction === 'out');
    const hasIn  = partnerFlows.some(f => f.direction === 'in');
    const bidi   = hasOut && hasIn;

    // Single line color for this partner pair
    const pairStyle = dominantStyle(partnerFlows);
    const lineColor = PAIR_LINE_COLOR[pairStyle];
    const markerId  = `arrow-${lineColor.replace('#', '')}`;

    for (const f of partnerFlows) {
      // Parallel offset so bidi arrows don't overlap
      const off = bidi ? (f.direction === 'out' ? 10 : -10) : 0;
      const [ox, oy] = off !== 0 ? perpOffset(ex1, ey1, ex2, ey2, off) : [0, 0];

      // Arrow start and end (with gapped arrowhead)
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
        `stroke="${lineColor}" stroke-width="1.5" ` +
        `marker-end="url(#${markerId})"/>`
      );

      // ── Label placement ────────────────────────────────────────────────
      // Place labels at the MIDPOINT of the arrow, offset perpendicularly.
      // This spreads labels along the arrows rather than clustering them near boxes.

      const labelItems = f.names.length > 0
        ? f.names
        : (f.type === 'api' ? ['« direct API »'] : []);
      if (labelItems.length === 0) continue;

      // Midpoint of this arrow segment
      const midX = (lx1 + lx2) / 2;
      const midY = (ly1 + ly2) / 2;

      // Perpendicular offset from the midpoint for the label block.
      // Bidi: put IN and OUT labels on opposite sides.
      // Unidirectional: offset to one side for readability.
      const labelOff = bidi ? (f.direction === 'out' ? 22 : -22) : 18;
      const [lax, lay] = perpOffset(lx1, ly1, lx2, ly2, labelOff);
      const ax = midX + lax;
      const ay = midY + lay;

      // Text anchor: derived from the perpendicular offset direction so text
      // always extends away from the arrow, regardless of quadrant.
      const anchor = lax > 1 ? 'start' : lax < -1 ? 'end' : 'middle';

      const partnerLabel = domainMap[partnerId]?.label || partnerId;
      const headerText = f.direction === 'in' ? `${partnerLabel} →` : `→ ${partnerLabel}`;

      const tspans = [
        `<tspan x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" font-size="7.5" fill="#9ca3af">${headerText}</tspan>`,
        ...labelItems.map((label, i) => {
          const textColor = EVENT_TEXT_COLOR[f.statuses[i]] || EVENT_TEXT_COLOR.planned;
          return `<tspan x="${ax.toFixed(1)}" dy="11" fill="${textColor}">${label}</tspan>`;
        }),
      ].join('');

      labelGroups.push(
        `  <text text-anchor="${anchor}" font-family="${MONO}" font-size="8.5">${tspans}</text>`
      );
    }
  }

  const backLink =
    `  <text x="20" y="28" font-family="${FONT}" font-size="12" fill="#2563eb"\n` +
    `    data-navigate="__overview__" style="cursor:pointer">← Context Map</text>\n` +
    `  <text x="112" y="28" font-family="${FONT}" font-size="12" fill="#6b7280"> / ${center.label}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
${defsStr}

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="white"/>

${backLink}

  <!-- Flows -->
${arrowLines.join('\n')}

  <!-- Event labels -->
${labelGroups.join('\n')}

  <!-- Partner domains -->
${partners.map(id => {
    const d = domainMap[id];
    const p = partnerPositions[id];
    return domainBox(d, p.cx, p.cy, true);
  }).join('\n')}

  <!-- Center domain -->
${domainBox(center, CX, CY, false)}

${detailLegendSvg(25, legendY, W - 50)}
</svg>`;
}

// ── Main ───────────────────────────────────────────────────────────────────

const overviewSvg = renderOverview();
writeFileSync(resolve(OUT_DIR, 'overview.svg'), overviewSvg, 'utf8');
console.log('Written: output/overview.svg');

for (const d of config.domains) {
  const svg = renderDetail(d.id);
  writeFileSync(resolve(OUT_DIR, `${d.id}.svg`), svg, 'utf8');
  console.log(`Written: output/${d.id}.svg`);
}
