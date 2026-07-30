#!/usr/bin/env node
/**
 * Event Catalog build
 *
 * Generates output/index.html — a cross-domain event catalog derived from
 * all *-state-machine.yaml files. Shows every event with its publisher and
 * subscribers, linking to the state machine docs for each domain.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { buildEventIndex } from '../state-machine-docs/src/generate.js';
import { COLORS, FONT } from '../../lib/theme.js';
import { esc as h, titleCase, breadcrumb } from '../../lib/html.js';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../../contracts');
const outputDir    = join(__dirname);
mkdirSync(outputDir, { recursive: true });

// ── Load state machines ───────────────────────────────────────────────────────

const files = readdirSync(contractsDir)
  .filter(f => f.endsWith('-state-machine.yaml'))
  .map(f => join(contractsDir, f));

const allStateMachines = files
  .map(f => load(readFileSync(f, 'utf8')))
  .filter(sm => sm.domain && Array.isArray(sm.machines));

const eventIndex = buildEventIndex(allStateMachines);

const SM_DOCS = '../state-machine-docs';

// ── Build table rows ──────────────────────────────────────────────────────────

const allEvents = new Set([
  ...Object.keys(eventIndex.emitters),
  ...Object.keys(eventIndex.subscribers),
]);
const sorted = [...allEvents].sort();

const rows = sorted.map(event => {
  const emitter = eventIndex.emitters[event];
  const subs    = eventIndex.subscribers[event] || [];
  const publisherCell = emitter
    ? `<a href="${SM_DOCS}/${h(emitter.domain)}.html">${h(titleCase(emitter.domain))} / ${h(emitter.object)}</a>`
    : `<span style="color:#999;font-size:11px;">unknown</span>`;
  const subsCell = subs.length
    ? subs.map(s => `<a href="${SM_DOCS}/${h(s.domain)}.html">${h(titleCase(s.domain))} / ${h(s.object)}</a>`).join('<br>')
    : `<span style="color:#999;font-size:11px;">none</span>`;
  return `<tr>
    <td><code>${h(event)}</code></td>
    <td>${publisherCell}</td>
    <td>${subsCell}</td>
  </tr>`;
}).join('');

const noPublisher = sorted.filter(e => !eventIndex.emitters[e]);
const orphanSection = noPublisher.length ? `
  <h2 style="font-size:1rem;font-weight:700;color:${COLORS.darkBlue};margin:2.5rem 0 0.5rem;">Subscribed but not emitted</h2>
  <p style="font-size:13px;color:#666;margin-bottom:0.75rem;">These events are subscribed to but have no emitter in the current state machines.</p>
  <ul style="font-size:13px;color:#666;padding-left:1.25rem;">
    ${noPublisher.map(e => `<li><code>${h(e)}</code></li>`).join('')}
  </ul>` : '';

// ── HTML page ─────────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Safety Net Blueprint — Event Catalog</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; color: ${COLORS.text}; font-size: 14px; line-height: 1.6; }
    a { color: ${COLORS.midBlue}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; background: ${COLORS.sandMid}; padding: 1px 5px; border-radius: 3px; border: 1px solid ${COLORS.sandDark}; color: #2a2a2a; }
    table { border-collapse: collapse; width: 100%; }
    th { background: ${COLORS.sandMid}; color: ${COLORS.text}; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; padding: 8px 12px; text-align: left; border-bottom: 2px solid ${COLORS.sandDark}; }
    td { padding: 10px 12px; border-bottom: 1px solid ${COLORS.sandDark}; vertical-align: top; font-size: 13px; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: ${COLORS.sandMid}; }
  </style>
</head>
<body>
  ${breadcrumb([{ label: 'Explorer', href: '../../index.html' }, { label: 'Event Catalog' }])}
  <div style="max-width:960px;margin:0 auto;padding:2.5rem 1.5rem 4rem;">
    <h1 style="font-size:1.5rem;font-weight:800;color:${COLORS.darkBlue};margin-bottom:0.375rem;">Event Catalog</h1>
    <p style="color:#666;margin-bottom:2rem;font-size:13px;">Cross-domain event reference auto-generated from state machine <code>emit</code> and subscription declarations.</p>
    <div style="background:white;border:1px solid ${COLORS.sandDark};border-radius:8px;overflow:hidden;">
      <table>
        <thead><tr>
          <th>Event</th><th>Published by</th><th>Subscribers</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${orphanSection}
  </div>
</body>
</html>`;

writeFileSync(join(outputDir, 'index.html'), html, 'utf8');
console.log('  wrote event-catalog/index.html');
