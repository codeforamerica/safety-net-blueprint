/**
 * Mock stub engine — in-memory registry for pre-programmed event responses.
 *
 * Stubs let developers register expected responses before running a scenario.
 * When a domain event fires, the stub engine scans registered stubs in order
 * (FIFO) and pops the first one whose `on` and `match` criteria fit the event.
 *
 * Two stub formats are supported:
 * - General: `{ on, match?, response: { type, subject?, source?, data? } }` — fires
 *   the specified response event when the stub matches.
 * - Timer: `{ on: "platform.timer.requested", match? }` — fires the callback
 *   event embedded in the triggering event's `data.callback` envelope. `response`
 *   is not needed; the callback type and data come from the event itself.
 *
 * Stubs are ephemeral — cleared on server restart or via DELETE /mock/stubs/events.
 * Each mock has its own (instance.js), so a stub registered on one never
 * answers another in the same page or process.
 *
 * See docs/guides/mock-server.md for usage patterns.
 */

import { emitEventEnvelope } from './emit-event.js';
import { resolveTimeTokens } from './time-tokens.js';
import { resolveDotPath, toCamelCase } from './collection-utils.js';
import { assertValid, dotted } from './mock-schemas.js';
import schema from '../schemas/stubs-schema.json' with { type: 'json' };

const TIMER_REQUESTED = 'platform.timer.requested';

/**
 * Derive a human-readable HTTP stub ID from the match URL.
 * "/evaluate/expedited-screening" → "http.expedited-screening-1"
 */
function nextHttpId(httpIdCounters, url) {
  const parts = url.replace(/^\/+|\/+$/g, '').split('/');
  const suffix = parts[parts.length - 1] || 'request';
  const key = `http.${suffix}`;
  const n = (httpIdCounters.get(key) ?? 0) + 1;
  httpIdCounters.set(key, n);
  return `${key}-${n}`;
}

/**
 * Derive a human-readable stub ID from the `on` event type.
 * "data-exchange.external_service_call.created" → "external_service_call.created-1"
 */
function nextId(idCounters, on) {
  const parts = (on || '').split('.');
  const prefix = parts.slice(-2).join('.');
  const n = (idCounters.get(prefix) ?? 0) + 1;
  idCounters.set(prefix, n);
  return `${prefix}-${n}`;
}


/**
 * Test whether a stub's `on` value matches the given CloudEvents type.
 */
function onMatches(eventType, on) {
  if (!on || !eventType) return false;
  return eventType === on;
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
    if (resolveDotPath(envelope, path) !== expected) return false;
  }
  return true;
}

/**
 * One mock's stubs, event and HTTP, each in the order they were registered.
 */
export function createStubs() {
  /** Ordered list of registered event stubs. */
  const stubs = [];

  /** Ordered list of registered HTTP stubs. */
  const httpStubs = [];

  /** Per-event-suffix counters for generating human-readable IDs. */
  const idCounters = new Map();

  /** Per-URL-segment counters for generating human-readable HTTP stub IDs. */
  const httpIdCounters = new Map();

  /**
   * Register a stub. Returns the stored stub with its assigned ID.
   *
   * @param {Object} stub
   * @param {string} stub.on       - CloudEvents type suffix to match (e.g., "data-exchange.external_service_call.created")
   * @param {Object} [stub.match]  - Dot-path field matchers against the event envelope
   * @param {Object} [stub.response] - Event to fire when matched: { type, subject?, source?, data? }.
   *   Omit for platform.timer.requested stubs — the callback is read from the event.
   * @returns {Object} The registered stub with id assigned
   */
  function registerStub(stub) {
    // Checked against the schema rather than spread in as it comes. An
    // unrecognised key used to be kept and silently do nothing, which is how a
    // stub could register, list, and then never fire.
    assertValid(schema.definitions.EventStub, stub, (pointer) => ['Event stub', dotted(pointer)]);
    const registered = { ...stub, id: nextId(idCounters, stub.on) };
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
  function matchAndPop(eventType, envelope) {
    const idx = stubs.findIndex(s => onMatches(eventType, s.on) && matchCriteria(s, envelope));
    if (idx === -1) return null;
    return stubs.splice(idx, 1)[0];
  }

  /**
   * Resolve a stub's effective match URL.
   * If `domain` is set, the effective URL is `/<domain><url>` (e.g., `/eligibility-adapter/evaluate/expedited-screening`).
   * Otherwise `url` is matched as-is against the full request path.
   */
  function resolveStubUrl(stub) {
    const { url, domain } = stub.match;
    return domain ? `/${domain}${url}` : url;
  }

  /**
   * Register an HTTP stub. Returns the stored stub with its assigned ID.
   *
   * @param {Object} stub
   * @param {Object} stub.match            - { method?, url, domain? }
   * @param {string} stub.match.url        - Path to match. With `domain`, this is relative to the domain
   *   (e.g., "/evaluate/expedited-screening"). Without `domain`, it is the full request path
   *   (e.g., "/eligibility-adapter/evaluate/expedited-screening").
   * @param {string} [stub.match.domain]   - Domain prefix (e.g., "eligibility-adapter"). When set, the
   *   effective match path is `/<domain><url>`, scoping the stub to a specific API domain.
   * @param {string} [stub.match.method]   - HTTP method (e.g., "POST"); omit to match any method
   * @param {Object} [stub.response]       - { status?, body? } — status defaults to 200. Optional:
   *   a stub intercepting a procedure's create only needs to match, and its response is never read.
   * @returns {Object} The registered stub with id and type assigned
   */
  function registerHttpStub(stub) {
    assertValid(schema.definitions.HttpStub, stub, (pointer) => ['HTTP stub', dotted(pointer)]);
    const registered = { ...stub, type: 'http', id: nextHttpId(httpIdCounters, stub.match.url) };
    httpStubs.push(registered);
    return registered;
  }

  /**
   * Scan HTTP stubs in registration order, find and remove the first one that
   * matches the given method and full request path.
   *
   * A stub matches when:
   *   - method matches (or stub has no method restriction)
   *   - effective stub URL matches `requestPath`:
   *       - if stub has `domain`: `/<domain><url>` must equal `requestPath`
   *       - otherwise: `url` must equal `requestPath`
   *
   * @param {string} method       - HTTP method (e.g., "POST")
   * @param {string} requestPath  - Full request path (e.g., "/eligibility-adapter/evaluate/expedited-screening")
   * @returns {Object|null} The matched stub, or null if none matched
   */
  function matchAndPopHttp(method, requestPath) {
    const idx = httpStubs.findIndex(s => {
      const methodMatch = !s.match.method || s.match.method.toUpperCase() === method.toUpperCase();
      return methodMatch && resolveStubUrl(s) === requestPath;
    });
    if (idx === -1) return null;
    return httpStubs.splice(idx, 1)[0];
  }

  /**
   * Return a snapshot of registered event stubs.
   */
  function listStubs() {
    return [...stubs];
  }

  /**
   * Return a snapshot of registered HTTP stubs.
   */
  function listHttpStubs() {
    return [...httpStubs];
  }

  /**
   * Remove a specific stub by ID (searches event registry only).
   * @returns {boolean} true if found and removed, false if not found
   */
  function removeStub(id) {
    const idx = stubs.findIndex(s => s.id === id);
    if (idx !== -1) { stubs.splice(idx, 1); return true; }
    return false;
  }

  /**
   * Remove a specific HTTP stub by ID.
   * @returns {boolean} true if found and removed, false if not found
   */
  function removeHttpStub(id) {
    const idx = httpStubs.findIndex(s => s.id === id);
    if (idx !== -1) { httpStubs.splice(idx, 1); return true; }
    return false;
  }

  /**
   * Remove all registered event stubs and reset event ID counters.
   */
  function clearStubs() {
    stubs.length = 0;
    idCounters.clear();
  }

  /**
   * Remove all registered HTTP stubs and reset HTTP ID counters.
   */
  function clearHttpStubs() {
    httpStubs.length = 0;
    httpIdCounters.clear();
  }

  /**
   * Remove all registered stubs (both event and HTTP). Used by mock/reset.
   */
  function clearAllStubs() {
    stubs.length = 0;
    httpStubs.length = 0;
    idCounters.clear();
    httpIdCounters.clear();
  }

  return {
    registerStub, matchAndPop, registerHttpStub, matchAndPopHttp,
    listStubs, listHttpStubs, removeStub, removeHttpStub,
    clearStubs, clearHttpStubs, clearAllStubs,
  };
}

/**
 * Fire the appropriate response for a matched stub.
 *
 * For platform.timer.requested: fires the callback event embedded in
 * the trigger event's data.callback envelope.
 *
 * For all other events: fires the stub's response event, merging trigger
 * data with stub-specified overrides.
 */
function dispatchStubResponse(stub, envelope, instance) {
  const eventType = envelope.type || '';

  if (eventType === TIMER_REQUESTED) {
    const callbackEvent = envelope.data?.callback?.event;
    const callbackData = envelope.data?.callback?.data ?? null;
    if (!callbackEvent) {
      console.warn(`[stub] matched ${stub.id} — platform.timer.requested missing callback.event`);
      return;
    }
    const timerId = envelope.data?.timerId;
    const firedData = {
      ...(callbackData && typeof callbackData === 'object' ? callbackData : {}),
      timerId,
    };
    emitEventEnvelope({
      type: callbackEvent,
      source: '/scheduler',
      subject: envelope.subject,
      traceparent: envelope.traceparent,
      causationid: envelope.id,
      data: firedData,
    }, instance);
    console.log(`[stub] matched ${stub.id} → fired ${callbackEvent} (timer callback)`);
    return;
  }

  if (!stub.response?.type) return;

  const { type, subject, source, data: rawStubData } = stub.response;
  const stubData = rawStubData ? resolveTimeTokens(rawStubData) : rawStubData;
  const fullType = type;

  // Derive entity ID field name from trigger event type.
  // "data-exchange.external_service_call.created" → "externalServiceCallId"
  const parts = eventType.split('.');
  const entitySnake = parts.length >= 2 ? parts[parts.length - 2] : '';
  const entityCamel = toCamelCase(entitySnake);
  const entityIdField = entityCamel ? entityCamel + 'Id' : null;

  // Merge: derived ID → trigger data → stub overrides
  const triggerData = (envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data))
    ? envelope.data : {};
  const resolvedData = {
    ...(entityIdField ? { [entityIdField]: envelope.subject } : {}),
    ...triggerData,
    ...(stubData && typeof stubData === 'object' && !Array.isArray(stubData) ? stubData : {}),
  };

  emitEventEnvelope({
    type: fullType,
    source: source || '/system',
    subject: subject !== undefined ? subject : envelope.subject,
    traceparent: envelope.traceparent,
    causationid: envelope.id,
    data: Object.keys(resolvedData).length > 0 ? resolvedData : null,
  }, instance);
  console.log(`[stub] matched ${stub.id} → fired ${fullType}`);
}

/**
 * Start dispatching a mock's stub responses for its domain events.
 *
 * Called at startup rather than subscribed on import, because dispatching a
 * stub emits an event and emitting writes through a store — so the listener
 * needs one, and a module-load side effect has nothing to be given.
 *
 * @param {object} instance - The mock (instance.js): its stubs answer events on its bus
 * @returns {() => void} Unsubscribe, for tests that need a clean bus.
 */
export function subscribeStubDispatch(instance) {
  const listener = (envelope) => {
    const stub = instance.stubs.matchAndPop(envelope.type, envelope);
    if (stub) dispatchStubResponse(stub, envelope, instance);
  };
  instance.bus.on('domain-event', listener);
  return () => instance.bus.off('domain-event', listener);
}
