/**
 * Timer stub engine — FIFO queue of mock timestamps for onTimer testing.
 *
 * Stubs are registered with a specific "now" timestamp. When POST /mock/timers/fire
 * is called, the next stub is popped and the mock server sweeps all state machine
 * resources to fire any onTimer entries whose deadline has passed relative to that time.
 *
 * Stubs are ephemeral — cleared on server restart or via DELETE /mock/stubs/timers.
 */

import { findAll, update, create } from './database-manager.js';
import { applySteps } from './state-machine-engine.js';
import { processRuleEvaluations } from './handlers/rule-evaluation.js';
import { emitEvent } from './emit-event.js';

/** Ordered queue of registered timer stubs. */
const timerStubs = [];
let idCounter = 0;

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
 * Register a timer stub.
 * @param {{ now: string }} stub
 * @returns {Object} Registered stub with id
 */
export function registerTimerStub(stub) {
  if (!stub?.now) throw new Error('Timer stub requires "now" (ISO timestamp)');
  // Validate ISO format
  if (isNaN(Date.parse(stub.now))) throw new Error(`"now" must be a valid ISO timestamp: ${stub.now}`);
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
 * Pop the next timer stub and sweep all state machine resources for due onTimer entries.
 * Returns null if no stubs are queued.
 *
 * @param {Array} allStateMachines - from discoverStateMachines()
 * @param {Array} allRules - from discoverRules()
 * @param {Array} allSlaTypes - from discoverSlaTypes()
 * @returns {{ fired: boolean, now: string, transitioned: Array }|null}
 */
export function fireNextTimer(allStateMachines, allRules = [], allSlaTypes = []) {
  if (timerStubs.length === 0) return null;

  const stub = timerStubs.shift();
  const now = stub.now;
  const nowMs = new Date(now).getTime();
  const transitioned = [];

  for (const smEntry of allStateMachines) {
    const { machine, stateMachine } = smEntry;
    const onTimers = machine?.triggers?.onTimer;
    if (!Array.isArray(onTimers) || onTimers.length === 0) continue;

    // Derive collection name: "Task" → "tasks"
    const collectionName = machine.object
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase() + 's';

    const { items: resources } = findAll(collectionName, {}, { limit: 10000 });

    for (const resource of resources) {
      for (const timerEntry of onTimers) {
        const { after, relativeTo, transition, then } = timerEntry;
        if (!relativeTo || !resource[relativeTo]) continue;

        // Check status guard
        if (transition?.from && !statusMatches(resource, transition.from)) continue;

        const baseMs = new Date(resource[relativeTo]).getTime();
        const offsetMs = parseDurationMs(after);
        const deadlineMs = baseMs + offsetMs;

        if (nowMs < deadlineMs) continue; // deadline not yet reached

        const context = {
          caller: { id: 'system', roles: ['system'] },
          object: { ...resource },
          request: {},
          now,
        };

        const updatedResource = { ...resource };

        // Apply transition
        if (transition?.to) {
          updatedResource.status = transition.to;
        }

        // Apply then steps
        const { pendingRuleEvaluations, pendingEvents } = applySteps(then || [], updatedResource, context);

        processRuleEvaluations(pendingRuleEvaluations, updatedResource, allRules, stateMachine.domain, stateMachine.rules, context);

        // Persist changes
        const diff = {};
        for (const [key, value] of Object.entries(updatedResource)) {
          if (resource[key] !== value && key !== 'id' && key !== 'createdAt') {
            diff[key] = value;
          }
        }
        if (Object.keys(diff).length > 0) {
          update(collectionName, resource.id, diff);
        }

        // Emit events from then steps
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

        // Each onTimer entry matches at most once per resource; move to next entry
        break;
      }
    }
  }

  return { fired: true, now, transitioned };
}
