/**
 * Shared utility for emitting CloudEvents 1.0 domain events.
 *
 * Constructs the CloudEvents envelope, persists it to the shared events
 * collection, and broadcasts it over the SSE event bus.
 *
 * Event type follows the convention:
 *   {domain}.{object}.{action}
 */

import { eventBus } from './event-bus.js';

/**
 * Emit a pre-built CloudEvents 1.0 envelope directly to the event bus.
 * Used by POST /platform/events to inject externally-sourced domain events
 * (e.g., events from other domains during integration testing).
 *
 * Unlike emitEvent (which constructs the type from domain/object/action),
 * this function stores the envelope as-is, preserving the caller-supplied id
 * so injected events can be correlated with external systems.
 *
 * @param {Object} envelope - CloudEvents 1.0 object with at minimum `type` and `specversion`
 * @returns {Object} The stored event record
 */
export function emitEventEnvelope(envelope, store) {
  const record = withoutAbsent({
    specversion: '1.0',
    datacontenttype: 'application/json',
    ...envelope,
    id: envelope.id || crypto.randomUUID(),
    time: envelope.time || new Date().toISOString(),
  });
  // Infrastructure events (scheduling, etc.) are broadcast for stub interception
  // but not persisted — they are not domain events observable via /platform/events.
  const isInfrastructureEvent = record.type?.startsWith('scheduling.');
  if (!isInfrastructureEvent) {
    saveEvent(store, record);
  }
  eventBus.emit('domain-event', record);
  return record;
}

/**
 * Save an event as it is. An event is a record of something that happened, not
 * a resource, so the store adds no id and no timestamps of its own. A store
 * written before `append` existed falls back to `insertResource`, whose events
 * keep the timestamps it adds.
 */
function saveEvent(store, record) {
  if (typeof store.append === 'function') store.append('events', record);
  else store.insertResource('events', record);
}

// The optional CloudEvents attributes, which the events contract has an event
// leave out when it has no value for them rather than carry as null.
const OPTIONAL_ATTRIBUTES = ['traceparent', 'causationid', 'authid', 'authtype', 'data'];

function withoutAbsent(envelope) {
  const out = { ...envelope };
  for (const name of OPTIONAL_ATTRIBUTES) {
    if (out[name] === null || out[name] === undefined) delete out[name];
  }
  return out;
}

// Roles that map to a non-user authtype value.
const NON_USER_AUTHTYPES = new Set(['system', 'service_account', 'api_key', 'unauthenticated', 'unknown']);

/**
 * The CloudEvents auth context for a caller: who acted, and what kind of actor
 * they are. The kind comes from a role naming one; a caller with none is a user,
 * except the mock's own `system` caller. Empty when there is no caller, since
 * the events contract requires `authtype` whenever `authid` is present.
 *
 * @param {string|null} callerId
 * @param {string[]} [callerRoles]
 * @returns {{ authid?: string, authtype?: string }}
 */
export function authContext(callerId, callerRoles = []) {
  if (!callerId) return {};
  const named = (callerRoles || []).find(role => NON_USER_AUTHTYPES.has(role));
  return { authid: callerId, authtype: named ?? (callerId === 'system' ? 'system' : 'user') };
}

/**
 * Emit a domain event.
 *
 * @param {Object} options
 * @param {string} options.domain        - Domain name (e.g., 'workflow')
 * @param {string} options.object        - Object name, singular lowercase (e.g., 'task')
 * @param {string} options.action        - Action verb (e.g., 'created', 'claimed')
 * @param {string} options.resourceId    - UUID of the affected resource
 * @param {string} options.source        - Domain base path (e.g., '/workflow')
 * @param {Object|null} [options.data]   - Event payload. Left out when null.
 * @param {string|null} [options.callerId]     - X-Caller-Id from request header
 * @param {string[]}    [options.callerRoles]  - X-Caller-Roles parsed array (used to derive authtype)
 * @param {string|null} [options.traceparent]  - W3C traceparent header, if present
 * @param {string|null} [options.causationid]  - CloudEvents causation extension: id of the triggering event
 * @param {string|null} [options.now]    - ISO timestamp. Defaults to current time.
 * @returns {Object} The stored event record
 */
export function emitEvent({ domain, object, action, resourceId, subject, source, data = null, callerId = null, callerRoles = [], traceparent = null, causationid = null, now = null, store }) {
  const timestamp = now || new Date().toISOString();
  const normalizedDomain = domain.replace(/-/g, '_');
  const normalizedObject = object.replace(/-/g, '_');
  // An empty domain would produce ".application.created" — a CloudEvents type
  // with a leading dot and no domain, which nothing can subscribe to. A spec
  // declaring no localhost server URL has no domain prefix to contribute, so
  // the segment is left out rather than emitted empty (#448).
  const type = [normalizedDomain, normalizedObject, action].filter(Boolean).join('.');

  const envelope = withoutAbsent({
    specversion: '1.0',
    id: crypto.randomUUID(),
    type,
    source: source || `/${domain}`,
    subject: subject ?? resourceId,
    time: timestamp,
    datacontenttype: 'application/json',
    traceparent,
    causationid,
    ...authContext(callerId, callerRoles),
    data,
  });

  saveEvent(store, envelope);
  eventBus.emit('domain-event', envelope);
  return envelope;
}
