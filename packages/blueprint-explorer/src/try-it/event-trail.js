/**
 * What happened: the events something set off, as the mock logged them.
 *
 * An API reference page shows it under a call it sent (send-panel.js). Each
 * event names its subscribers, the state machines subscribed to it, linked to
 * that machine's subscription row; then the timers asked for that haven't
 * fired.
 */

import { subscriptionAnchor, titleCase } from '../lib/html.js';

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  if (text !== '') node.textContent = text;
  if (className) node.className = className;
  return node;
};

export const HAPPENED_STYLE = `
  .happened { margin-top: 10px; font: 11.5px monospace; }
  .happened .happened-title { font: 700 12px system-ui, sans-serif; color: #333; margin-bottom: 4px; }
  .happened .happened-event { white-space: pre-wrap; word-break: break-all; line-height: 1.6; }
  .happened details.happened-event > summary { cursor: pointer; list-style: none; }
  .happened details.happened-event > summary::-webkit-details-marker { display: none; }
  .happened .happened-type { color: #5650BE; }
  .happened details.happened-event > summary:hover .happened-type { text-decoration: underline; }
  .happened details.happened-event[open] > summary .happened-type { font-weight: 700; }
  .happened pre.happened-body { margin: 4px 0 6px; padding: 8px 10px; background: #fff; border: 1px solid #eee; border-radius: 4px; max-height: 18rem; overflow: auto; white-space: pre-wrap; font-size: 11px; }
  .happened .happened-branch, .happened .happened-subject { color: #888; }
  .happened .happened-subscribers { font: 11px system-ui, sans-serif; color: #888; margin: 0 0 4px; }
  .happened .happened-subscribers a { color: #5650BE; }
  .happened .happened-heading { font: 700 11px system-ui, sans-serif; color: #666; margin-top: 8px; }
  .happened .happened-none, .happened .happened-note { font: 12px system-ui, sans-serif; color: #666; margin-top: 4px; }
  .happened .happened-note a, .happened a.happened-type { color: #5650BE; }
  .happened .happened-waiting { display: flex; align-items: baseline; gap: 4px; }
  .happened .happened-fire { margin-left: auto; font: 600 11px system-ui, sans-serif; padding: 1px 10px; border-radius: 3px; border: 1px solid #2B1A78; background: #fff; color: #2B1A78; cursor: pointer; flex: none; white-space: nowrap; }
  /* With Fire: the event and Fire on one line, when it fires on the next. */
  .happened .happened-firable { flex-wrap: wrap; margin-bottom: 6px; }
  .happened .happened-firable > span:first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .happened .happened-firable > .happened-subject { order: 1; flex-basis: 100%; white-space: normal; }
  .happened .happened-fire:disabled { opacity: .5; cursor: default; }
`;

/** A timer's wait as written: an ISO 8601 duration (PT72H), or an amount and a unit. */
const durationText = (value) => (value && typeof value === 'object' ? `${value.amount} ${value.unit}` : String(value));

/** Whether an event type is a timer request, behind any bus namespace. */
const isTimerRequest = (type) => type === 'platform.timer.requested' || type.endsWith('.platform.timer.requested');

/**
 * Where events lead, from the contract set: the subscribers to each type —
 * the state machines subscribed to it, or for a timer request or
 * cancellation, the timer service.
 *
 * @param {object[]} docs - From `extract(contracts, 'docs')`
 * @param {string} scope - The mock's folder; the explorer's pages are beside it
 */
export function trailFor(docs, scope) {
  const subscribers = new Map();
  for (const doc of docs) {
    const domain = doc.content?.domain;
    for (const machine of Array.isArray(doc.content?.machines) ? doc.content.machines : []) {
      for (const sub of machine.on ?? []) {
        if (!subscribers.has(sub.type)) subscribers.set(sub.type, []);
        subscribers.get(sub.type).push({
          label: `${titleCase(domain)} › ${machine.object}`,
          href: `${new URL(`../state-machine-docs/${domain}.html`, scope).href}#${subscriptionAnchor(machine.object, sub.type)}`,
        });
      }
    }
  }
  const timerService = [{ label: 'the timer service' }];
  return {
    subscribersOf: (type) => subscribers.get(type) ?? (/(^|\.)platform\.timer\.(requested|cancelled)$/.test(type) ? timerService : []),
  };
}

/**
 * The events among `events` caused, directly or down a chain, by one of
 * `ids`, in their order. Events logged in the same millisecond may come in
 * any order, a reaction before its cause, so this goes round until nothing
 * more joins.
 *
 * @param {Iterable<string>} ids - Event ids already known
 * @param {object[]} events
 * @returns {object[]}
 */
export function followedFrom(ids, events) {
  const known = new Set(ids);
  const found = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const event of events) {
      if (known.has(event.id) || !known.has(event.causationid)) continue;
      known.add(event.id);
      found.push(event);
      grew = true;
    }
  }
  return events.filter((event) => found.includes(event));
}

/**
 * Events, each nested under the one that caused it (its `causationid`),
 * opening to the event as it was published, with the machines subscribed to
 * it.
 *
 * @param {object[]} events - Oldest first
 * @param {{ trail: ReturnType<typeof trailFor>, shown?: string, newestFirst?: boolean }} where - Where
 *   events lead; the id of an event already shown in full above, as the
 *   response to publishing it; and whether the latest comes first, as in a
 *   log, rather than in the order they happened
 * @returns {HTMLElement[]}
 */
export const eventLines = (events, { trail, shown, newestFirst = false }) => {
  const ids = new Set(events.map((event) => event.id));
  const childrenOf = new Map();
  for (const event of events) {
    const parent = ids.has(event.causationid) ? event.causationid : null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(event);
  }
  const lines = [];
  // Each event opens to itself, as the mock published it, and names its subscribers.
  const line = (event, depth) => {
    const above = event.id === shown;
    const row = el(above ? 'div' : 'details', '', 'happened-event');
    row.dataset.event = event.id;
    row.style.paddingLeft = `${depth * 16}px`;
    const summary = el(above ? 'span' : 'summary');
    // Shown above, it doesn't open, so it isn't colored as though it would.
    summary.append(el('span', depth ? '└ ' : '', 'happened-branch'), el('span', event.type, above ? '' : 'happened-type'),
      el('span', above ? '  the event sent, shown above' : event.subject ? `  ${event.subject}` : '', 'happened-subject'));
    row.append(summary);
    if (!above) row.append(el('pre', JSON.stringify(event, null, 2), 'happened-body'));
    const subscribers = trail.subscribersOf(event.type);
    const listed = el('div', `Subscribers: ${subscribers.length ? '' : 'none'}`, 'happened-subscribers');
    listed.style.paddingLeft = `${depth * 16 + (depth ? 16 : 0)}px`;
    subscribers.forEach((subscriber, i) => {
      if (i) listed.append(', ');
      listed.append(subscriber.href
        ? Object.assign(el('a', subscriber.label), { href: subscriber.href })
        : subscriber.label);
    });
    lines.push(row, listed);
  };
  const walk = (parent, depth) => {
    const children = childrenOf.get(parent) ?? [];
    for (const event of depth === 0 && newestFirst ? [...children].reverse() : children) {
      line(event, depth);
      walk(event.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines;
};

/**
 * The timers asked for among `events` that are still waiting: each timer's
 * latest request, unless its callback or a cancellation came after it.
 *
 * @param {object[]} events - Oldest first
 * @returns {object[]} The requests, as `platform.timer.requested` events
 */
export const waitingTimers = (events) => {
  const waiting = new Map();
  for (const event of events) {
    const timerId = event.data?.timerId;
    if (!timerId) continue;
    if (isTimerRequest(event.type)) waiting.set(timerId, event);
    else if (event.type.endsWith('platform.timer.cancelled') || event.type === waiting.get(timerId)?.data?.callback?.event) {
      waiting.delete(timerId);
    }
  }
  return [...waiting.values()];
};

/**
 * A line for each waiting timer: what it will send and when.
 *
 * @param {object[]} requests - From waitingTimers
 * @param {{ fire?: (request: object) => void }} [options] - Given, each has a
 *   Fire button, which calls it
 * @returns {HTMLElement[]}
 */
export const waitingLines = (requests, { fire } = {}) => requests.map((request) => {
  const { callback, fireAfter, fireAt } = request.data ?? {};
  const row = el('div', '', 'happened-event happened-waiting');
  row.append(el('span', callback?.event ?? 'a timer'),
    el('span', `  from the timer service, ${fireAt ? `at ${fireAt}` : fireAfter ? `after ${durationText(fireAfter)}` : 'later'}`, 'happened-subject'));
  if (fire) {
    const button = Object.assign(el('button', 'Fire', 'happened-fire'), { type: 'button' });
    button.onclick = () => { button.disabled = true; fire(request); };
    row.append(button);
    row.classList.add('happened-firable');
  }
  return row;
});

/**
 * The events something set off, nested by cause, then the timers asked for
 * that haven't fired.
 *
 * @param {object[]} events - Oldest first
 * @param {{ trail: ReturnType<typeof trailFor>, shown?: string }} where - Where
 *   events lead, and the id of an event already shown in full above, as the
 *   response to publishing it
 * @returns {HTMLElement}
 */
export const whatHappened = (events, { trail, shown }) => {
  const box = el('div', '', 'happened');
  box.append(el('div', 'What happened', 'happened-title'));
  if (!events.length) {
    box.append(el('div', 'No events: nothing others are told about changed.', 'happened-none'));
    return box;
  }
  box.append(...eventLines(events, { trail, shown }));
  const waiting = waitingTimers(events);
  if (waiting.length) box.append(el('div', 'Waiting', 'happened-heading'), ...waitingLines(waiting));
  return box;
};
