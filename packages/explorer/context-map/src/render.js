#!/usr/bin/env node
/**
 * render.js
 *
 * Generates per-domain detail SVGs and an overview SVG from config.yaml.
 * Output goes to dist/ (default) or the path provided as argv[2].
 *
 * Usage:
 *   node render.js [outDir]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Package-level: domain registry and event definitions
const pkgConfig = yaml.load(readFileSync(resolve(__dirname, '..', '..', 'config.yaml'), 'utf8'));
// Diagram-level: title, subtitle, overview layout positions
const mapConfig = yaml.load(readFileSync(resolve(__dirname, '..', 'config', 'config.yaml'), 'utf8'));

// Merged config: attach layout positions (x, y) to each domain
const config = {
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

const OUT_DIR = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, 'dist');
mkdirSync(OUT_DIR, { recursive: true });

// ── Constants ──────────────────────────────────────────────────────────────

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const STATUS_STYLE = {
  partial:           { fill: '#eff6ff', stroke: '#2563eb', sw: 2,   dash: false },
  'not-started':     { fill: '#f9fafb', stroke: '#9ca3af', sw: 1.5, dash: true  },
  'design-complete': { fill: '#f0fdf4', stroke: '#16a34a', sw: 2,   dash: false },
};

// Per-status color for individual event/API labels
const EVENT_STATUS_COLOR = {
  implemented: '#16a34a',
  planned:     '#2563eb',
  partial:     '#2563eb',
  api:         '#0369a1',
};

// Flow sequence diagram constants
const GAP_COLOR = '#f97316';

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
function headerBarParts(W, leftParts = [], centerLabel = null) {
  const parts = [
    `<rect x="0" y="0" width="${W}" height="44" fill="#f9fafb"/>`,
    `<line x1="0" y1="44" x2="${W}" y2="44" stroke="#e5e7eb" stroke-width="1"/>`,
    ...leftParts,
  ];
  if (centerLabel) {
    parts.push(svgText(centerLabel, 700, 27, { anchor: 'middle', size: 13, weight: 700, fill: '#111827' }));
  }
  // Legend (right side)
  const legItems = [
    { status: 'design-complete', label: 'Complete'     },
    { status: 'partial',         label: 'In progress'  },
    { status: 'not-started',     label: 'Planned'      },
  ];
  let lx = 856;
  for (const item of legItems) {
    const st   = STATUS_STYLE[item.status];
    const dash = st.dash ? ' stroke-dasharray="4 3"' : '';
    parts.push(`<polygon points="${hexPtsStr(lx + 6, 23, 6)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"${dash}/>`);
    parts.push(svgText(item.label, lx + 17, 27, { size: 9, fill: '#374151' }));
    lx += 104;
  }
  return parts;
}

// ── Flow grouping ──────────────────────────────────────────────────────────

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

// ── Flow sequence diagram helpers ──────────────────────────────────────────

const FRAGMENT_STYLES = {
  par: { stroke: '#7c3aed', fill: 'rgba(124,58,237,0.03)', label: 'par' },
  opt: { stroke: '#2563eb', fill: 'rgba(37,99,235,0.04)',  label: 'opt' },
};

function flattenSteps(steps) {
  const result = [];
  for (const step of steps) {
    if (step.fragment !== undefined) {
      if (step.operands) {
        for (const op of step.operands) result.push(...flattenSteps(op.steps || []));
      } else {
        result.push(...flattenSteps(step.steps || []));
      }
    } else {
      result.push(step);
    }
  }
  return result;
}

function collectFragments(steps) {
  const fragments = [];
  let flatIdx = 0;

  function walk(steps, depth) {
    for (const step of steps) {
      if (step.fragment !== undefined) {
        const startIdx = flatIdx;
        const separators = [];
        if (step.operands) {
          for (let i = 0; i < step.operands.length; i++) {
            walk(step.operands[i].steps || [], depth + 1);
            if (i < step.operands.length - 1) separators.push(flatIdx - 1);
          }
        } else {
          walk(step.steps || [], depth + 1);
        }
        const endIdx = flatIdx - 1;
        // Only collect fragments that have a visual type (opt/par).
        // Named sections (fragment with no type) are transparent — steps render as if at top level.
        if (endIdx >= startIdx && step.type) {
          fragments.push({ type: step.type, label: step.label, depth, startIdx, endIdx, separators });
        }
      } else {
        flatIdx++;
      }
    }
  }

  walk(steps, 0);
  return fragments;
}

// ── Flow sequence diagram page ─────────────────────────────────────────────

function renderFlowPage(flow) {
  const actorMap  = Object.fromEntries((config.actors  || []).map(a => [a.id, a]));
  const domainMap = Object.fromEntries(config.domains.map(d => [d.id, d]));
  const eventMap  = Object.fromEntries((config.events || []).map(e => [e.name, e]));

  const participants = (flow.participants || []).map(id => {
    if (actorMap[id])  return { id, type: 'actor',  label: actorMap[id].label };
    const d = domainMap[id];
    if (d)             return { id, type: 'domain', label: d.label, status: d.status };
    return             { id, type: 'unknown', label: id, status: 'not-started' };
  });

  const N = participants.length;

  // Fit N columns into a fixed 1400px canvas.
  const CANVAS_W = 1400, ML = 60, MR = 60;
  const inner    = CANVAS_W - ML - MR;
  const COL_W    = Math.floor(inner / (N + 0.3 * (N - 1)));
  const COL_GAP  = Math.round(COL_W * 0.3);
  const W        = CANVAS_W;

  const HEADER_TOP = 52, HEADER_H = 62;
  const LIFELINE_Y = HEADER_TOP + HEADER_H + 14;
  const FIRST_Y    = LIFELINE_Y + 38;
  const STEP_H     = 64;
  const FOOTER_H   = 80;
  const SELF_W     = 36;
  const SELF_H     = 20;

  const flatSteps = flattenSteps(flow.steps || []);
  const nSteps    = flatSteps.length;
  const fragments = collectFragments(flow.steps || []);
  const H = Math.max(500, FIRST_Y + nSteps * STEP_H + FOOTER_H);

  const colX   = participants.map((_, i) => ML + i * (COL_W + COL_GAP) + COL_W / 2);
  const colIdx = Object.fromEntries(participants.map((p, i) => [p.id, i]));

  // ── Column header divs ────────────────────────────────────────────────────

  const headerDivs = participants.map((p, i) => {
    const left = colX[i] - COL_W / 2;
    if (p.type === 'actor') {
      const st = ['position:absolute', `left:${left}px`, `top:${HEADER_TOP}px`,
        `width:${COL_W}px`, `height:${HEADER_H}px`,
        'background:#eef2ff', 'border:1.5px solid #4f46e5', 'border-radius:8px',
        'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
        'box-sizing:border-box', 'z-index:2'].join(';');
      return `<div style="${st}">` +
        `<div style="font-size:9px;color:#4338ca;margin-bottom:2px;">&#128100;</div>` +
        `<div style="font-size:12px;font-weight:700;color:#3730a3;">${p.label}</div></div>`;
    }
    const s      = STATUS_STYLE[p.status] || STATUS_STYLE['not-started'];
    const border = s.dash ? `1.5px dashed ${s.stroke}` : `1.5px solid ${s.stroke}`;
    const st = ['position:absolute', `left:${left}px`, `top:${HEADER_TOP}px`,
      `width:${COL_W}px`, `height:${HEADER_H}px`,
      `background:${s.fill}`, `border:${border}`, 'border-radius:8px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'text-align:center', 'box-sizing:border-box', 'z-index:2', 'padding:4px 6px'].join(';');
    return `<div style="${st}">` +
      `<div style="font-size:12px;font-weight:700;color:#111827;">${p.label}</div></div>`;
  }).join('\n');

  // ── SVG: lifelines + arrows ───────────────────────────────────────────────

  const svgParts = [`  <defs>
    <marker id="sq-gray"   markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#9ca3af" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-green"  markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#16a34a" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-indigo" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#4f46e5" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-orange" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#f97316" fill="none" stroke-width="1.5"/></marker>
  </defs>`];

  // Fragment rectangles (drawn before lifelines so they sit behind everything)
  const FRAG_PAD = 10;
  for (const frag of fragments) {
    const style = FRAGMENT_STYLES[frag.type] || FRAGMENT_STYLES['opt'];
    const inset = frag.depth * 12;
    const fx    = ML - FRAG_PAD + inset;
    const fw    = (W - ML - MR) + FRAG_PAD * 2 - inset * 2;
    const fy    = (FIRST_Y + frag.startIdx * STEP_H - STEP_H * 0.4).toFixed(1);
    const fh    = (STEP_H * (frag.endIdx - frag.startIdx + 0.95)).toFixed(1);

    svgParts.push(
      `  <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" ` +
      `rx="3" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1" stroke-dasharray="5,3"/>`
    );

    const lw = 28, lh = 16, lx = fx, ly = parseFloat(fy);
    svgParts.push(
      `  <polygon points="${lx},${ly} ${lx+lw},${ly} ${lx+lw+8},${ly+lh/2} ${lx+lw},${ly+lh} ${lx},${ly+lh}" ` +
      `fill="${style.stroke}" fill-opacity="0.18" stroke="${style.stroke}" stroke-width="1"/>`
    );
    svgParts.push(
      `  <text x="${(lx + lw/2).toFixed(1)}" y="${(ly + lh - 4).toFixed(1)}" ` +
      `font-size="9" font-weight="700" text-anchor="middle" fill="${style.stroke}" ` +
      `font-family="${FONT}">${style.label}</text>`
    );

    if (frag.label) {
      svgParts.push(
        `  <text x="${(lx + lw + 14).toFixed(1)}" y="${(ly + lh - 4).toFixed(1)}" ` +
        `font-size="9" fill="${style.stroke}" font-style="italic" ` +
        `font-family="${FONT}">[${frag.label}]</text>`
      );
    }

    for (const sepIdx of (frag.separators || [])) {
      const sy = (FIRST_Y + (sepIdx + 0.5) * STEP_H).toFixed(1);
      svgParts.push(
        `  <line x1="${fx}" y1="${sy}" x2="${fx + fw}" y2="${sy}" ` +
        `stroke="${style.stroke}" stroke-width="1" stroke-dasharray="4,2"/>`
      );
    }
  }

  // Lifelines
  for (let i = 0; i < N; i++) {
    svgParts.push(
      `  <line x1="${colX[i]}" y1="${LIFELINE_Y}" x2="${colX[i]}" y2="${H - FOOTER_H}" ` +
      `stroke="${participants[i].type === 'actor' ? '#fde68a' : '#e5e7eb'}" stroke-width="1.5" stroke-dasharray="5,4"/>`
    );
  }

  // Steps
  const labelDivs = [];
  let gapIdx = 0, regIdx = 0;
  flatSteps.forEach((step, idx) => {
    const y = FIRST_Y + idx * STEP_H;

    if (step.ref) {
      const refFlow  = (config.flows || []).find(f => f.id === step.ref);
      const refLabel = refFlow?.label || step.label || step.ref;
      const flowIds  = (config.flows || []).map(f => f.id);
      const isBack   = flowIds.indexOf(step.ref) < flowIds.indexOf(flow.id);
      const arrow    = isBack ? '&#8592;' : '&#8594;';
      const refText  = isBack ? `${arrow} ${refLabel}` : `${refLabel} ${arrow}`;
      const boxH2 = 36, boxY = y - boxH2 / 2;
      labelDivs.push(
        `<div data-navigate="flow_${refFlow?.domain}_${step.ref}" style="position:absolute;left:${ML}px;top:${boxY}px;` +
        `width:${W - ML - MR}px;height:${boxH2}px;border:1.5px solid #93c5fd;border-radius:4px;` +
        `background:#eff6ff;display:flex;align-items:center;justify-content:center;` +
        `cursor:pointer;z-index:3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">` +
        `<span style="position:absolute;top:3px;left:6px;font-size:7px;font-weight:700;color:#2563eb;` +
        `border:1px solid #93c5fd;border-radius:2px;padding:0 3px;background:white;">ref</span>` +
        `<span style="font-size:10px;color:#2563eb;font-weight:600;">${refText}</span>` +
        `</div>`
      );
      return;
    }

    if (step.self) {
      const si = colIdx[step.self];
      if (si == null) return;
      const sx     = colX[si];
      const isGap  = !!step.gap;
      const color  = isGap ? GAP_COLOR : '#6b7280';
      const dash   = isGap ? ' stroke-dasharray="5,3"' : '';
      const marker = isGap ? 'sq-orange' : 'sq-gray';
      const prefix = isGap ? '\u26a0\ufe0f\u202f' : '';
      // Right-side columns go left so the label doesn't overflow the fragment box.
      const goLeft = sx > W / 2;
      const dx     = goLeft ? -SELF_W : SELF_W;
      const retX   = goLeft ? sx - 8 : sx + 8;
      svgParts.push(
        `  <line x1="${sx}" y1="${y}" x2="${sx + dx}" y2="${y}" stroke="${color}" stroke-width="1.5"${dash}/>` +
        `\n  <line x1="${sx + dx}" y1="${y}" x2="${sx + dx}" y2="${y + SELF_H}" stroke="${color}" stroke-width="1.5"${dash}/>` +
        `\n  <line x1="${sx + dx}" y1="${y + SELF_H}" x2="${retX}" y2="${y + SELF_H}" stroke="${color}" stroke-width="1.5"${dash} marker-end="url(#${marker})"/>` +
        `\n  <circle cx="${sx}" cy="${y}" r="3" fill="${color}"/>`
      );
      const labelX         = (sx + dx + (goLeft ? -6 : 6)).toFixed(1);
      const labelTransform = goLeft ? 'transform:translate(-100%,0);text-align:right;' : '';
      labelDivs.push(
        `<div style="position:absolute;left:${labelX}px;top:${(y - 9).toFixed(1)}px;` +
        `${labelTransform}font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:9px;font-weight:600;` +
        `color:${color};white-space:nowrap;z-index:3;">${prefix}${step.label || ''}</div>`
      );
      if (isGap && step.gap_description) {
        const id      = `g${gapIdx++}`;
        const hitLeft = goLeft ? sx + dx - 6 : sx;
        labelDivs.push(
          `<div class="int-hit" data-int-id="${id}" style="position:absolute;` +
          `left:${hitLeft}px;top:${(y - 5)}px;width:${SELF_W + 6}px;height:${SELF_H + 14}px;` +
          `background:transparent;cursor:help;z-index:4;"></div>` +
          `<div class="int-content" data-int-id="${id}" style="display:none;">` +
          `<div style="font-size:7.5px;font-weight:700;color:${GAP_COLOR};">\u26a0\ufe0f Gap</div>` +
          `<div style="font-size:8px;color:#374151;">${step.gap_description}</div>` +
          `</div>`
        );
      }
      return;
    }

    const fi = colIdx[step.from], ti = colIdx[step.to];
    if (fi == null || ti == null) return;

    const fx = colX[fi], tx = colX[ti];
    const isActor  = participants[fi].type === 'actor';
    const evStatus = step.event ? (eventMap[step.event]?.status || 'planned') : null;
    let color, markerId;
    if      (step.gap)                   { color = GAP_COLOR;  markerId = 'sq-orange'; }
    else if (isActor)                    { color = '#4f46e5';  markerId = 'sq-indigo'; }
    else if (evStatus === 'implemented') { color = '#16a34a';  markerId = 'sq-green';  }
    else                                 { color = '#9ca3af';  markerId = 'sq-gray';   }

    const dir  = tx > fx ? 1 : -1;
    const x2   = tx - dir * 8;
    const dash = step.gap ? 'stroke-dasharray="5,3"' : isActor ? 'stroke-dasharray="6,3"' : '';
    svgParts.push(
      `  <line x1="${fx}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="1.5" ${dash} marker-end="url(#${markerId})"/>`
    );
    svgParts.push(`  <circle cx="${fx}" cy="${y}" r="3" fill="${color}"/>`);
    svgParts.push(`  <circle cx="${tx}" cy="${y}" r="3" fill="${color}"/>`);

    const midX  = ((fx + tx) / 2).toFixed(1);
    const aboveY = (y - 13).toFixed(1);
    const belowY = (y + 4 + (step.condition ? 12 : 0)).toFixed(1);
    const gapPrefix = step.gap ? '\u26a0\ufe0f\u202f' : '';
    const icon = !isActor && step.event ? '\u26a1\u202f' : '';
    const mainText = step.event || step.label || '';

    let above = `<div style="font-size:9px;font-weight:600;color:${color};white-space:nowrap;">${gapPrefix}${icon}${mainText}</div>`;
    if (step.condition) above += `<div style="font-size:8px;color:#2563eb;font-style:italic;white-space:nowrap;">[${step.condition}]</div>`;

    labelDivs.push(
      `<div style="position:absolute;left:${midX}px;top:${aboveY}px;transform:translate(-50%,0);` +
      `text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;z-index:3;">${above}</div>`
    );
    if (step.note) {
      labelDivs.push(
        `<div style="position:absolute;left:${midX}px;top:${belowY}px;transform:translate(-50%,0);` +
        `text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:8px;` +
        `color:#6b7280;max-width:220px;white-space:normal;z-index:3;">${step.note}</div>`
      );
    }
    if (step.regulatory && step.regulatory.length) {
      const id  = `r${regIdx++}`;
      const tipX = (parseFloat(midX) + Math.abs(tx - fx) * 0.3 + 4).toFixed(1);
      const tipRows = step.regulatory.map((r, i) =>
        (i > 0 ? `<div style="border-top:1px solid #e5e7eb;margin-top:4px;padding-top:4px;"></div>` : '') +
        `<div style="font-size:7.5px;font-weight:700;color:#4f46e5;">${r.citation}</div>` +
        `<div style="font-size:8px;color:#374151;">${r.summary}</div>` +
        (r.detail ? `<div style="font-size:7.5px;color:#6b7280;font-style:italic;">${r.detail}</div>` : '')
      ).join('');
      labelDivs.push(
        `<div class="int-hit" data-int-id="${id}" style="position:absolute;` +
        `left:${tipX}px;top:${(y - 7)}px;width:14px;height:14px;` +
        `display:flex;align-items:center;justify-content:center;` +
        `background:#f0f4ff;border:1px solid #c7d2fe;border-radius:3px;` +
        `cursor:help;z-index:4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;` +
        `font-size:8px;color:#6366f1;">&#9878;</div>` +
        `<div class="int-content" data-int-id="${id}" style="display:none;">${tipRows}</div>`
      );
    }
    if (step.gap && step.gap_description) {
      const id = `g${gapIdx++}`;
      const hitW = Math.abs(tx - fx) * 0.6;
      labelDivs.push(
        `<div class="int-hit" data-int-id="${id}" style="position:absolute;` +
        `left:${midX}px;top:${(y - 14)}px;width:${hitW.toFixed(1)}px;height:28px;` +
        `transform:translateX(-50%);background:transparent;cursor:help;z-index:4;"></div>` +
        `<div class="int-content" data-int-id="${id}" style="display:none;">` +
        `<div style="font-size:7.5px;font-weight:700;color:${GAP_COLOR};">\u26a0\ufe0f Gap</div>` +
        `<div style="font-size:8px;color:#374151;">${step.gap_description}</div>` +
        `</div>`
      );
    }
  });

  // ── Header bar ────────────────────────────────────────────────────────────

  const mkArrow = (color, dash) =>
    `<svg width="28" height="10" style="overflow:visible;vertical-align:middle;">` +
    `<line x1="2" y1="5" x2="20" y2="5" stroke="${color}" stroke-width="1.5"${dash ? ' stroke-dasharray="5,3"' : ''}/>` +
    `<path d="M18,2 L26,5 L18,8" stroke="${color}" fill="none" stroke-width="1.5"/></svg>`;

  const domainLabel = domainMap[flow.domain]?.label || flow.domain;

  const flowHeader =
    `<div style="position:absolute;top:0;left:0;right:0;height:44px;background:#f9fafb;` +
    `border-bottom:1px solid #e5e7eb;display:flex;align-items:center;padding:0 20px;` +
    `z-index:10;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">` +
    `<div class="slide-nav" style="font-size:12px;">` +
    `<span data-navigate="domains" style="color:#2563eb;cursor:pointer;">&#8592; Context Map</span>` +
    `<span style="color:#6b7280;"> / </span>` +
    `<span data-navigate="domain_${flow.domain}" style="color:#2563eb;cursor:pointer;">${domainLabel}</span>` +
    `<span style="color:#6b7280;"> / ${flow.label}</span>` +
    `</div>` +
    `<div style="position:absolute;right:20px;top:0;height:44px;display:flex;align-items:center;gap:14px;font-size:9px;">` +
    `<span>${mkArrow('#16a34a', false)}&thinsp;Implemented</span>` +
    `<span>${mkArrow('#9ca3af', false)}&thinsp;Planned</span>` +
    `<span>${mkArrow('#4f46e5', false)}&thinsp;Human action</span>` +
    `<span>${mkArrow('#f97316', true)}&thinsp;Gap</span>` +
    `</div>` +
    `</div>`;

  return `<div style="position:relative;width:${W}px;height:${H}px;` +
    `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:white;overflow:visible;" ` +
    `data-domain="${flow.domain}">
${flowHeader}
  <svg style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible;" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${svgParts.join('\n')}
  </svg>
${headerDivs}
${labelDivs.join('\n')}
</div>`;
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
      svgText(config.title || 'Context Map', 700, 27, { anchor: 'middle', size: 13, weight: 700, fill: '#111827' }),
    ]),
    `<g class="slide-nav">${svgText('Click a domain to explore', 12, 27, { anchor: 'start', size: 9, fill: '#9ca3af', italic: true })}</g>`,
  ];

  // Cross-cutting banner
  const cc = (config.cross_cutting || []).join(' \u00b7 ');
  parts.push(
    `<rect x="40" y="55" width="${W - 80}" height="46" rx="6" fill="#f0fdf4" stroke="#16a34a" stroke-width="1"/>`,
    svgText('CROSS-CUTTING CONCERNS', 700, 73, { anchor: 'middle', size: 9, weight: 700, fill: '#15803d' }),
    svgText(cc, 700, 90, { anchor: 'middle', size: 12, fill: '#166534' }),
  );

  // Domain hexagons
  const inrOv   = R_OV * hcos(30);
  const LABEL_W = inrOv * 1.5;   // labels are short — generous budget
  const DESC_W  = inrOv * 1.45;  // descriptions are medium-length prose

  for (const d of sortedDomains) {
    const { cx, cy } = d;

    const isNav   = d.status !== 'not-started';
    const navAttr = isNav ? `data-navigate="domain_${d.id}" cursor="pointer"` : '';
    parts.push(hexPoly(cx, cy, R_OV, d.status, navAttr));

    const labelLines = wrapLines(d.label, LABEL_W, 13);
    const descLines  = wrapLines(d.description || '', DESC_W, 9);

    const LLH = 17, DLH = 12, GAP = 5;
    const totalH = labelLines.length*LLH + GAP + descLines.length*DLH;
    let ty = cy - totalH/2 + LLH * 0.8;

    parts.push(...textBlock(cx, ty, labelLines, LLH, 13, '#111827', 700));
    ty += labelLines.length*LLH + GAP;
    parts.push(...textBlock(cx, ty, descLines, DLH, 9, '#6b7280'));
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
  parts.push(
    ...headerBarParts(W, [
      `<g class="slide-nav" data-navigate="domains" cursor="pointer">`,
      `  <text x="20" y="27" font-size="12" fill="#2563eb" font-family="${FONT}">&#8592; Context Map</text>`,
      `</g>`,
    ], center.label),
    // Event status legend — right-to-left from right edge so it never clips
    // Icons match the diagram: ⚡ for events, ⇄ for API calls
    ...(() => {
      const items = [
        { color: '#0369a1', icon: '\u21c4', label: 'API call', italic: true },
        { color: '#2563eb', icon: '\u26a1', label: 'Planned' },
        { color: '#16a34a', icon: '\u26a1', label: 'Implemented' },
      ];
      const out = [];
      let rx = W - 20;
      for (const item of items) {
        const fullText = item.icon + '\u2009' + item.label;
        const lw = fullText.length * 5.8;
        out.push(svgText(fullText, rx, 27, { anchor: 'end', size: 9, fill: item.color, italic: item.italic }));
        rx = Math.round(rx - lw - 16);
      }
      return out;
    })(),
  );

  // ── Flows strip ───────────────────────────────────────────────────────────
  if (hasFlows) {
    parts.push(`<g class="slide-nav">`);
    parts.push(
      `<rect x="0" y="44" width="${W}" height="32" fill="#f0f9ff"/>`,
      `<line x1="0" y1="76" x2="${W}" y2="76" stroke="#bae6fd" stroke-width="1"/>`,
      svgText('Flows', 20, 64, { size: 9, weight: 600, fill: '#0369a1' }),
    );
    let fx = 76;
    for (const flow of domainFlows) {
      const label = flow.label || flow.id;
      const tw = Math.ceil(label.length * 6.5 + 20);
      parts.push(
        `<g data-navigate="flow_${flow.domain}_${flow.id}" cursor="pointer">`,
        `  <rect x="${fx}" y="50" width="${tw}" height="19" rx="4" fill="white" stroke="#bae6fd"/>`,
        `  ${svgText(label, fx + tw / 2, 63.5, { anchor: 'middle', size: 9, fill: '#0284c7' })}`,
        `</g>`,
      );
      fx += tw + 8;
    }
    parts.push(`</g>`);
  }

  // ── Connection lines (plain gray, no arrowheads) ──────────────────────────
  for (const { px, py, angleDeg } of Object.values(partnerData)) {
    const [x1, y1] = hexFacePt(CX, CY, CR, angleDeg,       3);
    const [x2, y2] = hexFacePt(px, py, PR, angleDeg + 180, 3);
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e2e8f0" stroke-width="2"/>`);
  }

  // ── Partner hexagons + event label blocks ─────────────────────────────────
  for (const [pid, { px, py, angleDeg }] of Object.entries(partnerData)) {
    const partner = domainMap[pid];
    if (!partner) continue;

    const inrP  = PR * hcos(30);
    const MAX_W = inrP * 1.5;

    // Hex shape — navigable unless not-started
    const isNav   = partner.status !== 'not-started';
    const navAttr = isNav ? `data-navigate="${pid}" cursor="pointer"` : '';
    parts.push(hexPoly(px, py, PR, partner.status, navAttr));

    // Label, description, entities inside hex
    const labelLines = wrapLines(partner.label, MAX_W, 12);
    const descLines  = wrapLines(partner.description || '', MAX_W, 8.5);
    const entArr     = partner.entities || [];
    const entStr     = entArr.slice(0, 3).join(', ') + (entArr.length > 3 ? '\u2026' : '');
    const entLines   = wrapLines(entStr, MAX_W, 7.5);

    const LLH = 15, DLH = 12, ELH = 10, GAP = 4;
    const totalH = labelLines.length*LLH + GAP + descLines.length*DLH + GAP + entLines.length*ELH;
    let ty = py - totalH/2 + LLH * 0.8;

    parts.push(...textBlock(px, ty, labelLines, LLH, 12, '#111827', 700));
    ty += labelLines.length*LLH + GAP;
    parts.push(...textBlock(px, ty, descLines, DLH, 8.5, '#6b7280'));
    ty += descLines.length*DLH + GAP;
    parts.push(...textBlock(px, ty, entLines, ELH, 7.5, '#9ca3af'));

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
    parts.push(`<line x1="${facePtX.toFixed(1)}" y1="${facePtY.toFixed(1)}" x2="${tickX2.toFixed(1)}" y2="${facePtY.toFixed(1)}" stroke="#cbd5e1" stroke-width="1"/>`);

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

  parts.push(...textBlock(CX, cty, cLabelLns, C_LLH, 17, '#111827', 700));
  cty += cLabelLns.length*C_LLH + C_GAP;
  parts.push(...textBlock(CX, cty, cDescLns, C_DLH, 9.5, '#6b7280'));
  cty += cDescLns.length*C_DLH + C_GAP;
  parts.push(...textBlock(CX, cty, cEntLns, C_ELH, 8.5, '#9ca3af'));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block">\n${parts.join('\n')}\n</svg>`;
}

// ── Main ───────────────────────────────────────────────────────────────────

const overviewHtml = renderOverview();
writeFileSync(resolve(OUT_DIR, 'domains.html'), overviewHtml, 'utf8');
console.log('Written: domains.html');

for (const d of config.domains) {
  if (d.status === 'not-started') continue;
  const html = renderDetail(d.id);
  writeFileSync(resolve(OUT_DIR, `domain_${d.id}.html`), html, 'utf8');
  console.log(`Written: domain_${d.id}.html`);
}

for (const flow of (config.flows || [])) {
  const html = renderFlowPage(flow);
  writeFileSync(resolve(OUT_DIR, `flow_${flow.domain}_${flow.id}.html`), html, 'utf8');
  console.log(`Written: flow_${flow.domain}_${flow.id}.html`);
}
