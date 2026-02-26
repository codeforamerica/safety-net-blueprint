/**
 * State machine engine — pure logic, no Express dependencies.
 * Evaluates guards, finds transitions, and applies effects
 * based on a state machine contract.
 */

/**
 * Resolve a value expression against a context.
 * Supports $caller.id references, null, and literal values.
 * @param {*} value - The value or expression to resolve
 * @param {Object} context - Context with caller info
 * @returns {*} Resolved value
 */
export function resolveValue(value, context) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' && value.startsWith('$caller.')) {
    const field = value.slice('$caller.'.length);
    return context.caller?.[field] ?? null;
  }

  return value;
}

/**
 * Evaluate a single guard condition against a resource.
 * @param {Object} guard - Guard definition with field, operator, value
 * @param {Object} resource - The resource being checked
 * @param {Object} context - Context with caller info
 * @returns {{ pass: boolean, reason: string }}
 */
export function evaluateGuard(guard, resource, context) {
  const fieldValue = guard.field.startsWith('$')
    ? resolveValue(guard.field, context)
    : resource[guard.field];

  switch (guard.operator) {
    case 'is_null':
      if (fieldValue === null || fieldValue === undefined) {
        return { pass: true, reason: null };
      }
      return { pass: false, reason: `${guard.field} is not null` };

    case 'equals': {
      const expected = resolveValue(guard.value, context);
      if (fieldValue === expected) {
        return { pass: true, reason: null };
      }
      return { pass: false, reason: `${guard.field} does not match expected value` };
    }

    default:
      // Forward-compatible: unknown operators pass with a warning
      console.warn(`Unknown guard operator: ${guard.operator} — skipping`);
      return { pass: true, reason: null };
  }
}

/**
 * Evaluate a list of named guards. Stops on first failure.
 * @param {string[]} guardNames - List of guard names to evaluate
 * @param {Object} guardsMap - Map of guard name to guard definition
 * @param {Object} resource - The resource being checked
 * @param {Object} context - Context with caller info
 * @returns {{ pass: boolean, failedGuard: string|null, reason: string|null }}
 */
export function evaluateGuards(guardNames, guardsMap, resource, context) {
  if (!guardNames || guardNames.length === 0) {
    return { pass: true, failedGuard: null, reason: null };
  }

  for (const name of guardNames) {
    const guard = guardsMap[name];
    if (!guard) {
      console.warn(`Guard "${name}" not found in guards map — skipping`);
      continue;
    }

    const result = evaluateGuard(guard, resource, context);
    if (!result.pass) {
      return { pass: false, failedGuard: name, reason: result.reason };
    }
  }

  return { pass: true, failedGuard: null, reason: null };
}

/**
 * Find a valid transition for a trigger given the resource's current status.
 * @param {Object} stateMachine - The state machine contract
 * @param {string} trigger - The trigger name (e.g., "claim")
 * @param {Object} resource - The resource (must have a status field)
 * @returns {{ transition: Object|null, error: string|null }}
 */
export function findTransition(stateMachine, trigger, resource) {
  const transition = stateMachine.transitions.find(
    t => t.trigger === trigger && t.from === resource.status
  );

  if (transition) {
    return { transition, error: null };
  }

  // Check if the trigger exists at all (for better error messages)
  const triggerExists = stateMachine.transitions.some(t => t.trigger === trigger);
  if (!triggerExists) {
    return { transition: null, error: `Unknown trigger: ${trigger}` };
  }

  return {
    transition: null,
    error: `Cannot ${trigger}: task is currently "${resource.status}"`
  };
}

/**
 * Apply a single set effect to a resource.
 * @param {Object} effect - Effect definition with field and value
 * @param {Object} resource - The resource to modify (mutated in place)
 * @param {Object} context - Context with caller info
 */
export function applySetEffect(effect, resource, context) {
  resource[effect.field] = resolveValue(effect.value, context);
}

/**
 * Apply all effects of supported types. Skips unimplemented types silently.
 * @param {Array} effects - Array of effect definitions
 * @param {Object} resource - The resource to modify (mutated in place)
 * @param {Object} context - Context with caller info
 */
export function applyEffects(effects, resource, context) {
  if (!effects) return;

  for (const effect of effects) {
    switch (effect.type) {
      case 'set':
        applySetEffect(effect, resource, context);
        break;
      default:
        // Silently skip unimplemented effect types (forward-compatible)
        break;
    }
  }
}
