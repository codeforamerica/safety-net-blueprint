/**
 * Mock stub engine — in-memory registry for pre-programmed event responses.
 *
 * Stubs let developers register expected responses before running a scenario.
 * When a domain event fires, the stub engine scans registered stubs in order
 * (FIFO) and pops the first one whose `on` and `match` criteria fit the event.
 * If no stub matches, the caller falls back to its default behavior.
 *
 * Stubs are ephemeral — cleared on server restart or via DELETE /mock/stubs/events.
 *
 * See packages/mock-server/mock-rules/README.md for usage patterns.
 */

import { CLOUDEVENTS_TYPE_PREFIX } from './emit-event.js';

/** Ordered list of registered stubs. */
const stubs = [];

/** Per-event-suffix counters for generating human-readable IDs. */
const idCounters = new Map();

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
 * Return a snapshot of all registered stubs.
 */
export function listStubs() {
  return [...stubs];
}

/**
 * Remove a specific stub by ID.
 * @returns {boolean} true if found and removed, false if not found
 */
export function removeStub(id) {
  const idx = stubs.findIndex(s => s.id === id);
  if (idx === -1) return false;
  stubs.splice(idx, 1);
  return true;
}

/**
 * Remove all registered stubs and reset ID counters.
 */
export function clearStubs() {
  stubs.length = 0;
  idCounters.clear();
}
