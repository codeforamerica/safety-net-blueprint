/**
 * State machine engine — pure logic, no Express dependencies.
 * Evaluates guards, finds transitions, and applies effects
 * based on a state machine contract.
 */

import jsonLogic from 'json-logic-js';
import { deriveCollectionName } from './collection-utils.js';

/**
 * Resolve a value expression against a context.
 * Supports $caller.*, $object.*, $request.*, $this.*, $alias.* (context entities), $now,
 * null, and literal values.
 *
 * Value expressions follow OpenAPI 3.1 Runtime Expression conventions ($source.location.field).
 * Entity aliases are resolved from context.entities (populated by resolveInlineRuleContext).
 *
 * @param {*} value - The value or expression to resolve
 * @param {Object} context - Context with caller, object, request, this, entities, and now info
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

    if (value.startsWith('$this.')) {
      const field = value.slice('$this.'.length);
      return resolveDotPath(context.this, field) ?? null;
    }

    // Entity alias: $alias.field from context.entities
    // Handles any $prefix.field not matched above (e.g. $application.id, $snapQueue.id)
    if (value.startsWith('$') && value.includes('.')) {
      const dot = value.indexOf('.');
      const alias = value.slice(1, dot);
      const field = value.slice(dot + 1);
      if (context.entities !== undefined && alias in context.entities) {
        return resolveDotPath(context.entities[alias], field) ?? null;
      }
    }
  }

  return value;
}

/**
 * Resolve a dot-notation path against an object.
 * @param {*} obj - The object to traverse
 * @param {string} path - Dot-notation path (e.g., "id", "data.memberId")
 * @returns {*} Resolved value, or null if any segment is missing
 */
function resolveDotPath(obj, path) {
  if (obj == null || !path) return null;
  return path.split('.').reduce((cur, key) => (cur == null ? null : cur[key]), obj) ?? null;
}

/**
 * Interpolate {alias.field} template expressions in a path string.
 * Follows OpenAPI path template syntax for the slot markers (curly braces).
 * Resolved values come from the step context: named prefixes (this, object, request, caller)
 * and context.entities (alias → entity map built by rule context bindings).
 *
 * Example: "intake/applications/{application.id}/open"
 *   with context.entities.application = { id: "uuid-123" }
 *   → "intake/applications/uuid-123/open"
 *
 * @param {string} pathTemplate - Path containing {alias.field} markers
 * @param {Object} context - Step context with caller, object, this, entities
 * @returns {string} Interpolated path
 */
function interpolatePath(pathTemplate, context) {
  return pathTemplate.replace(/\{([^}]+)\}/g, (match, expr) => {
    const dot = expr.indexOf('.');
    if (dot === -1) return match;
    const alias = expr.slice(0, dot);
    const field = expr.slice(dot + 1);
    let val;
    if (alias === 'this')         val = resolveDotPath(context.this, field);
    else if (alias === 'object')  val = resolveDotPath(context.object, field);
    else if (alias === 'request') val = resolveDotPath(context.request, field);
    else if (alias === 'caller')  val = resolveDotPath(context.caller, field);
    else                          val = resolveDotPath(context.entities?.[alias], field);
    return val != null ? String(val) : match;
  });
}

/**
 * Resolve all fields in a body object against a step context.
 * Handles nested $push values (used in PATCH array-append invoke steps).
 */
function resolveBody(body, context) {
  const result = {};
  for (const [key, val] of Object.entries(body || {})) {
    if (val && typeof val === 'object' && '$push' in val) {
      result[key] = { $push: resolveBodyValue(val['$push'], context) };
    } else {
      result[key] = resolveValue(val, context);
    }
  }
  return result;
}

/**
 * Resolve a single body value that may be a string expression, literal, or nested object.
 */
function resolveBodyValue(val, context) {
  if (typeof val === 'string') return resolveValue(val, context);
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const result = {};
    for (const [k, v] of Object.entries(val)) result[k] = resolveValue(v, context);
    return result;
  }
  return val;
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
 * Find a valid operation for an operation name given the resource's current status.
 * For the new machines: format where operations live on the machine entry.
 * @param {Object} machine - A machine entry (from machines[])
 * @param {string} operationName - The operation name (e.g., "claim")
 * @param {Object} resource - The resource (must have a status field)
 * @returns {{ operation: Object|null, error: string|null }}
 */
export function findOperation(machine, operationName, resource) {
  const operations = machine.operations || [];

  const operation = operations.find(op => {
    if (op.name !== operationName) return false;
    // In-place operation with no transition.from — valid from any state
    if (!op.transition?.from) return true;
    const from = op.transition.from;
    return Array.isArray(from) ? from.includes(resource.status) : from === resource.status;
  });

  if (operation) {
    return { operation, error: null };
  }

  const opExists = operations.some(op => op.name === operationName);
  if (!opExists) {
    return { operation: null, error: `Unknown operation: ${operationName}` };
  }

  return {
    operation: null,
    error: `Cannot ${operationName}: resource is currently "${resource.status}"`
  };
}

/**
 * Apply a list of steps from a then: block (new machines: format).
 * Recognizes: set, emit, evaluate, invoke.
 *
 * invoke: supports two forms (both use HTTP method as the key):
 *   POST to a collection:  { POST: "domain/collection", body: { ... } }
 *   POST to an operation:  { POST: "domain/collection/{alias.id}/op", body: { ... } }
 *   PATCH for array-append: { PATCH: "domain/collection/{alias.id}", body: { field: { $push: value } } }
 *
 * Path template slots use {alias.field} syntax (OpenAPI path template style).
 * Value expressions use $alias.field syntax (OpenAPI 3.1 Runtime Expression style).
 * See api-patterns.yaml behavioral_contract_steps for the full vocabulary.
 *
 * @param {Array} steps - Step items from a then: list
 * @param {Object} resource - The resource to modify (mutated in place)
 * @param {Object} context - Context with caller, object, request, this, entities, and now info
 * @returns {{
 *   pendingCreates: Array<{ entity: string, data: Object }>,
 *   pendingOperations: Array<{ path: string, rawPath: string, body: Object }>,
 *   pendingAppends: Array<{ path: string, body: Object }>,
 *   pendingRuleEvaluations: Array<{ ruleId?: string, ruleType?: string }>,
 *   pendingEvents: Array<{ action: string, data: Object }>
 * }}
 */
export function applySteps(steps, resource, context) {
  const pendingCreates = [];
  const pendingOperations = [];
  const pendingAppends = [];
  const pendingRuleEvaluations = [];
  const pendingEvents = [];

  if (!steps) return { pendingCreates, pendingOperations, pendingAppends, pendingRuleEvaluations, pendingEvents };

  for (const step of steps) {
    if (step.when !== undefined) {
      const logicData = { request: context.request || {}, object: context.object || {} };
      if (!jsonLogic.apply(step.when, logicData)) continue;
    }

    if (step.set) {
      resource[step.set.field] = resolveValue(step.set.value, context);
    } else if (step.emit) {
      const data = {};
      for (const [key, value] of Object.entries(step.emit.data || {})) {
        data[key] = resolveValue(value, context);
      }
      pendingEvents.push({ action: step.emit.event, data });
    } else if (step.evaluate) {
      pendingRuleEvaluations.push({ ruleId: step.evaluate });
    } else if (step.invoke) {
      const spec = step.invoke;
      const method = 'POST' in spec ? 'POST' : 'PATCH' in spec ? 'PATCH' : null;
      if (!method) {
        console.warn('invoke: step missing POST or PATCH key — skipping');
        continue;
      }

      const rawPath = spec[method];
      const path = interpolatePath(rawPath, context);
      const body = resolveBody(spec.body, context);

      if (method === 'POST') {
        if (rawPath.includes('{')) {
          // Operation trigger: POST to domain/collection/{alias.id}/operation
          pendingOperations.push({ path, rawPath, body });
        } else {
          // Collection create: POST to domain/collection
          // Derive the DB collection name from the full path so sub-collection paths
          // (e.g. intake/applications/documents) map correctly (→ application-documents).
          const domain = rawPath.split('/')[0];
          const entity = deriveCollectionName(rawPath, domain);
          pendingCreates.push({ entity, data: body });
        }
      } else {
        // Array append: PATCH to domain/collection/{alias.id}
        pendingAppends.push({ path, body });
      }
    }
  }

  return { pendingCreates, pendingOperations, pendingAppends, pendingRuleEvaluations, pendingEvents };
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
