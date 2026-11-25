/**
 * The control panel: docked beside every explorer page while Try it is on,
 * for the mock server running in the page.
 *
 * The Try it switch in the page's header turns it on and off
 * (lib/control-panel.js), as a browser's developer tools open beside a page.
 * It holds the activity log: each request Try it sent and the events it set
 * off, the latest first (activity.js), with the timers waiting pinned at the
 * top, each with Fire. Clear empties the log; a reload also puts back the
 * sample records (lib/control-panel.js).
 *
 * On an API reference page, Try it also puts the environment picker, when
 * the site has more than one environment, and sign-in in the page's header,
 * since they decide where every call goes and who makes it.
 *
 * A page that runs the mock itself (the API reference, the Scenarios page)
 * hands it over with `hostMock`, so the panel shows that page's mock. On any
 * other page the panel starts one of its own when it first opens, with what
 * the last page left (records.js), and leaves what it holds for the next.
 */

import { environments, chosenEnvironment, chooseEnvironment } from './environments.js';
import { signedIn, signOut, signInFromHeader, canSignIn } from './sign-in.js';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { startMock } from './start-mock.js';
import { trailFor, eventLines, followedFrom, waitingLines, waitingTimers, HAPPENED_STYLE } from './event-trail.js';
import { activityOf, clearActivity } from './activity.js';
import { chosenServer } from './routing.js';

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
  /* The environment picker and sign-in, in the page's header beside the Try it switch. */
  #try-it-where { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font: 12px system-ui, sans-serif; color: #fff; }
  #try-it-where + #try-it-switch { margin-left: 8px; }
  #try-it-where select { font: 600 12px system-ui, sans-serif; color: #fff; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.3);
    border-radius: 4px; padding: 1px 4px; }
  #try-it-where select option { color: #1a1a1a; }
  #try-it-where .who { color: #C2C0E8; }
  #try-it-where button { font: 600 12px system-ui, sans-serif; color: #fff; background: none; border: 1px solid rgba(255,255,255,.3);
    border-radius: 4px; padding: 1px 8px; cursor: pointer; }
  #try-it-where button:disabled { opacity: .5; cursor: default; }
  #mock-panel .mp-head { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; background: #2B1A78; color: #fff; font-weight: 700; }
  #mock-panel .mp-close { background: none; border: 0; color: #fff; font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
  #mock-panel .mp-body { padding: 16px; }
  #mock-panel .mp-waiting { border: 1px solid #fde68a; background: #fffbeb; border-radius: 6px; padding: 6px 10px; margin: 0 0 .6rem; }
  #mock-panel .mp-waiting .mp-note { font: 12px system-ui, sans-serif; margin-top: 4px; }
  #mock-panel .mp-about { margin: 0 0 1rem; padding-bottom: .75rem; border-bottom: 1px solid #e2e2e2; }
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
  #mock-panel .mp-none, #mock-panel .mp-note { font-size: .85rem; color: #777; margin: 0; }
  #mock-panel .happened { margin-top: 0; }
  #mock-panel .happened-under { padding-left: 16px; border-left: 2px solid #eeeaf8; margin: 0 0 4px 4px; }
  #mock-panel .happened-bad { color: #b42318; }
  /* The send a reference page's "see in Activity" link opened. */
  #mock-panel details.happened-event.mp-picked > summary { background: #eeeaf8; border-radius: 3px; }
  #mock-panel .mp-filters { display: flex; gap: 4px; align-items: center; margin-bottom: .5rem; }
  #mock-panel .mp-filter { font: 600 11px system-ui, sans-serif; padding: 1px 10px; border-radius: 3px; border: 1px solid #c7c4ea; background: #fff; color: #2B1A78; cursor: pointer; }
  #mock-panel .mp-filter[aria-pressed="true"] { background: #2B1A78; color: #fff; border-color: #2B1A78; }
  #mock-panel .mp-clear { margin-left: auto; font: 600 11px system-ui, sans-serif; padding: 1px 10px; border-radius: 3px;
    border: 1px solid #2B1A78; background: #fff; color: #2B1A78; cursor: pointer; }
`;

// How many events the log shows: the mock's list hands back at most this many at once.
const LOG_SIZE = 100;

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

/**
 * Open the activity log at a request Try it sent, by when it was sent: the
 * reference page's "see in Activity" link under a response.
 *
 * @param {string} time - The request's time, as activity.js logged it
 */
export async function showInActivity(time) {
  if (!panel?.classList.contains('open')) return;
  shownKinds = 'all';
  await render();
  for (const row of panel.querySelectorAll('details.mp-picked')) row.classList.remove('mp-picked');
  const row = panel.querySelector(`details[data-request="${CSS.escape(time)}"]`);
  if (!row) return;
  row.open = true;
  row.classList.add('mp-picked');
  row.scrollIntoView({ block: 'nearest' });
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
  const clear = Object.assign(el('button', 'Clear', 'mp-clear'), { type: 'button' });
  clear.onclick = () => { clearActivity(options); render(); };

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
  // Clear shows only when there's something to clear.
  if (!empty) bar.append(clear);
  return [bar, ...waitingSection(running, events), empty ? el('p', 'No activity yet.', 'mp-none') : box];
}

/** What the mock was built from, and the activity log. */
async function render() {
  const body = panel.querySelector('.mp-body');
  const running = host ?? own;
  if (!running) {
    body.replaceChildren(el('p', 'Starting the mock…', 'mp-status'));
    return;
  }
  // What it is and what went into it, folded, at the top.
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
  about.append(stats, el('p', `Built in ${running.ms} ms, ${running.seeded ? `with ${examples} sample records` : 'empty'}. `
    + 'Reloading the page puts back the sample records.', 'mp-status'));

  // The latest events, in the order they happened. Read oldest first from
  // where the latest begin, rather than newest first and turned around:
  // events sent in the same millisecond, such as a timer's request and its
  // cancellation, would come out the wrong way round.
  const logged = (await json(await send(running, 'GET', '/platform/events?limit=1')))?.total ?? 0;
  const listed = await json(await send(running, 'GET', `/platform/events?sort=time&offset=${Math.max(0, logged - LOG_SIZE)}&limit=${LOG_SIZE}`));
  const events = listed?.items ?? [];
  // Drawn again, an event opened stays open.
  const opened = new Set([...body.querySelectorAll('details[open][data-event]')].map((row) => row.dataset.event));
  const openedRequests = new Set([...body.querySelectorAll('details[open][data-request]')].map((row) => row.dataset.request));
  const picked = body.querySelector('details.mp-picked')?.dataset.request;
  body.replaceChildren(about, ...activitySection(running, events));
  for (const row of body.querySelectorAll('details[data-event]')) row.open = opened.has(row.dataset.event);
  for (const row of body.querySelectorAll('details[data-request]')) {
    row.open = openedRequests.has(row.dataset.request);
    if (row.dataset.request === picked) row.classList.add('mp-picked');
  }
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
 * Where calls go and who makes them, in the page's header beside the Try it
 * switch: the environment, when the site has more than one to switch between,
 * and who's signed in, with Sign in where its contracts say how
 * (environments.js, sign-in.js). Nothing for a site with one environment and
 * no way to sign in.
 */
function drawWhere() {
  document.getElementById('try-it-where')?.remove();
  const toggle = document.getElementById('try-it-switch');
  if (!toggle || !panel?.classList.contains('open')) return;
  const listed = environments();
  const scheme = canSignIn(options);
  if (listed.length < 2 && !scheme) return;
  const where = el('span');
  where.id = 'try-it-where';
  if (listed.length > 1) {
    const base = options.scope.split('#')[0];
    const picker = el('select');
    for (const { name } of listed) picker.append(Object.assign(el('option', name), { value: name }));
    picker.value = chosenEnvironment(base)?.name ?? listed[0].name;
    picker.setAttribute('aria-label', 'Environment');
    picker.title = 'Where calls go. Switching reloads the page in the one you pick; each keeps its own records.';
    // The page reloads in the one picked, with its own records, as a portal's switch does.
    picker.onchange = () => {
      chooseEnvironment(base, picker.value);
      try { sessionStorage.setItem(`blueprint-mock-switching:${base}`, '1'); } catch { /* this page only */ }
      location.reload();
    };
    where.append(picker);
  }
  if (scheme) {
    const who = signedIn(options);
    const said = el('span', who ? `Signed in as ${who.name}` : 'Not signed in', 'who');
    const button = Object.assign(el('button', who ? 'Sign out' : 'Sign in'), { type: 'button' });
    button.onclick = async () => {
      if (who) { signOut(options); drawWhere(); return; }
      button.disabled = true;
      try { await signInFromHeader(options); } catch (error) { said.textContent = `Not signed in: ${error.message}.`; }
      drawWhere();
    };
    where.append(said, button);
  }
  toggle.before(where);
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
  if (!panel) {
    document.head.append(Object.assign(el('style'), { textContent: STYLE + HAPPENED_STYLE }));
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
    head.append(el('span', 'Mock server · Activity'), close);
    panel.append(head, el('div', '', 'mp-body'));
    document.body.append(panel, resizeHandle());
  }
  panel.classList.toggle('open', on);
  document.getElementById('mock-panel-resize')?.classList.toggle('open', on);
  drawWhere();
  if (!on) return;
  render();
  if (!host && !own) {
    await startOwn({ seed: true, restore: true });
    render();
  }
}
