#!/usr/bin/env node
/**
 * render-action-flow.js
 *
 * Contract-driven sequence diagram for a triggering action. Traces the full
 * emit → subscribe → emit chain from state machine files. Expands procedure
 * calls so the full chain (including data exchange service calls) is shown.
 *
 * Usage: node render-action-flow.js [outDir]
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { COLORS, FONT } from '../../../lib/theme.js';
import { esc as escXml, breadcrumb } from '../../../lib/html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resolvedArg  = process.argv.find(a => a.startsWith('--resolved='));
const contractsDir = resolvedArg
  ? resolve(process.cwd(), resolvedArg.slice('--resolved='.length))
  : resolve(__dirname, '../../../../resolved');
const configDir    = resolve(__dirname, '../config');
const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '..');
mkdirSync(outDir, { recursive: true });

// ── Constants ──────────────────────────────────────────────────────────────

const W       = 1400;
const MARGIN  = 20;
const LEGEND_H = 40;
const PHDR_H  = 48;
const STEP_H  = 54;
const FPAD    = 10;

const DARK_BLUE = COLORS.darkBlue;
const MID_BLUE  = COLORS.midBlue;
const TEAL      = COLORS.midGreen;
const EVT_CLR   = COLORS.midBlue;
const CALL_CLR  = '#1F2937';

// ── Load diagram config files ──────────────────────────────────────────────
// {domain}-config.yaml files in the config/ directory provide clean display
// labels for events and procedure branches, separate from contract annotations.

const diagramConfig = new Map(); // domain → {events, procedures}
for (const f of readdirSync(configDir).filter(f => f.endsWith('-config.yaml'))) {
  const cfg = yaml.load(readFileSync(resolve(configDir, f), 'utf8'));
  if (cfg?.domain) diagramConfig.set(cfg.domain, cfg);
}

function eventLabel(domain, evtType, fallback) {
  return diagramConfig.get(domain)?.events?.[evtType]?.label ?? fallback;
}

function matchBranchLabel(domain, procId, branchKey) {
  return diagramConfig.get(domain)?.procedures?.[procId]?.match?.[branchKey]?.label ?? branchKey;
}

function procedureLabel(domain, procId) {
  return diagramConfig.get(domain)?.procedures?.[procId]?.label ?? null;
}

// ── Load state machines ────────────────────────────────────────────────────

const SM_FILES = readdirSync(contractsDir)
  .filter(f => f.endsWith('-state-machine.yaml') && f !== 'platform-state-machine.yaml')
  .sort();
const smDatas    = SM_FILES.map(f => yaml.load(readFileSync(resolve(contractsDir, f), 'utf8')));
const platformSM = yaml.load(readFileSync(resolve(contractsDir, 'platform-state-machine.yaml'), 'utf8'));

// ── Build subscriber index ─────────────────────────────────────────────────
// eventType → [{domain, object, description, steps}]

const subscribers = new Map();
for (const sm of smDatas) {
  for (const machine of sm.machines ?? []) {
    for (const ev of machine.events ?? []) {
      if (!subscribers.has(ev.type)) subscribers.set(ev.type, []);
      subscribers.get(ev.type).push({
        domain:      sm.domain,
        object:      machine.object,
        description: ev.description ?? '',
        steps:       ev.steps ?? [],
      });
    }
  }
}

// ── Procedure map builder ──────────────────────────────────────────────────
// Returns a Map<procId, proc> for a given domain + machine object.
// Precedence: machine-level > domain-level > platform

function buildProcMap(domain, machineObject) {
  const map = new Map();
  // Platform procedures (available to all domains)
  for (const proc of platformSM.procedures ?? []) map.set(proc.id, proc);
  const sm = smDatas.find(s => s.domain === domain);
  if (!sm) return map;
  // Domain-level procedures
  for (const proc of sm.procedures ?? []) map.set(proc.id, proc);
  // Machine-level procedures
  const machine = sm.machines?.find(m => m.object === machineObject);
  for (const proc of machine?.procedures ?? []) map.set(proc.id, proc);
  return map;
}

// Normalise a procedure definition to a list of walkable steps
function procToSteps(proc) {
  if (proc.steps)  return proc.steps;
  if (proc.then)   return [{ if: proc.if ?? 'true', then: proc.then, else: proc.else }];
  if (proc.call)   return [{ call: proc.call, ...(proc.with ? { with: proc.with } : {}) }];
  if (proc.match)  return [{ match: proc.match, on: proc.on, when: proc.when, _procId: proc.id }];
  if (proc.emit)   return [{ emit: proc.emit }];
  return [];
}

// ── Participant config ─────────────────────────────────────────────────────
// Canonical domain list comes from info.x-domain in each *-openapi.yaml.
// Domain IDs are normalized to underscore (data-exchange → data_exchange)
// to match path prefixes used in state machine call steps.
// 'applicant' is prepended as the external actor (not a backend domain).

const domainEntries = readdirSync(contractsDir)
  .filter(f => f.endsWith('-openapi.yaml') && !f.includes('-adapter-'))
  .map(f => yaml.load(readFileSync(resolve(contractsDir, f), 'utf8'))?.info?.['x-domain'])
  .filter(Boolean)
  .map(d => ({
    id:    d.replace(/-/g, '_'),
    label: d.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }));

const knownDomains      = new Set(domainEntries.map(e => e.id));
const PARTICIPANT_ORDER = ['applicant', ...domainEntries.map(e => e.id)];
const PARTICIPANT_LABELS = {
  applicant: 'Applicant',
  ...Object.fromEntries(domainEntries.map(e => [e.id, e.label])),
};

function pathToDomain(path) {
  if (!path || typeof path !== 'string') return null;
  const seg = path.split('/')[0].replace(/-/g, '_');
  return knownDomains.has(seg) ? seg : null;
}

// ── CRUD create event inference ────────────────────────────────────────────
// Infers the created event for a POST path by deriving the event type from
// the path segments and checking whether a subscriber exists for it.
// e.g. POST intake/applications/verifications → intake.verification.created

function inferCreateEvent(postPath) {
  if (!postPath || typeof postPath !== 'string') return null;
  const segs = postPath.split('/').filter(s => s && !s.startsWith('{'));
  if (segs.length === 0) return null;
  const domain   = segs[0].replace(/-/g, '_');
  const resource = segs[segs.length - 1].replace(/-/g, '_');
  // Simple English singularization: covers the common -ies → -y and -s → '' cases
  const singular = resource.replace(/ies$/, 'y').replace(/s$/, '');
  const evtType  = `${domain}.${singular}.created`;
  return subscribers.has(evtType) ? evtType : null;
}

// ── Tracer ─────────────────────────────────────────────────────────────────
//
// Render node types:
//   {type:'arrow', from, to, label, isEvent, trigger?}
//   {type:'emit',  domain, label}
//   {type:'note',  domain, label}
//   {type:'self',  domain, label}
//   {type:'par',   branches: [[node,…],…]}
//   {type:'opt',   label, steps:[node,…]}
//   {type:'loop',  label, steps:[node,…]}
//   {type:'alt',   branches:[{label,steps}]}

function shorten(s, max = 55) {
  if (!s || s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// emittedArrows tracks (from→to) pairs already shown in this branch context.
// Passing it through prevents the same domain interaction appearing many times
// when forEach loops or match/on branches call the same target repeatedly.

// label: when set, used as the arrow label for any cross-domain call in this context.
// Config-provided labels are passed in and take priority over contract descriptions.
// Contract descriptions are only used when no label has been set.
function walkSteps(steps, fromDomain, visited, procs, emittedArrows = new Set(), label = null) {
  const out = [];
  for (const step of steps ?? []) {
    if (step.emit) {
      out.push(...traceEmit(step.emit.type, fromDomain, visited, procs, new Set(emittedArrows)));

    } else if (step.call != null && typeof step.call === 'string') {
      const proc = procs?.get(step.call);
      if (proc) {
        // If we already have a label (from config), keep it. Otherwise derive one from
        // the call site description or procedure config, to be used by the first
        // cross-domain call inside the proc.
        const nextLabel = label ?? step.description ?? procedureLabel(fromDomain, step.call);
        out.push(...walkSteps(procToSteps(proc), fromDomain, visited, procs, emittedArrows, nextLabel));
      }

    } else if (step.call != null && typeof step.call === 'object') {
      out.push(...traceCall(step.call, fromDomain, visited, procs, emittedArrows, label));

    } else if (step.if != null) {
      out.push(...walkSteps(step.then ?? [], fromDomain, visited, procs, emittedArrows, label));

    } else if (step.forEach != null) {
      out.push(...walkSteps(step.do ?? [], fromDomain, visited, procs, emittedArrows, label));

    } else if (step.match != null) {
      const cases = step.when ?? step.on ?? {};
      const branches = [];
      for (const [caseKey, doSteps] of Object.entries(cases)) {
        const caseStepArr = Array.isArray(doSteps) ? doSteps : [doSteps];
        // [caseKey] labels the alt branch; config label goes on the arrow inside
        const arrowLabel = step._procId
          ? matchBranchLabel(fromDomain, step._procId, caseKey)
          : null;
        const caseNodes = walkSteps(caseStepArr, fromDomain, visited, procs, new Set(emittedArrows), arrowLabel);
        if (caseNodes.length > 0) branches.push({ label: caseKey, steps: caseNodes });
      }
      if (branches.length === 1)      out.push(...branches[0].steps);
      else if (branches.length > 1)   out.push({ type: 'alt', branches });
    }
  }
  return out;
}

function describeForEach(fe) {
  if (typeof fe === 'string') return `per ${fe.replace(/^\$/, '')}`;
  if (fe.from) {
    const seg = String(fe.from).split('/').pop();
    return `per ${seg.replace(/-/g, ' ')}`;
  }
  if (fe.in) return `per ${String(fe.in).replace(/^\$/, '')}`;
  return 'forEach';
}

function traceEmit(evtType, fromDomain, visited, procs, emittedArrows) {
  // Deduplicate: don't trace the same event from the same domain twice in this branch
  const emitKey = `emit:${evtType}:${fromDomain}`;
  if (emittedArrows.has(emitKey)) return [];
  emittedArrows.add(emitKey);

  const out = [];
  out.push({ type: 'emit', domain: fromDomain, label: evtType });

  const subs = subscribers.get(evtType) ?? [];
  const branches = [];
  for (const sub of subs) {
    const key = `${evtType}→${sub.domain}.${sub.object}`;
    if (visited.has(key)) continue;
    const nv = new Set(visited);
    nv.add(key);
    const subProcs = buildProcMap(sub.domain, sub.object);
    // Each subscriber branch gets its own emittedArrows so parallel branches are independent
    const subSteps = walkSteps(sub.steps, sub.domain, nv, subProcs, new Set());
    // Hollow circle shows event name (mirrors emit circle). If the handler only does local
    // processing (no outgoing cross-domain calls), add a self-loop with the handler description.
    const hasOutgoing = subSteps.some(n => n.type === 'arrow' || n.type === 'par' || n.type === 'alt');
    const handlerLabel = eventLabel(sub.domain, evtType, sub.description || `Handle ${evtType}`);
    const subNodes = [
      { type: 'note', domain: sub.domain, label: evtType },
      ...(!hasOutgoing ? [{ type: 'self', domain: sub.domain, label: handlerLabel }] : []),
      ...subSteps,
    ];
    branches.push(subNodes);
  }

  if (branches.length === 0)      { /* terminal */ }
  else if (branches.length === 1) out.push(...branches[0]);
  else                            out.push({ type: 'par', branches });

  return out;
}

function traceCall(callVal, fromDomain, visited, procs, emittedArrows, label = null) {
  let method, path;
  for (const m of ['POST', 'PATCH', 'PUT', 'DELETE', 'GET']) {
    if (callVal[m]) { method = m; path = callVal[m]; break; }
  }
  if (!path) return [];

  const toDomain = pathToDomain(path);
  const out      = [];

  if (!toDomain) return out; // external / unknown domain

  // Config label wins; fall back to the call's own description, then raw path
  label = label ?? callVal.description ?? `${method} ${path}`;

  if (toDomain !== fromDomain) {
    // Cross-domain call — deduplicate by (from→to:label) so distinct service calls each appear
    const key = `${fromDomain}→${toDomain}:${label}`;
    if (!emittedArrows.has(key)) {
      emittedArrows.add(key);
      out.push({ type: 'arrow', from: fromDomain, to: toDomain, label, isEvent: false });
    }
  }
  // Self-calls don't get an arrow, but DO fire their CRUD events —
  // that's how POST intake/applications/verifications leads to intake.verification.created

  if (method === 'POST') {
    const crudEvt = inferCreateEvent(path);
    if (crudEvt) {
      const crudKey = `crud:${crudEvt}:${toDomain}`;
      if (!emittedArrows.has(crudKey)) {
        emittedArrows.add(crudKey);
        out.push(...traceEmit(crudEvt, toDomain, visited, procs, emittedArrows));
      }
    }
  }

  return out;
}

// ── Post-processing: merge note + arrow into subscribe-call ───────────────
// When a subscription handler note is immediately followed by a cross-domain
// arrow from the same domain, collapse them into a single visual: a hollow
// circle (event received) with a line to the call target.

function mergeNoteArrows(nodes) {
  const out = [];
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i];
    const next = nodes[i + 1];
    if (n.type === 'note' && next?.type === 'arrow' && next.from === n.domain) {
      out.push({ type: 'subscribe-call', domain: n.domain, from: next.from, to: next.to,
                 label: n.label, callLabel: next.label });
      i += 2;
    } else {
      if (n.type === 'par') {
        out.push({ ...n, branches: n.branches.map(mergeNoteArrows) });
      } else if (n.type === 'alt') {
        out.push({ ...n, branches: n.branches.map(b => ({ ...b, steps: mergeNoteArrows(b.steps) })) });
      } else if (n.steps) {
        out.push({ ...n, steps: mergeNoteArrows(n.steps) });
      } else {
        out.push(n);
      }
      i++;
    }
  }
  return out;
}

// ── Load diagram list from index-config.yaml ───────────────────────────────

const indexConfig = yaml.load(readFileSync(resolve(configDir, 'index-config.yaml'), 'utf8'));
const diagramDefs = indexConfig.diagrams ?? [];

// ── Collect used participants ──────────────────────────────────────────────

function collectDomains(nodes) {
  const seen = [];
  const seenSet = new Set();
  function visit(nodes) {
    for (const n of nodes) {
      for (const d of [n.from, n.to, n.domain].filter(Boolean)) {
        if (!seenSet.has(d)) { seenSet.add(d); seen.push(d); }
      }
      if (n.branches) n.branches.forEach(b => Array.isArray(b) ? visit(b) : visit(b.steps ?? []));
      if (n.steps) visit(n.steps);
    }
  }
  visit(nodes);
  return seen.filter(p => PARTICIPANT_ORDER.includes(p));
}

// ── SVG text helpers ───────────────────────────────────────────────────────

function wrapWords(str, maxChars) {
  const words = String(str).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w;
    if (candidate.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = candidate;
  }
  if (cur) lines.push(cur);
  return lines;
}

function txt(str, x, y, { size = 11, anchor = 'start', fill = '#222', weight = 'normal', italic = false, maxChars = 0 } = {}) {
  const ta = anchor !== 'start' ? ` text-anchor="${anchor}"` : '';
  const fw = weight !== 'normal' ? ` font-weight="${weight}"` : '';
  const fi = italic ? ` font-style="italic"` : '';

  if (maxChars > 0) {
    const LH   = size * 1.25;
    const lines = wrapWords(str, maxChars);
    const startY = y - (lines.length - 1) * LH / 2;
    return lines.map((line, i) =>
      `<text x="${(+x).toFixed(1)}" y="${(startY + i * LH).toFixed(1)}" font-size="${size}" font-family="${FONT}"${ta}${fw}${fi} fill="${fill}">${escXml(line)}</text>`
    ).join('');
  }

  return `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" font-size="${size}" font-family="${FONT}"${ta}${fw}${fi} fill="${fill}">${escXml(str)}</text>`;
}

// ── Renderer ───────────────────────────────────────────────────────────────

class Renderer {
  constructor(tree, participants, colMid) {
    this.tree         = tree;
    this.participants = participants;
    this.colMid       = colMid;
    this.bg = [];   // fragment boxes (behind)
    this.fg = [];   // arrows, labels, dots (on top)
    this.y  = LEGEND_H + PHDR_H + 14;
  }

  b(s) { this.bg.push(s); }
  f(s) { this.fg.push(s); }

  ln(x1, y1, x2, y2, stroke, sw = 1.5, dash = '') {
    const da = dash ? ` stroke-dasharray="${dash}"` : '';
    return `<line x1="${(+x1).toFixed(1)}" y1="${(+y1).toFixed(1)}" x2="${(+x2).toFixed(1)}" y2="${(+y2).toFixed(1)}" stroke="${stroke}" stroke-width="${sw}"${da}/>`;
  }

  renderAll(nodes) { for (const n of nodes) this.renderNode(n); }

  renderNode(n) {
    switch (n.type) {
      case 'arrow':          return this.renderArrow(n);
      case 'subscribe-call': return this.renderSubscribeCall(n);
      case 'emit':           return this.renderEmit(n);
      case 'note':           return this.renderNote(n);
      case 'self':           return this.renderSelf(n);
      case 'par':   return this.renderPar(n);
      case 'opt':   return this.renderFragBox(n, 'opt',  MID_BLUE, 'rgba(86,80,190,0.04)');
      case 'alt':   return this.renderAlt(n);
    }
  }

  renderArrow(n) {
    const ax  = this.colMid(n.from), bx = this.colMid(n.to);
    const ay  = this.y + STEP_H * 0.52;
    const color = n.isEvent ? EVT_CLR : CALL_CLR;
    const dir   = bx > ax ? 1 : -1;
    const dash  = n.isEvent ? '6 3' : '';

    // Arrow line + head
    this.f(this.ln(ax, ay, bx - dir * 7, ay, color, 1.5, dash));
    this.f(`<polygon points="${bx.toFixed(1)},${ay.toFixed(1)} ${(bx-dir*7).toFixed(1)},${(ay-4).toFixed(1)} ${(bx-dir*7).toFixed(1)},${(ay+4).toFixed(1)}" fill="${color}"/>`);

    // Label — centered, wrapped based on available width
    const arrowW   = Math.abs(bx - ax);
    const maxChars = Math.max(20, Math.floor(arrowW / (n.trigger ? 6.5 : 6)));
    const lineH    = (n.trigger ? 11 : 10) * 1.25;
    const lines    = wrapWords(n.label, maxChars);
    const labelY   = ay - (lines.length > 1 ? lines.length * lineH * 0.5 + 2 : 5);

    this.f(txt(n.label, (ax + bx) / 2, labelY, {
      anchor:   'middle',
      size:     n.trigger ? 11 : 10,
      fill:     n.isEvent ? EVT_CLR : (n.trigger ? DARK_BLUE : '#333'),
      weight:   n.trigger ? 'bold' : 'normal',
      italic:   n.isEvent,
      maxChars,
    }));

    this.y += STEP_H + Math.max(0, (lines.length - 1) * lineH);
  }

  renderSubscribeCall(n) {
    // Hollow circle at subscriber domain + arrow to call target on the same line
    const ax  = this.colMid(n.from), bx = this.colMid(n.to);
    const ay  = this.y + STEP_H * 0.52;
    const dir = bx > ax ? 1 : -1;

    // Hollow circle (subscription received)
    this.f(`<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="5" fill="white" stroke="${EVT_CLR}" stroke-width="1.5"/>`);
    // Arrow line from circle edge to target
    this.f(this.ln(ax + dir * 6, ay, bx - dir * 7, ay, EVT_CLR, 1.5));
    // Arrowhead at target
    this.f(`<polygon points="${bx.toFixed(1)},${ay.toFixed(1)} ${(bx-dir*7).toFixed(1)},${(ay-4).toFixed(1)} ${(bx-dir*7).toFixed(1)},${(ay+4).toFixed(1)}" fill="${EVT_CLR}"/>`);

    // Label (subscription description) above the line
    const arrowW   = Math.abs(bx - ax) - 16;
    const maxChars = Math.max(20, Math.floor(arrowW / 6));
    const lines    = wrapWords(n.label, maxChars);
    const LH       = 10 * 1.25;
    const labelY   = ay - (lines.length > 1 ? lines.length * LH * 0.5 + 2 : 5);
    this.f(txt(n.label, (ax + bx) / 2, labelY, {
      anchor: 'middle', size: 10, fill: EVT_CLR, italic: true, maxChars,
    }));

    this.y += STEP_H + Math.max(0, (lines.length - 1) * LH);
  }

  renderEmit(n) {
    const cx       = this.colMid(n.domain);
    const ay       = this.y + 16;
    const colW     = (W - 2 * MARGIN) / this.participants.length;
    const maxChars = Math.max(12, Math.floor((colW / 2 - 12) / 5.5));
    const lines    = wrapWords(n.label, maxChars);
    const LH    = 11;
    this.f(`<circle cx="${cx.toFixed(1)}" cy="${ay.toFixed(1)}" r="4" fill="${EVT_CLR}"/>`);
    lines.forEach((line, i) => {
      this.f(txt(line, cx + 9, ay + 4 + i * LH, { size: 9, fill: EVT_CLR, italic: true }));
    });
    this.y += 14 + lines.length * LH;
  }

  renderNote(n) {
    const cx       = this.colMid(n.domain);
    const ay       = this.y + 12;
    const colW     = (W - 2 * MARGIN) / this.participants.length;
    const maxChars = Math.max(12, Math.floor((colW / 2 - 12) / 5.5));
    const lines    = wrapWords(n.label, maxChars);
    const LH    = 11;
    this.f(`<circle cx="${cx.toFixed(1)}" cy="${ay.toFixed(1)}" r="3.5" fill="white" stroke="${EVT_CLR}" stroke-width="1.5"/>`);
    lines.forEach((line, i) => {
      this.f(txt(line, cx + 9, ay + 4 + i * LH, { size: 9, fill: EVT_CLR, italic: true }));
    });
    this.y += 14 + lines.length * LH;
  }

  renderSelf(n) {
    const cx   = this.colMid(n.domain);
    const ay   = this.y + STEP_H * 0.3;
    const colW = (W - 2 * MARGIN) / this.participants.length;
    const maxChars = Math.max(12, Math.floor((colW / 2 - 42) / 6));
    const lines    = wrapWords(n.label, maxChars);
    const lineH    = 12;
    this.f(`<path d="M${(cx+5).toFixed(1)},${ay.toFixed(1)} Q${(cx+32).toFixed(1)},${ay.toFixed(1)} ${(cx+32).toFixed(1)},${(ay+12).toFixed(1)} Q${(cx+32).toFixed(1)},${(ay+24).toFixed(1)} ${(cx+5).toFixed(1)},${(ay+24).toFixed(1)}" stroke="${CALL_CLR}" stroke-width="1.5" fill="none"/>`);
    this.f(`<polygon points="${(cx+5).toFixed(1)},${(ay+24).toFixed(1)} ${(cx+12).toFixed(1)},${(ay+20).toFixed(1)} ${(cx+12).toFixed(1)},${(ay+28).toFixed(1)}" fill="${CALL_CLR}"/>`);
    lines.forEach((line, i) => {
      this.f(txt(line, cx + 38, ay + 14 + i * lineH, { size: 10, fill: '#333' }));
    });
    this.y += STEP_H + Math.max(0, (lines.length - 1) * lineH);
  }

  renderPar(n) {
    const sy = this.y;
    this.y += FPAD;
    for (let i = 0; i < n.branches.length; i++) {
      if (i > 0) {
        const dy = this.y;
        // Solid blue divider — clearly distinct from alt's dashed gray
        this.b(this.ln(MARGIN, dy, W - MARGIN, dy, MID_BLUE, 1.5));
        this.y += 6;
      }
      this.renderAll(n.branches[i]);
    }
    this.y += FPAD;
    const h = this.y - sy;
    this.b(`<rect x="${MARGIN}" y="${sy.toFixed(1)}" width="${(W-2*MARGIN).toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(86,80,190,0.05)" stroke="${MID_BLUE}" stroke-width="1.5" rx="3"/>`);
    this.b(`<rect x="${MARGIN}" y="${sy.toFixed(1)}" width="28" height="15" fill="${MID_BLUE}" rx="2"/>`);
    this.b(txt('par', MARGIN + 14, sy + 11, { size: 9, anchor: 'middle', fill: 'white', weight: 'bold' }));
  }

  renderFragBox(n, label, color, fill) {
    const sy = this.y;
    this.y += FPAD + 4;
    if (n.label) {
      this.f(txt(`[${n.label}]`, MARGIN + 36, sy + FPAD + 13, { size: 9, fill: color, italic: true }));
      this.y += 16;
    }
    this.renderAll(n.steps ?? []);
    this.y += FPAD;
    const h = this.y - sy;
    this.b(`<rect x="${MARGIN}" y="${sy.toFixed(1)}" width="${(W-2*MARGIN).toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="${color}" stroke-width="1" stroke-dasharray="5 2" rx="3"/>`);
    this.b(`<rect x="${MARGIN}" y="${sy.toFixed(1)}" width="30" height="15" fill="${color}" rx="2"/>`);
    this.b(txt(label, MARGIN + 15, sy + 11, { size: 9, anchor: 'middle', fill: 'white', weight: 'bold' }));
  }

  renderAlt(n) {
    const sy = this.y;
    this.y += FPAD;
    for (let i = 0; i < n.branches.length; i++) {
      if (i > 0) {
        const dy = this.y;
        // Dashed gray divider — clearly distinct from par's solid blue
        this.b(this.ln(MARGIN, dy, W - MARGIN, dy, '#bbb', 1, '6 4'));
        this.y += 6;
      }
      this.f(txt(`[${n.branches[i].label}]`, MARGIN + 36, this.y + 12, { size: 9, fill: '#888', italic: true }));
      this.y += 16;
      this.renderAll(n.branches[i].steps);
    }
    this.y += FPAD;
    const h = this.y - sy;
    this.b(`<rect x="${MARGIN}" y="${sy.toFixed(1)}" width="${(W-2*MARGIN).toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(0,0,0,0.01)" stroke="#bbb" stroke-width="1" stroke-dasharray="6 4" rx="3"/>`);
    this.b(`<rect x="${MARGIN}" y="${sy.toFixed(1)}" width="26" height="15" fill="#999" rx="2"/>`);
    this.b(txt('alt', MARGIN + 13, sy + 11, { size: 9, anchor: 'middle', fill: 'white', weight: 'bold' }));
  }

  legendBar() {
    // Returns SVG strings for a horizontal legend bar above the participant headers.
    // Three side-by-side boxes: Calls | Events | Fragments
    const cy  = LEGEND_H / 2;   // vertical center = 20
    const bh  = 24;              // box height
    const by  = cy - bh / 2;    // box top = 8
    const PAD = 8;
    const GAP = 14;
    const out = [];

    // Bar background + bottom separator
    out.push(`<rect x="0" y="0" width="${W}" height="${LEGEND_H}" fill="#F3F3F3"/>`);
    out.push(`<line x1="0" y1="${LEGEND_H}" x2="${W}" y2="${LEGEND_H}" stroke="#E9CCBE" stroke-width="1"/>`);

    let bx = MARGIN;

    // ── Box 1: Calls ──────────────────────────────────────────────────────
    const arrLbl = 'API call',         arrLblW = arrLbl.length * 5.5, arrSymW = 28;
    const slLbl  = 'Local processing', slLblW  = slLbl.length  * 5.5, slSymW  = 26;
    const b1w = PAD + arrSymW + 5 + arrLblW + GAP + slSymW + 5 + slLblW + PAD;
    out.push(`<rect x="${bx}" y="${by}" width="${Math.ceil(b1w)}" height="${bh}" fill="white" stroke="#E5E7EB" stroke-width="1" rx="3"/>`);

    let ix = bx + PAD;
    // Arrow
    out.push(this.ln(ix, cy, ix + arrSymW, cy, CALL_CLR, 1.5));
    out.push(`<polygon points="${ix+arrSymW},${cy} ${ix+arrSymW-7},${cy-4} ${ix+arrSymW-7},${cy+4}" fill="${CALL_CLR}"/>`);
    out.push(txt(arrLbl, ix + arrSymW + 5, cy + 3.5, { size: 9, fill: '#555' }));
    ix += arrSymW + 5 + arrLblW + GAP;
    // Self-loop
    out.push(`<path d="M${ix+3},${cy-5} Q${ix+22},${cy-5} ${ix+22},${cy} Q${ix+22},${cy+6} ${ix+3},${cy+6}" stroke="${CALL_CLR}" stroke-width="1.5" fill="none"/>`);
    out.push(`<polygon points="${ix+3},${cy+6} ${ix+9},${cy+3} ${ix+9},${cy+9}" fill="${CALL_CLR}"/>`);
    out.push(txt(slLbl, ix + slSymW, cy + 3.5, { size: 9, fill: '#555' }));

    bx += Math.ceil(b1w) + 10;

    // ── Box 2: Events ─────────────────────────────────────────────────────
    const emLbl = 'Event emitted',  emLblW = emLbl.length * 5.5, dotSymW = 10;
    const erLbl = 'Event received', erLblW = erLbl.length * 5.5;
    const b2w = PAD + dotSymW + 5 + emLblW + GAP + dotSymW + 5 + erLblW + PAD;
    out.push(`<rect x="${bx}" y="${by}" width="${Math.ceil(b2w)}" height="${bh}" fill="white" stroke="#E5E7EB" stroke-width="1" rx="3"/>`);

    ix = bx + PAD;
    // Filled dot
    out.push(`<circle cx="${ix+5}" cy="${cy}" r="4" fill="${EVT_CLR}"/>`);
    out.push(txt(emLbl, ix + dotSymW + 5, cy + 3.5, { size: 9, fill: '#555' }));
    ix += dotSymW + 5 + emLblW + GAP;
    // Hollow dot
    out.push(`<circle cx="${ix+5}" cy="${cy}" r="3.5" fill="white" stroke="${EVT_CLR}" stroke-width="1.5"/>`);
    out.push(txt(erLbl, ix + dotSymW + 5, cy + 3.5, { size: 9, fill: '#555' }));

    bx += Math.ceil(b2w) + 10;

    // ── Box 3: Fragments ──────────────────────────────────────────────────
    const parLbl = 'par — parallel execution', parLblW = parLbl.length * 5.5, fragSymW = 28;
    const altLbl = 'alt — branching by value', altLblW = altLbl.length * 5.5;
    const b3w = PAD + fragSymW + 5 + parLblW + GAP + fragSymW + 5 + altLblW + PAD;
    out.push(`<rect x="${bx}" y="${by}" width="${Math.ceil(b3w)}" height="${bh}" fill="white" stroke="#E5E7EB" stroke-width="1" rx="3"/>`);

    ix = bx + PAD;
    // par
    out.push(`<rect x="${ix}" y="${cy-5}" width="${fragSymW}" height="10" fill="rgba(86,80,190,0.05)" stroke="${MID_BLUE}" stroke-width="1.5" rx="2"/>`);
    out.push(txt('par', ix + fragSymW/2, cy + 3.5, { size: 7, anchor: 'middle', fill: MID_BLUE, weight: 'bold' }));
    out.push(txt(parLbl, ix + fragSymW + 5, cy + 3.5, { size: 9, fill: '#555' }));
    ix += fragSymW + 5 + parLblW + GAP;
    // alt
    out.push(`<rect x="${ix}" y="${cy-5}" width="${fragSymW}" height="10" fill="rgba(0,0,0,0.01)" stroke="#999" stroke-width="1" stroke-dasharray="4 3" rx="2"/>`);
    out.push(txt('alt', ix + fragSymW/2, cy + 3.5, { size: 7, anchor: 'middle', fill: '#999', weight: 'bold' }));
    out.push(txt(altLbl, ix + fragSymW + 5, cy + 3.5, { size: 9, fill: '#555' }));

    return out;
  }

  toSVG() {
    this.renderAll(this.tree);
    const totalH = this.y;
    const colW   = (W - 2 * MARGIN) / this.participants.length;

    const lifelines = this.participants.map(p => {
      const cx = this.colMid(p);
      return this.ln(cx, LEGEND_H + PHDR_H + 2, cx, totalH - 20, '#CACACA', 1, '4 3');
    });

    const hdr = this.participants.flatMap(p => {
      const cx   = this.colMid(p);
      const bw   = Math.min(colW - 8, 165);
      const hy   = LEGEND_H + 4;
      return [
        `<rect x="${(cx - bw/2).toFixed(1)}" y="${hy}" width="${bw.toFixed(1)}" height="${(PHDR_H-8).toFixed(1)}" rx="4" fill="${DARK_BLUE}"/>`,
        txt(PARTICIPANT_LABELS[p] ?? p, cx, LEGEND_H + PHDR_H - 13, { anchor: 'middle', fill: 'white', weight: 'bold', size: 12 }),
      ];
    });

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}">`,
      `<rect width="${W}" height="${totalH}" fill="white"/>`,
      ...lifelines,
      ...this.bg,
      ...this.fg,
      ...hdr,
      ...this.legendBar(),
      '</svg>',
    ].join('\n');
  }
}

// ── Generate and write ─────────────────────────────────────────────────────

for (const def of diagramDefs) {
  const { domain, object, action, label: triggerLabel } = def.trigger;

  const sm = smDatas.find(s => s.domain === domain);
  if (!sm) { console.warn(`Skipping diagram '${def.id}': no state machine for domain '${domain}'`); continue; }
  const machine = sm.machines?.find(m => m.object === object);
  if (!machine) { console.warn(`Skipping diagram '${def.id}': no machine for object '${object}' in domain '${domain}'`); continue; }
  const actionDef = machine.actions?.find(a => a.id === action);
  if (!actionDef) { console.warn(`Skipping diagram '${def.id}': no action '${action}' on ${domain}/${object}`); continue; }

  const procs = buildProcMap(domain, object);
  const tree = [
    { type: 'arrow', from: 'applicant', to: domain, label: triggerLabel, isEvent: false, trigger: true },
    ...walkSteps(actionDef.steps, domain, new Set(), procs, new Set()),
  ];

  const participants = collectDomains(tree);
  const colW   = (W - 2 * MARGIN) / participants.length;
  const colMid = p => {
    const i = participants.indexOf(p);
    return i < 0 ? W / 2 : MARGIN + (i + 0.5) * colW;
  };

  const svg = new Renderer(tree, participants, colMid).toSVG();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escXml(def.title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; }
    #container { padding: 16px 0 32px; overflow-x: hidden; }
    #map-wrapper { background: white; box-shadow: 0 2px 16px rgba(0,0,0,.10); overflow: hidden; width: 1400px; transform-origin: top left; }
  </style>
</head>
<body>
  ${breadcrumb([{ label: 'Explorer', href: '../../index.html' }, { label: 'Sequence Diagrams', href: 'index.html' }, { label: escXml(def.title.replace(' \u2014 Event Chain', '')) }])}
  <div id="container"><div id="map-wrapper">${svg}</div></div>
  <script>
    var w = document.getElementById('map-wrapper');
    function fit() {
      var vw = document.documentElement.clientWidth || window.innerWidth || 1400;
      var s = Math.min(1, vw / 1400);
      w.style.transform = 'scale(' + s + ')';
      w.style.marginBottom = Math.round(w.offsetHeight * (s - 1)) + 'px';
    }
    fit(); window.addEventListener('resize', fit);
  </script>
</body>
</html>`;

  const outFile = resolve(outDir, `${def.id}.html`);
  writeFileSync(outFile, html, 'utf8');
  console.log(`Written: ${outFile}`);
}
