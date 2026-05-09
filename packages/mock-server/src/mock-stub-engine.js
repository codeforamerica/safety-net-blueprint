/**
 * Mock stub engine — in-memory registry for pre-programmed event responses.
 *
 * Stubs let developers register expected responses before running a scenario.
 * When a domain event fires, the stub engine scans registered stubs in order
 * (FIFO) and pops the first one whose `on` and `match` criteria fit the event.
 * If no stub matches, the caller falls back to its default behavior.
 *
 * Stubs are ephemeral — cleared on server restart or via DELETE /mock/stubs.
 *
 * See packages/mock-server/mock-rules/README.md for usage patterns.
 */

import { CLOUDEVENTS_TYPE_PREFIX } from './emit-event.js';

/** Ordered list of registered event stubs. */
const stubs = [];

/** Ordered list of registered HTTP stubs. */
const httpStubs = [];

/** Per-event-suffix counters for generating human-readable IDs. */
const idCounters = new Map();

/** Per-URL-segment counters for generating human-readable HTTP stub IDs. */
const httpIdCounters = new Map();

/**
 * Derive a human-readable HTTP stub ID from the match URL.
 * "/evaluate/expedited-screening" → "http.expedited-screening-1"
 */
function nextHttpId(url) {
  const parts = url.replace(/^\/+|\/+$/g, '').split('/');
  const suffix = parts[parts.length - 1] || 'request';
  const key = `http.${suffix}`;
  const n = (httpIdCounters.get(key) ?? 0) + 1;
  httpIdCounters.set(key, n);
  return `${key}-${n}`;
}

/**
 * Derive a human-readable stub ID from the `on` event type.
 * "data_exchange.service_call.created" → "service_call.created-1"
 */
function nextId(on) {
  const short = on.startsWith(CLOUDEVENTS_TYPE_PREFIX)
    ? on.slice(CLOUDEVENTS_TYPE_PREFIX.length)
    : on;
  const parts = short.split('.');
  const prefix = parts.slice(-2).join('.');
  const n = (idCounters.get(prefix) ?? 0) + 1;
  idCounters.set(prefix, n);
  return `${prefix}-${n}`;
}

/**
 * Resolve a dot-path against an object.
 * "data.serviceType" → obj.data.serviceType
 */
function getPath(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

/**
 * Test whether a stub's `on` value matches the given CloudEvents type.
 * Accepts the full type or a short suffix (same logic as eventTypeMatches).
 */
function onMatches(eventType, on) {
  if (!on || !eventType) return false;
  if (eventType === on) return true;
  return eventType === CLOUDEVENTS_TYPE_PREFIX + on;
}

/**
 * Test whether a stub's `match` criteria all match the event envelope.
 * Each key in match is a dot-path into the envelope; each value is the
 * expected value. Omitting `match` (or passing an empty object) matches
 * any event of the matching type.
 */
function matchCriteria(stub, envelope) {
  if (!stub.match || Object.keys(stub.match).length === 0) return true;
  for (const [path, expected] of Object.entries(stub.match)) {
    if (getPath(envelope, path) !== expected) return false;
  }
  return true;
}

/**
 * Register a stub. Returns the stored stub with its assigned ID.
 *
 * @param {Object} stub
 * @param {string} stub.on       - CloudEvents type suffix to match (e.g., "data_exchange.service_call.created")
 * @param {Object} [stub.match]  - Dot-path field matchers against the event envelope (e.g., { "data.serviceType": "fdsh_ssa" })
 * @param {Object} stub.respond  - Event to fire when matched: { type, subject?, source?, data? }
 * @returns {Object} The registered stub with id assigned
 */
export function registerStub(stub) {
  const { on, respond } = stub;
  if (!on || !respond?.type) {
    throw new Error('Stub requires "on" (event type suffix) and "respond.type" (response event type)');
  }
  const registered = { ...stub, id: nextId(on) };
  stubs.push(registered);
  return registered;
}

/**
 * Scan stubs in registration order, find and remove the first one that
 * matches the given event type and envelope fields.
 *
 * @param {string} eventType  - Full CloudEvents type of the triggering event
 * @param {Object} envelope   - The full event envelope (for match field resolution)
 * @returns {Object|null} The matched stub, or null if none matched
 */
export function matchAndPop(eventType, envelope) {
  const idx = stubs.findIndex(s => onMatches(eventType, s.on) && matchCriteria(s, envelope));
  if (idx === -1) return null;
  return stubs.splice(idx, 1)[0];
}

/**
 * Register an HTTP stub. Returns the stored stub with its assigned ID.
 *
 * @param {Object} stub
 * @param {Object} stub.match           - { method?, url } — method defaults to any if omitted
 * @param {string} stub.match.url       - URL path to match exactly (e.g., "/evaluate/expedited-screening")
 * @param {string} [stub.match.method]  - HTTP method (e.g., "POST"); omit to match any method
 * @param {Object} [stub.response]      - { status?, body? } — status defaults to 200
 * @returns {Object} The registered stub with id and type assigned
 */
export function registerHttpStub(stub) {
  if (!stub.match?.url) {
    throw new Error('HTTP stub requires "match.url"');
  }
  const registered = { ...stub, type: 'http', id: nextHttpId(stub.match.url) };
  httpStubs.push(registered);
  return registered;
}

/**
 * Scan HTTP stubs in registration order, find and remove the first one that
 * matches the given method and URL.
 *
 * @param {string} method  - HTTP method (e.g., "POST")
 * @param {string} url     - URL path (e.g., "/evaluate/expedited-screening")
 * @returns {Object|null} The matched stub, or null if none matched
 */
export function matchAndPopHttp(method, url) {
  const idx = httpStubs.findIndex(s => {
    const methodMatch = !s.match.method || s.match.method.toUpperCase() === method.toUpperCase();
    return methodMatch && s.match.url === url;
  });
  if (idx === -1) return null;
  return httpStubs.splice(idx, 1)[0];
}

/**
 * Return a snapshot of all registered stubs (both event and HTTP).
 */
export function listStubs() {
  return [...stubs, ...httpStubs];
}

/**
 * Remove a specific stub by ID (searches both event and HTTP registries).
 * @returns {boolean} true if found and removed, false if not found
 */
export function removeStub(id) {
  let idx = stubs.findIndex(s => s.id === id);
  if (idx !== -1) { stubs.splice(idx, 1); return true; }
  idx = httpStubs.findIndex(s => s.id === id);
  if (idx !== -1) { httpStubs.splice(idx, 1); return true; }
  return false;
}

/**
 * Remove all registered stubs (both event and HTTP) and reset ID counters.
 */
export function clearStubs() {
  stubs.length = 0;
  httpStubs.length = 0;
  idCounters.clear();
  httpIdCounters.clear();
}
