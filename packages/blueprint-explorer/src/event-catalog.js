#!/usr/bin/env node
/**
 * Event Catalog build
 *
 * Generates output/index.html — a cross-domain event catalog derived from
 * all *-state-machine.yaml files. Shows every event with its publisher and
 * subscribers, linking to the state machine docs for each domain.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { buildEventIndex } from '@codeforamerica/blueprint-core';
import { COLORS, FONT } from './lib/theme.js';
import { esc as h, titleCase, breadcrumb } from './lib/html.js';
import { singleColumnPage } from './lib/layout.js';
import { resolvedDir } from './lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const contentArg = process.argv.find(a => a.startsWith('--content='));
if (!contentArg) {
  console.error('Usage: node event-catalog.js --content=<path> [--resolved=<path>]');
  process.exit(1);
}
const contentDir = resolve(process.cwd(), contentArg.slice('--content='.length));
const outputDir = join(contentDir, 'event-catalog');
mkdirSync(outputDir, { recursive: true });
readdirSync(outputDir).filter(f => f.endsWith('.html')).forEach(f => rmSync(join(outputDir, f)));

// ── Load state machines ───────────────────────────────────────────────────────

const files = readdirSync(resolvedDir, { recursive: true })
  .filter(f => typeof f === 'string' && f.endsWith('-state-machine.yaml'))
  .map(f => join(resolvedDir, f));

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
    ? `<a href="${SM_DOCS}/${h(emitter.domain)}.html#machine-${h(emitter.object.toLowerCase())}">${h(titleCase(emitter.domain))} / ${h(emitter.object)}</a>`
    : `<span style="color:#999;font-size:11px;">none</span>`;
  const subsCell = subs.length
    ? subs.map(s => `<a href="${SM_DOCS}/${h(s.domain)}.html#machine-${h(s.object.toLowerCase())}">${h(titleCase(s.domain))} / ${h(s.object)}</a>`).join('<br>')
    : `<span style="color:#999;font-size:11px;">none</span>`;
  const anchor = `event-${h(event)}`;
  return `<tr id="${anchor}">
    <td><code>${h(event)}</code> <a href="#${anchor}" class="permalink" title="Link to this event">#</a></td>
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

const html = singleColumnPage({
  title: 'Safety Net Blueprint \u2014 Event Catalog',
  breadcrumbs: [{ label: 'Explorer', href: '../../index.html' }, { label: 'Event Catalog' }],
  bodyHtml: `
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
  </div>`,
});

writeFileSync(join(outputDir, 'index.html'), html, 'utf8');
console.log('  wrote event-catalog/index.html');
