/**
 * State machine engine — pure logic, no Express dependencies.
 * Evaluates guards, finds transitions, and applies effects
 * based on a state machine contract.
 */

import jsonLogic from 'json-logic-js';

/**
 * Resolve a value expression against a context.
 * Supports $caller.*, $object.*, $now, null, and literal values.
 * @param {*} value - The value or expression to resolve
 * @param {Object} context - Context with caller, object, and now info
 * @returns {*} Resolved value
 */
export function resolveValue(value, context) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    if (value === '$now') {
      return context.now ?? new Date().toISOString();
    }

    if (value.startsWith('$caller.')) {
      const field = value.slice('$caller.'.length);
      return context.caller?.[field] ?? null;
    }

    if (value.startsWith('$object.')) {
      const field = value.slice('$object.'.length);
      return context.object?.[field] ?? null;
    }

    if (value.startsWith('$request.')) {
      const field = value.slice('$request.'.length);
      return context.request?.[field] ?? null;
    }
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

    case 'contains_any': {
      const field = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
      const values = Array.isArray(guard.value) ? guard.value : [guard.value];
      if (field.some(v => values.includes(v))) {
        return { pass: true, reason: null };
      }
      return { pass: false, reason: `${guard.field} does not contain any of the required values` };
    }

    case 'contains_all': {
      const field = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
      const values = Array.isArray(guard.value) ? guard.value : [guard.value];
      if (values.every(v => field.includes(v))) {
        return { pass: true, reason: null };
      }
      return { pass: false, reason: `${guard.field} does not contain all required values` };
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

  for (const item of guardNames) {
    // Composition: { any: [...] } — at least one must pass (OR)
    if (item && typeof item === 'object' && item.any) {
      const passed = item.any.some(name => {
        const guard = guardsMap[name];
        if (!guard) { console.warn(`Guard "${name}" not found in guards map — skipping`); return false; }
        return evaluateGuard(guard, resource, context).pass;
      });
      if (!passed) {
        return { pass: false, failedGuard: `any(${item.any.join(', ')})`, reason: 'None of the required guards passed' };
      }
      continue;
    }

    // Composition: { all: [...] } — all must pass (AND)
    if (item && typeof item === 'object' && item.all) {
      for (const name of item.all) {
        const guard = guardsMap[name];
        if (!guard) { console.warn(`Guard "${name}" not found in guards map — skipping`); continue; }
        const result = evaluateGuard(guard, resource, context);
        if (!result.pass) {
          return { pass: false, failedGuard: name, reason: result.reason };
        }
      }
      continue;
    }

    // Plain named guard
    const guard = guardsMap[item];
    if (!guard) {
      console.warn(`Guard "${item}" not found in guards map — skipping`);
      continue;
    }
    const result = evaluateGuard(guard, resource, context);
    if (!result.pass) {
      return { pass: false, failedGuard: item, reason: result.reason };
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
  const transition = stateMachine.transitions.find(t => {
    if (t.trigger !== trigger) return false;
    return Array.isArray(t.from)
      ? t.from.includes(resource.status)
      : t.from === resource.status;
  });

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
 * Apply a single create effect — resolves all fields and returns the data to create.
 * Engine stays pure: no database dependency.
 * @param {Object} effect - Effect definition with entity and fields
 * @param {Object} context - Context with caller, object, and now info
 * @returns {{ entity: string, data: Object }}
 */
export function applyCreateEffect(effect, context) {
  const data = {};
  for (const [key, value] of Object.entries(effect.fields || {})) {
    data[key] = resolveValue(value, context);
  }
  return { entity: effect.entity, data };
}

/**
 * Apply a single event effect — resolves data fields and returns the event to emit.
 * The engine populates envelope fields (domain, resource, resourceId, etc.) automatically
 * from context; the effect only specifies action and optional data.
 * @param {Object} effect - Effect definition with action and optional data
 * @param {Object} context - Context with caller, object, and now info
 * @returns {{ action: string, data: Object }}
 */
export function applyEventEffect(effect, context) {
  const data = {};
  for (const [key, value] of Object.entries(effect.data || {})) {
    data[key] = resolveValue(value, context);
  }
  return { action: effect.action, data };
}

/**
 * Apply all effects of supported types. Skips unimplemented types silently.
 * Evaluates any `when` clause (JSON Logic) before executing each effect —
 * effects whose condition is false are skipped.
 * @param {Array} effects - Array of effect definitions
 * @param {Object} resource - The resource to modify (mutated in place)
 * @param {Object} context - Context with caller, object, request, and now info
 * @returns {{ pendingCreates: Array, pendingRuleEvaluations: Array, pendingEvents: Array }}
 */
export function applyEffects(effects, resource, context) {
  const pendingCreates = [];
  const pendingRuleEvaluations = [];
  const pendingEvents = [];

  if (!effects) return { pendingCreates, pendingRuleEvaluations, pendingEvents };

  for (const effect of effects) {
    // Evaluate `when` clause before executing the effect
    if (effect.when !== undefined) {
      const logicData = { request: context.request || {}, object: context.object || {} };
      if (!jsonLogic.apply(effect.when, logicData)) {
        continue;
      }
    }

    switch (effect.type) {
      case 'set':
        applySetEffect(effect, resource, context);
        break;
      case 'create':
        pendingCreates.push(applyCreateEffect(effect, context));
        break;
      case 'event':
        pendingEvents.push(applyEventEffect(effect, context));
        break;
      case 'evaluate-rules':
        pendingRuleEvaluations.push({ ruleType: effect.ruleType });
        break;
      default:
        // Silently skip unimplemented effect types (forward-compatible)
        break;
    }
  }

  return { pendingCreates, pendingRuleEvaluations, pendingEvents };
}
