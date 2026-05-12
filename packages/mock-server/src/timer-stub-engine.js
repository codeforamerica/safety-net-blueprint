/**
 * Timer stub engine — FIFO queue of mock timestamps for onTimer testing.
 *
 * Two ways to fire timers:
 *
 *   1. Inline (no pre-registration):
 *      POST /mock/timers/fire { "now": "+72h" }
 *      The engine resolves "now" against the current real time and sweeps all resources.
 *
 *   2. Pre-registered queue (for sequenced scenarios):
 *      POST /mock/stubs/timers { "now": "+72h" }   ← enqueue
 *      POST /mock/timers/fire                       ← pop and sweep
 *
 * The "now" value accepts:
 *   - ISO 8601 timestamp: "2025-06-01T00:00:00Z"
 *   - Relative offset:    "+72h", "+7d", "-48h", "+30m"
 *     Resolved against the current clock at fire time.
 *
 * calendarType: business is accepted by the schema but treated as calendar time
 * in the mock. A warning is logged when it is used. Real business-hours arithmetic
 * requires a business calendar definition (hours, timezone, holidays) not available
 * in the mock server.
 *
 * Stubs are ephemeral — cleared on server restart or via DELETE /mock/stubs/timers.
 */

import { findAll, update, create } from './database-manager.js';
import { applySteps, evaluateGuards } from './state-machine-engine.js';
import { processRuleEvaluations, resolveContextLayers } from './handlers/rule-evaluation.js';
import { mergeByPrecedence } from './collection-utils.js';
import { emitEvent } from './emit-event.js';

/** Ordered queue of registered timer stubs. */
const timerStubs = [];
let idCounter = 0;

/** Regex matching relative offset strings: +72h, -48h, +7d, +30m */
const OFFSET_RE = /^([+-]\d+(?:\.\d+)?)(h|d|m)$/;

/**
 * Resolve a "now" value — absolute ISO timestamp or relative offset — to an ISO string.
 * Relative offsets are resolved against the current real time at call time.
 * @param {string} value
 * @returns {string} ISO timestamp
 */
function resolveNow(value) {
  const match = String(value).match(OFFSET_RE);
  if (match) {
    const amount = parseFloat(match[1]);
    const unit = match[2];
    let ms;
    switch (unit) {
      case 'h': ms = amount * 60 * 60 * 1000; break;
      case 'd': ms = amount * 24 * 60 * 60 * 1000; break;
      case 'm': ms = amount * 60 * 1000; break;
      default: ms = 0;
    }
    return new Date(Date.now() + ms).toISOString();
  }
  return value; // already an ISO timestamp
}

/**
 * Parse a duration string like "72h", "-48h", "30d", "7d", "0h" into milliseconds.
 * @param {string|number} after - Duration string or number (hours assumed)
 * @returns {number} Duration in milliseconds (negative for past offsets)
 */
function parseDurationMs(after) {
  if (typeof after === 'number') return after * 60 * 60 * 1000;
  const str = String(after).trim();
  const match = str.match(/^(-?\d+(?:\.\d+)?)(h|d|m)$/);
  if (!match) return 0;
  const amount = parseFloat(match[1]);
  const unit = match[2];
  switch (unit) {
    case 'h': return amount * 60 * 60 * 1000;
    case 'd': return amount * 24 * 60 * 60 * 1000;
    case 'm': return amount * 60 * 1000;
    default: return 0;
  }
}

/**
 * Check whether a resource's current status matches the onTimer `from` constraint.
 * @param {Object} resource
 * @param {string|string[]} from
 * @returns {boolean}
 */
function statusMatches(resource, from) {
  if (!from) return true;
  if (Array.isArray(from)) return from.includes(resource.status);
  return resource.status === from;
}

/**
 * Sweep all state machine resources for onTimer entries whose deadline has passed.
 * @param {string} now - Resolved ISO timestamp to use as "current time"
 * @param {Array} allStateMachines
 * @param {Array} allRules
 * @param {Array} allSlaTypes
 * @returns {{ fired: boolean, now: string, transitioned: Array }}
 */
function sweepTimers(now, allStateMachines, allRules, allSlaTypes) {
  const nowMs = new Date(now).getTime();
  const transitioned = [];

  for (const smEntry of allStateMachines) {
    const { machine, stateMachine } = smEntry;
    const onTimers = machine?.triggers?.onTimer;
    if (!Array.isArray(onTimers) || onTimers.length === 0) continue;

    const collectionName = machine.object
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase() + 's';

    const { items: resources } = findAll(collectionName, {}, { limit: 10000 });

    for (const resource of resources) {
      for (const timerEntry of onTimers) {
        const { after, relativeTo, calendarType, transition, guards: timerGuards, then } = timerEntry;
        if (!relativeTo || !resource[relativeTo]) continue;

        if (transition?.from && !statusMatches(resource, transition.from)) continue;

        const baseMs = new Date(resource[relativeTo]).getTime();
        const offsetMs = parseDurationMs(after);
        const deadlineMs = baseMs + offsetMs;

        if (nowMs < deadlineMs) continue;

        if (calendarType === 'business') {
          console.warn(
            `onTimer: calendarType "business" is not enforced in the mock — ` +
            `treating as calendar time (resource ${resource.id})`
          );
        }

        const baseContext = {
          caller: { id: 'system', roles: ['system'] },
          object: { ...resource },
          request: {},
          now,
        };

        const entities = resolveContextLayers(
          [stateMachine.context, machine?.context, timerEntry.context],
          resource,
          baseContext
        );
        if (entities === null) {
          console.error(`onTimer: required context binding failed for resource ${resource.id} — skipping`);
          continue;
        }
        const context = { ...baseContext, entities };

        // Evaluate guards if defined on this timer entry
        const guardsConditions = timerGuards?.conditions || [];
        if (guardsConditions.length > 0) {
          const guardsMap = Object.fromEntries(
            mergeByPrecedence(stateMachine?.guards || [], machine?.guards || []).map(g => [g.id, g])
          );
          const guardResult = evaluateGuards(guardsConditions, guardsMap, resource, context);
          if (!guardResult.pass) {
            continue;
          }
        }

        const updatedResource = { ...resource };

        if (transition?.to) {
          updatedResource.status = transition.to;
        }

        const { pendingRuleEvaluations, pendingEvents } = applySteps(then || [], updatedResource, context);

        processRuleEvaluations(pendingRuleEvaluations, updatedResource, allRules, stateMachine.domain, stateMachine.rules, context);

        const diff = {};
        for (const [key, value] of Object.entries(updatedResource)) {
          if (resource[key] !== value && key !== 'id' && key !== 'createdAt') {
            diff[key] = value;
          }
        }
        if (Object.keys(diff).length > 0) {
          update(collectionName, resource.id, diff);
        }

        const domain = stateMachine.domain;
        const object = machine.object.toLowerCase();
        for (const event of pendingEvents) {
          try {
            emitEvent({
              domain,
              object,
              action: event.action,
              resourceId: resource.id,
              source: `/${domain}`,
              data: event.data || null,
              callerId: 'system',
              now,
            });
          } catch (e) {
            console.error(`Timer event "${event.action}" emit failed:`, e.message);
          }
        }

        transitioned.push({
          collection: collectionName,
          id: resource.id,
          from: resource.status,
          to: updatedResource.status,
        });

        break; // each onTimer entry matches at most once per resource
      }
    }
  }

  return { fired: true, now, transitioned };
}

/**
 * Register a timer stub in the FIFO queue.
 * @param {{ now: string }} stub - now is an ISO timestamp or relative offset (+72h, +7d, -48h)
 * @returns {Object} Registered stub with id
 */
export function registerTimerStub(stub) {
  if (!stub?.now) throw new Error('Timer stub requires "now" (ISO timestamp or relative offset like +72h)');
  const nowStr = String(stub.now);
  const isRelative = OFFSET_RE.test(nowStr);
  if (!isRelative && isNaN(Date.parse(nowStr))) {
    throw new Error(`"now" must be a valid ISO timestamp or relative offset (e.g., +72h, +7d, -48h): ${stub.now}`);
  }
  const id = `timer-${++idCounter}`;
  const registered = { id, now: stub.now };
  timerStubs.push(registered);
  return registered;
}

/**
 * Return a snapshot of all registered timer stubs.
 */
export function listTimerStubs() {
  return [...timerStubs];
}

/**
 * Remove a specific timer stub by ID.
 */
export function removeTimerStub(id) {
  const idx = timerStubs.findIndex(s => s.id === id);
  if (idx === -1) return false;
  timerStubs.splice(idx, 1);
  return true;
}

/**
 * Remove all timer stubs and reset the counter.
 */
export function clearTimerStubs() {
  timerStubs.length = 0;
  idCounter = 0;
}

/**
 * Fire timers inline without consuming from the queue.
 * Use when you don't need sequenced pre-registration.
 *
 * @param {string} now - ISO timestamp or relative offset (+72h, +7d, -48h)
 * @param {Array} allStateMachines
 * @param {Array} allRules
 * @param {Array} allSlaTypes
 * @returns {{ fired: boolean, now: string, transitioned: Array }}
 */
export function fireWithNow(now, allStateMachines, allRules = [], allSlaTypes = []) {
  const resolved = resolveNow(now);
  return sweepTimers(resolved, allStateMachines, allRules, allSlaTypes);
}

/**
 * Pop the next timer stub and sweep all state machine resources for due onTimer entries.
 * Returns null if no stubs are queued.
 *
 * @param {Array} allStateMachines
 * @param {Array} allRules
 * @param {Array} allSlaTypes
 * @returns {{ fired: boolean, now: string, transitioned: Array }|null}
 */
export function fireNextTimer(allStateMachines, allRules = [], allSlaTypes = []) {
  if (timerStubs.length === 0) return null;
  const stub = timerStubs.shift();
  const resolved = resolveNow(stub.now);
  return sweepTimers(resolved, allStateMachines, allRules, allSlaTypes);
}
