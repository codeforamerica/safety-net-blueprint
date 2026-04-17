/**
 * Shared utility for emitting CloudEvents 1.0 domain events.
 *
 * Constructs the CloudEvents envelope, persists it to the shared events
 * collection, and broadcasts it over the SSE event bus.
 *
 * Event type follows the convention:
 *   org.codeforamerica.safety-net-blueprint.{domain}.{object}.{action}
 */

import { randomUUID } from 'crypto';
import { create, insertResource } from './database-manager.js';
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
export function emitEventEnvelope(envelope) {
  const record = {
    specversion: '1.0',
    datacontenttype: 'application/json',
    ...envelope,
    id: envelope.id || randomUUID(),
    time: envelope.time || new Date().toISOString(),
  };
  insertResource('events', record);
  eventBus.emit('domain-event', record);
  return record;
}

/**
 * Emit a domain event.
 *
 * @param {Object} options
 * @param {string} options.domain      - Domain name (e.g., 'workflow')
 * @param {string} options.object      - Object name, singular lowercase (e.g., 'task')
 * @param {string} options.action      - Action verb (e.g., 'created', 'claimed')
 * @param {string} options.resourceId  - UUID of the affected resource
 * @param {string} options.source      - Domain base path (e.g., '/workflow')
 * @param {Object|null} [options.data] - Event payload. Defaults to null.
 * @param {string|null} [options.callerId]    - X-Caller-Id from request header
 * @param {string|null} [options.traceparent] - W3C traceparent header, if present
 * @param {string|null} [options.now]  - ISO timestamp. Defaults to current time.
 * @returns {Object} The stored event record
 */
export function emitEvent({ domain, object, action, resourceId, source, data = null, callerId = null, traceparent = null, now = null }) {
  const timestamp = now || new Date().toISOString();
  const type = `org.codeforamerica.safety-net-blueprint.${domain}.${object}.${action}`;

  const envelope = {
    specversion: '1.0',
    id: randomUUID(),
    type,
    source: source || `/${domain}`,
    subject: resourceId,
    time: timestamp,
    datacontenttype: 'application/json',
    traceparent: traceparent || null,
    data: data ?? null,
  };

  const stored = create('events', envelope);
  eventBus.emit('domain-event', stored);
  return stored;
}
