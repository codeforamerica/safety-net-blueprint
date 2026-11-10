/**
 * Events from the services routing sends to, for the reactions that run here.
 *
 * Routing sends a request to whoever answers it, and an event a routed domain
 * receives to them too (routing.js). This is the other way: when a state
 * machine here reacts to an event a routed API sends — the session in a page
 * following its transcript on the server — the mock reads that service's
 * events and handles each as `POST /platform/events` would.
 *
 * It reads them the ways the platform contract offers
 * (platform-events-openapi.yaml): the event stream first, reconnecting with
 * `Last-Event-ID` so nothing is missed, and polling the event log when the
 * service has no stream. One reader per service, however many events it
 * gives. An event the mock already has — one it sent there itself — is
 * skipped, and one that arrives isn't delivered back where it came from.
 */

import { createParser } from 'eventsource-parser';
import { emitEventEnvelope } from './emit-event.js';

const STREAM = '/platform/events/stream';
const LIST = '/platform/events';
const RETRY_MS = [1000, 2000, 5000, 10000, 30000];
const POLL_MS = 3000;

const ARRIVALS_KEPT = 1000;

/**
 * The routing entry an event arrived through, if it did. A mock remembers the
 * ids of events that arrived from a service, and the entry they came through
 * (`instance.arrivals`), so its dispatcher doesn't deliver them back to it.
 *
 * @param {{ arrivals: Map<string, object> }} instance
 * @param {object} event
 */
export function arrivedThrough(instance, event) {
  return instance.arrivals.get(event?.id) ?? null;
}

/**
 * What to read from where: for each routing entry, the event types it sends
 * that a machine here reacts to.
 *
 * @param {object[]} stateMachines
 * @param {Array<{ api: string, event: string, entry: object }>} sends - routed send operations (planRouting)
 * @param {Array<{ api: string, event: string }>} receives - routed receive operations
 * @param {Map<string, string>} apiOfFile
 * @returns {Map<object, Set<string>>}
 */
export function eventsToFollow(stateMachines, sends, receives, apiOfFile) {
  const wanted = new Map();
  for (const smEntry of stateMachines) {
    const api = apiOfFile.get(smEntry.api?.relativePath);
    for (const on of smEntry.machine?.on ?? []) {
      // A reaction whose receive is routed runs over there, not here.
      if (receives.some((receive) => receive.api === api && receive.event === on.type)) continue;
      for (const send of sends) {
        if (send.event !== on.type) continue;
        if (!wanted.has(send.entry)) wanted.set(send.entry, new Set());
        wanted.get(send.entry).add(on.type);
      }
    }
  }
  return wanted;
}

/** One filter covering the types: the type itself, or the prefix they share. */
function typeFilter(types) {
  if (types.length === 1) return types[0];
  const parts = types.map((type) => type.split('.'));
  const shared = [];
  for (let i = 0; parts.every((p) => i < p.length - 1 && p[i] === parts[0][i]); i += 1) shared.push(parts[0][i]);
  return shared.length ? `${shared.join('.')}.*` : null;
}

/**
 * Start reading. Each service is read until `stop`.
 *
 * @param {Map<object, Set<string>>} wanted - from eventsToFollow
 * @param {{ instance: object }} deps - The mock the events arrive in (instance.js)
 * @returns {{ stop: () => void }}
 */
export function followRoutedEvents(wanted, { instance }) {
  const controller = new AbortController();
  for (const [entry, types] of wanted) follow(entry, [...types], instance, controller.signal);
  return { stop: () => controller.abort() };
}

function follow(entry, types, instance, signal) {
  const { store, arrivals } = instance;
  const filter = typeFilter(types);
  const query = filter ? `?type=${encodeURIComponent(filter)}` : '';
  const send = (path, headers = {}) => {
    const request = new Request(`${(entry.to ?? 'http://handler.invalid').replace(/\/$/, '')}${path}`, { headers, signal });
    return entry.handler ? entry.handler(request) : fetch(request, { redirect: 'manual' });
  };
  const where = entry.to ?? 'the routing handler';
  console.log(`  EVENTS ${types.join(', ')} from ${where}`);
  let lastId = null;
  let lastTime = null;
  let failures = 0;

  const arrive = (event) => {
    if (!event?.id || !types.includes(event.type)) return;
    lastId = event.id;
    lastTime = event.time ?? lastTime;
    if (store.findById('events', event.id)) return;
    arrivals.set(event.id, entry);
    if (arrivals.size > ARRIVALS_KEPT) arrivals.delete(arrivals.keys().next().value);
    emitEventEnvelope(event, instance);
  };

  const wait = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

  async function stream() {
    const response = await send(`${STREAM}${query}`, {
      accept: 'text/event-stream',
      ...(lastId && { 'last-event-id': lastId }),
    });
    if (response.status === 410) {
      console.warn(`Events from ${where}: the log no longer has event ${lastId}, so some may have been missed; reading from now.`);
      lastId = null;
      return 'again';
    }
    // No stream here: the event log, polled, is the other way the contract offers.
    if ([404, 405, 501].includes(response.status)) {
      await response.body?.cancel();
      return 'poll';
    }
    // An answer that isn't a stream is a mistake, as EventSource treats it.
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
      await response.body?.cancel();
      throw new Error(`answered ${response.status}${response.ok ? ', not with an event stream' : ''}`);
    }
    failures = 0;
    const parser = createParser({
      onEvent: ({ data }) => {
        try { arrive(JSON.parse(data)); } catch { /* not an event */ }
      },
    });
    const decoder = new TextDecoder();
    for await (const chunk of response.body) parser.feed(decoder.decode(chunk, { stream: true }));
    return 'again';
  }

  async function poll() {
    const params = new URLSearchParams({ limit: '100' });
    if (filter) params.set('type', filter);
    if (lastTime) params.set('start', lastTime);
    const response = await send(`${LIST}?${params}`);
    if (!response.ok) throw new Error(`answered ${response.status}`);
    failures = 0;
    for (const event of (await response.json()).items ?? []) arrive(event);
  }

  (async () => {
    let mode = 'stream';
    while (!signal.aborted) {
      try {
        if (mode === 'stream') {
          if ((await stream()) === 'poll') mode = 'poll';
          // A stream that ended is opened again after a moment, as EventSource does.
          else await wait(RETRY_MS[0]);
        } else {
          await poll();
          await wait(POLL_MS);
        }
      } catch (error) {
        if (signal.aborted) return;
        if (failures === 0) console.warn(`Events from ${where}: ${error.message}; trying again.`);
        await wait(RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
        failures += 1;
      }
    }
  })();
}
