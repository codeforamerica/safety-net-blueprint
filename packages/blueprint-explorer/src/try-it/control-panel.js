/**
 * The control panel: docked beside every explorer page while Try it is on,
 * for the mock server running in the page.
 *
 * The Try it switch in the page's header turns it on and off
 * (lib/control-panel.js), as a browser's developer tools open beside a page.
 * It shows what the mock
 * was built from and how it started, and starts it over, with the sample
 * records or empty. Below that, the timers waiting, each fired by a stub
 * standing in for the timer service; the stubs, added and edited with the
 * contracts' choices offered (stub-editor.js); and the activity log: each
 * request Try it sent and the events it set off, the latest first
 * (activity.js).
 *
 * A page that runs the mock itself (the API reference, the Scenarios page)
 * hands it over with `hostMock`, so the panel shows and starts over that
 * page's mock. On any other page the panel starts one of its own when it
 * first opens, with what the last page left (records.js), and leaves what it
 * holds for the next.
 */

import { environments, chosenEnvironment, chooseEnvironment } from './environments.js';
import { signedIn, signOut, signInFromHeader, canSignIn } from './sign-in.js';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { startMock } from './start-mock.js';
import { trailFor, eventLines, followedFrom, waitingTimers, waitingLines, HAPPENED_STYLE } from './event-trail.js';
import { activityOf, clearActivity } from './activity.js';
import { stubChoices, eventStubForm, httpStubForm, describeStub, STUB_STYLE } from './stub-editor.js';
import { COMBO_STYLE } from './combobox.js';
import { chosenServer, chooseServer, environmentsOf, expandServer, isLocal } from './routing.js';

const ORIGIN = 'http://mock.invalid';

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  if (text !== '') node.textContent = text;
  if (className) node.className = className;
  return node;
};

const STYLE = `
  #mock-panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1000; width: var(--mock-panel-width, 30rem); max-width: 100vw;
    background: #fff; border-left: 1px solid #d9d6ee; overflow: auto; font: 14px/1.5 system-ui, sans-serif; color: #1a1a1a; display: none; }
  #mock-panel.open { display: block; }
  /* Narrow, docked along the bottom, the page above it its full width. */
  @media (max-width: 1200px) {
    #mock-panel { top: auto; left: 0; width: 100vw; height: var(--mock-panel-height, 40vh); border-left: 0; border-top: 1px solid #d9d6ee;
      display: none; flex-direction: column; overflow: hidden; }
    #mock-panel.open { display: flex; }
    #mock-panel .mp-head { position: static; flex: none; }
    /* Side by side, each scrolling on its own. */
    #mock-panel .mp-body { flex: 1; min-height: 0; overflow: auto; }
  }
  /* Drag handle on the panel's edge, like the sash between VS Code's panes. Fixed, so scrolling the panel doesn't move it. */
  #mock-panel-resize { position: fixed; top: 0; bottom: 0; right: calc(var(--mock-panel-width, 30rem) - 4px); width: 8px;
    cursor: col-resize; z-index: 1001; display: none; }
  #mock-panel-resize.open { display: block; }
  #mock-panel-resize::after { content: ''; position: absolute; top: 50%; left: 2px; width: 4px; height: 36px; margin-top: -18px;
    border-radius: 2px; background: #b9b3e3; }
  #mock-panel-resize:hover, #mock-panel-resize.dragging { background: rgba(43,26,120,.18); }
  #mock-panel-resize:hover::after, #mock-panel-resize.dragging::after { background: #2B1A78; }
  @media (max-width: 1200px) {
    #mock-panel-resize { top: auto; left: 0; right: 0; bottom: calc(var(--mock-panel-height, 40vh) - 4px); width: auto; height: 8px; cursor: row-resize; }
    #mock-panel-resize::after { top: 2px; left: 50%; width: 36px; height: 4px; margin-top: 0; margin-left: -18px; }
  }
  #mock-panel .mp-stubs-about summary { font-size: .8rem; font-weight: 600; color: #555; }
  #mock-panel .mp-stubs-about { margin-bottom: .5rem; }
  #mock-panel .mp-stubs-about summary { font-size: .8rem; font-weight: 600; color: #555; }
  #mock-panel .mp-stubs-about { margin-bottom: .5rem; }
  #mock-panel .mp-environment { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin: 0 0 .6rem; font-size: .85rem; }
  #mock-panel .mp-environment label { font-weight: 700; color: #2B1A78; }
  #mock-panel .mp-environment select { font: inherit; padding: 2px 6px; }
  #mock-panel .mp-environment .mp-who { color: #555; }
  #mock-panel .mp-head { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; background: #2B1A78; color: #fff; font-weight: 700; }
  #mock-panel .mp-close { background: none; border: 0; color: #fff; font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
  #mock-panel .mp-body { padding: 16px; }
  /* Tabs, as developer tools have: one view at a time. */
  #mock-panel .mp-tabs { display: flex; gap: 2px; margin-left: 16px; flex: 1; }
  #mock-panel .mp-tab { font: 600 12px system-ui, sans-serif; color: rgba(255,255,255,.75); background: none; border: 0;
    border-bottom: 2px solid transparent; padding: 4px 10px; cursor: pointer; }
  #mock-panel .mp-tab[aria-selected="true"] { color: #fff; border-bottom-color: #fff; }
  #mock-panel .mp-view > h3:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
  #mock-panel .mp-waiting { border: 1px solid #fde68a; background: #fffbeb; border-radius: 6px; padding: 6px 10px; margin: 0 0 .6rem; }
  #mock-panel .mp-waiting .mp-note { font: 12px system-ui, sans-serif; margin-top: 4px; }
  #mock-panel .mp-about { margin: 1rem 0 0; }
  #mock-panel .mp-about > summary { cursor: pointer; font-weight: 700; font-size: .95rem; }
  #mock-panel .mp-about > .mp-lede { margin-top: .5rem; }
  #mock-panel .mp-lede { color: #555; margin: 0 0 1rem; }
  #mock-panel .mp-stats { border: 1px solid #e2e2e2; border-radius: 6px; padding: .7rem .9rem; margin: 0 0 1rem; }
  #mock-panel .mp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .1rem 1.2rem; }
  #mock-panel .mp-stat { display: flex; gap: .45rem; font-size: .82rem; color: #555; }
  #mock-panel .mp-stat .n { font-family: ui-monospace, Menlo, monospace; min-width: 1.6rem; text-align: right; color: #1a1a1a; }
  #mock-panel .mp-lead { font-size: .95rem; font-weight: 600; color: #1a1a1a; }
  #mock-panel .mp-lead .n { color: #2b6cb0; min-width: 2.2rem; }
  #mock-panel .mp-headline { padding-bottom: .5rem; margin-bottom: .5rem; border-bottom: 1px solid #e2e2e2; }
  #mock-panel .mp-status { font-size: .85rem; color: #555; margin: 0 0 .6rem; }
  #mock-panel .mp-controls { display: flex; gap: .5rem; flex-wrap: wrap; }
  #mock-panel button.mp-action { font: 600 13px system-ui, sans-serif; padding: .4rem .8rem; border-radius: 4px;
    border: 1px solid #2B1A78; background: #fff; color: #2B1A78; cursor: pointer; }
  #mock-panel button.mp-action:disabled { opacity: .5; cursor: default; }
  #mock-panel h3 { font-size: .8rem; letter-spacing: .05em; text-transform: uppercase; color: #555; margin: 1.4rem 0 .4rem;
    padding-top: .8rem; border-top: 1px solid #e2e2e2; }
  #mock-panel .mp-none, #mock-panel .mp-note { font-size: .85rem; color: #777; margin: 0; }
  #mock-panel .happened { margin-top: 0; }
  #mock-panel .happened-under { padding-left: 16px; border-left: 2px solid #eeeaf8; margin: 0 0 4px 4px; }
  #mock-panel .happened-bad { color: #b42318; }
  #mock-panel .mp-filters { display: flex; gap: 4px; align-items: center; margin-bottom: .5rem; }
  #mock-panel .mp-filter { font: 600 11px system-ui, sans-serif; padding: 1px 10px; border-radius: 3px; border: 1px solid #c7c4ea; background: #fff; color: #2B1A78; cursor: pointer; }
  #mock-panel .mp-filter[aria-pressed="true"] { background: #2B1A78; color: #fff; border-color: #2B1A78; }
  #mock-panel .mp-rows { margin: 0; padding: 0; list-style: none; font: 12px ui-monospace, Menlo, monospace; }
  #mock-panel .mp-rows li { display: flex; gap: .6rem; align-items: baseline; padding: .15rem 0; }
  #mock-panel .mp-rows .n { margin-left: auto; color: #555; }
  #mock-panel .mp-rows code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #mock-panel .mp-rows .mp-what { font-family: system-ui, sans-serif; overflow-wrap: anywhere; }
  #mock-panel .mp-edit { margin-left: auto; font: 600 11px system-ui, sans-serif; padding: 1px 10px; border-radius: 3px;
    border: 1px solid #2B1A78; background: #fff; color: #2B1A78; cursor: pointer; }
  #mock-panel .mp-remove { margin-left: .3rem; font: 600 11px system-ui, sans-serif; padding: 1px 10px; border-radius: 3px;
    border: 1px solid #b42318; background: #fff; color: #b42318; cursor: pointer; }
  #mock-panel .mp-server { margin-bottom: .5rem; display: flex; flex-direction: column; gap: .35rem; align-items: flex-start; }
  #mock-panel .mp-server select, #mock-panel .mp-server input { font: 12px system-ui, sans-serif; padding: 3px 6px; border: 1px solid #c7c4ea; border-radius: 4px; max-width: 100%; }
  #mock-panel .mp-server input[type=url] { width: 100%; box-sizing: border-box; font-family: ui-monospace, Menlo, monospace; }
  #mock-panel .mp-server .mp-edit { margin-left: 0; }
  #mock-panel .mp-server .mp-note { width: 100%; overflow-wrap: anywhere; }
  #mock-panel .mp-server .mp-rows { margin-top: .4rem; }
  #mock-panel .mp-server .mp-rows li { flex-wrap: wrap; gap: 0 .6rem; }
  #mock-panel .mp-server .mp-rows .n { margin-left: 0; overflow-wrap: anywhere; }
  #mock-panel .mp-server-fields { display: flex; flex-direction: column; gap: .3rem; width: 100%; }
  #mock-panel .mp-server-var { display: flex; gap: .5rem; align-items: center; font-size: .85rem; }
  #mock-panel .mp-route-head { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
  #mock-panel .mp-route-head code { font: 12px ui-monospace, Menlo, monospace; overflow-wrap: anywhere; }
`;

// How many events the log shows: the mock's list hands back at most this many at once.
const LOG_SIZE = 100;
const STUB_KINDS = ['events', 'http'];
const KIND_NAMES = { events: 'Event', http: 'HTTP' };
const ADD_LABELS = { events: 'Add an event stub', http: 'Add an HTTP stub' };

const FORMS = { events: eventStubForm, http: httpStubForm };

/**
 * The stub being written, if any: its kind, a new one or the id of one being
 * edited, and its form, kept as it is while the panel is drawn again around it.
 * @type {{ kind: string, id: string|null, form: HTMLElement } | null}
 */
let editing = null;

// What a contract set is made of, by kind. Shared schema fragments aren't
// counted: each of these declares behavior.
const CONTRACTS = [
  ['openapi', 'API', 'APIs'],
  ['state-machine', 'state machine', 'state machines'],
  ['rules', 'ruleset', 'rulesets'],
  ['compositions', 'composition', 'compositions'],
  ['asyncapi', 'event catalog', 'event catalogs'],
  ['annotations', 'annotation set', 'annotation sets'],
  ['registry', 'registry', 'registries'],
  ['sla-types', 'SLA definition', 'SLA definitions'],
];

/**
 * The mock the panel shows: the page's, once it hands it over, else its own.
 * @type {{ mock: () => object, restart: (options: { seed: boolean }) => Promise<void>,
 *   reroute: () => Promise<void>, seeded: boolean, ms: number, keep: () => Promise<void>,
 *   changed?: () => Promise<unknown> } | null}
 */
let host = null;
let own = null;
let options = null;

// The panel's views, as developer tools have tabs: Activity, the log of
// requests and events, and Setup, for the environment, data and stubs. A page
// can show only some, as the Scenarios page shows only Activity.
const VIEWS = [['activity', 'Activity'], ['setup', 'Setup']];
const VIEW_KEY = 'blueprint-mock-panel-view';
let views = VIEWS.map(([id]) => id);
let view = (() => { try { return sessionStorage.getItem(VIEW_KEY) ?? 'activity'; } catch { return 'activity'; } })();
let panel = null;

/**
 * Show the mock again, if the panel is open: the page sent it something.
 */
export function mockChanged() {
  if (panel?.classList.contains('open')) render();
}

/**
 * Hand the panel the page's mock, each time the page starts it.
 *
 * @param {{ mock: () => object, restart: (options: { seed: boolean }) => Promise<void>,
 *   reroute: () => Promise<void>, seeded: boolean, ms: number,
 *   keep: () => Promise<void>, changed?: () => Promise<unknown> }} given - The
 *   mock as it is now; how to start it over; how to start it again, records
 *   and stubs kept, when its routing changes; whether it started with the
 *   sample records, and how long it took to build (start-mock.js); how to save
 *   it for the next page; and what the page does when the panel changes it
 */
export function hostMock(given) {
  host = given;
  if (panel?.classList.contains('open')) render();
}

/** A mock of the panel's own, for a page that runs none, with what the last page left. */
async function startOwn({ seed, restore }) {
  const session = await startMock({ contracts: options.contracts, scope: options.scope, version: options.version, seed, restore });
  own = {
    ...session,
    mock: () => session.mock,
    restart: ({ seed: again }) => startOwn({ seed: again, restore: false }),
    reroute: () => startOwn({ seed: session.seeded, restore: true }),
  };
}

const stat = (count, label, className = '') => {
  const row = el('div', '', `mp-stat ${className}`.trim());
  row.append(el('span', String(count), 'n'), el('span', label));
  return row;
};

/** A request to the mock the panel shows. */
const send = (running, method, path, body) => running.mock().fetch(new Request(ORIGIN + path, {
  method, body: body ? JSON.stringify(body) : undefined, headers: body ? { 'Content-Type': 'application/json' } : {},
}));

const json = async (response) => (response.ok ? response.json() : null);

/** Keep for the next page what the panel changed, and let the page show it. */
const keep = async (running) => {
  await running.keep();
  await running.changed?.();
};

/**
 * Where the mock's calls go: the site's routing, each entry with a switch
 * between the real service and the mock in this page. A switch restarts the
 * mock without the entry, records and stubs kept. A call the mock can't answer
 * itself, such as an adapter's, then needs a stub, so the HTTP stub form is
 * offered for it, started on that call.
 */
/**
 * The server, chosen in the page, as Swagger's server list does: this
 * page, an environment the contracts' servers name, or a URL typed in. The
 * site's own routing, listed below it, still wins.
 */
function serverChooser(running) {
  const docs = extract(options.contracts, 'docs');
  const environments = environmentsOf(docs);
  const chosen = chosenServer(options);
  const box = el('div', '', 'mp-server');
  const pick = el('select');
  pick.setAttribute('aria-label', 'Server');
  // Named for what they are: a mock, here or on this computer, or real services.
  const urlsOf = (environment) => environment.apis.map((a) => ({ api: a.api, url: expandServer(a.server, chosen?.variables) }));
  const labelOf = (environment) => {
    const urls = urlsOf(environment).map((a) => a.url);
    if (!urls.every(isLocal)) return `Real services (${environment.description.replace(/\s+server$/i, '')})`;
    const hosts = [...new Set(urls.map((url) => { try { return new URL(url).host; } catch { return url; } }))];
    return `Mock server on this computer (${hosts.join(', ')})`;
  };
  pick.append(Object.assign(el('option', 'Mock, in this page'), { value: '' }));
  // Real services first: they're what a reader comes to switch to.
  for (const environment of [...environments].sort((a, b) => Number(urlsOf(a).every((x) => isLocal(x.url))) - Number(urlsOf(b).every((x) => isLocal(x.url))))) {
    pick.append(Object.assign(el('option', labelOf(environment)), { value: `env:${environment.description}` }));
  }
  pick.append(Object.assign(el('option', 'Another server…'), { value: 'url' }));
  pick.value = chosen?.url ? 'url' : chosen?.environment ? `env:${chosen.environment}` : '';

  const url = Object.assign(el('input'), { type: 'url', placeholder: 'http://localhost:1080', value: chosen?.url ?? '' });
  url.setAttribute('aria-label', 'Server URL');
  const fields = el('div', '', 'mp-server-fields');
  const apply = Object.assign(el('button', 'Use it', 'mp-edit'), { type: 'button' });
  const said = el('p', '', 'mp-note');

  // An environment's server variables, each a field starting from its default.
  const environmentPicked = () => environments.find((e) => `env:${e.description}` === pick.value);
  const variableBoxes = new Map();
  const drawFields = () => {
    variableBoxes.clear();
    fields.replaceChildren();
    if (pick.value === 'url') { fields.append(url); return; }
    for (const [name, variable] of Object.entries(environmentPicked()?.variables ?? {})) {
      const input = Object.assign(el('input'), { type: 'text', value: chosen?.variables?.[name] ?? variable.default ?? '' });
      input.setAttribute('aria-label', name);
      variableBoxes.set(name, input);
      const row = el('label', '', 'mp-server-var');
      row.append(el('code', `{${name}}`), input);
      fields.append(row);
    }
  };
  const choice = () => {
    if (pick.value === 'url') return url.value.trim() ? { url: url.value.trim().replace(/\/$/, '') } : null;
    const environment = environmentPicked();
    if (!environment) return null;
    const variables = Object.fromEntries([...variableBoxes].map(([name, input]) => [name, input.value.trim()]));
    return { environment: environment.description, ...(variableBoxes.size ? { variables } : {}) };
  };
  const use = async () => {
    if (pick.value === 'url' && !url.value.trim()) { said.textContent = 'Type the server\'s URL.'; return; }
    pick.disabled = apply.disabled = true;
    await running.keep();
    chooseServer(options, choice());
    await running.reroute();
    render();
  };
  pick.onchange = () => {
    drawFields();
    // A choice with nothing to fill in takes effect at once.
    if (pick.value !== 'url' && !variableBoxes.size) use();
  };
  apply.onclick = use;
  drawFields();

  const row = el('div', '', 'mp-route-head');
  row.append(pick);
  box.append(row, fields);
  if (pick.value === 'url' || variableBoxes.size) box.append(apply);
  pick.addEventListener('change', () => { apply.remove(); if (pick.value === 'url' || variableBoxes.size) box.insertBefore(apply, said); });
  box.append(said);
  if (chosen?.url) {
    said.textContent = `Every call goes to ${chosen.url}, except what this site routes. It has to allow calls from this page (CORS).`;
  } else if (chosen) {
    // Where each API goes, so the addresses are here when wanted, not in the menu.
    said.textContent = 'Each API goes to its own server; one with none stays in this page. Each has to allow calls from this page (CORS).';
    const environment = environments.find((e) => e.description === chosen.environment);
    const list = el('ul', '', 'mp-rows');
    for (const { api, url } of environment ? urlsOf(environment) : []) {
      const item = el('li');
      item.append(el('code', api), el('span', url, 'n'));
      list.append(item);
    }
    said.append(list);
  } else {
    said.textContent = 'Everything runs in your browser.';
  }
  return box;
}

/** The timers waiting, each with Fire, pinned at the top of the activity log while there are any. */
function waitingSection(running, events) {
  // With calls going to a server, its timers are its own: the page's are beside the point.
  if (chosenServer(options)) return [];
  const waiting = waitingTimers(events);
  if (!waiting.length) return [];
  const box = el('div', '', 'happened mp-waiting');
  box.append(el('div', 'Timers waiting', 'happened-heading'));
  // A stub matching this one timer fires it as soon as it is registered,
  // standing in for the timer service (the mock's POST /mock/stubs/events).
  box.append(...waitingLines(waiting, {
    fire: async (request) => {
      await send(running, 'POST', '/mock/stubs/events', { on: request.type, match: { 'data.timerId': request.data.timerId } });
      await keep(running);
      render();
    },
  }));
  box.append(el('p', 'Fire sends a timer\'s callback now, instead of waiting until it\'s due.', 'mp-note'));
  return [box];
}

/** The events published, the latest first, each under the one that caused it. */
/** Which of the activity log's kinds it shows. */
let shownKinds = 'all';
const KINDS = [['all', 'All'], ['requests', 'Requests'], ['events', 'Events']];

/** A request Try it sent, opening to its body and the response. */
function requestLine(request) {
  const row = el('details', '', 'happened-event');
  row.dataset.request = request.time;
  const outcome = request.status === null ? `not sent: ${request.error ?? ''}` : `${request.status}${request.ms !== undefined ? ` · ${request.ms} ms` : ''}`;
  const summary = el('summary');
  summary.append(el('span', `${request.method} ${request.path}`, 'happened-type'), el('span', `  → ${outcome}`, request.ok ? 'happened-subject' : 'happened-bad'));
  row.append(summary);
  if (request.body) row.append(el('div', 'Request', 'happened-heading'), el('pre', request.body, 'happened-body'));
  if (request.shown) row.append(el('div', 'Response', 'happened-heading'), el('pre', request.shown, 'happened-body'));
  return row;
}

/**
 * Everything that happened in the mock, the latest first: each request Try
 * it sent with the events it set off under it, and the events nothing logged
 * set off, such as a timer firing, on their own. Clear empties it.
 */
function activitySection(running, events) {
  const docs = extract(options.contracts, 'docs');
  const trail = trailFor(docs, options.scope);
  const { requests, clearedAt } = activityOf(options);
  const since = clearedAt ? events.filter((event) => !event.time || event.time >= clearedAt) : events;

  const bar = el('div', '', 'mp-filters');
  for (const [kind, label] of KINDS) {
    const button = Object.assign(el('button', label, 'mp-filter'), { type: 'button' });
    button.setAttribute('aria-pressed', String(shownKinds === kind));
    button.onclick = () => { shownKinds = kind; render(); };
    bar.append(button);
  }
  const clear = Object.assign(el('button', 'Clear', 'mp-edit'), { type: 'button' });
  clear.onclick = () => { clearActivity(options); render(); };
  bar.append(clear);

  const box = el('div', '', 'happened');
  if (shownKinds === 'events') {
    box.append(...eventLines(since, { trail, newestFirst: true }));
  } else {
    // Each request's events, and what followed from them.
    const claimed = new Set();
    const items = requests.map((request) => {
      const own = since.filter((event) => (request.eventIds ?? []).includes(event.id));
      const all = [...own, ...followedFrom(own.map((event) => event.id), since).filter((event) => !own.includes(event))];
      for (const event of all) claimed.add(event.id);
      return { time: request.time, request, events: all };
    });
    if (shownKinds === 'all') {
      // The events no request set off, each with what followed from it.
      const loose = since.filter((event) => !claimed.has(event.id));
      const looseIds = new Set(loose.map((event) => event.id));
      for (const root of loose.filter((event) => !looseIds.has(event.causationid))) {
        const group = [root, ...followedFrom([root.id], loose)];
        items.push({ time: root.time ?? '', events: group });
      }
    }
    items.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
    for (const item of items) {
      if (!item.request) {
        box.append(...eventLines(item.events, { trail }));
        continue;
      }
      box.append(requestLine(item.request));
      if (shownKinds === 'all' && item.events.length) {
        const under = el('div', '', 'happened-under');
        under.append(...eventLines(item.events, { trail }));
        box.append(under);
      }
    }
  }
  const empty = !box.childElementCount;
  return [bar, ...waitingSection(running, events), empty ? el('p', 'No activity yet.', 'mp-none') : box];
}

/** A stub registered, or why the mock refused it. */
async function register(running, kind, stub) {
  const response = await send(running, 'POST', `/mock/stubs/${kind}`, stub);
  if (response.ok) return { stub: await response.json() };
  const text = await response.text();
  try { const said = JSON.parse(text); return { refused: said.message ?? said.error ?? text }; } catch { return { refused: text }; }
}

/** The form for a stub of a kind, new or replacing one. */
function openEditor(running, kind, events, stub = null) {
  editing = {
    kind,
    id: stub?.id ?? null,
    form: FORMS[kind]({
      choices: (() => {
        const docs = extract(options.contracts, 'docs');
        return stubChoices(docs, extract(docs, 'examples'));
      })(),
      waiting: waitingTimers(events),
      stub,
      // Registered first, so a refused edit leaves the one it would replace.
      save: async (value) => {
        const { refused } = await register(running, kind, value);
        if (refused) return refused;
        if (stub) await send(running, 'DELETE', `/mock/stubs/${kind}/${encodeURIComponent(stub.id)}`);
        editing = null;
        await keep(running);
        render();
        return null;
      },
      cancel: () => { editing = null; render(); },
    }),
  };
  render();
}

/** The stubs registered, each said in words, with Edit and Remove; and adding one. */
async function stubsSection(running, events) {
  const rows = el('ul', '', 'mp-rows');
  for (const kind of STUB_KINDS) {
    for (const stub of (await json(await send(running, 'GET', `/mock/stubs/${kind}`)))?.items ?? []) {
      const row = el('li');
      const what = Object.assign(el('span', describeStub(kind, stub), 'mp-what'), { title: JSON.stringify(stub, null, 2) });
      const edit = Object.assign(el('button', 'Edit', 'mp-edit'), { type: 'button' });
      edit.onclick = () => openEditor(running, kind, events, stub);
      row.append(el('span', KIND_NAMES[kind]), what, edit);
      const remove = Object.assign(el('button', 'Remove', 'mp-remove'), { type: 'button' });
      remove.onclick = async () => {
        remove.disabled = true;
        await send(running, 'DELETE', `/mock/stubs/${kind}/${encodeURIComponent(stub.id)}`);
        if (editing?.id === stub.id) editing = null;
        await keep(running);
        render();
      };
      row.append(remove);
      rows.append(row);
      if (editing?.id === stub.id) rows.append(editing.form);
    }
  }
  // What a stub is, folded away until asked.
  const what = el('details', '', 'mp-about');
  what.open = Boolean(panel.querySelector('details.mp-stubs-about[open]'));
  what.classList.add('mp-stubs-about');
  what.append(el('summary', 'What\'s a stub?'), el('p', 'A stub makes the mock do what something outside the system would: '
    + 'answer an event with another, fire a timer, or answer a call to another service. Each answers once.', 'mp-note'));
  const parts = [what];
  if (editing && editing.id === null) parts.push(editing.form);
  else {
    const adds = el('div', '', 'mp-controls');
    for (const kind of STUB_KINDS) {
      const add = Object.assign(el('button', ADD_LABELS[kind], 'mp-action'), { type: 'button' });
      add.onclick = () => openEditor(running, kind, events);
      adds.append(add);
    }
    parts.push(adds);
  }
  if (rows.children.length) parts.push(rows);
  return parts;
}

/** What the mock was built from, how it started, and what it holds. */
async function render() {
  const body = panel.querySelector('.mp-body');
  const running = host ?? own;
  if (!running) {
    body.replaceChildren(el('p', 'Starting the mock…', 'mp-status'));
    return;
  }
  // What it is and what went into it, folded away under the controls.
  const about = el('details', '', 'mp-about');
  about.open = Boolean(body.querySelector('details.mp-about[open]'));
  about.append(el('summary', 'Not your average Mock Server'), Object.assign(el('p', '', 'mp-lede'), {
    innerHTML: 'An entire server, generated from a set of contracts, running in this tab. <b>No custom code.</b> '
      + 'Everything is derived on the fly when the server boots, so what you see here is what these contracts say, and nothing else.',
  }));
  const docs = extract(options.contracts, 'docs');
  const kinds = new Map();
  for (const doc of docs) kinds.set(doc.type, (kinds.get(doc.type) ?? 0) + 1);
  const total = CONTRACTS.reduce((n, [type]) => n + (kinds.get(type) ?? 0), 0);
  const examples = docs.filter((doc) => doc.type === 'mock-data')
    .reduce((n, doc) => n + Object.keys(doc.content ?? {}).length, 0);

  const stats = el('div', '', 'mp-stats');
  const headline = el('div', '', 'mp-grid mp-headline');
  headline.append(stat(total, 'contracts', 'mp-lead'), stat(running.mock().routes.size, 'routes', 'mp-lead'));
  const breakdown = el('div', '', 'mp-grid');
  for (const [type, one, many] of CONTRACTS) {
    const count = kinds.get(type);
    if (count) breakdown.append(stat(count, count === 1 ? one : many));
  }
  stats.append(headline, breakdown);
  about.append(stats);

  const status = el('p', `Built in ${running.ms} ms, ${running.seeded ? `with ${examples} sample records` : 'empty'}.`, 'mp-status');
  const controls = el('div', '', 'mp-controls');
  // With calls going to a server, its records and timers are its own: the page's are beside the point.
  const away = chosenServer(options);
  for (const [label, seed] of away ? [] : [['Restart with data', true], ['Start empty', false]]) {
    const button = el('button', label, 'mp-action');
    button.type = 'button';
    button.onclick = async () => {
      for (const other of controls.querySelectorAll('button')) other.disabled = true;
      await running.restart({ seed });
      // A new mock: what the log showed happened in the old one.
      clearActivity(options);
      render();
    };
    controls.append(button);
  }

  // The latest events, in the order they happened. Read oldest first from
  // where the latest begin, rather than newest first and turned around:
  // events sent in the same millisecond, such as a timer's request and its
  // cancellation, would come out the wrong way round.
  const logged = (await json(await send(running, 'GET', '/platform/events?limit=1')))?.total ?? 0;
  const listed = await json(await send(running, 'GET', `/platform/events?sort=time&offset=${Math.max(0, logged - LOG_SIZE)}&limit=${LOG_SIZE}`));
  const events = listed?.items ?? [];
  // Two views, shown one at a time: Activity, and Setup.
  const settings = el('div', '', 'mp-settings mp-view');
  // A site with environments switches them above, instead of choosing a server.
  const servers = environments().length ? [] : [el('h3', 'Server'), serverChooser(running)];
  settings.append(...environmentRow(), status, controls, about, ...servers,
    el('h3', 'Stubs'), ...await stubsSection(running, events));
  const activity = el('div', '', 'mp-activity mp-view');
  activity.append(...activitySection(running, events));
  // Drawn again, an event opened stays open.
  const opened = new Set([...body.querySelectorAll('details[open][data-event]')].map((row) => row.dataset.event));
  const openedRequests = new Set([...body.querySelectorAll('details[open][data-request]')].map((row) => row.dataset.request));
  // Editing a stub is in Setup.
  if (editing && views.includes('setup')) view = 'setup';
  if (!views.includes(view)) view = views[0];
  for (const tab of panel.querySelectorAll('.mp-tab')) tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  body.replaceChildren(view === 'setup' ? settings : activity);
  for (const row of body.querySelectorAll('details[data-event]')) row.open = opened.has(row.dataset.event);
  for (const row of body.querySelectorAll('details[data-request]')) row.open = openedRequests.has(row.dataset.request);
}

// The panel's size, kept for this browser, as an editor keeps its side bar's.
const SIZE_KEY = 'blueprint-mock-panel-size';
const docked = () => matchMedia('(max-width: 1200px)').matches;
const storedSize = () => { try { return JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') ?? {}; } catch { return {}; } };

/**
 * The edge the page meets, dragged to resize the panel: its width beside the
 * page, or its height docked along the bottom.
 */
function resizeHandle() {
  const handle = el('div');
  handle.id = 'mock-panel-resize';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'Resize the mock server panel');
  for (const property of ['--mock-panel-width', '--mock-panel-height']) {
    const size = storedSize()[property];
    if (size) document.documentElement.style.setProperty(property, size);
  }
  handle.onpointerdown = (down) => {
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    handle.classList.add('dragging');
    const bottom = docked();
    const move = (event) => {
      const size = bottom
        ? `${Math.round(Math.min(Math.max(innerHeight - event.clientY, 160), innerHeight * 0.9))}px`
        : `${Math.round(Math.min(Math.max(innerWidth - event.clientX, 280), innerWidth * 0.85))}px`;
      document.documentElement.style.setProperty(bottom ? '--mock-panel-height' : '--mock-panel-width', size);
    };
    const up = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      const property = bottom ? '--mock-panel-height' : '--mock-panel-width';
      try { localStorage.setItem(SIZE_KEY, JSON.stringify({ ...storedSize(), [property]: document.documentElement.style.getPropertyValue(property) })); } catch { /* this page only */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  return handle;
}

/**
 * The environment the page is in, with the site's others to switch to, and
 * who's signed in to it, with Sign in where its contracts say how
 * (environments.js, sign-in.js). Nothing for a site that lists none and has
 * no way to sign in.
 */
function environmentRow() {
  const listed = environments();
  const scheme = canSignIn(options);
  if (!listed.length && !scheme) return [];
  const row = el('div', '', 'mp-environment');
  if (listed.length) {
    const base = options.scope.split('#')[0];
    const picker = el('select');
    picker.id = 'mp-environment-picker';
    for (const { name } of listed) picker.append(Object.assign(el('option', name), { value: name }));
    picker.value = chosenEnvironment(base)?.name ?? listed[0].name;
    // The page reloads in the one picked, with its own records, as a portal's switch does.
    picker.onchange = () => {
      chooseEnvironment(base, picker.value);
      try { sessionStorage.setItem(`blueprint-mock-switching:${base}`, '1'); } catch { /* this page only */ }
      location.reload();
    };
    const label = el('label', 'Environment');
    label.htmlFor = picker.id;
    row.append(label, picker);
  }
  if (scheme) {
    const who = signedIn(options);
    const button = Object.assign(el('button', who ? 'Sign out' : 'Sign in', 'mp-action'), { type: 'button' });
    const said = el('span', who ? `Signed in as ${who.name}` : 'Not signed in', 'mp-who');
    button.onclick = async () => {
      if (who) { signOut(options); render(); return; }
      button.disabled = true;
      try { await signInFromHeader(options); } catch (error) { said.textContent = `Not signed in: ${error.message}.`; }
      render();
    };
    row.append(said, button);
  }
  return [row];
}

/**
 * Turn Try it on, docking the panel beside the page, or off. The first time
 * on a page that runs no mock of its own, it starts one.
 *
 * @param {boolean} on
 * @param {{ contracts: object, version: string, scope: string }} given - The
 *   contract set, its version, and the mock's folder, where records are kept
 */
export async function setTryIt(on, given) {
  options ??= given;
  if (given?.views) views = given.views;
  if (!panel) {
    document.head.append(Object.assign(el('style'), { textContent: STYLE + HAPPENED_STYLE + STUB_STYLE + COMBO_STYLE }));
    panel = el('aside');
    panel.id = 'mock-panel';
    panel.setAttribute('aria-label', 'Mock server');
    const head = el('div', '', 'mp-head');
    const close = el('button', '×', 'mp-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Turn off Try it');
    // The switch hears it, and remembers it for the tab.
    close.onclick = () => {
      setTryIt(false);
      dispatchEvent(new CustomEvent('try-it', { detail: { on: false } }));
    };
    const tabs = el('div', '', 'mp-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of VIEWS.filter(([id]) => views.includes(id))) {
      const tab = Object.assign(el('button', label, 'mp-tab'), { type: 'button' });
      tab.dataset.view = id;
      tab.setAttribute('role', 'tab');
      tab.onclick = () => {
        view = id;
        try { sessionStorage.setItem(VIEW_KEY, id); } catch { /* this page only */ }
        render();
      };
      tabs.append(tab);
    }
    head.append(el('span', views.length > 1 ? 'Mock server' : 'Activity'), ...(views.length > 1 ? [tabs] : []), close);
    panel.append(head, el('div', '', 'mp-body'));
    document.body.append(panel, resizeHandle());
  }
  panel.classList.toggle('open', on);
  document.getElementById('mock-panel-resize')?.classList.toggle('open', on);
  if (!on) return;
  render();
  if (!host && !own) {
    await startOwn({ seed: true, restore: true });
    render();
  }
}
