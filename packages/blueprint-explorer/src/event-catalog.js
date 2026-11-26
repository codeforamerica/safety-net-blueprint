#!/usr/bin/env node
/**
 * Event Catalog build
 *
 * Generates event-catalog/index.html — a card per domain, listing the
 * resources its events are about — and a page per domain, laid out like the
 * API reference: each event is a row that opens to who publishes it and who
 * subscribes to it, linked to the action, endpoint or subscription on its own
 * page, beside its example. The catalog documents; an event is caused where it
 * really is — by the call that publishes it, tried in the API reference, which shows what
 * happened — or, for one only an outside party publishes, by a stub in the
 * control panel.
 *
 * Events are read from the AsyncAPI documents, which carry each message's
 * example; who publishes them and who subscribes, from the state machines. Only
 * the documents reached over no protocol of their own are: an events document
 * declares no servers, since the event bus carries it. One reached over a
 * protocol of its own isn't events, and isn't listed.
 */

import { readdirSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { buildEventIndex } from './contract-nav.js';
import { discover, load as loadDoc } from '@codeforamerica/blueprint-core';
import { COLORS } from './lib/theme.js';
import { esc as h, titleCase, subscriptionAnchor } from './lib/html.js';
import { eventSenders, pathLabel } from './lib/event-senders.js';
import { singleColumnPage, twoColumnPage } from './lib/layout.js';
import { loadConfig } from './lib/config.js';
import { OPERATION_STYLE, OPERATION_SCRIPT } from './lib/operation-page.js';

const SM_DOCS = '../state-machine-docs';

/**
 * Every event the AsyncAPI documents define a message for, once each, with
 * the domain whose document defines it and that document's example.
 */
function eventsOf(asyncDocs) {
  const events = new Map();
  for (const doc of asyncDocs) {
    const content = doc.content ?? {};
    if (doc.protocols.length) continue;
    const domain = content.info?.['x-domain'] ?? doc.domain;
    for (const message of Object.values(content.components?.messages ?? {})) {
      const type = message?.name;
      if (!type || events.has(type)) continue;
      events.set(type, {
        type,
        domain,
        summary: message.summary ?? '',
        example: message.examples?.[0]?.payload ?? null,
        file: doc.relativePath,
      });
    }
  }
  return events;
}

const link = (href, label) => `<a href="${h(href)}">${label}</a>`;
const labeled = (kind, html) => `<span class="who-kind">${kind}:</span> ${html}`;
/** A machine subscribed to an event, linked to its subscription row. */
const subscriberLink = (type) => (sub) => labeled('State machine',
  link(`${SM_DOCS}/${sub.domain}.html#${subscriptionAnchor(sub.object, type)}`, pathLabel(titleCase(sub.domain), sub.object)));
const none = '<span style="color:#999;font-size:11px;">none</span>';

/**
 * @param {{ contentDir: string, resolvedDir: string }} opts
 */
export function build({ contentDir, resolvedDir }) {
const outputDir = join(contentDir, 'event-catalog');
const hubHref = relative(outputDir, join(contentDir, 'index.html'));
const { name: projectName } = loadConfig(contentDir);
mkdirSync(outputDir, { recursive: true });
readdirSync(outputDir).filter(f => f.endsWith('.html')).forEach(f => rmSync(join(outputDir, f)));

// ── Load contracts ────────────────────────────────────────────────────────────

const allStateMachines = discover(resolvedDir, 'state-machine')
  .map(loadDoc)
  .filter((doc) => doc.content?.domain && Array.isArray(doc.content.machines));
const eventIndex = buildEventIndex(allStateMachines);
const asyncapis = discover(resolvedDir, 'asyncapi').map(loadDoc);
const events = eventsOf(asyncapis);

/**
 * The events something outside the contracts sends, such as a running
 * adapter: an AsyncAPI document marked external whose send operations name
 * another document's event channels. Event type → the sender's title.
 */
const externalSenders = new Map();
for (const doc of asyncapis) {
  const content = doc.content ?? {};
  if (content['x-relationship']?.type !== 'external') continue;
  for (const operation of Object.values(content.operations ?? {})) {
    if (operation?.action !== 'send') continue;
    const key = String(operation.channel?.$ref ?? '').split('/').pop();
    const ref = String(content.channels?.[key]?.$ref ?? '');
    const type = ref.includes('#/channels/') ? ref.slice(ref.indexOf('#/channels/') + '#/channels/'.length).replace(/~1/g, '/').replace(/~0/g, '~') : null;
    if (type) externalSenders.set(type, { title: content.info?.title ?? doc.relativePath, file: doc.relativePath });
  }
}

const senderOf = eventSenders(eventIndex, discover(resolvedDir, 'openapi').map(loadDoc));

const tryThere = '<p class="how">To see it published, try that call: what happened lists this event.</p>';

/** Who publishes an event, linked to the action or endpoint that publishes it, and how to cause it. */
const publishedBy = (type) => {
  const external = externalSenders.get(type);
  if (external) {
    return `${h(external.title)}, which sends it to report what it did (<code>${h(external.file.split('/').pop())}</code>).`;
  }
  const sender = senderOf(type);
  if (sender?.kind === 'timer') return sender.label;
  if (sender) return labeled(sender.kind, link(sender.href, sender.label)) + tryThere;
  if (type.startsWith('platform.timer.')) return 'A state machine asking for, or cancelling, a timer';
  return null;
};
/** The machines subscribed to an event; a timer request or cancellation, the timer service. */
const subscribersOf = (type) => (eventIndex.subscribers[type] ?? []).map(subscriberLink(type)).join('<br>')
  || (/^platform\.timer\.(requested|cancelled)$/.test(type) ? 'The timer service' : none);

// ── Index page: a card per domain, listing what publishes its events ───────────

const allTypes = [...new Set([...events.keys(), ...Object.keys(eventIndex.emitters), ...Object.keys(eventIndex.subscribers)])].sort();
const domains = [...new Set([...events.values()].map((event) => event.domain))].sort();
// Grouped by what the event is about: intake.application.created → application.
const groupOf = (type) => type.split('.').length > 2 ? type.split('.')[1] : 'other';
const groupLabel = (group) => group.replace(/[_-]/g, ' ');

const cardStyle = `background:${COLORS.white};border:1px solid ${COLORS.sandDark};border-radius:8px;padding:1.25rem 1.25rem 1rem;`;
const cards = domains.map((domain) => {
  const domainEvents = [...events.values()].filter((event) => event.domain === domain).sort((a, b) => a.type.localeCompare(b.type));
  const groups = [...new Set(domainEvents.map((event) => groupOf(event.type)))].sort((a, b) => groupLabel(a).localeCompare(groupLabel(b)));
  const links = groups.map((group) => {
    const inGroup = domainEvents.filter((event) => groupOf(event.type) === group);
    return `<a href="${h(domain)}.html#event-${h(inGroup[0].type)}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;text-decoration:none;color:${COLORS.text};" onmouseover="this.style.background='${COLORS.paleBlue}'" onmouseout="this.style.background=''">
        <span style="font-size:12px;font-weight:600;color:${COLORS.midBlue};flex:1;">${h(groupLabel(group))}</span>
        <span style="font-size:10px;color:#aaa;flex-shrink:0;">${inGroup.length} event${inGroup.length !== 1 ? 's' : ''}</span>
      </a>`;
  }).join('');
  return `<div style="${cardStyle}">
      <div style="margin-bottom:0.25rem;"><a href="${h(domain)}.html" style="font-size:1rem;font-weight:800;color:${COLORS.darkBlue};text-decoration:none;">${h(titleCase(domain))}</a></div>
      <p style="font-size:12px;color:#666;margin-bottom:0.5rem;">${domainEvents.length} event${domainEvents.length !== 1 ? 's' : ''}</p>
      <div style="border:1px solid ${COLORS.sandDark};border-radius:4px;overflow:hidden;">${links}</div>
    </div>`;
}).join('');

const undefinedEvents = allTypes.filter((type) => !events.has(type) && !eventIndex.emitters[type]);
const orphanSection = undefinedEvents.length ? `
  <h2 style="font-size:1rem;font-weight:700;color:${COLORS.darkBlue};margin:2.5rem 0 0.5rem;">Subscribed to but never published</h2>
  <p style="font-size:13px;color:#666;margin-bottom:0.75rem;">A state machine subscribes to these, but no document or state machine publishes them.</p>
  <ul style="font-size:13px;color:#666;padding-left:1.25rem;">
    ${undefinedEvents.map((type) => `<li><code>${h(type)}</code></li>`).join('')}
  </ul>` : '';

writeFileSync(join(outputDir, 'index.html'), singleColumnPage({
  title: `${projectName} — Event Catalog`,
  breadcrumbs: [{ label: 'Explorer', href: hubHref }, { label: 'Event Catalog' }],
  bodyHtml: `
  <div style="background:${COLORS.darkBlue};color:${COLORS.white};padding:1.25rem 1.5rem 1.125rem;">
    <h2 style="font-size:1.25rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:0.2rem;">Event Catalog</h2>
    <p style="font-size:0.8125rem;color:rgba(255,255,255,0.55);">The events each domain publishes, read from the AsyncAPI documents and the state machines. Open a domain to see what each event carries, who publishes it and who subscribes to it.</p>
  </div>
  <div style="max-width:1100px;margin:2rem auto;padding:0 1.5rem 4rem;">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
      ${cards}
    </div>
    ${orphanSection}
  </div>`,
}), 'utf8');
console.log('  wrote event-catalog/index.html');

// ── A page per domain: each event, and Try it ─────────────────────────────────

for (const domain of domains) {
  const domainEvents = [...events.values()].filter((event) => event.domain === domain).sort((a, b) => a.type.localeCompare(b.type));
  const groups = [...new Set(domainEvents.map((event) => groupOf(event.type)))];

  const navHtml = groups.map((group) => `<div class="nav-section">
    <div class="nav-section-label">${h(groupLabel(group))}</div>
    ${domainEvents.filter((event) => groupOf(event.type) === group).map((event) => `<a href="#event-${h(event.type)}" class="nav-link nav-op" title="${h(event.summary)}">
      <span class="nav-op-path">${h(event.type.split('.').slice(groupOf(event.type) === 'other' ? 1 : 2).join('.'))}</span>
    </a>`).join('')}
  </div>`).join('');

  const rowsHtml = domainEvents.map((event) => {
    const sender = publishedBy(event.type);
    return `<div id="event-${h(event.type)}" class="content-item op-post" style="border:1px solid ${COLORS.sandDark};border-radius:6px;margin-bottom:6px;overflow:hidden;">
  <details>
    <summary class="op-row" style="display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer;list-style:none;user-select:none;">
      <span style="font-size:10px;color:#aaa;width:10px;flex-shrink:0;" class="chevron">▶</span>
      <span class="op-line">
        <code class="op-path">${h(event.type)}</code>
        ${event.summary ? `<span class="op-name">${h(event.summary)}</span>` : ''}
      </span>
      <a href="#event-${h(event.type)}" class="permalink" title="Link to this event">#</a>
    </summary>
    <div class="op-body">
      <div class="op-docs">
        <div class="op-section"><h4 class="op-h">Published by</h4><div>${sender ?? none}</div></div>
        <div class="op-section"><h4 class="op-h">Subscribers</h4><div>${subscribersOf(event.type)}</div></div>
        <div class="op-section"><h4 class="op-h">Defined in</h4><code style="font-size:11.5px;">${h(event.file ?? '')}</code></div>
      </div>
      <aside class="op-side">${event.example ? `<h4 class="op-h">Example</h4><pre class="event-example">${h(JSON.stringify(event.example, null, 2))}</pre>` : ''}</aside>
    </div>
  </details>
</div>`;
  }).join('');

  const headerHtml = `<div style="background:${COLORS.darkBlue};color:${COLORS.white};">
    <div style="padding:0.625rem 1.25rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:0.9375rem;font-weight:800;">${h(titleCase(domain))} events</span>
      <span style="font-size:11px;color:rgba(255,255,255,0.35);margin-left:auto;">${domainEvents.length} event${domainEvents.length !== 1 ? 's' : ''}</span>
    </div>
    <div style="padding:0 1.25rem 0.6rem;font-size:11px;color:rgba(255,255,255,0.55);">What each event carries, who publishes it and who subscribes to it</div>
  </div>`;

  const page = twoColumnPage({
    title: `${projectName} — ${titleCase(domain)} events`,
    breadcrumbs: [
      { label: 'Explorer', href: hubHref },
      { label: 'Event Catalog', href: 'index.html' },
      { label: `${titleCase(domain)} events` },
    ],
    headerHtml,
    navHtml,
    mainHtml: rowsHtml,
    navWidth: 260,
    navSearch: true,
    extraStyle: `${OPERATION_STYLE}
  .op-docs a { color: ${COLORS.midBlue}; text-decoration: none; }
  .op-docs .who-kind { color: ${COLORS.textLight}; }
  .op-docs .how { margin-top: 4px; font-size: 12px; color: ${COLORS.textLight}; }
  .event-example { margin: 0; padding: 10px 12px; background: #1e1b3a; color: #e8e6ff; border-radius: 6px; font-size: 11.5px; overflow: auto; max-height: 28rem; }
  .op-docs a:hover { text-decoration: underline; }`,
  });
  const withNav = page.replace('</body>', () => `<script>${OPERATION_SCRIPT}</script>\n</body>`);
  writeFileSync(join(outputDir, `${domain}.html`), withNav, 'utf8');
  console.log(`  wrote event-catalog/${domain}.html`);
}
} // end build()

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contentArg  = process.argv.find(a => a.startsWith('--content='));
  const resolvedArg = process.argv.find(a => a.startsWith('--resolved='));
  if (!contentArg) {
    console.error('Usage: node event-catalog.js --content=<path> [--resolved=<path>]');
    process.exit(1);
  }
  build({
    contentDir:  resolve(process.cwd(), contentArg.slice('--content='.length)),
    resolvedDir: resolvedArg ? resolve(process.cwd(), resolvedArg.slice('--resolved='.length)) : null,
  });
}
