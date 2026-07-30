/**
 * generate-html.js
 *
 * HTML output for state machine documentation.
 * Generates index.html, {domain}.html, and events.html into the output directory.
 * Called by build.js alongside the existing markdown generator.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { load } from 'js-yaml';
import path from 'path';

// ── Color palette ─────────────────────────────────────────────────────────────

const COLORS = {
  darkBlue:   '#2B1A78',
  midBlue:    '#5650BE',
  lightBlue:  '#C2C0E8',
  paleBlue:   '#E6EBF9',
  deepGreen:  '#006152',
  midGreen:   '#00AD93',
  lightGreen: '#E2F9F6',
  richRed:    '#AF121D',
  lightRed:   '#F9C8CB',
  warmYellow: '#FFB446',
  lightYellow:'#FFF3E0',
  sandDark:   '#E9CCBE',
  sandMid:    '#F7EDE8',
  bg:         '#F3F3F3',
  white:      '#FFFFFF',
  text:       '#1a1a1a',
  textLight:  '#666',
};

// Semantic state coloring
function stateColor(stateId) {
  const green  = ['approved', 'completed', 'satisfied', 'waived', 'active'];
  const red    = ['denied', 'ineligible', 'cannot_verify', 'rejected'];
  const yellow = ['pending', 'pending_approval', 'escalated', 'inconclusive',
                  'awaiting_client', 'awaiting_verification', 'pending_review',
                  'in_progress', 'under_review', 'submitted'];
  const grey   = ['draft', 'closed', 'withdrawn', 'cancelled'];

  if (green.some(s => stateId.includes(s)))  return { bg: COLORS.lightGreen,  text: COLORS.deepGreen,  border: '#b2e8e2' };
  if (red.some(s => stateId.includes(s)))    return { bg: COLORS.lightRed,    text: COLORS.richRed,    border: '#f0b0b5' };
  if (yellow.some(s => stateId.includes(s))) return { bg: COLORS.lightYellow, text: '#8a5a00',         border: '#ffd280' };
  if (grey.some(s => stateId.includes(s)))   return { bg: COLORS.sandMid,     text: '#5a5050',         border: COLORS.sandDark };
  return { bg: COLORS.paleBlue, text: COLORS.midBlue, border: COLORS.lightBlue };
}

function stateBadge(stateId) {
  const c = stateColor(stateId);
  return `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.04em;` +
    `padding:2px 8px;border-radius:100px;border:1px solid ${c.border};` +
    `background:${c.bg};color:${c.text};">${stateId}</span>`;
}

// ── Shared HTML shell ─────────────────────────────────────────────────────────

function shell(title, navLinks, body, allDomains) {
  const navItems = [
    { label: 'Overview', href: 'index.html' },
    ...allDomains.map(d => ({ label: titleCase(d), href: `${d}.html` })),
  ];

  const nav = navItems.map(({ label, href }) => {
    const active = href === navLinks.active;
    return `<a href="${href}" style="color:${active ? COLORS.white : COLORS.lightBlue};` +
      `font-size:12px;font-weight:${active ? '700' : '400'};text-decoration:none;` +
      `padding:0.25rem 0.625rem;border-radius:4px;` +
      `background:${active ? 'rgba(255,255,255,0.15)' : 'none'};">${label}</a>`;
  }).join('');

  const activeLabel = navItems.find(n => n.href === navLinks.active)?.label ?? title;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — State Machine Docs</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: ${COLORS.bg}; color: ${COLORS.text}; font-size: 14px; line-height: 1.6; }
    a { color: ${COLORS.midBlue}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; background: ${COLORS.sandMid}; padding: 1px 5px; border-radius: 3px; border: 1px solid ${COLORS.sandDark}; color: #2a2a2a; }
    table { border-collapse: collapse; width: 100%; }
    th { background: ${COLORS.sandMid}; color: ${COLORS.text}; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; padding: 8px 12px; text-align: left; border-bottom: 2px solid ${COLORS.sandDark}; }
    td { padding: 10px 12px; border-bottom: 1px solid ${COLORS.sandDark}; vertical-align: top; font-size: 13px; word-break: break-word; overflow-wrap: anywhere; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: ${COLORS.sandMid}; }
  </style>
</head>
<body>
<div style="background:${COLORS.darkBlue};padding:0.5rem 1.25rem;display:flex;align-items:center;gap:0.5rem;font-size:12px;">
  <a href="../../index.html" style="color:${COLORS.lightBlue};text-decoration:none;">Explorer</a>
  <span style="color:${COLORS.lightBlue};opacity:0.5;">/</span>
  <a href="index.html" style="color:${COLORS.lightBlue};text-decoration:none;">State Machine Docs</a>
  <span style="color:${COLORS.lightBlue};opacity:0.5;">/</span>
  <span style="color:${COLORS.white};">${activeLabel}</span>
</div>
<div style="background:${COLORS.darkBlue};padding:0 1.5rem;display:flex;align-items:center;gap:0.25rem;height:40px;border-bottom:3px solid ${COLORS.midBlue};">
  <nav style="display:flex;align-items:center;gap:0.25rem;">${nav}</nav>
</div>
<div style="max-width:960px;margin:0 auto;padding:2.5rem 1.5rem 4rem;">
  ${body}
</div>
</body>
</html>`;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function titleCase(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getActors(guards) {
  const entry = (guards || []).find(g => g.actors);
  return entry?.actors || [];
}

function getSteps(node) {
  return node?.steps || node?.then || [];
}

function getMatchBranches(step) {
  return step?.when || step?.on || {};
}

function getForEachBody(forEach) {
  return forEach?.do || forEach?.then || [];
}

function stripRpcPrefix(desc) {
  if (!desc) return null;
  return desc.replace(/^(POST|GET|PATCH|PUT|DELETE)\s+\S+\s+[—\-–]+\s*/i, '').trim();
}

function stripEmitPrefix(desc) {
  if (!desc) return null;
  return desc.replace(/^Emit\s+[a-z_]+(?:\.[a-z_]+)*\s*[—\-–]+\s*/i, '').trim();
}

function humanActors(actors) {
  if (!actors.length) return null;
  if (actors.length === 1 && actors[0] === 'system') return 'System';
  return actors.map(a => titleCase(a)).join(', ');
}

function humanizeCondition(expr) {
  expr = String(expr).trim();
  if (expr.includes(' && ')) return expr.split(' && ').map(humanizeCondition).join(' and ');
  let m = expr.match(/^\$this\.data\.(\w+)$/);
  if (m) return m[1];
  m = expr.match(/^\$\w+\.(\w+)\s*==\s*null$/);
  if (m) return `${m[1]} is not set`;
  m = expr.match(/^\$\w+\.(\w+)\s*!=\s*null$/);
  if (m) return `${m[1]} is set`;
  m = expr.match(/^\$\w+\.(\w+)\s*==\s*"([^"]+)"$/);
  if (m) return `${m[1]} is "${m[2]}"`;
  if (expr.includes('.fields.exists(')) {
    const fields = [...expr.matchAll(/f\s*==\s*"([^"]+)"/g)].map(x => x[1]);
    if (fields.length) return fields.join(' or ') + ' was updated';
  }
  return expr.replace(/ == /g, ' is ').replace(/ != /g, ' is not ');
}

function allProcedures(machine, sm) {
  return [...(machine.procedures || []), ...(sm.procedures || [])];
}

// ── Step list renderer (HTML) ─────────────────────────────────────────────────

function renderStepsHtml(steps, sm, machine, eventIndex, allStateMachines) {
  if (!steps?.length) return '';
  const items = collectStepHtml(steps, sm, machine, eventIndex, allStateMachines);
  return `<ul style="margin:4px 0 0 16px;font-size:12px;color:${COLORS.textLight};">${items}</ul>`;
}

function collectStepHtml(steps, sm, machine, eventIndex, allStateMachines) {
  return (steps || []).map(step => {
    if (step.set) {
      const desc = step.set.description?.trim().replace(/\n\s*/g, ' ') || '';
      return `<li>${desc ? `${desc} ` : ''}<code>sets ${step.set.field}</code></li>`;
    }
    if (step.emit) {
      const canonical = step.emit.type;
      const raw = step.emit.description?.trim().replace(/\n\s*/g, ' ') || '';
      const desc = stripEmitPrefix(raw) || raw;
      return `<li>Emit <code>${canonical}</code>${desc ? ` — ${desc}` : ''}</li>`;
    }
    if (step.call) {
      if (typeof step.call === 'string') {
        const proc = allProcedures(machine, sm).find(p => p.id === step.call);
        return `<li>${proc?.description?.trim().replace(/\n\s*/g, ' ') || step.call}</li>`;
      }
      const desc = step.description?.trim().replace(/\n\s*/g, ' ')
        || step.call.description?.trim().replace(/\n\s*/g, ' ')
        || JSON.stringify(step.call);
      return `<li>${desc}</li>`;
    }
    if (step.if !== undefined) {
      const thenHtml = collectStepHtml(getSteps(step), sm, machine, eventIndex, allStateMachines);
      const elseHtml = step.else?.length ? collectStepHtml(step.else, sm, machine, eventIndex, allStateMachines) : '';
      return `<li>If <code>${humanizeCondition(step.if)}</code>:<ul style="margin:2px 0 0 14px;">${thenHtml}</ul>` +
        (elseHtml ? `<br>Else:<ul style="margin:2px 0 0 14px;">${elseHtml}</ul>` : '') + '</li>';
    }
    if (step.match !== undefined) {
      const branches = Object.entries(getMatchBranches(step)).map(([key, branchSteps]) => {
        const inner = collectStepHtml(branchSteps || [], sm, machine, eventIndex, allStateMachines);
        return `<li>When <code>${key}</code>:<ul style="margin:2px 0 0 14px;">${inner}</ul></li>`;
      }).join('');
      return `<li>Match on <code>${humanizeCondition(step.match)}</code>:<ul style="margin:2px 0 0 14px;">${branches}</ul></li>`;
    }
    if (step.forEach) {
      const collection = step.forEach.in ? ` <code>${step.forEach.in}</code>` : '';
      const inner = collectStepHtml(getForEachBody(step.forEach), sm, machine, eventIndex, allStateMachines);
      return `<li>For each${collection}:<ul style="margin:2px 0 0 14px;">${inner}</ul></li>`;
    }
    return '';
  }).join('');
}

// ── Overview page ─────────────────────────────────────────────────────────────

export function generateOverviewHtml(allStateMachines, outputDir, eventIndex) {
  mkdirSync(outputDir, { recursive: true });
  const allDomains = allStateMachines.map(sm => sm.domain);

  const machineRows = allStateMachines.flatMap(sm =>
    sm.machines.map(machine => {
      const multiMachine = sm.machines.length > 1;
      const anchor = multiMachine ? `#${machine.object.toLowerCase()}` : '';
      const actionCount = (machine.actions || []).length;
      const eventCount = (machine.events || []).length;
      const badges = (machine.states || []).map(s => stateBadge(s.id)).join(' ');
      return `<tr>
        <td style="white-space:nowrap;"><a href="${sm.domain}.html${anchor}" style="font-weight:600;color:${COLORS.darkBlue};">${titleCase(sm.domain)}</a></td>
        <td style="color:${COLORS.textLight};">${machine.object}</td>
        <td>${badges}</td>
        <td style="text-align:center;color:${COLORS.textLight};">${actionCount}</td>
        <td style="text-align:center;color:${COLORS.textLight};">${eventCount}</td>
      </tr>`;
    })
  ).join('');

  const body = `
    <h1 style="font-size:1.5rem;font-weight:800;color:${COLORS.darkBlue};margin-bottom:0.375rem;">State Machine Overview</h1>
    <p style="color:${COLORS.textLight};margin-bottom:2rem;font-size:13px;">Auto-generated from <code>packages/contracts/*-state-machine.yaml</code>.</p>
    <div style="background:${COLORS.white};border:1px solid ${COLORS.sandDark};border-radius:8px;overflow:hidden;">
      <table>
        <thead><tr>
          <th>Domain</th>
          <th>Object</th>
          <th>States</th>
          <th style="text-align:center;">Actions</th>
          <th style="text-align:center;">Events</th>
        </tr></thead>
        <tbody>${machineRows}</tbody>
      </table>
    </div>`;

  writeFileSync(
    path.join(outputDir, 'index.html'),
    shell('Overview', { active: 'index.html' }, body, allDomains)
  );
  console.log('  wrote index.html');
}

// ── Domain detail page ────────────────────────────────────────────────────────

export function generateHtml(inputPath, outputDir, eventIndex, allStateMachines) {
  const sm = load(readFileSync(inputPath, 'utf8'));
  mkdirSync(outputDir, { recursive: true });
  const allDomains = allStateMachines.map(s => s.domain);

  const sections = sm.machines.map(machine => {
    const anchor = sm.machines.length > 1 ? ` id="${machine.object.toLowerCase()}"` : '';

    // States section
    const stateRows = (machine.states || []).map(s => {
      const c = stateColor(s.id);
      const badge = `<span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:100px;border:1px solid ${c.border};background:${c.bg};color:${c.text};white-space:nowrap;">${s.id}</span>`;
      const sla = s.slaClock
        ? `<span style="font-size:11px;color:${s.slaClock === 'running' ? COLORS.deepGreen : COLORS.textLight};">${s.slaClock}</span>`
        : '';
      return `<tr>
        <td style="width:1%;white-space:nowrap;">${badge}</td>
        <td style="font-size:12px;color:${COLORS.text};">${s.description || ''}</td>
        <td style="width:1%;white-space:nowrap;text-align:center;">${sla}</td>
      </tr>`;
    }).join('');
    const statesHtml = `<h4 style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${COLORS.textLight};margin-bottom:0.625rem;">States</h4>
      <div style="background:${COLORS.white};border:1px solid ${COLORS.sandDark};border-radius:6px;overflow:hidden;margin-bottom:0.5rem;">
        <table>
          <thead><tr>
            <th>State</th><th>Description</th><th style="text-align:center;">SLA clock</th>
          </tr></thead>
          <tbody>${stateRows}</tbody>
        </table>
      </div>`;

    // Actions table
    const actionsHtml = (machine.actions || []).length ? (() => {
      const rows = machine.actions.map(op => {
        const desc = op.description ? stripRpcPrefix(op.description) || op.description : '';
        const actors = humanActors(getActors(op.guards));
        const froms = Array.isArray(op.transition?.from) ? op.transition.from
          : op.transition?.from ? [op.transition.from] : [];
        const transition = op.transition?.to
          ? `${froms.length ? froms.map(f => stateBadge(f)).join('/') + ' → ' : ''}${stateBadge(op.transition.to)}`
          : op.transition ? '<span style="color:#999;font-size:11px;">no state change</span>' : '';
        const steps = renderStepsHtml(getSteps(op), sm, machine, eventIndex, allStateMachines);
        return `<tr>
          <td><strong style="color:${COLORS.darkBlue};">${op.id}</strong>${desc ? `<br><span style="font-size:12px;color:${COLORS.textLight};">${desc}</span>` : ''}</td>
          <td style="white-space:nowrap;">${actors ? `<span style="font-size:12px;">${actors}</span>` : ''}</td>
          <td>${transition}</td>
          <td>${steps}</td>
        </tr>`;
      }).join('');
      return `<h4 style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${COLORS.textLight};margin:1.5rem 0 0.625rem;">Actions</h4>
        <div style="background:${COLORS.white};border:1px solid ${COLORS.sandDark};border-radius:6px;overflow:hidden;">
          <table>
            <thead><tr>
              <th>Action</th><th>Actors</th><th>Transition</th><th>Steps</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    })() : '';

    // Events table
    const eventsHtml = (machine.events || []).length ? (() => {
      const rows = machine.events.map(sub => {
        const emitter = eventIndex?.emitters[sub.type];
        const emitterLink = emitter
          ? `<a href="${emitter.domain}.html">${titleCase(emitter.domain)}/${emitter.object}</a>`
          : '<span style="color:#999;font-size:11px;">unknown</span>';
        const steps = renderStepsHtml(getSteps(sub), sm, machine, eventIndex, allStateMachines);
        return `<tr>
          <td><code>${sub.type}</code></td>
          <td>${emitterLink}</td>
          <td>${steps}</td>
        </tr>`;
      }).join('');
      return `<h4 style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${COLORS.textLight};margin:1.5rem 0 0.625rem;">Event Subscriptions</h4>
        <div style="background:${COLORS.white};border:1px solid ${COLORS.sandDark};border-radius:6px;overflow:hidden;">
          <table style="table-layout:fixed;">
            <colgroup>
              <col style="width:30%">
              <col style="width:20%">
              <col style="width:50%">
            </colgroup>
            <thead><tr>
              <th>Event</th><th>Emitted by</th><th>Handler steps</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    })() : '';

    return `<section${anchor} style="margin-bottom:2.5rem;">
      <h2 style="font-size:1.125rem;font-weight:800;color:${COLORS.darkBlue};padding-bottom:0.5rem;border-bottom:2px solid ${COLORS.paleBlue};margin-bottom:1rem;">${machine.object}</h2>
      ${statesHtml}
      ${actionsHtml}
      ${eventsHtml}
    </section>`;
  }).join('');

  const smFile = path.basename(inputPath);
  const body = `
    <div style="margin-bottom:2rem;">
      <h1 style="font-size:1.5rem;font-weight:800;color:${COLORS.darkBlue};margin-bottom:0.375rem;">${titleCase(sm.domain)} State Machine</h1>
      <p style="font-size:12px;color:${COLORS.textLight};">Domain: <code>${sm.domain}</code> · API spec: <code>${sm.apiSpec}</code></p>
    </div>
    ${sections}`;

  writeFileSync(
    path.join(outputDir, `${sm.domain}.html`),
    shell(titleCase(sm.domain), { active: `${sm.domain}.html` }, body, allDomains)
  );
  console.log(`  wrote ${sm.domain}.html`);
}

// ── Events page ───────────────────────────────────────────────────────────────

export function generateEventsHtml(eventIndex, allStateMachines, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const allDomains = allStateMachines.map(sm => sm.domain);

  const allEvents = new Set([
    ...Object.keys(eventIndex.emitters),
    ...Object.keys(eventIndex.subscribers),
  ]);
  const sorted = [...allEvents].sort();

  const rows = sorted.map(event => {
    const emitter = eventIndex.emitters[event];
    const subs = eventIndex.subscribers[event] || [];
    const publisherCell = emitter
      ? `<a href="${emitter.domain}.html">${titleCase(emitter.domain)}/${emitter.object}</a>`
      : `<span style="color:#999;font-size:11px;">unknown</span>`;
    const subsCell = subs.length
      ? subs.map(s => `<a href="${s.domain}.html">${titleCase(s.domain)}/${s.object}</a>`).join(', ')
      : `<span style="color:#999;font-size:11px;">none</span>`;
    return `<tr>
      <td><code>${event}</code></td>
      <td>${publisherCell}</td>
      <td>${subsCell}</td>
    </tr>`;
  }).join('');

  const noPublisher = sorted.filter(e => !eventIndex.emitters[e]);
  const orphanSection = noPublisher.length ? `
    <h3 style="font-size:1rem;font-weight:700;color:${COLORS.darkBlue};margin:2rem 0 0.75rem;">Subscribed but not emitted</h3>
    <p style="font-size:13px;color:${COLORS.textLight};margin-bottom:0.75rem;">These events are subscribed to but have no emitter in the current state machines.</p>
    <ul style="font-size:13px;color:${COLORS.textLight};">
      ${noPublisher.map(e => `<li><code>${e}</code></li>`).join('')}
    </ul>` : '';

  const body = `
    <h1 style="font-size:1.5rem;font-weight:800;color:${COLORS.darkBlue};margin-bottom:0.375rem;">Published Events</h1>
    <p style="color:${COLORS.textLight};margin-bottom:2rem;font-size:13px;">Auto-generated from state machine <code>emit</code> and subscription declarations.</p>
    <div style="background:${COLORS.white};border:1px solid ${COLORS.sandDark};border-radius:8px;overflow:hidden;">
      <table>
        <thead><tr>
          <th>Event</th><th>Published by</th><th>Subscribers</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${orphanSection}`;

  writeFileSync(
    path.join(outputDir, 'events.html'),
    shell('Events', { active: 'events.html' }, body, allDomains)
  );
  console.log('  wrote events.html');
}
