/**
 * State machine utilities shared across the blueprint toolchain.
 *
 * These helpers read the parsed state machine YAML structure and are used by
 * the explorer tools (state-machine-docs, event-catalog) and any other tooling
 * that needs to index or walk state machine definitions.
 *
 * Schema navigation utilities (resolveRef, resolveSchemaRefs,
 * collectTopLevelProperties, getPropertyAtPath) are re-exported from
 * @codeforamerica/blueprint-core/json-schema for backward compatibility.
 */

export {
  resolveRef,
  resolveSchemaRefs,
  collectTopLevelProperties,
  getPropertyAtPath,
} from './json-schema/index.js';

// =============================================================================
// Step traversal utilities
// =============================================================================

/** Return the step list for an action or step node, handling both `steps` and `then` keys. */
export function getSteps(node) {
  return node?.steps || node?.then || [];
}

/** Return the branch map for a match/on step. */
export function getMatchBranches(step) {
  return step?.when || step?.on || {};
}

/** Return the body steps for a forEach step. */
export function getForEachBody(forEach) {
  return forEach?.do || forEach?.then || [];
}

/**
 * Recursively collect all emit.type values from a step list,
 * walking into if/else, match, and forEach branches.
 */
export function collectEmitSteps(steps) {
  const emits = [];
  for (const step of steps || []) {
    if (step.emit) {
      emits.push(step.emit.type);
    } else if (step.if !== undefined) {
      emits.push(...collectEmitSteps(getSteps(step)));
      emits.push(...collectEmitSteps(step.else || []));
    } else if (step.match !== undefined) {
      for (const branchSteps of Object.values(getMatchBranches(step))) {
        emits.push(...collectEmitSteps(branchSteps));
      }
    } else if (step.forEach) {
      emits.push(...collectEmitSteps(getForEachBody(step.forEach)));
    }
  }
  return emits;
}

