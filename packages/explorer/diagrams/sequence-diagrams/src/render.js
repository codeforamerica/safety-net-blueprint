/**
 * render.js
 *
 * Generates per-flow sequence diagram HTML pages from the enriched explorer
 * config. Called by packages/explorer/build.js.
 *
 * Exports: renderSequenceDiagrams(pkgConfig, outDir)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { FONT } from '../../../lib/theme.js';

// Set by renderSequenceDiagrams() before any helper function is called.
let config;

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  partial:           { fill: '#E6EBF9', stroke: '#5650BE', sw: 2,   dash: false },
  'not-started':     { fill: '#F3F3F3', stroke: '#E9CCBE', sw: 1.5, dash: true  },
  'design-complete': { fill: '#E2F9F6', stroke: '#00AD93', sw: 2,   dash: false },
};

const EVENT_STATUS_COLOR = {
  implemented: '#00AD93',
  planned:     '#5650BE',
  partial:     '#5650BE',
  api:         '#2B1A78',
};

// Flow sequence diagram constants
const GAP_COLOR = '#AF121D';

// ── SVG text helper ────────────────────────────────────────────────────────

/** Build a <text> SVG element string. */
function svgText(str, x, y, {
  anchor = 'start', size = 12, weight = 'normal', fill = '#111827', italic = false,
} = {}) {
  const wa = anchor !== 'start' ? ` text-anchor="${anchor}"` : '';
  const fw = weight !== 'normal' ? ` font-weight="${weight}"` : '';
  const fi = italic ? ` font-style="italic"` : '';
  return `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" font-size="${size}"${wa}${fw}${fi} fill="${fill}" font-family="${FONT}">${str}</text>`;
}

// ── Standard header bar ────────────────────────────────────────────────────

const d2r  = deg => deg * Math.PI / 180;
const hcos = deg => Math.cos(d2r(deg));
const hsin = deg => Math.sin(d2r(deg));

function hexPtsStr(cx, cy, r) {
  return Array.from({ length: 6 }, (_, k) =>
    `${(cx + r * hcos(30 + k * 60)).toFixed(1)},${(cy + r * hsin(30 + k * 60)).toFixed(1)}`
  ).join(' ');
}

/**
 * SVG elements for the shared 44px header bar (background, separator, legend).
 * `leftParts` — additional SVG elements to place on the left (e.g. breadcrumb).
 * `centerLabel` — label text centered at x=700 (omit for overview).
 */
function headerBarParts(W, leftParts = [], centerLabel = null) {
  const parts = [
    `<rect x="0" y="0" width="${W}" height="44" fill="#F3F3F3"/>`,
    `<line x1="0" y1="44" x2="${W}" y2="44" stroke="#E9CCBE" stroke-width="1"/>`,
    ...leftParts,
  ];
  if (centerLabel) {
    parts.push(svgText(centerLabel, 700, 27, { anchor: 'middle', size: 13, weight: 700, fill: '#000000' }));
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
    parts.push(svgText(item.label, lx + 17, 27, { size: 9, fill: '#000000' }));
    lx += 104;
  }
  return parts;
}

// ── Flow sequence diagram helpers ──────────────────────────────────────────

const FRAGMENT_STYLES = {
  par: { stroke: '#2B1A78', fill: 'rgba(43,26,120,0.03)',  label: 'par' },
  opt: { stroke: '#5650BE', fill: 'rgba(86,80,190,0.04)',  label: 'opt' },
};

// ── Adaptive step height ───────────────────────────────────────────────────
//
// The layout uses slot-based positioning. Each step owns a rectangular slot.
// Within the slot, the arrow is positioned at slot_top + ABOVE, where ABOVE
// varies based on whether the step opens a fragment.
//
// Fragment-starting steps need extra above-arrow space so the badge label fits
// between the preceding slot bottom and the arrow without overlap:
//
//   ABOVE_NORMAL (16px): regular steps — just enough for arrow label text
//   ABOVE_FRAG   (40px): first step of a fragment — badge(16) + gap(4) + label(13) + margin(7)
//
// Fragment box top = slot top of its first step (no extra constant needed).
// Fragment box bottom = arrow_y of last step + content below + FRAG_PAD_BOT.
//
// When two fragments start at the same step (nested), the outer fragment is
// pulled up by FRAG_NEST_PAD so the two badges don't collide.

const SEQ_SELF_H    = 20;  // self-loop arc height (px below arrow)
const SEQ_SELF_W    = 36;  // self-loop width
const NOTE_LH       = 12;  // note text line height
const NOTE_WPL      = 5;   // words per line (wrap estimate)
const ABOVE_NORMAL  = 16;  // above-arrow space for a plain step
const ABOVE_FRAG    = 40;  // above-arrow space when the step opens a fragment
//                          = badge(16) + gap(4) + label(13) + margin(7)
const MIN_BELOW     = 28;  // minimum below-arrow clearance
const BADGE_H       = 16;  // fragment badge strip height
const BOX_H2        = 36;  // ref-step box height
const MIN_GAP       = 4;   // minimum visual gap
const FRAG_PAD_BOT  = 14;  // breathing room below the last step in a fragment
const FRAG_NEST_PAD = 20;  // extra top extension for outer badge when two fragments share a start

/**
 * Pixels of content extending below the arrow center.
 * "Base" version — does not include fragment layout bonuses.
 * Used for: (a) fragment bottom calculation, (b) separator positions.
 */
function stepBelowBase(step) {
  if (step.ref)  return Math.max(MIN_BELOW, BOX_H2 / 2 + MIN_GAP);
  let b = MIN_BELOW;
  if (step.self) b = Math.max(b, SEQ_SELF_H + 8);
  if (step.note) {
    const words = (step.note || '').split(/\s+/).filter(Boolean).length;
    const lines = Math.max(1, Math.ceil(words / NOTE_WPL));
    b = Math.max(b, 6 + lines * NOTE_LH);
  }
  return b;
}

/**
 * Total slot height for a step.
 *
 * Slots are contiguous — their total covers the full diagram height.
 * Fragment boxes are drawn within slot boundaries so adjacent fragments never overlap.
 *
 * Layout bonuses added to below-arrow space:
 *   - FRAG_PAD_BOT  if this step is the last step of a fragment (creates gap to next fragment)
 *   - FRAG_NEST_PAD if the NEXT step opens multiple nested fragments (room for outer badge)
 */
function stepSlotHeight(step, stepIdx, aboveFragSet, fragEndSet, fragStartCounts) {
  const above = aboveFragSet.has(stepIdx) ? ABOVE_FRAG : ABOVE_NORMAL;
  let below = stepBelowBase(step);
  if (fragEndSet.has(stepIdx))                           below += FRAG_PAD_BOT;
  if ((fragStartCounts.get(stepIdx + 1) || 0) > 1)      below += FRAG_NEST_PAD;
  return above + below;
}

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
        const operandStarts = [];
        if (step.operands) {
          for (let i = 0; i < step.operands.length; i++) {
            operandStarts.push({ idx: flatIdx, label: step.operands[i].label });
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
          fragments.push({ type: step.type, label: step.label, depth, startIdx, endIdx, separators, operandStarts });
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
  const FOOTER_H   = 80;
  const SELF_W     = SEQ_SELF_W;
  const SELF_H     = SEQ_SELF_H;

  const flatSteps = flattenSteps(flow.steps || []);
  const nSteps    = flatSteps.length;
  const fragments = collectFragments(flow.steps || []);

  // Pre-compute fragment index sets needed for slot height bonuses.
  // fragStartSet    — steps that open ≥1 fragment (for ABOVE_FRAG and nesting calc)
  // fragEndSet      — steps that close ≥1 fragment (FRAG_PAD_BOT bonus below-arrow)
  // fragStartCounts — how many fragments open at each step (>1 = nested badges at same row)
  const fragStartSet    = new Set(fragments.map(f => f.startIdx));
  const fragEndSet      = new Set(fragments.map(f => f.endIdx));
  const fragStartCounts = new Map();
  for (const frag of fragments) {
    fragStartCounts.set(frag.startIdx, (fragStartCounts.get(frag.startIdx) || 0) + 1);
  }

  // aboveFragSet: steps that need ABOVE_FRAG above-arrow space.
  // Includes fragment-starting steps AND the first step of each non-first operand in a par —
  // both need room for a badge/label above the arrow.
  const aboveFragSet = new Set(fragStartSet);
  for (const frag of fragments) {
    for (const { idx } of (frag.operandStarts || [])) {
      if (idx !== frag.startIdx) aboveFragSet.add(idx);
    }
  }

  // Build per-step positions.
  //   stepTop[i]  = Y of the slot top (= fragment box top when step opens a fragment)
  //   arrowY[i]   = Y of the arrow itself (stepTop + ABOVE_FRAG or ABOVE_NORMAL)
  const stepHts  = flatSteps.map((step, idx) => stepSlotHeight(step, idx, aboveFragSet, fragEndSet, fragStartCounts));
  const stepTop  = [];
  const arrowY   = [];
  { let y = FIRST_Y; for (let i = 0; i < nSteps; i++) {
    stepTop[i]  = y;
    arrowY[i]   = y + (aboveFragSet.has(i) ? ABOVE_FRAG : ABOVE_NORMAL);
    y += stepHts[i];
  } }
  const totalH = nSteps > 0 ? (stepTop[nSteps - 1] + stepHts[nSteps - 1]) : FIRST_Y;

  // Fragment nesting: when two fragments share a startIdx (outer + inner at same step),
  // pull the outer fragment up by FRAG_NEST_PAD so the badges don't collide.
  // When they share an endIdx, extend the parent below the child.
  for (const frag of fragments) {
    if (fragments.some(f => f.depth > frag.depth && f.startIdx === frag.startIdx)) {
      frag.extraTopPad = FRAG_NEST_PAD;
    }
    if (fragments.some(f => f.depth > frag.depth && f.endIdx === frag.endIdx)) {
      frag.extraBottomPad = SELF_H / 2;
    }
  }

  const H = Math.max(500, totalH + FOOTER_H);

  // Map from step index → max depth of containing fragment (-1 if none).
  // Used to inset ref boxes so they visually sit inside their container.
  const stepDepth = new Array(nSteps).fill(-1);
  for (const frag of fragments) {
    for (let i = frag.startIdx; i <= frag.endIdx; i++) {
      stepDepth[i] = Math.max(stepDepth[i], frag.depth);
    }
  }

  const colX   = participants.map((_, i) => ML + i * (COL_W + COL_GAP) + COL_W / 2);
  const colIdx = Object.fromEntries(participants.map((p, i) => [p.id, i]));

  // ── Column header divs ────────────────────────────────────────────────────

  const headerDivs = participants.map((p, i) => {
    const left = colX[i] - COL_W / 2;
    if (p.type === 'actor') {
      const st = ['position:absolute', `left:${left}px`, `top:${HEADER_TOP}px`,
        `width:${COL_W}px`, `height:${HEADER_H}px`,
        'background:#E6EBF9', 'border:1.5px solid #2B1A78', 'border-radius:8px',
        'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
        'box-sizing:border-box', 'z-index:2'].join(';');
      return `<div style="${st}">` +
        `<div style="font-size:9px;color:#2B1A78;margin-bottom:2px;">&#128100;</div>` +
        `<div style="font-size:12px;font-weight:700;color:#2B1A78;">${p.label}</div></div>`;
    }
    const s      = STATUS_STYLE[p.status] || STATUS_STYLE['not-started'];
    const border = s.dash ? `1.5px dashed ${s.stroke}` : `1.5px solid ${s.stroke}`;
    const st = ['position:absolute', `left:${left}px`, `top:${HEADER_TOP}px`,
      `width:${COL_W}px`, `height:${HEADER_H}px`,
      `background:${s.fill}`, `border:${border}`, 'border-radius:8px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'text-align:center', 'box-sizing:border-box', 'z-index:2', 'padding:4px 6px'].join(';');
    return `<div style="${st}">` +
      `<div style="font-size:12px;font-weight:700;color:#000000;">${p.label}</div></div>`;
  }).join('\n');

  // ── SVG: lifelines + arrows ───────────────────────────────────────────────

  const svgParts = [`  <defs>
    <marker id="sq-gray"      markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#9ca3af" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-blue"      markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#5650BE" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-green"     markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#00AD93" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-dark-blue" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#2B1A78" fill="none" stroke-width="1.5"/></marker>
    <marker id="sq-red"       markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,1.5 L8,4.5 L0,7.5" stroke="#AF121D" fill="none" stroke-width="1.5"/></marker>
  </defs>`];

  const labelDivs = [];

  // Fragment rectangles (drawn before lifelines so they sit behind everything)
  const FRAG_PAD = 10;
  for (const frag of fragments) {
    const style    = FRAGMENT_STYLES[frag.type] || FRAGMENT_STYLES['opt'];
    const inset    = frag.depth * 12;
    const fx       = ML - FRAG_PAD + inset;
    const fw       = (W - ML - MR) + FRAG_PAD * 2 - inset * 2;
    const extraTop = frag.extraTopPad  || 0;
    const extraBot = frag.extraBottomPad || 0;

    // Top: slot top of the first step (already has ABOVE_FRAG space for the badge),
    //      pulled up further when a nested fragment shares the same startIdx.
    const fy    = stepTop[frag.startIdx] - extraTop;
    // Bottom: after the last step's content. FRAG_PAD_BOT is already baked into the slot
    // height of fragment-end steps, so adding it here would double-count. Use only extraBot
    // (for parent-contains-child visual extension) plus the base below-content.
    const fyEnd = arrowY[frag.endIdx] + stepBelowBase(flatSteps[frag.endIdx]) + extraBot;
    const fh    = fyEnd - fy;

    svgParts.push(
      `  <rect x="${fx}" y="${fy.toFixed(1)}" width="${fw}" height="${fh.toFixed(1)}" ` +
      `rx="3" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1" stroke-dasharray="5,3"/>`
    );

    const lw = 28, lh = BADGE_H, lx = fx, ly = fy;
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

    // Per-operand labels rendered as HTML divs.
    for (const { idx, label } of (frag.operandStarts || [])) {
      if (!label) continue;
      const opIdx   = frag.operandStarts.findIndex(o => o.idx === idx);
      const isFirst = idx === frag.startIdx;
      // First operand: label sits just below the fragment badge strip.
      // Later operands: label sits just below the separator line (which is at stepTop of the
      // next operand's first step — both share the same slot boundary).
      const nextOpFirstIdx = frag.separators[opIdx - 1] + 1;
      const topPx = isFirst
        ? fy + lh + MIN_GAP
        : (stepTop[nextOpFirstIdx] ?? 0) + MIN_GAP;
      labelDivs.push(
        `<div style="position:absolute;left:${(lx + lw + 14).toFixed(1)}px;top:${topPx.toFixed(1)}px;` +
        `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:9px;font-weight:600;` +
        `color:${style.stroke};white-space:nowrap;z-index:3;">${label}</div>`
      );
    }

    for (const sepIdx of (frag.separators || [])) {
      // Separator drawn exactly at the slot boundary between operands.
      // stepTop[sepIdx + 1] is the top of the next operand's first step slot,
      // which is guaranteed to be below all content of sepIdx's step.
      const sy = (stepTop[sepIdx + 1] ?? (arrowY[sepIdx] + stepBelowBase(flatSteps[sepIdx]))).toFixed(1);
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
      `stroke="#E9CCBE" stroke-width="1.5" stroke-dasharray="5,4"/>`
    );
  }

  // Steps
  let gapIdx = 0, regIdx = 0, ovIdx = 0;
  flatSteps.forEach((step, idx) => {
    const y = arrowY[idx];

    if (step.ref && !step.ref.includes('/')) {
      const refFlow  = (config.flows || []).find(f => f.id === step.ref);
      const refLabel = refFlow?.label || step.label || step.ref;
      const flowIds  = (config.flows || []).map(f => f.id);
      const isBack   = flowIds.indexOf(step.ref) < flowIds.indexOf(flow.id);
      const arrow    = isBack ? '&#8592;' : '&#8594;';
      const refText  = isBack ? `${arrow} ${refLabel}` : `${refLabel} ${arrow}`;
      // The slot for a fragment-starting step already reserves ABOVE_FRAG = 40px above the
      // arrow: badge(16) + gap(4) + label(13) + margin(7). The ref box (BOX_H2=36) centered
      // at y extends 18px above the arrow — well within the 40px badge-safe zone.
      // No shift needed.
      const refInset  = stepDepth[idx] >= 0 ? (stepDepth[idx] + 1) * 12 + 10 : 0;
      const refLeft   = ML + refInset;
      const refWidth  = W - ML - MR - refInset * 2;
      const boxY = y - BOX_H2 / 2;
      labelDivs.push(
        `<a href="flow_${refFlow?.domain}_${step.ref}.html" style="position:absolute;left:${refLeft}px;top:${boxY}px;` +
        `width:${refWidth}px;height:${BOX_H2}px;border:1.5px solid #A1B4EA;border-radius:4px;` +
        `background:#E6EBF9;display:flex;align-items:center;justify-content:center;` +
        `text-decoration:none;z-index:3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">` +
        `<span style="position:absolute;top:3px;left:6px;font-size:7px;font-weight:700;color:#5650BE;` +
        `border:1px solid #A1B4EA;border-radius:2px;padding:0 3px;background:white;">ref</span>` +
        `<span style="font-size:10px;color:#5650BE;font-weight:600;">${refText}</span>` +
        `</a>`
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
      const marker = isGap ? 'sq-red' : 'sq-gray';
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
      const hasGap     = isGap && !!step.gap_description;
      const hasOverlay = !!(step.overlay && step.overlay.length);
      const ovBadge    = hasOverlay
        ? `<span style="display:inline-block;margin-left:4px;width:12px;height:12px;` +
          `line-height:12px;text-align:center;vertical-align:middle;` +
          `background:#FEF3C7;border:1px solid #D97706;border-radius:2px;` +
          `font-size:8px;color:#D97706;">&#8853;</span>`
        : '';
      if (hasGap || hasOverlay) {
        const id = hasGap ? `g${gapIdx++}` : `ov${ovIdx++}`;
        const tipParts = [];
        if (hasGap) {
          tipParts.push(
            `<div style="font-size:7.5px;font-weight:700;color:${GAP_COLOR};">\u26a0\ufe0f Gap</div>` +
            `<div style="font-size:8px;color:#374151;">${step.gap_description}</div>`
          );
        }
        if (hasOverlay) {
          if (hasGap) tipParts.push(`<div style="border-top:1px solid #e5e7eb;margin-top:4px;padding-top:4px;"></div>`);
          for (const [i, o] of step.overlay.entries()) {
            if (i > 0) tipParts.push(`<div style="border-top:1px solid #e5e7eb;margin-top:4px;padding-top:4px;"></div>`);
            tipParts.push(
              `<div style="font-size:7.5px;font-weight:700;color:#D97706;">&#8853; State overlay point</div>` +
              `<div style="font-size:8px;color:#374151;">${o.note}</div>` +
              (o.mechanism ? `<div style="font-size:7.5px;color:#6b7280;font-style:italic;">${o.mechanism}</div>` : '')
            );
          }
        }
        labelDivs.push(
          `<div class="int-hit" data-int-id="${id}" style="position:absolute;left:${labelX}px;top:${(y - 9).toFixed(1)}px;` +
          `${labelTransform}font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:9px;font-weight:600;` +
          `color:${color};white-space:nowrap;z-index:4;cursor:help;">${prefix}${step.label || ''}${ovBadge}</div>` +
          `<div class="int-content" data-int-id="${id}" style="display:none;">${tipParts.join('')}</div>`
        );
      } else {
        labelDivs.push(
          `<div style="position:absolute;left:${labelX}px;top:${(y - 9).toFixed(1)}px;` +
          `${labelTransform}font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:9px;font-weight:600;` +
          `color:${color};white-space:nowrap;z-index:3;">${prefix}${step.label || ''}</div>`
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
    if      (step.gap)                   { color = GAP_COLOR;  markerId = 'sq-red';       }
    else if (isActor)                    { color = '#2B1A78';  markerId = 'sq-dark-blue'; }
    else if (evStatus === 'implemented') { color = '#00AD93';  markerId = 'sq-green';     }
    else                                 { color = '#5650BE';  markerId = 'sq-blue';      }

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
    const fromDomain = participants[fi]?.id;
    const rawLabel = step.event || step.label || '';
    const mainText = (step.event && fromDomain && rawLabel.startsWith(fromDomain + '.'))
      ? rawLabel.slice(fromDomain.length + 1)
      : rawLabel;

    let above = `<div style="font-size:9px;font-weight:600;color:${color};white-space:nowrap;">${gapPrefix}${icon}${mainText}</div>`;
    if (step.condition) above += `<div style="font-size:8px;color:#5650BE;font-style:italic;white-space:nowrap;">[${step.condition}]</div>`;

    labelDivs.push(
      `<div style="position:absolute;left:${midX}px;top:${aboveY}px;transform:translate(-50%,0);` +
      `text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;z-index:3;">${above}</div>`
    );
    if (step.note) {
      const noteHtml = step.note.replace(/^(\[.+?\])\s*/, '$1<br>');
      labelDivs.push(
        `<div style="position:absolute;left:${midX}px;top:${belowY}px;transform:translate(-50%,0);` +
        `text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:8px;` +
        `color:#6b7280;max-width:220px;white-space:normal;z-index:3;">${noteHtml}</div>`
      );
    }
    if (step.policies && step.policies.length) {
      const id  = `r${regIdx++}`;
      const tipX = (parseFloat(midX) + Math.abs(tx - fx) * 0.3 + 4).toFixed(1);
      const tipRows = step.policies.map((p, i) =>
        (i > 0 ? `<div style="border-top:1px solid #e5e7eb;margin-top:4px;padding-top:4px;"></div>` : '') +
        `<div style="font-size:7.5px;font-weight:700;color:#2B1A78;">${p.citation}</div>` +
        `<div style="font-size:8px;color:#374151;">${p.description}</div>`
      ).join('');
      labelDivs.push(
        `<div class="int-hit" data-int-id="${id}" style="position:absolute;` +
        `left:${tipX}px;top:${(y - 7)}px;width:14px;height:14px;` +
        `display:flex;align-items:center;justify-content:center;` +
        `background:#E6EBF9;border:1px solid #C2C0E8;border-radius:3px;` +
        `cursor:help;z-index:4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;` +
        `font-size:8px;color:#5650BE;">&#9878;</div>` +
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
    if (step.overlay && step.overlay.length) {
      const id      = `ov${ovIdx++}`;
      const hasReg  = !!(step.policies && step.policies.length);
      const tipX    = (parseFloat(midX) + Math.abs(tx - fx) * 0.3 + (hasReg ? 22 : 4)).toFixed(1);
      const tipRows = step.overlay.map((o, i) =>
        (i > 0 ? `<div style="border-top:1px solid #e5e7eb;margin-top:4px;padding-top:4px;"></div>` : '') +
        `<div style="font-size:7.5px;font-weight:700;color:#D97706;">&#8853; State overlay point</div>` +
        `<div style="font-size:8px;color:#374151;">${o.note}</div>` +
        (o.mechanism ? `<div style="font-size:7.5px;color:#6b7280;font-style:italic;">${o.mechanism}</div>` : '')
      ).join('');
      labelDivs.push(
        `<div class="int-hit" data-int-id="${id}" style="position:absolute;` +
        `left:${tipX}px;top:${(y - 7)}px;width:14px;height:14px;` +
        `display:flex;align-items:center;justify-content:center;` +
        `background:#FEF3C7;border:1px solid #D97706;border-radius:3px;` +
        `cursor:help;z-index:4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;` +
        `font-size:9px;color:#D97706;">&#8853;</div>` +
        `<div class="int-content" data-int-id="${id}" style="display:none;">${tipRows}</div>`
      );
    }
  });

  // ── Header bar ────────────────────────────────────────────────────────────

  const mkArrow = (color, dash) =>
    `<svg width="28" height="10" style="overflow:visible;vertical-align:middle;">` +
    `<line x1="2" y1="5" x2="20" y2="5" stroke="${color}" stroke-width="1.5"${dash ? ' stroke-dasharray="5,3"' : ''}/>` +
    `<path d="M18,2 L26,5 L18,8" stroke="${color}" fill="none" stroke-width="1.5"/></svg>`;

  const domainMap2 = Object.fromEntries(config.domains.map(d => [d.id, d]));
  const domainLabel = domainMap2[flow.domain]?.label || flow.domain;
  const contextMapPath = '../../context-map/context-map.html';
  const domainDetailPath = `../../context-map/context-map.html#domain_${flow.domain}`;

  const flowHeader =
    `<div style="position:absolute;top:0;left:0;right:0;height:44px;background:#F3F3F3;` +
    `border-bottom:1px solid #E9CCBE;display:flex;align-items:center;padding:0 20px;` +
    `z-index:10;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">` +
    `<div style="font-size:12px;">` +
    `<a href="${contextMapPath}" style="color:#5650BE;text-decoration:none;">&#8592; Context Map</a>` +
    `<span style="color:#6b7280;"> / </span>` +
    `<a href="${domainDetailPath}" style="color:#5650BE;text-decoration:none;">${domainLabel}</a>` +
    `<span style="color:#6b7280;"> / ${flow.label}</span>` +
    `</div>` +
    `<div style="position:absolute;right:20px;top:0;height:44px;display:flex;align-items:center;gap:14px;font-size:9px;">` +
    `<span>${mkArrow('#00AD93', false)}&thinsp;Implemented</span>` +
    `<span>${mkArrow('#5650BE', false)}&thinsp;Planned</span>` +
    `<span>${mkArrow('#2B1A78', false)}&thinsp;Human action</span>` +
    `<span>${mkArrow('#AF121D', true)}&thinsp;Gap</span>` +
    `<span><span style="display:inline-block;width:12px;height:12px;line-height:12px;` +
    `text-align:center;vertical-align:middle;background:#FEF3C7;border:1px solid #D97706;` +
    `border-radius:2px;font-size:8px;color:#D97706;">&#8853;</span>&thinsp;State overlay point</span>` +
    `</div>` +
    `</div>`;

  // ── Tooltip wiring script ─────────────────────────────────────────────────

  const tooltipScript = `
  <script>
    (function() {
      const tip = document.createElement('div');
      tip.style.cssText = [
        'position:fixed', 'display:none', 'pointer-events:none',
        "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif",
        'font-size:8.5px', 'line-height:1.65', 'white-space:nowrap',
        'z-index:9999', 'background:white', 'border:1px solid #E9CCBE',
        'border-radius:5px', 'padding:5px 8px',
        'box-shadow:0 2px 8px rgba(0,0,0,0.12)'
      ].join(';');
      document.body.appendChild(tip);
      const content = {};
      document.querySelectorAll('.int-content').forEach(el => {
        content[el.dataset.intId] = el.innerHTML;
      });
      document.querySelectorAll('.int-hit').forEach(el => {
        const html = content[el.dataset.intId] || '';
        if (!html) return;
        el.addEventListener('mouseenter', () => { tip.innerHTML = html; tip.style.display = 'block'; });
        el.addEventListener('mousemove', e => { tip.style.left = (e.clientX + 16) + 'px'; tip.style.top = (e.clientY + 10) + 'px'; });
        el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      });
    })();
  </script>`;

  const bodyStyle = `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#F3F3F3;margin:0;padding:24px 0;`;
  const wrapStyle = `position:relative;width:${W}px;height:${H}px;background:white;overflow:visible;box-shadow:0 2px 16px rgba(0,0,0,0.10);margin:0 auto;`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${flow.label}</title>
  <style>*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }</style>
</head>
<body style="${bodyStyle}">
<div style="${wrapStyle}" data-domain="${flow.domain}">
${flowHeader}
  <svg style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible;" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${svgParts.join('\n')}
  </svg>
${headerDivs}
${labelDivs.join('\n')}
</div>
${tooltipScript}
</body>
</html>`;
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * @param {Object} pkgConfig  enriched explorer config (from resolveConfig())
 * @param {string} outDir     directory to write flow HTML files into
 */
export function renderSequenceDiagrams(pkgConfig, outDir) {
  config = {
    title:   pkgConfig.title,
    events:  pkgConfig.events,
    apis:    pkgConfig.apis,
    actors:  pkgConfig.actors,
    flows:   pkgConfig.flows,
    domains: pkgConfig.domains || [],
  };

  mkdirSync(outDir, { recursive: true });

  for (const flow of (config.flows || [])) {
    const html = renderFlowPage(flow);
    const filename = `flow_${flow.domain}_${flow.id}.html`;
    writeFileSync(resolve(outDir, filename), html, 'utf8');
    console.log(`Written: ${filename}`);
  }
}
