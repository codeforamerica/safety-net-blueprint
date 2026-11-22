/**
 * What was sent to the mock in this browser tab, for the control panel's
 * activity log: each request Try it sent, with its response and the events
 * it set off, and each connection it opened to an API reached over a
 * WebSocket, with the messages each way and how it closed. The events themselves are the mock's own, read from its event
 * log; a request keeps only their ids, and the events that followed from
 * them are found by their causes (event-trail.js, followedFrom).
 *
 * Kept for the tab, as the records are (records.js), and forgotten on a
 * reload by the same name (lib/control-panel.js). Clear empties it, and hides
 * the events from before it.
 */

const keyFor = (scope) => `blueprint-mock-activity:${scope}`;

/** How many requests are kept: the oldest go first. */
const KEPT = 200;

/**
 * The tab's activity: the requests sent, oldest first, and when it was last
 * cleared, before which no event is shown.
 *
 * @param {{ scope: string }} where
 * @returns {{ requests: object[], clearedAt: string|null }}
 */
export function activityOf({ scope }) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(keyFor(scope)) ?? 'null');
    if (saved && Array.isArray(saved.requests)) return saved;
  } catch { /* nothing kept */ }
  return { requests: [], clearedAt: null };
}

const keep = ({ scope }, activity) => {
  try { sessionStorage.setItem(keyFor(scope), JSON.stringify(activity)); } catch { /* this page only */ }
};

/**
 * Log a request Try it sent.
 *
 * @param {{ scope: string }} where
 * @param {{ time: string, method: string, path: string, body?: string, status: number|null, ok: boolean, ms?: number,
 *   shown?: string, error?: string, eventIds?: string[] }} request - When it was sent; the request; its
 *   response, or why there was none; and the events it set off
 */
export function logRequest(where, request) {
  const activity = activityOf(where);
  activity.requests = [...activity.requests, request].slice(-KEPT);
  keep(where, activity);
}

/** A logged entry by when it began, which names it, and the log it's in. */
const entryAt = (where, time) => {
  const activity = activityOf(where);
  return { activity, entry: activity.requests.find((entry) => entry.kind === 'socket' && entry.time === time) };
};

/**
 * Log a connection Try it opened, and return when, which names it for its
 * messages and its close.
 *
 * @param {{ scope: string }} where
 * @param {{ url: string, protocols?: string[] }} connection
 * @returns {string}
 */
export function logConnection(where, { url, protocols = [] }) {
  const time = new Date().toISOString();
  const activity = activityOf(where);
  activity.requests = [...activity.requests, { kind: 'socket', time, method: 'WS', path: url, protocols, messages: [], close: null }].slice(-KEPT);
  keep(where, activity);
  return time;
}

/**
 * Log a message on a connection: sent (↑) or received (↓), by its name, with
 * its payload, or for binary frames, what they were.
 *
 * @param {{ scope: string }} where
 * @param {string} time - The connection's, as logConnection gave it
 * @param {{ sent: boolean, name: string, payload?: unknown, said?: string }} message
 */
export function logMessage(where, time, message) {
  const { activity, entry } = entryAt(where, time);
  if (!entry) return;
  entry.messages.push({ time: new Date().toISOString(), ...message });
  keep(where, activity);
}

/** Log how a connection closed: its code and reason. */
export function logClose(where, time, { code, reason = '' }) {
  const { activity, entry } = entryAt(where, time);
  if (!entry) return;
  entry.close = { code, reason };
  keep(where, activity);
}

/** Empty the log: its requests, and the events from before now. */
export function clearActivity(where) {
  keep(where, { requests: [], clearedAt: new Date().toISOString() });
}
