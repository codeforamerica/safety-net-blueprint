/**
 * SLA engine — pure logic for SLA clock initialization and evaluation.
 * No Express or database dependencies.
 */

import jsonLogic from 'json-logic-js';

/**
 * Add a duration to a base ISO datetime string.
 * @param {string} baseIso - Base datetime (ISO 8601)
 * @param {{ amount: number, unit: string }} duration - Duration to add
 * @returns {string} New datetime (ISO 8601)
 */
export function addDuration(baseIso, duration) {
  const base = new Date(baseIso);
  const ms = durationToMs(duration);
  return new Date(base.getTime() + ms).toISOString();
}

/**
 * Convert a duration object to milliseconds.
 * @param {{ amount: number, unit: string }} duration
 * @returns {number}
 */
function durationToMs({ amount, unit }) {
  switch (unit) {
    case 'minutes': return amount * 60 * 1000;
    case 'hours':   return amount * 60 * 60 * 1000;
    case 'days':    return amount * 24 * 60 * 60 * 1000;
    default:
      console.warn(`Unknown duration unit: ${unit} — treating as days`);
      return amount * 24 * 60 * 60 * 1000;
  }
}

/**
 * Evaluate a JSON Logic condition against a data object.
 * Returns false if condition is absent or evaluation fails.
 * @param {*} condition - JSON Logic condition
 * @param {Object} data - Data to evaluate against
 * @returns {boolean}
 */
function evaluateCondition(condition, data) {
  if (condition === undefined || condition === null) return false;
  try {
    return Boolean(jsonLogic.apply(condition, data));
  } catch {
    return false;
  }
}

/**
 * Initialize slaInfo entries on resource creation.
 * Merges client-provided SLA types with auto-assigned ones, deduped by slaTypeCode.
 * Populates status, clockStartedAt, deadline, and internal tracking fields.
 *
 * Mutates resource.slaInfo in place.
 *
 * @param {Object} resource - The newly created resource (mutated)
 * @param {Array} slaTypes - SLA type definitions from *-sla-types.yaml
 * @param {string} now - Current datetime (ISO 8601)
 */
export function initializeSlaInfo(resource, slaTypes, now, resolvedEntities = {}) {
  const conditionData = { ...resource, ...resolvedEntities };

  // Collect client-provided slaTypeCodes
  const clientCodes = new Set(
    (resource.slaInfo || []).map(e => e.slaTypeCode)
  );

  // Evaluate autoAssignWhen for each SLA type
  const autoAssigned = [];
  for (const slaType of slaTypes) {
    if (!slaType.autoAssignWhen) continue;
    if (clientCodes.has(slaType.id)) continue; // already included
    if (evaluateCondition(slaType.autoAssignWhen, conditionData)) {
      autoAssigned.push({ slaTypeCode: slaType.id });
    }
  }

  // Merge client-provided + auto-assigned
  const allEntries = [...(resource.slaInfo || []), ...autoAssigned];

  if (allEntries.length === 0) {
    resource.slaInfo = [];
    return;
  }

  // Initialize each entry
  resource.slaInfo = allEntries.map(entry => {
    const slaType = slaTypes.find(t => t.id === entry.slaTypeCode);
    if (!slaType) {
      console.warn(`SLA type "${entry.slaTypeCode}" not found in config — skipping`);
      return null;
    }

    const deadline = addDuration(now, slaType.duration);

    return {
      slaTypeCode: entry.slaTypeCode,
      status: 'active',
      clockStartedAt: now,
      deadline,
      // Internal tracking fields (not in OpenAPI contract, but useful for debugging)
      _pausedSince: null,
      _accumulatedPausedMs: 0
    };
  }).filter(Boolean);
}

/**
 * Update slaInfo entries after a state transition.
 * Evaluates pauseWhen/resumeWhen, warning threshold, and breach conditions.
 *
 * Mutates resource.slaInfo in place.
 *
 * @param {Object} resource - The resource after transition (mutated)
 * @param {Array} slaTypes - SLA type definitions from *-sla-types.yaml
 * @param {string} now - Current datetime (ISO 8601)
 * @param {Object} states - State definitions from the state machine (keyed by state name)
 */
export function updateSlaInfo(resource, slaTypes, now, states = {}, resolvedEntities = {}) {
  if (!resource.slaInfo || resource.slaInfo.length === 0) return;

  const conditionData = { ...resource, ...resolvedEntities };
  const nowMs = new Date(now).getTime();
  const currentStateConfig = states[resource.status] ?? {};
  const clockIsStopped = currentStateConfig.slaClock === 'stopped';

  for (const entry of resource.slaInfo) {
    // Skip terminal states
    if (entry.status === 'completed' || entry.status === 'breached') continue;

    const slaType = slaTypes.find(t => t.id === entry.slaTypeCode);
    if (!slaType) continue;

    // Evaluate completedWhen (highest priority — explicit SLA type override)
    const completedWhen = slaType.completedWhen ?? null;
    if (completedWhen !== null && evaluateCondition(completedWhen, conditionData)) {
      entry.status = 'completed';
      entry._pausedSince = null;
      continue;
    }

    // If no custom completedWhen, defer to the state machine: any state with
    // slaClock: stopped (e.g. completed, cancelled) terminates SLA tracking.
    if (!completedWhen && clockIsStopped) {
      entry.status = 'completed';
      entry._pausedSince = null;
      continue;
    }

    // Evaluate pauseWhen
    const shouldPause = slaType.pauseWhen
      ? evaluateCondition(slaType.pauseWhen, conditionData)
      : false;

    // Evaluate resumeWhen (defaults to: pauseWhen no longer true)
    const shouldResume = slaType.resumeWhen
      ? evaluateCondition(slaType.resumeWhen, conditionData)
      : !shouldPause;

    if (entry.status === 'paused') {
      if (shouldResume) {
        // Compute how long this pause lasted and extend deadline
        const pausedSinceMs = entry._pausedSince ? new Date(entry._pausedSince).getTime() : nowMs;
        const pauseDurationMs = nowMs - pausedSinceMs;
        entry._accumulatedPausedMs = (entry._accumulatedPausedMs || 0) + pauseDurationMs;

        // Extend deadline by the pause duration
        const currentDeadlineMs = new Date(entry.deadline).getTime();
        entry.deadline = new Date(currentDeadlineMs + pauseDurationMs).toISOString();
        entry._pausedSince = null;
        entry.status = 'active';
      } else {
        // Still paused — nothing to do
        continue;
      }
    } else {
      // Currently active or warning
      if (shouldPause) {
        entry.status = 'paused';
        entry._pausedSince = now;
        continue;
      }
    }

    // Check breach (deadline passed)
    const deadlineMs = new Date(entry.deadline).getTime();
    if (nowMs > deadlineMs) {
      entry.status = 'breached';
      continue;
    }

    // Check warning threshold
    if (slaType.warningThresholdPercent) {
      const totalMs = durationToMs(slaType.duration);
      const elapsedMs = nowMs
        - new Date(entry.clockStartedAt).getTime()
        - (entry._accumulatedPausedMs || 0);
      const pctElapsed = (elapsedMs / totalMs) * 100;
      if (pctElapsed >= slaType.warningThresholdPercent) {
        entry.status = 'warning';
        continue;
      }
    }

    // Still active
    entry.status = 'active';
  }
}
