#!/usr/bin/env node
/**
 * render-phase.js — BPMN process diagram for a single program phase
 *
 * Reads program-processes.yaml for the phase scope, then loads the relevant
 * state machine to derive tasks, pools, and message flows automatically.
 * No per-phase config file — everything comes from contracts.
 *
 * Usage:
 *   node render-phase.js <phaseId> [distDir]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const resolvedArg  = process.argv.find(a => a.startsWith('--resolved='));
const contractsDir = resolvedArg
  ? resolve(process.cwd(), resolvedArg.slice('--resolved='.length))
  : resolve(__dirname, '../../../../resolved');
const configPath   = resolve(__dirname, '../config/index-config.yaml');

const phaseId = process.argv[2];
const distDir = process.argv[3] ? resolve(process.argv[3]) : resolve(__dirname, '../dist');
mkdirSync(distDir, { recursive: true });

if (!phaseId) {
  console.error('Usage: node render-phase.js <phaseId> [distDir]');
  process.exit(1);
}

// ── Colors ────────────────────────────────────────────────────────────────────

const FONT      = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const DARK_BLUE = '#2B1A78';
const MID_BLUE  = '#5650BE';
const LT_BLUE   = '#C2C0E8';
const BG        = '#F3F3F3';
const SAND      = '#E9CCBE';
const GREEN     = '#00AD93';
const WHITE     = '#ffffff';
const GRAY      = '#6b7280';
const DARK_TEXT = '#111827';

// ── Layout ────────────────────────────────────────────────────────────────────

const W             = 1400;
const HEADER_H      = 44;
const POOL_LABEL_W  = 110;
const POOL_H        = 180;
const TASK_W        = 130;
const TASK_H        = 52;
const EVT_R         = 16;
const LEGEND_H      = 32;
const PAD_X         = 60;   // horizontal padding inside content area

// Pool display metadata
const POOL_META = {
  applicant:  { label: 'Applicant',           order: 0 },
  caseworker: { label: 'Caseworker / Agency', order: 1 },
  system:     { label: 'System',              order: 2 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function txt(text, x, y, { size=11, weight='normal', fill=DARK_TEXT, anchor='middle', italic=false } = {}) {
  const style = italic ? 'font-style:italic;' : '';
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" font-family="${FONT}" style="${style}">${esc(text)}</text>`;
}

/** Strip HTTP verb + path prefix from SM action descriptions. */
function stripDescription(desc) {
  if (!desc) return '';
  // "POST /path/to/resource — Human readable label" → "Human readable label"
  const match = String(desc).match(/^(?:GET|POST|PUT|PATCH|DELETE)\s+\S+\s+[—–-]+\s*(.+)$/i);
  return match ? match[1].trim() : String(desc).trim();
}

/** Infer which pool an action belongs to from its guards. */
function inferPool(guards) {
  const actors = (guards ?? []).flatMap(g => g.actors ?? []);
  if (actors.some(a => ['resident', 'applicant', 'client', 'user'].includes(a))) return 'applicant';
  if (actors.some(a => ['case_worker', 'supervisor', 'caseworker'].includes(a))) return 'caseworker';
  return 'system';
}

/** Infer task type: system actors → service task, otherwise user task. */
function inferTaskType(guards) {
  const actors = (guards ?? []).flatMap(g => g.actors ?? []);
  if (actors.length === 0 || actors.every(a => a === 'system')) return 'service';
  return 'user';
}

/** Flatten action steps (handles nested then/forEach arrays). */
function flattenSteps(action) {
  const steps = [];
  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (node.emit || node.set || node.call) steps.push(node);
    if (node.then) walk(node.then);
    if (node.forEach) walk(node.forEach);
    if (node.match) Object.values(node.match).forEach(walk);
  }
  walk(action.steps);
  return steps;
}

// ── BPMN shape renderers ──────────────────────────────────────────────────────

function noneStart(cx, cy) {
  return `<circle cx="${cx}" cy="${cy}" r="${EVT_R}" fill="${WHITE}" stroke="${DARK_TEXT}" stroke-width="1.5"/>`;
}

function noneEnd(cx, cy) {
  return `<circle cx="${cx}" cy="${cy}" r="${EVT_R}" fill="${WHITE}" stroke="${DARK_TEXT}" stroke-width="4"/>`;
}

function msgThrow(cx, cy) {
  // Intermediate message throw event: thin double-ring circle + filled envelope
  return [
    `<circle cx="${cx}" cy="${cy}" r="${EVT_R}" fill="${WHITE}" stroke="${MID_BLUE}" stroke-width="1.5"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${EVT_R - 4}" fill="${WHITE}" stroke="${MID_BLUE}" stroke-width="1.5"/>`,
    `<rect x="${cx-7}" y="${cy-5}" width="14" height="9" rx="1" fill="${MID_BLUE}"/>`,
    `<polyline points="${cx-7},${cy-5} ${cx},${cy+1} ${cx+7},${cy-5}" fill="none" stroke="${WHITE}" stroke-width="1"/>`,
  ].join('');
}

function taskShape(cx, cy, label, taskType) {
  const x = cx - TASK_W / 2, y = cy - TASK_H / 2;
  const stroke = taskType === 'service' ? GREEN : MID_BLUE;

  const words = label.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > 15) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);

  const textH = lines.length * 14;
  const startY = cy - textH / 2 + 8;

  const icon = taskType === 'service' ? serviceIcon(x + 10, y + 6, stroke) : userIcon(x + 10, y + 6, stroke);

  return [
    `<rect x="${x}" y="${y}" width="${TASK_W}" height="${TASK_H}" rx="5" fill="${WHITE}" stroke="${stroke}" stroke-width="1.5"/>`,
    icon,
    ...lines.map((l, i) => txt(l, cx, startY + i * 14, { size: 9.5, weight: '600', fill: DARK_BLUE })),
  ].join('');
}

function userIcon(x, y, color) {
  return `<circle cx="${x+8}" cy="${y+6}" r="4" fill="none" stroke="${color}" stroke-width="1.2"/>` +
    `<path d="M${x+2},${y+18} a6,5 0 0,1 12,0" fill="none" stroke="${color}" stroke-width="1.2"/>`;
}

function serviceIcon(x, y, color) {
  return `<circle cx="${x+8}" cy="${y+9}" r="4" fill="none" stroke="${color}" stroke-width="1.2"/>` +
    `<circle cx="${x+8}" cy="${y+9}" r="8" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="3,2.5"/>`;
}

// ── Arrow helpers ─────────────────────────────────────────────────────────────

function seqArrow(x1, y1, x2, y2) {
  const dx = x2-x1, dy = y2-y1, len = Math.sqrt(dx*dx+dy*dy);
  const ux = dx/len, uy = dy/len;
  const ax = x2-ux*10, ay = y2-uy*10;
  const px = -uy*4,    py =  ux*4;
  return `<line x1="${x1}" y1="${y1}" x2="${ax}" y2="${ay}" stroke="${DARK_TEXT}" stroke-width="1.5"/>` +
    `<polygon points="${x2},${y2} ${ax+px},${ay+py} ${ax-px},${ay-py}" fill="${DARK_TEXT}"/>`;
}

function msgArrow(x1, y1, x2, y2, label='') {
  const dx = x2-x1, dy = y2-y1, len = Math.sqrt(dx*dx+dy*dy);
  const ux = dx/len, uy = dy/len;
  const ax = x2-ux*10, ay = y2-uy*10;
  const px = -uy*4,    py =  ux*4;
  const mx = (x1+x2)/2, my = (y1+y2)/2;
  const parts = [
    `<line x1="${x1}" y1="${y1}" x2="${ax}" y2="${ay}" stroke="${MID_BLUE}" stroke-width="1.2" stroke-dasharray="5,3"/>`,
    `<polygon points="${x2},${y2} ${ax+px},${ay+py} ${ax-px},${ay-py}" fill="${WHITE}" stroke="${MID_BLUE}" stroke-width="1.2"/>`,
  ];
  if (label) parts.push(txt(label, mx+6, my-4, { size: 7.5, fill: MID_BLUE, anchor: 'start', italic: true }));
  return parts.join('');
}

// Edge helpers
function rEdge(cx, cy, type) { return type === 'task' ? { x: cx+TASK_W/2, y: cy } : { x: cx+EVT_R, y: cy }; }
function lEdge(cx, cy, type) { return type === 'task' ? { x: cx-TASK_W/2, y: cy } : { x: cx-EVT_R, y: cy }; }
function bEdge(cx, cy, type) { return type === 'task' ? { x: cx, y: cy+TASK_H/2 } : { x: cx, y: cy+EVT_R }; }
function tEdge(cx, cy, type) { return type === 'task' ? { x: cx, y: cy-TASK_H/2 } : { x: cx, y: cy-EVT_R }; }

// ── Main ──────────────────────────────────────────────────────────────────────

function render() {
  // Load phase scope from program-processes.yaml
  const config  = yaml.load(readFileSync(configPath, 'utf8'), { schema: yaml.CORE_SCHEMA });
  const phase   = (config.phases ?? []).find(p => p.id === phaseId);
  if (!phase) { console.error(`Phase '${phaseId}' not found in program-processes.yaml`); process.exit(1); }

  const smRef = phase.stateMachine;
  if (!smRef) { console.warn(`Phase '${phaseId}' has no stateMachine — skipping`); return; }

  // Load state machines
  const smFiles = readdirSync(contractsDir, { recursive: true }).filter(f => typeof f === 'string' && f.endsWith('-state-machine.yaml') && !f.endsWith('platform-state-machine.yaml'));
  const machines = {};
  for (const f of smFiles) {
    try {
      const sm = yaml.load(readFileSync(resolve(contractsDir, f), 'utf8'), { schema: yaml.CORE_SCHEMA });
      if (sm?.domain && sm?.machines) machines[sm.domain] = sm;
    } catch { /* skip */ }
  }

  const sm  = machines[smRef.machine];
  if (!sm)  { console.error(`State machine '${smRef.machine}' not found`); process.exit(1); }
  const obj = sm.machines?.find(m => m.object?.toLowerCase() === smRef.object?.toLowerCase());
  if (!obj) { console.error(`Object '${smRef.object}' not found in '${smRef.machine}'`); process.exit(1); }

  const phaseStates = new Set(smRef.states ?? []);

  // Collect actions whose primary `from` state is in this phase
  const tasks = [];   // { id, label, pool, taskType, emits[] }
  for (const action of obj.actions ?? []) {
    const from = action.transition?.from;
    // Include if from is a single state in this phase, or an array where at least one is in phase
    const fromStates = Array.isArray(from) ? from : [from];
    const primaryFrom = fromStates.find(s => phaseStates.has(s));
    if (!primaryFrom) continue;

    const pool     = inferPool(action.guards);
    const taskType = inferTaskType(action.guards);
    const label    = stripDescription(action.description) || action.id;

    // Collect emitted event types from steps
    const emits = flattenSteps(action)
      .filter(s => s.emit?.type)
      .map(s => s.emit.type);

    tasks.push({ id: action.id, label, pool, taskType, emits });
  }

  if (tasks.length === 0) {
    console.warn(`  No actions found for phase '${phaseId}' in states [${[...phaseStates].join(', ')}]`);
  }

  // Also check event subscriptions in OTHER machines that handle events emitted by this phase
  // — these become system/caseworker tasks if they live in another machine
  // (future enhancement — skipped for first pass)

  // Group tasks by pool, preserve discovery order
  const poolOrder  = ['applicant', 'caseworker', 'system'];
  const poolTasks  = Object.fromEntries(poolOrder.map(p => [p, []]));
  for (const task of tasks) {
    if (poolTasks[task.pool]) poolTasks[task.pool].push(task);
    else poolTasks['system'].push(task); // fallback
  }

  // Add intermediate message throw events after tasks that emit events
  // These are inline SVG events, not "tasks" — track separately
  const throwEvents = []; // { afterTaskId, eventType }
  for (const task of tasks) {
    for (const eventType of task.emits) {
      throwEvents.push({ afterTaskId: task.id, eventType });
    }
  }

  const activePools = poolOrder.filter(p => poolTasks[p].length > 0);
  const totalH = HEADER_H + activePools.length * POOL_H + LEGEND_H;

  // ── Layout ─────────────────────────────────────────────────────────────────

  // Build element registry: id → { cx, cy, type }
  const EL = {};

  for (let pi = 0; pi < activePools.length; pi++) {
    const pool = activePools[pi];
    const cy   = HEADER_H + pi * POOL_H + POOL_H / 2;
    const pts  = poolTasks[pool];

    // Elements: [start, ...tasks, ...throwEventsForPool, end]
    // Throw events are interspersed after their source task
    const ordered = [];
    for (const task of pts) {
      ordered.push({ id: task.id, type: 'task', taskType: task.taskType, label: task.label });
      for (const te of throwEvents.filter(te => te.afterTaskId === task.id)) {
        ordered.push({ id: `throw-${te.afterTaskId}-${te.eventType}`, type: 'msg-throw', eventType: te.eventType });
      }
    }

    const startEl = { id: `${pool}-start`, type: 'none-start' };
    const endEl   = { id: `${pool}-end`,   type: 'none-end'   };
    const all     = [startEl, ...ordered, endEl];

    // X positions: evenly distributed
    const x0 = POOL_LABEL_W + PAD_X;
    const x1 = W - PAD_X;
    const step = all.length > 1 ? (x1 - x0) / (all.length - 1) : 0;

    for (let i = 0; i < all.length; i++) {
      EL[all[i].id] = { cx: Math.round(x0 + step * i), cy, type: all[i].type, ...all[i] };
    }
  }

  // ── Sequence flows ──────────────────────────────────────────────────────────

  const seqFlows = [];
  for (const pool of activePools) {
    const pts = poolTasks[pool];
    // Reconstruct the ordered element sequence for this pool
    const ordered = [];
    ordered.push(`${pool}-start`);
    for (const task of pts) {
      ordered.push(task.id);
      for (const te of throwEvents.filter(te => te.afterTaskId === task.id)) {
        ordered.push(`throw-${te.afterTaskId}-${te.eventType}`);
      }
    }
    ordered.push(`${pool}-end`);
    for (let i = 0; i < ordered.length - 1; i++) {
      seqFlows.push([ordered[i], ordered[i + 1]]);
    }
  }

  // ── Message flows ───────────────────────────────────────────────────────────

  // For now: show throw event → end of diagram with label (no receiver in scope)
  // A throw event sitting above the pool boundary indicates an outbound event
  const msgFlows = []; // { fromId, label } — outbound, no in-scope target

  // ── SVG ────────────────────────────────────────────────────────────────────

  const parts = [];

  // Background
  parts.push(`<rect x="0" y="0" width="${W}" height="${totalH}" fill="${BG}"/>`);

  // Header
  parts.push(`<rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="${DARK_BLUE}"/>`);
  parts.push(txt('← Program Processes', POOL_LABEL_W + 16, 27, { size: 11, fill: LT_BLUE, anchor: 'start' }));
  parts.push(txt(phase.label, W / 2, 27, { size: 13, weight: '700', fill: WHITE }));

  // Pool containers
  for (let pi = 0; pi < activePools.length; pi++) {
    const pool = activePools[pi];
    const y    = HEADER_H + pi * POOL_H;
    const meta = POOL_META[pool];
    parts.push(`<rect x="0" y="${y}" width="${W}" height="${POOL_H}" fill="${WHITE}" stroke="${SAND}" stroke-width="1"/>`);
    parts.push(`<rect x="0" y="${y}" width="${POOL_LABEL_W}" height="${POOL_H}" fill="${DARK_BLUE}"/>`);
    const lx = POOL_LABEL_W / 2, ly = y + POOL_H / 2;
    parts.push(`<text x="${lx}" y="${ly}" font-size="11" font-weight="700" fill="${WHITE}" text-anchor="middle" font-family="${FONT}" transform="rotate(-90,${lx},${ly})">${esc(meta.label)}</text>`);
  }

  // Sequence flows (drawn before shapes so shapes appear on top)
  for (const [fromId, toId] of seqFlows) {
    const src = EL[fromId], tgt = EL[toId];
    if (!src || !tgt) continue;
    const s = rEdge(src.cx, src.cy, src.type);
    const e = lEdge(tgt.cx, tgt.cy, tgt.type);
    parts.push(seqArrow(s.x, s.y, e.x, e.y));
  }

  // BPMN elements
  for (const el of Object.values(EL)) {
    if      (el.type === 'none-start') parts.push(noneStart(el.cx, el.cy));
    else if (el.type === 'none-end')   parts.push(noneEnd(el.cx, el.cy));
    else if (el.type === 'msg-throw')  parts.push(msgThrow(el.cx, el.cy));
    else if (el.type === 'task')       parts.push(taskShape(el.cx, el.cy, el.label, el.taskType));
  }

  // Event type labels under throw events
  for (const el of Object.values(EL)) {
    if (el.type !== 'msg-throw') continue;
    const shortType = el.eventType.split('.').slice(-1)[0].replace(/_/g, ' ');
    parts.push(txt(shortType, el.cx, el.cy + EVT_R + 12, { size: 7.5, fill: MID_BLUE, italic: true }));
  }

  // State machine reference annotation
  parts.push(txt(`${smRef.machine}/${smRef.object} · states: ${[...phaseStates].join(', ')}`,
    W - 16, totalH - LEGEND_H + 14, { size: 8, fill: '#9ca3af', anchor: 'end' }));

  // Legend
  const legY = totalH - LEGEND_H + 18;
  let lx = POOL_LABEL_W + 20;
  const legItems = [
    { shape: 'circle-thin',  color: DARK_TEXT, label: 'Start' },
    { shape: 'circle-thick', color: DARK_TEXT, label: 'End' },
    { shape: 'rect-user',    color: MID_BLUE,  label: 'User task' },
    { shape: 'rect-svc',     color: GREEN,     label: 'Service task' },
    { shape: 'msg-throw',    color: MID_BLUE,  label: 'Message thrown' },
    { shape: 'seq',          color: DARK_TEXT, label: 'Sequence flow' },
  ];
  for (const item of legItems) {
    if (item.shape === 'circle-thin')  parts.push(`<circle cx="${lx+7}" cy="${legY}" r="7" fill="${WHITE}" stroke="${item.color}" stroke-width="1.5"/>`);
    if (item.shape === 'circle-thick') parts.push(`<circle cx="${lx+7}" cy="${legY}" r="7" fill="${WHITE}" stroke="${item.color}" stroke-width="3.5"/>`);
    if (item.shape === 'rect-user')    parts.push(`<rect x="${lx}" y="${legY-7}" width="16" height="13" rx="3" fill="${WHITE}" stroke="${item.color}" stroke-width="1.5"/>`);
    if (item.shape === 'rect-svc')     parts.push(`<rect x="${lx}" y="${legY-7}" width="16" height="13" rx="3" fill="${WHITE}" stroke="${item.color}" stroke-width="1.5"/>`);
    if (item.shape === 'msg-throw') {
      parts.push(`<circle cx="${lx+7}" cy="${legY}" r="7" fill="${WHITE}" stroke="${item.color}" stroke-width="1.5"/>`);
      parts.push(`<circle cx="${lx+7}" cy="${legY}" r="3.5" fill="${WHITE}" stroke="${item.color}" stroke-width="1.5"/>`);
      parts.push(`<rect x="${lx+3}" y="${legY-3}" width="8" height="5" rx="0.5" fill="${item.color}"/>`);
    }
    if (item.shape === 'seq') {
      parts.push(`<line x1="${lx}" y1="${legY}" x2="${lx+14}" y2="${legY}" stroke="${item.color}" stroke-width="1.5"/>`);
      parts.push(`<polygon points="${lx+18},${legY} ${lx+12},${legY-3} ${lx+12},${legY+3}" fill="${item.color}"/>`);
    }
    parts.push(txt(item.label, lx + 24, legY + 4, { size: 8.5, fill: GRAY, anchor: 'start' }));
    lx += 120;
  }

  const svgH = totalH;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${svgH}" style="display:block">
${parts.join('\n')}
</svg>`;

  writeFileSync(resolve(distDir, `${phaseId}.svg`), svg, 'utf8');
  console.log(`  Written: ${resolve(distDir, `${phaseId}.svg`)}`);
}

render();
