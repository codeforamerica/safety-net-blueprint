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
  actors: pkgConfig.actors,
  flows: pkgConfig.flows,
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

// Gap color — behavior or contract not yet designed
const GAP_COLOR = '#f97316'; // orange-500

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
  // auto-start-reverse makes marker-start automatically flip 180° so both ends
  // point correctly without needing a separate reversed marker definition.
  return `  <defs>
    <marker id="${FLOW_MARKER_ID}" markerWidth="10" markerHeight="10"
      refX="10" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
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

// ── Header bar helpers ──────────────────────────────────────────────────────

/**
 * Top header bar for domain detail pages: breadcrumb (left) + legend (right).
 * Replaces the old bottom legend and the separate nav div.
 */
function detailHeaderHtml(domainLabel) {
  const sw = (fill, stroke, dash) =>
    `display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle;` +
    `margin-right:3px;background:${fill};border:1.5px ${dash ? 'dashed' : 'solid'} ${stroke};`;
  const bar = `position:absolute;top:0;left:0;right:0;height:44px;background:#f9fafb;` +
    `border-bottom:1px solid #e5e7eb;display:flex;align-items:center;padding:0 20px;` +
    `gap:16px;z-index:10;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:9px;`;
  return `<div style="${bar}">` +
    `<div style="font-size:12px;">` +
    `<span data-navigate="__overview__" style="color:#2563eb;cursor:pointer;">&#8592; Context Map</span>` +
    `<span style="color:#6b7280;"> / ${domainLabel}</span>` +
    `</div>` +
    `<div style="flex:1;"></div>` +
    `<span><span style="${sw('#f0fdf4','#16a34a',false)}"></span>Complete</span>` +
    `<span><span style="${sw('#eff6ff','#2563eb',false)}"></span>In progress</span>` +
    `<span><span style="${sw('#f9fafb','#9ca3af',true )}"></span>Planned</span>` +
    `<span>&#x26a1;&thinsp;Event &nbsp; &#x21c4;&thinsp;API call</span>` +
    `<span style="color:#9ca3af;font-style:italic;">Hover to see integrations</span>` +
    `</div>`;
}

/**
 * Second header row listing flow sequence diagrams for a domain.
 * Shown directly below the main header bar (top:44px).
 */
function flowsStrip(domainFlows) {
  const links = domainFlows.map(f =>
    `<span data-navigate="flow_${f.id}" style="cursor:pointer;padding:3px 10px;` +
    `background:white;border:1px solid #bae6fd;border-radius:4px;color:#0284c7;` +
    `font-size:9px;">${f.label}</span>`
  ).join(' ');
  return `<div style="position:absolute;top:44px;left:0;right:0;height:32px;` +
    `background:#f0f9ff;border-bottom:1px solid #bae6fd;display:flex;` +
    `align-items:center;padding:0 20px;gap:8px;z-index:10;` +
    `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">` +
    `<span style="font-size:9px;color:#0369a1;font-weight:600;white-space:nowrap;">Flows</span>` +
    `${links}</div>`;
}

// ── Combined fragment helpers ───────────────────────────────────────────────

const FRAGMENT_STYLES = {
  par: { stroke: '#7c3aed', fill: 'rgba(124,58,237,0.03)', label: 'par' },
  opt: { stroke: '#2563eb', fill: 'rgba(37,99,235,0.04)',  label: 'opt' },
};

/** Recursively flatten nested steps — fragment wrappers are unwrapped, not yielded. */
function flattenSteps(steps) {
  const result = [];
  for (const step of steps) {
    if (step.fragment !== undefined) {
      if (step.operands) {
        for (const op of step.operands) {
          result.push(...flattenSteps(op.steps || []));
        }
      } else {
        result.push(...flattenSteps(step.steps || []));
      }
    } else {
      result.push(step);
    }
  }
  return result;
}

/**
 * Walk nested steps and collect fragment descriptors with flat step index extents.
 * Returns: [{ type, label, depth, startIdx, endIdx, separators }]
 * startIdx/endIdx are indices into the flat (leaf) step array.
 * separators: flat indices of the last step in each operand (except the last) — used
 * to draw horizontal divider lines between parallel/alternative operands.
 */
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
            if (i < step.operands.length - 1) {
              separators.push(flatIdx - 1); // last leaf index of this operand
            }
          }
        } else {
          walk(step.steps || [], depth + 1);
        }
        const endIdx = flatIdx - 1;
        if (endIdx >= startIdx) {
          fragments.push({ type: step.fragment, label: step.label, depth, startIdx, endIdx, separators });
        }
      } else {
        flatIdx++;
      }
    }
  }

  walk(steps, 0);
  return fragments;
}

/**
 * Renders a sequence diagram for a single flow definition.
 * Columns are dynamically sized to always fill 1400px regardless of participant count.
 */
function renderFlowPage(flow) {
  const actorMap = Object.fromEntries((config.actors  || []).map(a => [a.id, a]));
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
  // COL_GAP ≈ 0.3 × COL_W → inner = N×COL_W + (N-1)×COL_GAP
  const CANVAS_W = 1400, ML = 60, MR = 60;
  const inner    = CANVAS_W - ML - MR;
  const COL_W    = Math.floor(inner / (N + 0.3 * (N - 1)));
  const COL_GAP  = Math.round(COL_W * 0.3);
  const W        = CANVAS_W;

  const HEADER_TOP = 52, HEADER_H = 62;
  const LIFELINE_Y = HEADER_TOP + HEADER_H + 14;
  const FIRST_Y    = LIFELINE_Y + 38;
  const STEP_H     = 82;
  const FOOTER_H   = 80;
  const SELF_W     = 36;   // how far right the self-arrow loop extends
  const SELF_H     = 20;   // vertical drop of the self-arrow loop

  const flatSteps = flattenSteps(flow.steps || []);
  const nSteps    = flatSteps.length;
  const fragments = collectFragments(flow.steps || []);
  const H = Math.max(500, FIRST_Y + nSteps * STEP_H + FOOTER_H);

  const colX   = participants.map((_, i) => ML + i * (COL_W + COL_GAP) + COL_W / 2);
  const colIdx = Object.fromEntries(participants.map((p, i) => [p.id, i]));

  // ── Column header divs ──────────────────────────────────────────────────────

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
    const s = STATUS_STYLE[p.status] || STATUS_STYLE['not-started'];
    const border = s.dash ? `1.5px dashed ${s.stroke}` : `1.5px solid ${s.stroke}`;
    const st = ['position:absolute', `left:${left}px`, `top:${HEADER_TOP}px`,
      `width:${COL_W}px`, `height:${HEADER_H}px`,
      `background:${s.fill}`, `border:${border}`, 'border-radius:8px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'text-align:center', 'box-sizing:border-box', 'z-index:2', 'padding:4px 6px'].join(';');
    return `<div style="${st}">` +
      `<div style="font-size:12px;font-weight:700;color:#111827;">${p.label}</div></div>`;
  }).join('\n');

  // ── SVG: lifelines + arrows ─────────────────────────────────────────────────

  const svgParts = [`  <defs>
    <marker id="sq-gray"   markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#9ca3af" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-green"  markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#16a34a" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-indigo" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#4f46e5" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-orange" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#f97316" fill="none" stroke-width="1.5"/></marker>
  </defs>`];

  // ── Fragment rectangles (drawn before lifelines so they sit behind everything) ──
  const FRAG_PAD = 10;
  for (const frag of fragments) {
    const style  = FRAGMENT_STYLES[frag.type] || FRAGMENT_STYLES['opt'];
    const inset  = frag.depth * 12;
    const fx     = ML - FRAG_PAD + inset;
    const fw     = (W - ML - MR) + FRAG_PAD * 2 - inset * 2;
    const fy     = (FIRST_Y + frag.startIdx * STEP_H - STEP_H * 0.4).toFixed(1);
    const fh     = (STEP_H * (frag.endIdx - frag.startIdx + 1) + STEP_H * 0.15).toFixed(1);

    // Fragment border
    svgParts.push(
      `  <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" ` +
      `rx="3" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1" stroke-dasharray="5,3"/>`
    );

    // Pentagon label (type box in top-left corner of fragment)
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

    // Guard / condition label
    if (frag.label) {
      svgParts.push(
        `  <text x="${(lx + lw + 14).toFixed(1)}" y="${(ly + lh - 4).toFixed(1)}" ` +
        `font-size="9" fill="${style.stroke}" font-style="italic" ` +
        `font-family="${FONT}">[${frag.label}]</text>`
      );
    }

    // Operand separator lines (dashed horizontal dividers between par/alt branches)
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
  let gapIdx = 0;
  flatSteps.forEach((step, idx) => {
    const y = FIRST_Y + idx * STEP_H;

    // ── ref fragment ────────────────────────────────────────────────────────
    if (step.ref) {
      const refFlow  = (config.flows || []).find(f => f.id === step.ref);
      const refLabel = refFlow?.label || step.label || step.ref;
      const flowIds  = (config.flows || []).map(f => f.id);
      const isBack   = flowIds.indexOf(step.ref) < flowIds.indexOf(flow.id);
      const arrow    = isBack ? '&#8592;' : '&#8594;';
      const refText  = isBack ? `${arrow} ${refLabel}` : `${refLabel} ${arrow}`;
      const boxH2    = 36;
      const boxY     = y - boxH2 / 2;
      labelDivs.push(
        `<div data-navigate="flow_${step.ref}" style="position:absolute;left:${ML}px;top:${boxY}px;` +
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

    // ── self-message ─────────────────────────────────────────────────────────
    if (step.self) {
      const si = colIdx[step.self];
      if (si == null) return;
      const sx    = colX[si];
      const isGap = !!step.gap;
      const color = isGap ? GAP_COLOR : '#6b7280';
      const dash  = isGap ? ' stroke-dasharray="5,3"' : '';
      const marker = isGap ? 'sq-orange' : 'sq-gray';
      const prefix = isGap ? '\u26a0\ufe0f\u202f' : '';
      svgParts.push(
        `  <line x1="${sx}" y1="${y}" x2="${sx + SELF_W}" y2="${y}" stroke="${color}" stroke-width="1.5"${dash}/>` +
        `\n  <line x1="${sx + SELF_W}" y1="${y}" x2="${sx + SELF_W}" y2="${y + SELF_H}" stroke="${color}" stroke-width="1.5"${dash}/>` +
        `\n  <line x1="${sx + SELF_W}" y1="${y + SELF_H}" x2="${sx + 8}" y2="${y + SELF_H}" stroke="${color}" stroke-width="1.5"${dash} marker-end="url(#${marker})"/>` +
        `\n  <circle cx="${sx}" cy="${y}" r="3" fill="${color}"/>`
      );
      labelDivs.push(
        `<div style="position:absolute;left:${(sx + SELF_W + 6).toFixed(1)}px;top:${(y - 9).toFixed(1)}px;` +
        `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:9px;font-weight:600;` +
        `color:${color};white-space:nowrap;z-index:3;">${prefix}${step.label || ''}</div>`
      );
      if (isGap && step.gap_description) {
        const id = `g${gapIdx++}`;
        labelDivs.push(
          `<div class="int-hit" data-int-id="${id}" style="position:absolute;` +
          `left:${sx}px;top:${(y - 5)}px;width:${SELF_W + 6}px;height:${SELF_H + 14}px;` +
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
    const isActor   = participants[fi].type === 'actor';
    const evStatus  = step.event ? (eventMap[step.event]?.status || 'planned') : null;
    let color, markerId;
    if      (step.gap)                   { color = GAP_COLOR; markerId = 'sq-orange'; }
    else if (isActor)                    { color = '#4f46e5'; markerId = 'sq-indigo'; }
    else if (evStatus === 'implemented') { color = '#16a34a'; markerId = 'sq-green';  }
    else                                 { color = '#9ca3af'; markerId = 'sq-gray';   }

    // Arrow — pull x2 back by 8px so arrowhead lands on the lifeline center
    const dir = tx > fx ? 1 : -1;
    const x2  = tx - dir * 8;
    const dash = step.gap ? 'stroke-dasharray="5,3"' : isActor ? 'stroke-dasharray="6,3"' : '';
    svgParts.push(
      `  <line x1="${fx}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="1.5" ${dash} marker-end="url(#${markerId})"/>`
    );
    svgParts.push(`  <circle cx="${fx}" cy="${y}" r="3" fill="${color}"/>`);
    svgParts.push(`  <circle cx="${tx}" cy="${y}" r="3" fill="${color}"/>`);

    // Label div — event name / action label above arrow, note below
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

  // ── Header bar (breadcrumb + legend) ────────────────────────────────────────

  const mkArrow = (color, dash) =>
    `<svg width="28" height="10" style="overflow:visible;vertical-align:middle;">` +
    `<line x1="2" y1="5" x2="20" y2="5" stroke="${color}" stroke-width="1.5"${dash ? ' stroke-dasharray="5,3"' : ''}/>` +
    `<path d="M18,2 L26,5 L18,8" stroke="${color}" fill="none" stroke-width="1.5"/></svg>`;

  const domainLabel = domainMap[flow.domain]?.label || flow.domain;

  const flowHeader =
    `<div style="position:absolute;top:0;left:0;right:0;height:44px;background:#f9fafb;` +
    `border-bottom:1px solid #e5e7eb;display:flex;align-items:center;padding:0 20px;` +
    `gap:16px;z-index:10;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:9px;">` +
    `<div style="font-size:12px;">` +
    `<span data-navigate="__overview__" style="color:#2563eb;cursor:pointer;">&#8592; Context Map</span>` +
    `<span style="color:#6b7280;"> / </span>` +
    `<span data-navigate="${flow.domain}" style="color:#2563eb;cursor:pointer;">${domainLabel}</span>` +
    `<span style="color:#6b7280;"> / ${flow.label}</span>` +
    `</div>` +
    `<div style="flex:1;"></div>` +
    `<span>${mkArrow('#16a34a', false)}&thinsp;Implemented</span>` +
    `<span>${mkArrow('#9ca3af', false)}&thinsp;Planned</span>` +
    `<span>${mkArrow('#4f46e5', false)}&thinsp;Human action</span>` +
    `<span>${mkArrow('#f97316', true)}&thinsp;Gap &mdash; not yet designed</span>` +
    `<span style="color:#2563eb;font-style:italic;">[condition]</span>` +
    `<span style="color:#2563eb;">&#9645;&thinsp;opt</span>` +
    `<span style="color:#7c3aed;">&#9645;&thinsp;par</span>` +
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
  <div class="cm-legend">
    <div class="cm-legend-item"><div class="cm-swatch design-complete"></div> Domain complete</div>
    <div class="cm-legend-item"><div class="cm-swatch partial"></div> Domain in progress</div>
    <div class="cm-legend-item"><div class="cm-swatch not-started"></div> Domain planned</div>
    <div style="margin-left:auto;font-size:9px;color:#9ca3af;font-style:italic;">Click a domain card to explore it</div>
  </div>
  <div class="cm-banner">
    <div class="cm-banner-label">Cross-cutting concerns</div>
    <div class="cm-banner-items">${crossCutting}</div>
  </div>
  <div class="cm-grid">
    ${cards}
  </div>
</div>`;
}

// ── Detail SVG ─────────────────────────────────────────────────────────────

function renderDetail(domainId) {
  const W = 1400, H = 1100, CX = W / 2, CY = H / 2;

  const center = config.domains.find(d => d.id === domainId);
  if (!center) throw new Error(`Unknown domain: ${domainId}`);

  const domainFlows = (config.flows || []).filter(f => f.domain === domainId);
  const hasFlows    = domainFlows.length > 0;
  const flowsHtml   = hasFlows ? flowsStrip(domainFlows) : '';

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
  const n = partners.length;
  // Max safe radius: partners must stay fully within the canvas.
  // Binding constraint is the bottom (legend takes ~80px) and top (nav bar ~60px).
  const topClear = hasFlows ? 82 : 50;   // header 44px + optional flows row 32px + gap
  const maxRadius = Math.min(
    CX - BOX_W / 2 - 20,             // left/right
    CY - BOX_H / 2 - topClear,       // top (header bar)
    H - CY - BOX_H / 2 - 30,         // bottom (no legend — just canvas edge clearance)
  );
  // Integration boxes are hover-to-reveal, so label extent no longer drives radius.
  const minRadius = n <= 2 ? 240 : n <= 4 ? 270 : 300;
  const radius = Math.min(maxRadius, minRadius);
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

  const arrowLines  = [];
  const midCircles  = [];   // drawn after all lines so they always paint on top
  const hitAreaDivs = [];   // invisible rotated divs covering each line — cursor-following tooltip targets
  const contentDivs = [];   // hidden content stores keyed by int-id

  let intIdx = 0;

  for (const [partnerId, partnerFlows] of Object.entries(flowsByPartner)) {
    const p = partnerPositions[partnerId];
    const [ex1, ey1] = boxEdge(CX, CY, p.cx, p.cy);
    const [ex2, ey2] = boxEdge(p.cx, p.cy, CX, CY);
    // One line per connection pair: arrowhead(s) determined by direction(s)
    const hasOut = partnerFlows.some(f => f.direction === 'out');
    const hasIn  = partnerFlows.some(f => f.direction === 'in');
    // Pull back from box edge only where an arrowhead will sit
    const [lx1, ly1] = hasIn  ? gappedEdge(CX, CY, p.cx, p.cy)  : [ex1, ey1];
    const [lx2, ly2] = hasOut ? gappedEdge(p.cx, p.cy, CX, CY)  : [ex2, ey2];
    const mStart = hasIn  ? `marker-start="url(#${FLOW_MARKER_ID})"` : '';
    const mEnd   = hasOut ? `marker-end="url(#${FLOW_MARKER_ID})"` : '';
    arrowLines.push(
      `  <line x1="${lx1.toFixed(1)}" y1="${ly1.toFixed(1)}" ` +
      `x2="${lx2.toFixed(1)}" y2="${ly2.toFixed(1)}" ` +
      `stroke="${FLOW_LINE_COLOR}" stroke-width="1.5" ${mStart} ${mEnd}/>`
    );

    // Build tooltip content for this connection
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
      const cx = (ex1 + ex2) / 2, cy = (ey1 + ey2) / 2;
      const dx = ex2 - ex1, dy = ey2 - ey1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2);

      // Invisible rotated hit-area div covering the full connection line.
      // z-index:1 keeps it below domain boxes (z-index:2) so box clicks still work.
      hitAreaDivs.push(
        `<div class="int-hit" data-int-id="${intIdx}" ` +
        `style="position:absolute;left:${cx.toFixed(1)}px;top:${cy.toFixed(1)}px;` +
        `width:${len.toFixed(1)}px;height:20px;` +
        `transform:translate(-50%,-50%) rotate(${angle}deg);` +
        `background:transparent;cursor:pointer;z-index:1;"></div>`
      );
      contentDivs.push(
        `<div class="int-content" data-int-id="${intIdx}" style="display:none;">${labelHtml}</div>`
      );

      // ··· indicator drawn on top of all lines (midCircles layer)
      midCircles.push(
        `  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="10" ` +
        `fill="white" stroke="#d1d5db" stroke-width="1.5" pointer-events="none"/>` +
        `\n  <text x="${cx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" ` +
        `font-size="9" text-anchor="middle" fill="#9ca3af" pointer-events="none" ` +
        `font-family="'Helvetica Neue',Helvetica,Arial,sans-serif">\u00b7\u00b7\u00b7</text>`
      );

      intIdx++;
    }
  }

  const partnerBoxes = partners
    .map(id => domainBoxHtml(domainMap[id], partnerPositions[id].cx, partnerPositions[id].cy, true))
    .join('\n');

  return `<div style="position:relative;width:${W}px;height:${H}px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:white;overflow:hidden;" data-domain="${domainId}">
${detailHeaderHtml(center.label)}
${flowsHtml}
  <svg style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible;" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${defsForFlows()}
${arrowLines.join('\n')}
${midCircles.join('\n')}
  </svg>
${hitAreaDivs.join('\n')}
${contentDivs.join('\n')}
${partnerBoxes}
${domainBoxHtml(center, CX, CY, false)}
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

for (const flow of (config.flows || [])) {
  const html = renderFlowPage(flow);
  writeFileSync(resolve(OUT_DIR, `flow_${flow.id}.html`), html, 'utf8');
  console.log(`Written: output/flow_${flow.id}.html`);
}
