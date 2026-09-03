#!/usr/bin/env node
/**
 * render.js — BPMN Collaboration Diagram for Program Processes
 *
 * Generates a BPMN-standard collaboration diagram with three pools
 * (Applicant, Caseworker/Agency, System) and phase dividers derived
 * from program-processes.yaml.
 *
 * Usage:
 *   node render.js [distDir]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { loadConfig } from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resolvedArg  = process.argv.find(a => a.startsWith('--resolved='));
const contentArg   = process.argv.find(a => a.startsWith('--content='));
const contractsDir = resolvedArg
  ? resolve(process.cwd(), resolvedArg.slice('--resolved='.length))
  : resolve(__dirname, '../../../../resolved');
const configPath   = resolve(__dirname, '../config/index-config.yaml');
const distDir      = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '../dist');
const contentDir   = contentArg ? resolve(contentArg.slice('--content='.length)) : null;
const { name: projectName } = contentDir ? loadConfig(contentDir) : { name: 'Blueprint' };
mkdirSync(distDir, { recursive: true });

// ── Colors ────────────────────────────────────────────────────────────────────

const FONT      = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const DARK_BLUE = '#2B1A78';
const MID_BLUE  = '#5650BE';
const LT_BLUE   = '#C2C0E8';
const BG        = '#F3F3F3';
const SAND      = '#E9CCBE';
const GREEN     = '#00AD93';
const GREEN_BG  = '#E2F9F6';
const WHITE     = '#ffffff';
const GRAY_TEXT = '#6b7280';
const DARK_TEXT = '#111827';

// ── Layout ────────────────────────────────────────────────────────────────────

const W           = 1400;
const HEADER_H    = 44;
const POOL_LABEL_W = 110;   // width of the vertical pool label strip
const POOL_H      = 168;    // height of each pool
const TOTAL_H     = HEADER_H + 3 * POOL_H + 32; // 32px for legend

const CONTENT_X   = POOL_LABEL_W;
const CONTENT_W   = W - POOL_LABEL_W;

// Pool top-y and center-y
const POOLS = {
  applicant:  { label: 'Applicant',           y: HEADER_H,              h: POOL_H },
  caseworker: { label: 'Caseworker / Agency', y: HEADER_H + POOL_H,     h: POOL_H },
  system:     { label: 'System',              y: HEADER_H + POOL_H * 2, h: POOL_H },
};
function poolCy(pool) { return POOLS[pool].y + POOLS[pool].h / 2; }

// Phase x-dividers and labels (from config)
// Computed after config load — see render()

// ── BPMN element dimensions ───────────────────────────────────────────────────

const TASK_W  = 120;
const TASK_H  = 50;
const EVT_R   = 16;   // event circle radius

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function t(text, x, y, opts = {}) {
  const { size = 11, weight = 'normal', fill = DARK_TEXT, anchor = 'middle', italic = false } = opts;
  const style = italic ? 'font-style:italic;' : '';
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" font-family="${FONT}" style="${style}">${esc(text)}</text>`;
}

// ── BPMN shape renderers ──────────────────────────────────────────────────────

// None start event: thin-border circle
function noneStart(cx, cy) {
  return `<circle cx="${cx}" cy="${cy}" r="${EVT_R}" fill="${WHITE}" stroke="${DARK_TEXT}" stroke-width="1.5"/>`;
}

// None end event: thick-border circle
function noneEnd(cx, cy) {
  return `<circle cx="${cx}" cy="${cy}" r="${EVT_R}" fill="${WHITE}" stroke="${DARK_TEXT}" stroke-width="4"/>`;
}

// Message start event: thin-border circle + small envelope
function msgStart(cx, cy) {
  const r = EVT_R;
  const ex = cx - 8, ey = cy - 5, ew = 16, eh = 11;
  return [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${WHITE}" stroke="${MID_BLUE}" stroke-width="1.5"/>`,
    `<rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" fill="${LT_BLUE}" stroke="${MID_BLUE}" stroke-width="1" rx="1"/>`,
    `<polyline points="${ex},${ey} ${cx},${ey + 6} ${ex + ew},${ey}" fill="none" stroke="${MID_BLUE}" stroke-width="1"/>`,
  ].join('');
}

// Task: rounded rect with label and small type icon in top-left
function task(cx, cy, label, taskType, planned = false) {
  const x = cx - TASK_W / 2;
  const y = cy - TASK_H / 2;
  const fill   = planned ? BG   : WHITE;
  const stroke = planned ? SAND : (taskType === 'service' ? GREEN : MID_BLUE);
  const sw     = planned ? 1    : 1.5;
  const dash   = planned ? ' stroke-dasharray="5,3"' : '';

  // Word-wrap label to 2 lines (approx 14 chars per line)
  const words = label.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > 14) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);

  const iconColor = planned ? '#aaa' : stroke;
  const iconSvg = taskType === 'user'
    ? userIcon(x + 10, y + 7, iconColor)
    : serviceIcon(x + 10, y + 7, iconColor);

  const totalTextH = lines.length * 14;
  const textStartY = cy - totalTextH / 2 + 8;

  const parts = [
    `<rect x="${x}" y="${y}" width="${TASK_W}" height="${TASK_H}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`,
    iconSvg,
    ...lines.map((line, i) => t(line, cx, textStartY + i * 14, {
      size: 9.5,
      fill: planned ? '#aaa' : DARK_BLUE,
      weight: '600',
    })),
  ];
  return parts.join('');
}

// User task icon: silhouette (head + shoulders)
function userIcon(x, y, color) {
  return [
    `<circle cx="${x + 8}" cy="${y + 6}" r="4" fill="none" stroke="${color}" stroke-width="1.2"/>`,
    `<path d="M${x + 2},${y + 18} a6,5 0 0,1 12,0" fill="none" stroke="${color}" stroke-width="1.2"/>`,
  ].join('');
}

// Service task icon: gear (circle + dashes)
function serviceIcon(x, y, color) {
  return [
    `<circle cx="${x + 8}" cy="${y + 9}" r="4" fill="none" stroke="${color}" stroke-width="1.2"/>`,
    `<circle cx="${x + 8}" cy="${y + 9}" r="8" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="3,2.5"/>`,
  ].join('');
}

// ── Arrow helpers ─────────────────────────────────────────────────────────────

// Sequence flow (solid, filled arrowhead)
function seqArrow(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len, uy = dy / len;
  const ax = x2 - ux * 10, ay = y2 - uy * 10;
  const px = -uy * 4,      py =  ux * 4;
  return `<line x1="${x1}" y1="${y1}" x2="${ax}" y2="${ay}" stroke="${DARK_TEXT}" stroke-width="1.5"/>` +
    `<polygon points="${x2},${y2} ${ax + px},${ay + py} ${ax - px},${ay - py}" fill="${DARK_TEXT}"/>`;
}

// Message flow (dashed, open arrowhead)
function msgArrow(x1, y1, x2, y2, label = '') {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len, uy = dy / len;
  const ax = x2 - ux * 10, ay = y2 - uy * 10;
  const px = -uy * 4,      py =  ux * 4;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const parts = [
    // small envelope at source
    `<rect x="${x1 - 6}" y="${y1 - 4}" width="12" height="8" rx="1" fill="${WHITE}" stroke="${MID_BLUE}" stroke-width="1"/>`,
    `<polyline points="${x1 - 6},${y1 - 4} ${x1},${y1 + 1} ${x1 + 6},${y1 - 4}" fill="none" stroke="${MID_BLUE}" stroke-width="1"/>`,
    // dashed line
    `<line x1="${x1}" y1="${y1 + 4}" x2="${ax}" y2="${ay}" stroke="${MID_BLUE}" stroke-width="1.2" stroke-dasharray="5,3"/>`,
    // open arrowhead
    `<polygon points="${x2},${y2} ${ax + px},${ay + py} ${ax - px},${ay - py}" fill="${WHITE}" stroke="${MID_BLUE}" stroke-width="1.2"/>`,
  ];
  if (label) {
    parts.push(t(label, mx + 6, my - 4, { size: 7.5, fill: MID_BLUE, anchor: 'start', italic: true }));
  }
  return parts.join('');
}

// Edge points for seq/msg flow endpoints
function rightEdge(cx, cy, type) {
  return type === 'task'
    ? { x: cx + TASK_W / 2, y: cy }
    : { x: cx + EVT_R,      y: cy };
}
function leftEdge(cx, cy, type) {
  return type === 'task'
    ? { x: cx - TASK_W / 2, y: cy }
    : { x: cx - EVT_R,      y: cy };
}
function bottomEdge(cx, cy, type) {
  return type === 'task'
    ? { x: cx, y: cy + TASK_H / 2 }
    : { x: cx, y: cy + EVT_R };
}
function topEdge(cx, cy, type) {
  return type === 'task'
    ? { x: cx, y: cy - TASK_H / 2 }
    : { x: cx, y: cy - EVT_R };
}

// ── Main render ───────────────────────────────────────────────────────────────

function render() {
  const config = yaml.load(readFileSync(configPath, 'utf8'), { schema: yaml.CORE_SCHEMA });

  // Validate state machine references (warn only)
  const smFiles = readdirSync(contractsDir, { recursive: true })
    .filter(f => typeof f === 'string' && f.endsWith('-state-machine.yaml') && !f.endsWith('platform-state-machine.yaml'));
  const machines = {};
  for (const f of smFiles) {
    try {
      const sm = yaml.load(readFileSync(resolve(contractsDir, f), 'utf8'), { schema: yaml.CORE_SCHEMA });
      if (sm?.domain && sm?.machines) machines[sm.domain] = sm;
    } catch { /* skip */ }
  }
  for (const phase of config.phases ?? []) {
    const ref = phase.stateMachine;
    if (!ref) continue;
    const sm = machines[ref.machine];
    if (!sm) { console.warn(`  Warning: machine '${ref.machine}' not found (phase: ${phase.id})`); continue; }
    const obj = sm.machines?.find(m => m.object?.toLowerCase() === ref.object?.toLowerCase());
    if (!obj) { console.warn(`  Warning: object '${ref.object}' not found in '${ref.machine}'`); continue; }
    const known = new Set((obj.states ?? []).map(s => s.id));
    for (const s of ref.states ?? []) {
      if (!known.has(s)) console.warn(`  Warning: state '${s}' not found in ${ref.machine}/${ref.object}`);
    }
  }

  // ── Phase dividers from config ─────────────────────────────────────────────
  // Distribute phases evenly across content width
  const phases = config.phases ?? [];
  const phaseW = Math.floor(CONTENT_W / phases.length);
  const phaseLayout = phases.map((p, i) => ({
    ...p,
    x: CONTENT_X + i * phaseW,
    w: i === phases.length - 1 ? (W - (CONTENT_X + i * phaseW)) : phaseW,
    cx: CONTENT_X + i * phaseW + phaseW / 2,
  }));

  // ── BPMN elements ──────────────────────────────────────────────────────────
  // cx is absolute x; cy computed from pool

  // Phase x reference points
  const p1cx = phaseLayout[0]?.cx ?? 210;  // Application Filing center
  const p2cx = phaseLayout[1]?.cx ?? 510;  // Intake Review center
  const p3cx = phaseLayout[2]?.cx ?? 820;  // Determination center
  const p4cx = phaseLayout[3]?.cx ?? 1200; // Benefit Management center

  // x positions within phases (offset from phase center)
  const EL = {
    // Applicant pool
    'app-start':    { pool: 'applicant',  cx: CONTENT_X + 28,      type: 'none-start' },
    'complete-app': { pool: 'applicant',  cx: p1cx + 30,           type: 'task',       label: 'Complete Application',   taskType: 'user' },
    'submit-app':   { pool: 'applicant',  cx: p2cx - 50,           type: 'task',       label: 'Submit Application',     taskType: 'user' },
    'app-end':      { pool: 'applicant',  cx: W - CONTENT_X - 28,  type: 'none-end' },

    // Caseworker pool
    'review-app':   { pool: 'caseworker', cx: p2cx + 60,           type: 'task',       label: 'Review Application',    taskType: 'user' },
    'request-verif':{ pool: 'caseworker', cx: p3cx - 30,           type: 'task',       label: 'Request Verifications', taskType: 'user' },
    'issue-det':    { pool: 'caseworker', cx: p3cx + 65,           type: 'task',       label: 'Issue Determination',   taskType: 'user' },
    'manage-case':  { pool: 'caseworker', cx: p4cx,                type: 'task',       label: 'Manage Case',           taskType: 'user',    planned: true },
    'cw-end':       { pool: 'caseworker', cx: W - CONTENT_X - 28,  type: 'none-end' },

    // System pool
    'validate-sub': { pool: 'system',     cx: p2cx - 50,           type: 'task',       label: 'Validate & Record',     taskType: 'service' },
    'run-verif':    { pool: 'system',     cx: p3cx - 30,           type: 'task',       label: 'Run Verifications',     taskType: 'service' },
    'eval-elig':    { pool: 'system',     cx: p3cx + 65,           type: 'task',       label: 'Evaluate Eligibility',  taskType: 'service' },
    'send-notice':  { pool: 'system',     cx: p4cx,                type: 'task',       label: 'Send Notice',           taskType: 'service', planned: true },
    'sys-end':      { pool: 'system',     cx: W - CONTENT_X - 28,  type: 'none-end' },
  };

  // Add computed cy
  for (const el of Object.values(EL)) {
    el.cy = poolCy(el.pool);
  }

  // Sequence flows (within pool)
  const SEQ = [
    ['app-start',    'complete-app'],
    ['complete-app', 'submit-app'],
    ['review-app',   'request-verif'],
    ['request-verif','issue-det'],
    ['issue-det',    'manage-case'],
    ['manage-case',  'cw-end'],
    ['validate-sub', 'run-verif'],
    ['run-verif',    'eval-elig'],
    ['eval-elig',    'send-notice'],
    ['send-notice',  'sys-end'],
  ];

  // Message flows (between pools) with label
  const MSG = [
    { from: 'submit-app',    to: 'validate-sub',  label: 'application submitted' },
    { from: 'validate-sub',  to: 'review-app',    label: 'assignment notification' },
    { from: 'request-verif', to: 'run-verif',     label: 'verification request' },
    { from: 'eval-elig',     to: 'issue-det',     label: 'eligibility results' },
    { from: 'send-notice',   to: 'app-end',       label: 'decision notice' },
  ];

  // ── Build SVG ──────────────────────────────────────────────────────────────

  const parts = [];

  // Background
  parts.push(`<rect x="0" y="0" width="${W}" height="${TOTAL_H}" fill="${BG}"/>`);

  // Header
  parts.push(`<rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="${DARK_BLUE}"/>`);
  parts.push(t('Program Processes', W / 2, 27, { size: 13, weight: '700', fill: WHITE }));
  parts.push(t(projectName, W - 20, 27, { size: 10, fill: LT_BLUE, anchor: 'end' }));

  // Pool containers + labels
  for (const [id, pool] of Object.entries(POOLS)) {
    const { y, h, label } = pool;
    // Pool border
    parts.push(`<rect x="0" y="${y}" width="${W}" height="${h}" fill="${WHITE}" stroke="${SAND}" stroke-width="1"/>`);
    // Pool label strip
    parts.push(`<rect x="0" y="${y}" width="${POOL_LABEL_W}" height="${h}" fill="${DARK_BLUE}" stroke="none"/>`);
    // Rotated pool label
    const lx = POOL_LABEL_W / 2;
    const ly = y + h / 2;
    parts.push(`<text x="${lx}" y="${ly}" font-size="11" font-weight="700" fill="${WHITE}" text-anchor="middle" font-family="${FONT}" transform="rotate(-90,${lx},${ly})">${esc(label)}</text>`);
  }

  // Phase dividers (vertical lines across all pools) and phase labels
  for (let i = 0; i < phaseLayout.length; i++) {
    const ph = phaseLayout[i];
    const isPlanned = ph.status === 'planned';

    // Vertical divider (not before the first phase)
    if (i > 0) {
      parts.push(`<line x1="${ph.x}" y1="${HEADER_H}" x2="${ph.x}" y2="${HEADER_H + 3 * POOL_H}" stroke="${SAND}" stroke-width="1" stroke-dasharray="4,3"/>`);
    }

    // Phase label at top of each pool's area
    const labelColor = isPlanned ? '#aaa' : GRAY_TEXT;
    parts.push(t(ph.label, ph.cx, HEADER_H + 14, { size: 8.5, weight: '600', fill: labelColor, anchor: 'middle' }));

    // Status dot next to label
    const dotColor = isPlanned ? '#ccc' : GREEN;
    parts.push(`<circle cx="${ph.cx - (ph.label.length * 3.2)}" cy="${HEADER_H + 10}" r="4" fill="${dotColor}"/>`);

    // Clickable overlay for non-planned phases (data-navigate wired by build-html.js)
    if (!isPlanned) {
      parts.push(`<rect x="${ph.x}" y="${HEADER_H}" width="${ph.w}" height="${3 * POOL_H}" fill="transparent" data-navigate="${ph.id}" style="cursor:pointer"/>`);
    }
  }

  // Phase divider line under phase labels
  parts.push(`<line x1="${CONTENT_X}" y1="${HEADER_H + 22}" x2="${W}" y2="${HEADER_H + 22}" stroke="${SAND}" stroke-width="0.5"/>`);

  // Message flows (drawn before tasks so tasks appear on top)
  for (const mf of MSG) {
    const src = EL[mf.from];
    const tgt = EL[mf.to];
    if (!src || !tgt) continue;

    // Determine if flow goes down or up between pools
    const srcIsAbove = src.cy < tgt.cy;
    const s = srcIsAbove
      ? bottomEdge(src.cx, src.cy, src.type)
      : topEdge(src.cx, src.cy, src.type);
    const tEnd = srcIsAbove
      ? topEdge(tgt.cx, tgt.cy, tgt.type)
      : bottomEdge(tgt.cx, tgt.cy, tgt.type);

    parts.push(msgArrow(s.x, s.y, tEnd.x, tEnd.y, mf.label));
  }

  // Sequence flows
  for (const [fromId, toId] of SEQ) {
    const src = EL[fromId];
    const tgt = EL[toId];
    if (!src || !tgt) continue;
    const s = rightEdge(src.cx, src.cy, src.type);
    const e = leftEdge(tgt.cx, tgt.cy, tgt.type);
    parts.push(seqArrow(s.x, s.y, e.x, e.y));
  }

  // BPMN elements
  for (const [id, el] of Object.entries(EL)) {
    const { cx, cy, type, label, taskType, planned } = el;
    if      (type === 'none-start') parts.push(noneStart(cx, cy));
    else if (type === 'none-end')   parts.push(noneEnd(cx, cy));
    else if (type === 'msg-start')  parts.push(msgStart(cx, cy));
    else if (type === 'task')       parts.push(task(cx, cy, label, taskType, planned ?? false));
  }

  // Legend
  const legY = TOTAL_H - 22;
  const legItems = [
    { shape: 'circle-thin',  color: DARK_TEXT, label: 'Start event' },
    { shape: 'circle-thick', color: DARK_TEXT, label: 'End event' },
    { shape: 'rect',         color: MID_BLUE,  label: 'User task' },
    { shape: 'rect',         color: GREEN,     label: 'Service task' },
    { shape: 'seq',          color: DARK_TEXT, label: 'Sequence flow' },
    { shape: 'msg',          color: MID_BLUE,  label: 'Message flow' },
    { shape: 'rect-planned', color: '#aaa',    label: 'Planned' },
  ];
  let lx = CONTENT_X + 20;
  for (const item of legItems) {
    if (item.shape === 'circle-thin') {
      parts.push(`<circle cx="${lx + 8}" cy="${legY}" r="7" fill="${WHITE}" stroke="${item.color}" stroke-width="1.5"/>`);
    } else if (item.shape === 'circle-thick') {
      parts.push(`<circle cx="${lx + 8}" cy="${legY}" r="7" fill="${WHITE}" stroke="${item.color}" stroke-width="3.5"/>`);
    } else if (item.shape === 'rect') {
      parts.push(`<rect x="${lx}" y="${legY - 7}" width="18" height="14" rx="3" fill="${WHITE}" stroke="${item.color}" stroke-width="1.5"/>`);
    } else if (item.shape === 'rect-planned') {
      parts.push(`<rect x="${lx}" y="${legY - 7}" width="18" height="14" rx="3" fill="${BG}" stroke="${item.color}" stroke-width="1" stroke-dasharray="4,2"/>`);
    } else if (item.shape === 'seq') {
      parts.push(`<line x1="${lx}" y1="${legY}" x2="${lx + 14}" y2="${legY}" stroke="${item.color}" stroke-width="1.5"/>`);
      parts.push(`<polygon points="${lx + 18},${legY} ${lx + 12},${legY - 3} ${lx + 12},${legY + 3}" fill="${item.color}"/>`);
    } else if (item.shape === 'msg') {
      parts.push(`<line x1="${lx}" y1="${legY}" x2="${lx + 14}" y2="${legY}" stroke="${item.color}" stroke-width="1.2" stroke-dasharray="4,2"/>`);
      parts.push(`<polygon points="${lx + 18},${legY} ${lx + 12},${legY - 3} ${lx + 12},${legY + 3}" fill="${WHITE}" stroke="${item.color}" stroke-width="1"/>`);
    }
    parts.push(t(item.label, lx + 24, legY + 4, { size: 8.5, fill: GRAY_TEXT, anchor: 'start' }));
    lx += 130;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TOTAL_H}" style="display:block">
${parts.join('\n')}
</svg>`;

  writeFileSync(resolve(distDir, 'overview.svg'), svg, 'utf8');
  console.log(`  Written: ${resolve(distDir, 'overview.svg')}`);
}

render();
