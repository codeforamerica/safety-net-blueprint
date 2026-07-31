/**
 * render.js
 *
 * Generates per-domain detail SVGs and an overview SVG from the enriched
 * explorer config. Called by the consolidated packages/explorer/build.js.
 *
 * Exports: renderContextMap(pkgConfig, mapConfig, outDir)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// Set by renderContextMap() before any helper function is called.
let config;

// ── Constants ──────────────────────────────────────────────────────────────

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const STATUS_STYLE = {
  partial:           { fill: '#E6EBF9', stroke: '#5650BE', sw: 2,   dash: false },
  'not-started':     { fill: '#F3F3F3', stroke: '#E9CCBE', sw: 1.5, dash: true  },
  'design-complete': { fill: '#E2F9F6', stroke: '#00AD93', sw: 2,   dash: false },
};

// Per-status color for individual event/API labels
const EVENT_STATUS_COLOR = {
  implemented: '#00AD93',
  planned:     '#5650BE',
  partial:     '#5650BE',
  api:         '#2B1A78',
};

// ── Hex geometry helpers ───────────────────────────────────────────────────

const d2r  = deg => deg * Math.PI / 180;
const hcos = deg => Math.cos(d2r(deg));
const hsin = deg => Math.sin(d2r(deg));

/** Vertex string for a pointy-top hexagon centered at (cx, cy) with vertex-radius r. */
function hexPtsStr(cx, cy, r) {
  return Array.from({ length: 6 }, (_, k) =>
    `${(cx + r * hcos(30 + k * 60)).toFixed(1)},${(cy + r * hsin(30 + k * 60)).toFixed(1)}`
  ).join(' ');
}

/**
 * Point on the hex face nearest to angleDeg, extended outward by ext px.
 * For 0° (right) or 180° (left), this is exactly the flat-face midpoint.
 */
function hexFacePt(cx, cy, r, angleDeg, ext = 0) {
  const inr  = r * hcos(30);
  const face = Math.round(angleDeg / 60) * 60;
  const dist = inr / Math.cos(d2r(angleDeg - face)) + ext;
  return [cx + dist * hcos(angleDeg), cy + dist * hsin(angleDeg)];
}

/** Wrap text into lines fitting maxPx at fontSize (character-count approximation). */
function wrapLines(str, maxPx, fontSize) {
  const charW = fontSize * 0.62;
  const max   = Math.floor(maxPx / charW);
  const words = (str || '').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (test.length > max && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── SVG primitive helpers ──────────────────────────────────────────────────

/** Build a <text> SVG element string. */
function svgText(str, x, y, {
  anchor = 'start', size = 12, weight = 'normal', fill = '#111827', italic = false,
} = {}) {
  const wa = anchor !== 'start' ? ` text-anchor="${anchor}"` : '';
  const fw = weight !== 'normal' ? ` font-weight="${weight}"` : '';
  const fi = italic ? ` font-style="italic"` : '';
  return `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" font-size="${size}"${wa}${fw}${fi} fill="${fill}" font-family="${FONT}">${str}</text>`;
}

/** Build a hex <polygon> with status styling, plus any extra attribute string. */
function hexPoly(cx, cy, r, status, extra = '') {
  const st   = STATUS_STYLE[status] || STATUS_STYLE['not-started'];
  const dash = st.dash ? ' stroke-dasharray="6 4"' : '';
  const ext  = extra ? ` ${extra.trim()}` : '';
  return `<polygon points="${hexPtsStr(cx, cy, r)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.sw}"${dash}${ext}/>`;
}

/** Render wrapped text lines centered at cx. Returns an array of svgText strings. */
function textBlock(cx, startY, lines, lh, size, fill, weight = 'normal') {
  return lines.map((line, i) =>
    svgText(line, cx, startY + i * lh, { anchor: 'middle', size, weight, fill })
  );
}

// ── Standard header bar ────────────────────────────────────────────────────

/**
 * SVG elements for the shared 44px header bar (background, separator, legend).
 * `leftParts` — additional SVG elements to place on the left (e.g. breadcrumb).
 * `centerLabel` — label text centered at x=700 (omit for overview).
 */
function headerBarParts(W, leftParts = [], centerLabel = null, detailLegend = false) {
  const parts = [
    `<rect x="0" y="0" width="${W}" height="44" fill="#F3F3F3"/>`,
    `<line x1="0" y1="44" x2="${W}" y2="44" stroke="#E9CCBE" stroke-width="1"/>`,
    ...leftParts,
  ];
  if (centerLabel) {
    parts.push(svgText(centerLabel, 700, 27, { anchor: 'middle', size: 13, weight: 700, fill: '#000000' }));
  }

  const CHAR_W = 5.5;
  const GAP    = 20;
  let lx = 856;

  // Hex status items (all pages)
  for (const { status, label } of [
    { status: 'design-complete', label: 'Complete'    },
    { status: 'partial',         label: 'In progress' },
    { status: 'not-started',     label: 'Planned'     },
  ]) {
    const st   = STATUS_STYLE[status];
    const dash = st.dash ? ' stroke-dasharray="4 3"' : '';
    parts.push(`<polygon points="${hexPtsStr(lx + 6, 23, 6)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"${dash}/>`);
    parts.push(svgText(label, lx + 17, 27, { size: 9, fill: '#000000' }));
    lx += 17 + Math.ceil(label.length * CHAR_W) + GAP;
  }

  if (detailLegend) {
    // Separator
    parts.push(`<line x1="${lx - 8}" y1="14" x2="${lx - 8}" y2="32" stroke="#E9CCBE" stroke-width="1"/>`);

    // Edge type items
    for (const { icon, label, color, italic } of [
      { icon: '\u26a1', label: 'Event',    color: '#444',    italic: false },
      { icon: '\u21c4', label: 'API call', color: '#2B1A78', italic: true  },
    ]) {
      const text = icon + '\u2009' + label;
      parts.push(svgText(text, lx, 27, { size: 9, fill: color, italic }));
      lx += Math.ceil(text.length * CHAR_W) + GAP;
    }

    // Separator
    parts.push(`<line x1="${lx - 8}" y1="14" x2="${lx - 8}" y2="32" stroke="#E9CCBE" stroke-width="1"/>`);

    // Implementation status items
    for (const { label, color } of [
      { label: 'Implemented', color: '#00AD93' },
      { label: 'Planned',     color: '#5650BE' },
    ]) {
      parts.push(`<circle cx="${lx + 4}" cy="23" r="3.5" fill="${color}"/>`);
      parts.push(svgText(label, lx + 13, 27, { size: 9, fill: color }));
      lx += 13 + Math.ceil(label.length * CHAR_W) + GAP;
    }
  }

  return parts;
}

// ── Flow grouping (used by renderDetail for context map hub-and-spoke) ─────

function groupIntoFlows(cfg) {
  const flowMap = new Map();

  for (const e of cfg.events || []) {
    const status = e.status || 'planned';
    const subs = Array.isArray(e.subscribers) ? e.subscribers : (e.subscribers ? [e.subscribers] : []);
    for (const sub of subs) {
      const key = `${e.publisher}\u2192${sub}`;
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
      const key = `${caller}\u2192${a.domain}:api`;
      if (!flowMap.has(key)) {
        flowMap.set(key, { from: caller, to: a.domain, type: 'api', names: [], statuses: [] });
      }
      flowMap.get(key).names.push(a.call);
      flowMap.get(key).statuses.push('api');
    }
  }

  return [...flowMap.values()];
}

// ── Overview (SVG hex grid) ────────────────────────────────────────────────

function renderOverview() {
  const W = 1400, H = 840;
  const R_OV        = 100;  // hex vertex-radius — sized for readable text
  const COL_COUNT   = 4;
  const COL_SPACING = 310;  // center-to-center column distance
  const ROW_SPACING = 235;  // center-to-center row distance
  const GRID_TOP    = 240;  // y-coordinate of the first row center

  // Center the 4-column grid horizontally within the canvas
  const COL_START = Math.round((W - (COL_COUNT - 1) * COL_SPACING) / 2);

  // Sort by y then x (preserves config layout order) and assign to grid slots
  const sortedDomains = [...config.domains]
    .filter(d => d.x != null)
    .sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x)
    .map((d, idx) => ({
      ...d,
      cx: COL_START + (idx % COL_COUNT) * COL_SPACING,
      cy: GRID_TOP  + Math.floor(idx / COL_COUNT) * ROW_SPACING,
    }));

  const parts = [
    `<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`,
    ...headerBarParts(W, [
      svgText(config.title || 'Context Map', 700, 27, { anchor: 'middle', size: 13, weight: 700, fill: '#000000' }),
    ]),
    `<g class="slide-nav">${svgText('Click a domain to explore', 12, 27, { anchor: 'start', size: 9, fill: '#9ca3af', italic: true })}</g>`,
  ];

  // Cross-cutting banner
  const cc = (config.cross_cutting || []).join(' \u00b7 ');
  parts.push(
    `<rect x="40" y="55" width="${W - 80}" height="46" rx="6" fill="#E2F9F6" stroke="#00AD93" stroke-width="1"/>`,
    svgText('CROSS-CUTTING CONCERNS', 700, 73, { anchor: 'middle', size: 9, weight: 700, fill: '#006152' }),
    svgText(cc, 700, 90, { anchor: 'middle', size: 12, fill: '#00AD93' }),
  );

  // Domain hexagons
  const inrOv   = R_OV * hcos(30);
  const LABEL_W = inrOv * 1.5;   // labels are short — generous budget
  const DESC_W  = inrOv * 1.45;  // descriptions are medium-length prose

  for (const d of sortedDomains) {
    const { cx, cy } = d;

    const isNav = d.status !== 'not-started';
    if (isNav) parts.push(`<g data-navigate="domain_${d.id}" cursor="pointer">`);
    parts.push(hexPoly(cx, cy, R_OV, d.status));

    const labelLines = wrapLines(d.label, LABEL_W, 13);
    const descLines  = wrapLines(d.description || '', DESC_W, 9);

    const LLH = 17, DLH = 12, GAP = 5;
    const totalH = labelLines.length*LLH + GAP + descLines.length*DLH;
    let ty = cy - totalH/2 + LLH * 0.8;

    parts.push(...textBlock(cx, ty, labelLines, LLH, 13, '#000000', 700));
    ty += labelLines.length*LLH + GAP;
    parts.push(...textBlock(cx, ty, descLines, DLH, 9, '#6b7280'));
    if (isNav) parts.push(`</g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block">\n${parts.join('\n')}\n</svg>`;
}

// ── Detail (SVG hex hub-and-spoke) ─────────────────────────────────────────

function renderDetail(domainId) {
  const W = 1400, H = 1100;
  const CX = W / 2, CY = 555;
  const CR = 125, PR = 90;

  const center = config.domains.find(d => d.id === domainId);
  if (!center) throw new Error(`Unknown domain: ${domainId}`);

  const domainFlows = (config.flows || []).filter(f => f.domain === domainId);
  const hasFlows    = domainFlows.length > 0;
  const HEADER_H    = hasFlows ? 76 : 44;

  const domainMap = Object.fromEntries(config.domains.map(d => [d.id, d]));
  const allFlows  = groupIntoFlows(config);

  // Collect all domains that share at least one flow with this domain
  const partnerIds = new Set();
  for (const f of allFlows) {
    if (f.from === domainId && f.to !== domainId   && domainMap[f.to])   partnerIds.add(f.to);
    if (f.to   === domainId && f.from !== domainId && domainMap[f.from]) partnerIds.add(f.from);
  }
  const partners = [...partnerIds];
  const n = partners.length;

  // Orbit radius: guarantee ≥ 100px of label clearance between adjacent partner hexes.
  // Gap = ORBIT × 2 × sin(π/n) − 2 × PR × cos(30°) ≥ MIN_HEX_CLEARANCE
  const MIN_HEX_CLEARANCE = 100;
  const ORBIT = n <= 1
    ? 310
    : Math.max(278, Math.ceil((MIN_HEX_CLEARANCE + 2 * PR * hcos(30)) / (2 * Math.sin(Math.PI / n))));

  // Assign evenly-spaced angles starting at the top (−90°)
  const partnerData = {};
  partners.forEach((id, i) => {
    const angleDeg = 360 * i / n - 90;
    partnerData[id] = {
      px:       CX + ORBIT * hcos(angleDeg),
      py:       CY + ORBIT * hsin(angleDeg),
      angleDeg,
    };
  });

  // Tag each flow with which partner it belongs to and its direction
  const flowsByPartner = {};
  for (const f of allFlows) {
    let pid = null, dir = null;
    if (f.from === domainId && partnerData[f.to])   { pid = f.to;   dir = 'out'; }
    if (f.to   === domainId && partnerData[f.from]) { pid = f.from; dir = 'in';  }
    if (!pid) continue;
    if (!flowsByPartner[pid]) flowsByPartner[pid] = [];
    flowsByPartner[pid].push({ ...f, dir });
  }

  const parts = [
    `<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`,
  ];

  // ── Header bar ─────────────────────────────────────────────────────────────
  parts.push(...headerBarParts(W, [], center.label, true));


  // ── Connection lines (plain gray, no arrowheads) ──────────────────────────
  for (const { px, py, angleDeg } of Object.values(partnerData)) {
    const [x1, y1] = hexFacePt(CX, CY, CR, angleDeg,       3);
    const [x2, y2] = hexFacePt(px, py, PR, angleDeg + 180, 3);
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#E9CCBE" stroke-width="2"/>`);
  }

  // ── Partner hexagons + event label blocks ─────────────────────────────────
  for (const [pid, { px, py, angleDeg }] of Object.entries(partnerData)) {
    const partner = domainMap[pid];
    if (!partner) continue;

    const inrP  = PR * hcos(30);
    const MAX_W = inrP * 1.5;

    // Hex shape — navigable unless not-started
    const isNav = partner.status !== 'not-started';
    if (isNav) parts.push(`<g data-navigate="domain_${pid}" cursor="pointer">`);
    parts.push(hexPoly(px, py, PR, partner.status));

    // Label, description, entities inside hex
    const labelLines = wrapLines(partner.label, MAX_W, 12);
    const descLines  = wrapLines(partner.description || '', MAX_W, 8.5);
    const entArr     = partner.entities || [];
    const entStr     = entArr.slice(0, 3).join(', ') + (entArr.length > 3 ? '\u2026' : '');
    const entLines   = wrapLines(entStr, MAX_W, 7.5);

    const LLH = 15, DLH = 12, ELH = 10, GAP = 4;
    const totalH = labelLines.length*LLH + GAP + descLines.length*DLH + GAP + entLines.length*ELH;
    let ty = py - totalH/2 + LLH * 0.8;

    parts.push(...textBlock(px, ty, labelLines, LLH, 12, '#000000', 700));
    ty += labelLines.length*LLH + GAP;
    parts.push(...textBlock(px, ty, descLines, DLH, 8.5, '#6b7280'));
    ty += descLines.length*DLH + GAP;
    parts.push(...textBlock(px, ty, entLines, ELH, 7.5, '#9ca3af'));
    if (isNav) parts.push(`</g>`);

    // ── Event label block ──────────────────────────────────────────────────
    const partnerFlows = flowsByPartner[pid] || [];
    if (!partnerFlows.length) continue;

    const LH = 11.5, EFS = 8, HFS = 7, HLH = 10, SECGAP = 8, TICK_W = 14;

    // Labels extend from the nearest flat (left or right) face
    const labelDir = hcos(angleDeg) >= 0 ? 0 : 180;
    const ta       = labelDir === 0 ? 'start' : 'end';
    const [facePtX, facePtY] = hexFacePt(px, py, PR, labelDir, 0);
    const ax = facePtX + (labelDir === 0 ? TICK_W : -TICK_W);

    // Separate outbound (center→partner) and inbound (partner→center) items
    const outItems = partnerFlows
      .filter(f => f.dir === 'out')
      .flatMap(f => f.names.map((name, i) => ({ name, type: f.type, status: f.statuses[i] })));
    const inItems  = partnerFlows
      .filter(f => f.dir === 'in')
      .flatMap(f => f.names.map((name, i) => ({ name, type: f.type, status: f.statuses[i] })));

    const sections = [];
    if (outItems.length) sections.push({ header: `${center.label} \u2192 ${partner.label}`, items: outItems });
    if (inItems.length)  sections.push({ header: `${partner.label} \u2192 ${center.label}`,  items: inItems  });
    if (!sections.length) continue;

    let blockH = 0;
    sections.forEach((sec, si) => { if (si > 0) blockH += SECGAP; blockH += HLH + sec.items.length * LH; });

    let ey = py - blockH/2 + HLH * 0.8;
    ey = Math.max(ey, HEADER_H + 8);

    // Horizontal tick from flat hex face to label
    const tickX2 = facePtX + (labelDir === 0 ? TICK_W - 2 : -(TICK_W - 2));
    parts.push(`<line x1="${facePtX.toFixed(1)}" y1="${facePtY.toFixed(1)}" x2="${tickX2.toFixed(1)}" y2="${facePtY.toFixed(1)}" stroke="#E9CCBE" stroke-width="1"/>`);

    for (const [si, sec] of sections.entries()) {
      if (si > 0) ey += SECGAP;
      parts.push(svgText(sec.header, ax, ey, { anchor: ta, size: HFS, weight: 700, fill: '#94a3b8' }));
      ey += HLH;
      for (const item of sec.items) {
        const isApi = item.type === 'api';
        const icon  = isApi ? '\u21c4 ' : '\u26a1 ';
        const color = EVENT_STATUS_COLOR[isApi ? 'api' : (item.status || 'planned')] || '#2563eb';
        parts.push(svgText(icon + item.name, ax, ey, { anchor: ta, size: EFS, fill: color, italic: isApi }));
        ey += LH;
      }
    }
  }

  // ── Center hexagon (drawn on top) ─────────────────────────────────────────
  const cst   = STATUS_STYLE[center.status] || STATUS_STYLE['not-started'];
  const cdash = cst.dash ? ' stroke-dasharray="6 4"' : '';
  parts.push(`<polygon points="${hexPtsStr(CX, CY, CR)}" fill="${cst.fill}" stroke="${cst.stroke}" stroke-width="3"${cdash}/>`);

  const C_MAX_W   = CR * hcos(30) * 1.6;
  const cLabelLns = wrapLines(center.label, C_MAX_W, 17);
  const cDescLns  = wrapLines(center.description || '', C_MAX_W, 9.5);
  const cEntStr   = (center.entities || []).join(' \u00b7 ');
  const cEntLns   = wrapLines(cEntStr, C_MAX_W, 8.5);

  const C_LLH = 21, C_DLH = 13, C_ELH = 11, C_GAP = 5;
  const cTotalH = cLabelLns.length*C_LLH + C_GAP + cDescLns.length*C_DLH + C_GAP + cEntLns.length*C_ELH;
  let cty = CY - cTotalH/2 + C_LLH * 0.8;

  parts.push(...textBlock(CX, cty, cLabelLns, C_LLH, 17, '#000000', 700));
  cty += cLabelLns.length*C_LLH + C_GAP;
  parts.push(...textBlock(CX, cty, cDescLns, C_DLH, 9.5, '#6b7280'));
  cty += cDescLns.length*C_DLH + C_GAP;
  parts.push(...textBlock(CX, cty, cEntLns, C_ELH, 8.5, '#9ca3af'));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block">\n${parts.join('\n')}\n</svg>`;
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * @param {Object} pkgConfig  enriched explorer config (from resolveConfig())
 * @param {Object} mapConfig  context-map layout config (context-map/config/config.yaml)
 * @param {string} outDir     directory to write HTML fragment files into
 */
export function renderContextMap(pkgConfig, mapConfig, outDir) {
  config = {
    title:         mapConfig.title,
    subtitle:      mapConfig.subtitle,
    cross_cutting: pkgConfig.cross_cutting,
    events:        pkgConfig.events,
    apis:          pkgConfig.apis,
    actors:        pkgConfig.actors,
    flows:         pkgConfig.flows,
    domains:       (pkgConfig.domains || []).map(d => ({
      ...d,
      ...(mapConfig.layout?.[d.id] || {}),
    })),
  };

  mkdirSync(outDir, { recursive: true });

  const overviewHtml = renderOverview();
  writeFileSync(resolve(outDir, 'domains.html'), overviewHtml, 'utf8');
  console.log('Written: domains.html');

  for (const d of config.domains) {
    if (d.status === 'not-started') continue;
    const html = renderDetail(d.id);
    writeFileSync(resolve(outDir, `domain_${d.id}.html`), html, 'utf8');
    console.log(`Written: domain_${d.id}.html`);
  }

}
