/**
 * State machine engine — pure logic, no Express dependencies.
 * Evaluates guards, finds transitions, and applies effects
 * based on a state machine contract.
 */

import jsonLogic from 'json-logic-js';
import { deriveCollectionName } from './collection-utils.js';
import { findAll, findById } from './database-manager.js';

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

    if (value === '$object') return context.object ?? null;
    if (value === '$caller') return context.caller ?? null;
    if (value === '$request') return context.request ?? null;

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

    if (value.startsWith('$params.')) {
      const field = value.slice('$params.'.length);
      return resolveDotPath(context.params, field) ?? null;
    }

    // Entity alias: $alias.field from context.entities
    // Handles any $prefix.field not matched above (e.g. $application.id, $snapQueue.id)
    if (value.startsWith('$') && value.includes('.')) {
      const dot = value.indexOf('.');
      const alias = value.slice(1, dot);
      const field = value.slice(dot + 1);
      if (context.entities !== undefined) {
        if (alias in context.entities) {
          return resolveDotPath(context.entities[alias], field) ?? null;
        }
        return null; // entities map is defined but alias not found
      }
    }

    // Bare alias: $alias with no field — returns the whole entity.
    if (value.startsWith('$') && !value.includes('.')) {
      const alias = value.slice(1);
      if (context.entities !== undefined) {
        return context.entities[alias] ?? null;
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
  // Handle {alias.field} curly-brace syntax
  const step1 = pathTemplate.replace(/\{([^}]+)\}/g, (match, expr) => {
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
  // Handle $alias.field dollar-sign syntax in individual path segments
  return step1.split('/').map(segment => {
    if (!segment.startsWith('$')) return segment;
    const resolved = resolveValue(segment, context);
    return resolved != null ? String(resolved) : segment;
  }).join('/');
}

/**
 * Resolve all fields in a body object against a step context.
 * Handles $merge (object spread — copy source fields then apply explicit overrides)
 * and nested $push values (array-append on PATCH).
 */
function resolveBody(body, context) {
  if (!body) return {};
  const result = {};

  // $merge: resolve source object first and use as base; explicit keys override
  if ('$merge' in body) {
    const source = resolveValue(body['$merge'], context);
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      Object.assign(result, source);
    }
  }

  for (const [key, val] of Object.entries(body)) {
    if (key === '$merge') continue;
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
 * Evaluate a CEL condition string against a context.
 * This is a simplified CEL evaluator that handles common patterns used in guards and if steps.
 * Supports: 'in' operator for array membership, == and != comparisons, null checks, && and ||.
 *
 * @param {string} condition - CEL expression string
 * @param {Object} celData - Data available to the expression (caller, object, request, etc.)
 * @returns {boolean} Evaluation result
 */
function evaluateCEL(condition, celData) {
  if (!condition || typeof condition !== 'string') return true;

  // Build a simple evaluation context
  // Replace $-prefixed variables with plain ones for JS eval
  // CEL in guards uses caller.roles, object.field (no $ prefix)
  // CEL in procedures/steps uses $caller.*, $object.*, etc.

  try {
    // Build context object accessible in eval
    // Note: 'this' is omitted — it is a reserved word and breaks new Function(); use $this instead
    const ctx = {
      caller: celData.caller || {},
      object: celData.object || {},
      request: celData.request || {},
      params: celData.params || {},
      ...Object.fromEntries(
        Object.entries(celData.entities || {}).map(([k, v]) => [`$${k}`, v])
      ),
      $caller: celData.caller || {},
      $object: celData.object || {},
      $request: celData.request || {},
      $this: celData.this || {},
      $params: celData.params || {},
      $now: celData.now || new Date().toISOString(),
    };

    // Add entity aliases with $ prefix
    for (const [alias, entity] of Object.entries(celData.entities || {})) {
      ctx[`$${alias}`] = entity;
    }

    // CEL .size() → .length for JS arrays/strings
    // CEL 'x in arr' → arr.includes(x) for arrays
    // We do a lightweight transform for common patterns
    let jsExpr = condition
      // Replace .size() with .length
      .replace(/\.size\(\)/g, '.length')
      // Replace CEL 'str in arr' with arr.includes(str) — careful with complex expressions
      .replace(/"([^"]+)"\s+in\s+([\w$\.]+)/g, '(Array.isArray($2) ? $2.includes("$1") : false)')
      // Replace CEL list.exists(var, predicate) with list.some(var => (predicate))
      .replace(/\.exists\((\w+),\s*([^)]+(?:\([^)]*\)[^)]*)*)\)/g, '.some($1 => ($2))')
      // Replace bare variable references (no prefix) to ctx.variable
      .replace(/\bnull\b/g, 'null');

    // Use Function constructor for safer eval than global eval
    const fn = new Function(...Object.keys(ctx), `return (${jsExpr});`);
    return Boolean(fn(...Object.values(ctx)));
  } catch (e) {
    console.warn(`CEL evaluation error for condition "${condition}": ${e.message} — defaulting to false`);
    return false;
  }
}

/**
 * Evaluate a single guard condition against a resource.
 * @param {Object} guard - Guard definition with condition (CEL string)
 * @param {Object} resource - The resource being checked
 * @param {Object} context - Context with caller info
 * @returns {{ pass: boolean, reason: string }}
 */
export function evaluateGuard(guard, resource, context) {
  if (guard.condition !== undefined) {
    // New format: CEL condition string
    const celData = {
      caller: context.caller || {},
      object: resource,
      request: context.request || {},
      this: context.this || {},
      entities: context.entities || {},
    };
    const pass = evaluateCEL(guard.condition, celData);
    return { pass, reason: pass ? null : `Guard "${guard.id}" condition failed: ${guard.condition}` };
  }

  // Legacy format: field/operator/value
  const fieldValue = guard.field.startsWith('$')
    ? resolveValue(guard.field, context)
    : resource[guard.field];

  switch (guard.operator) {
    case 'is_null':
      if (fieldValue === null || fieldValue === undefined) {
        return { pass: true, reason: null };
      }
      return { pass: false, reason: `${guard.field} is not null` };

    case 'is_not_null':
      if (fieldValue !== null && fieldValue !== undefined) {
        return { pass: true, reason: null };
      }
      return { pass: false, reason: `${guard.field} is null` };

    case 'equals': {
      const expected = resolveValue(guard.value, context);
      if (fieldValue === expected) {
        return { pass: true, reason: null };
      }
      return { pass: false, reason: `${guard.field} does not match expected value` };
    }

    case 'not_equals': {
      const expected = resolveValue(guard.value, context);
      if (fieldValue !== expected) {
        return { pass: true, reason: null };
      }
      return { pass: false, reason: `${guard.field} equals the excluded value` };
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
 * Find a valid transition for a transition name given the resource's current status.
 * @param {Object} machine - A machine entry (from machines[])
 * @param {string} transitionName - The transition name (e.g., "claim")
 * @param {Object} resource - The resource (must have a status field)
 * @returns {{ operation: Object|null, error: string|null }}
 */
export function findOperation(machine, transitionName, resource) {
  const transitions = machine.transitions || [];

  const operation = transitions.find(op => {
    if (op.id !== transitionName) return false;
    // In-place transition with no transition.from — valid from any state
    if (!op.transition?.from) return true;
    const from = op.transition.from;
    return Array.isArray(from) ? from.includes(resource.status) : from === resource.status;
  });

  if (operation) {
    return { operation, error: null };
  }

  const opExists = transitions.some(op => op.id === transitionName);
  if (!opExists) {
    return { operation: null, error: `Unknown transition: ${transitionName}` };
  }

  return {
    operation: null,
    error: `Cannot ${transitionName}: resource is currently "${resource.status}"`
  };
}

/**
 * Apply a call: step in object form (HTTP operation, formerly invoke:).
 * Supports POST to create resources or trigger operations, and PATCH for array-append.
 *
 * @param {Object} spec - The call object (e.g., { POST: "path", body: { ... } })
 * @param {Object} context - Step context
 * @param {Array} pendingCreates - Accumulator for pending creates
 * @param {Array} pendingOperations - Accumulator for pending operations
 * @param {Array} pendingAppends - Accumulator for pending appends
 */
function applyCallObjectStep(spec, context, pendingCreates, pendingOperations, pendingAppends) {
  const method = 'POST' in spec ? 'POST' : 'PATCH' in spec ? 'PATCH' : 'GET' in spec ? 'GET' : 'DELETE' in spec ? 'DELETE' : null;
  if (!method) {
    console.warn('call: (object form) step missing POST, PATCH, GET, or DELETE key — skipping');
    return;
  }

  const rawPath = spec[method];
  const path = interpolatePath(rawPath, context);
  const body = resolveBody(spec.body, context);

  if (method === 'POST') {
    if (rawPath.includes('{') || rawPath.includes('$')) {
      // Operation trigger: POST to domain/collection/{alias.id}/operation or $ref.field/operation
      pendingOperations.push({ path, rawPath, body });
    } else {
      // Collection create: POST to domain/collection
      const domain = rawPath.split('/')[0];
      const entity = deriveCollectionName(rawPath, domain);
      pendingCreates.push({ entity, data: body });
    }
  } else if (method === 'PATCH') {
    // Array append: PATCH to domain/collection/{alias.id}
    pendingAppends.push({ path, body });
  }
  // GET and DELETE are no-ops in the step engine (read-only or handled elsewhere)
}

/**
 * Apply a list of steps from a then: block (new machines: format).
 * Recognizes: set, emit, call (string = procedure, object = HTTP op), if, match, forEach.
 *
 * call: (object form) supports:
 *   POST to a collection:  { POST: "domain/collection", body: { ... } }
 *   POST to an operation:  { POST: "domain/collection/{alias.id}/op", body: { ... } }
 *   PATCH for array-append: { PATCH: "domain/collection/{alias.id}", body: { field: { $push: value } } }
 *
 * if: evaluates a CEL condition; runs then: on true, else: on false.
 * match: evaluates a CEL expression; routes to matching branch in on:.
 *
 * Path template slots use {alias.field} syntax (OpenAPI path template style).
 * Value expressions use $alias.field syntax (OpenAPI 3.1 Runtime Expression style).
 *
 * @param {Array} steps - Step items from a then: list
 * @param {Object} resource - The resource to modify (mutated in place)
 * @param {Object} context - Context with caller, object, request, this, entities, and now info
 * @returns {{
 *   pendingCreates: Array<{ entity: string, data: Object }>,
 *   pendingOperations: Array<{ path: string, rawPath: string, body: Object }>,
 *   pendingAppends: Array<{ path: string, body: Object }>,
 *   pendingProcedures: Array<{ procedureId?: string }>,
 *   pendingEvents: Array<{ action: string, data: Object }>
 * }}
 */
export function applySteps(steps, resource, context) {
  const pendingCreates = [];
  const pendingOperations = [];
  const pendingAppends = [];
  const pendingProcedures = [];
  const pendingEvents = [];

  if (!steps) return { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents };

  for (const step of steps) {
    // if: step — CEL conditional branch
    if (step.if !== undefined) {
      const celData = {
        caller: context.caller || {},
        object: context.object || {},
        request: context.request || {},
        this: context.this || {},
        entities: context.entities || {},
        params: context.params || {},
        now: context.now,
      };
      const conditionMet = evaluateCEL(step.if, celData);
      const branchSteps = conditionMet ? (step.then || []) : (step.else || []);
      const nested = applySteps(branchSteps, resource, context);
      pendingCreates.push(...nested.pendingCreates);
      pendingOperations.push(...nested.pendingOperations);
      pendingAppends.push(...nested.pendingAppends);
      pendingProcedures.push(...nested.pendingProcedures);
      pendingEvents.push(...nested.pendingEvents);
      continue;
    }

    // match: step — dispatch on a resolved value
    if (step.match !== undefined) {
      const matchValue = resolveValue(step.match, context);
      const branches = step.when || {};
      const matchedSteps = branches[matchValue];
      if (matchedSteps) {
        const nested = applySteps(matchedSteps, resource, context);
        pendingCreates.push(...nested.pendingCreates);
        pendingOperations.push(...nested.pendingOperations);
        pendingAppends.push(...nested.pendingAppends);
        pendingProcedures.push(...nested.pendingProcedures);
        pendingEvents.push(...nested.pendingEvents);
      }
      continue;
    }

    if (step.forEach) {
      // forEach with in: iterates over an array parameter
      if (step.forEach.in !== undefined) {
        const inValue = resolveValue(step.forEach.in, context);
        const items = Array.isArray(inValue) ? inValue : [];
        const itemAlias = step.forEach.as;
        for (const item of items) {
          const itemContext = {
            ...context,
            entities: { ...(context.entities ?? {}), ...(itemAlias ? { [itemAlias]: item } : {}) },
            // Expose category/item as $params.category equivalent
            params: { ...(context.params || {}), ...(itemAlias ? { [itemAlias]: item } : {}) },
          };
          const nested = applySteps(step.do || [], resource, itemContext);
          pendingCreates.push(...nested.pendingCreates);
          pendingOperations.push(...nested.pendingOperations);
          pendingAppends.push(...nested.pendingAppends);
          pendingProcedures.push(...nested.pendingProcedures);
          pendingEvents.push(...nested.pendingEvents);
        }
        continue;
      }

      const { from: collectionPath, where, as: itemAlias } = step.forEach;
      const forEachSteps = step.do || [];
      if (!collectionPath || !where || !itemAlias) {
        console.warn('forEach: missing required from:, where:, or as: — skipping');
        continue;
      }

      const collection = deriveCollectionName(collectionPath, collectionPath.split('/')[0]);
      const logicOperators = new Set(['==', '!=', '>', '>=', '<', '<=', 'and', 'or', 'not', 'in', '!', 'if', 'var', 'missing', 'all', 'none', 'some', 'merge', 'cat', 'substr', 'log']);
      const isJsonLogic = Object.keys(where).some(k => logicOperators.has(k));

      let items;
      if (isJsonLogic) {
        const { items: allItems } = findAll(collection, {});
        const logicData = {
          this: context.this ?? {},
          object: context.object ?? {},
          ...Object.fromEntries(Object.entries(context.entities ?? {}))
        };
        items = allItems.filter(item => {
          try {
            return jsonLogic.apply(where, { ...logicData, ...item });
          } catch (e) {
            console.warn(`forEach: JSON Logic where filter error — ${e.message}`);
            return false;
          }
        });
      } else {
        // Field-value equality pairs: resolve each value expression then query
        const query = {};
        for (const [field, val] of Object.entries(where)) {
          query[field] = resolveValue(val, context);
        }
        const hasUndefined = Object.values(query).some(v => v === undefined);
        if (hasUndefined) {
          console.warn('forEach: where clause resolved to undefined — skipping');
          continue;
        }
        ({ items } = findAll(collection, query));
      }

      for (const item of items) {
        const itemContext = {
          ...context,
          entities: { ...(context.entities ?? {}), [itemAlias]: item },
        };
        const nested = applySteps(forEachSteps || [], resource, itemContext);
        pendingCreates.push(...nested.pendingCreates);
        pendingOperations.push(...nested.pendingOperations);
        pendingAppends.push(...nested.pendingAppends);
        pendingProcedures.push(...nested.pendingProcedures);
        pendingEvents.push(...nested.pendingEvents);
      }
    } else if (step.set) {
      resource[step.set.field] = resolveValue(step.set.value, context);
    } else if (step.emit) {
      const data = {};
      for (const [key, value] of Object.entries(step.emit.data || {})) {
        data[key] = resolveValue(value, context);
      }
      pendingEvents.push({ action: step.emit.event, data });
    } else if (step.evaluate) {
      pendingProcedures.push({ procedureId: step.evaluate });
    } else if (step.call !== undefined) {
      // call: can be a string (procedure name) or an object (HTTP operation, formerly invoke:)
      if (typeof step.call === 'string') {
        // String form: call a named procedure — handled by the runner, not here
        pendingProcedures.push({ procedureId: step.call, with: step.with });
      } else if (step.call && typeof step.call === 'object') {
        // Object form: HTTP operation (formerly invoke:)
        applyCallObjectStep(step.call, context, pendingCreates, pendingOperations, pendingAppends);
      }
    } else if (step.invoke) {
      // Legacy invoke: support (string or object form)
      if (typeof step.invoke === 'string') {
        // Legacy string form: invoke: "path" with separate body:
        const rawPath = step.invoke;
        const path = interpolatePath(rawPath, context);
        const body = resolveBody(step.body, context);
        if (rawPath.includes('{')) {
          pendingOperations.push({ path, rawPath, body });
        } else {
          const domain = rawPath.split('/')[0];
          const entity = deriveCollectionName(rawPath, domain);
          pendingCreates.push({ entity, data: body });
        }
      } else {
        // Legacy object form: { POST: path, body: ... }
        applyCallObjectStep(step.invoke, context, pendingCreates, pendingOperations, pendingAppends);
      }
    }
  }

  return { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents };
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
 * @returns {{ pendingCreates: Array, pendingProcedures: Array, pendingEvents: Array }}
 */
export function applyEffects(effects, resource, context) {
  const pendingCreates = [];
  const pendingProcedures = [];
  const pendingEvents = [];

  if (!effects) return { pendingCreates, pendingProcedures, pendingEvents };

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
      default:
        // Silently skip unimplemented effect types (forward-compatible)
        break;
    }
  }

  return { pendingCreates, pendingProcedures, pendingEvents };
}
