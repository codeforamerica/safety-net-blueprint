/**
 * State machine engine — pure logic, no Express dependencies.
 * Evaluates guards, finds transitions, and applies effects
 * based on a state machine contract.
 */

import jsonLogic from 'json-logic-js';
import { evaluateCEL as evaluateExpression } from '@codeforamerica/blueprint-core/cel';
import { deriveCollectionName, resolveDotPath } from './collection-utils.js';
import { resolveTimeToken } from './time-tokens.js';
import { evaluate as evaluateRules } from '@codeforamerica/blueprint-rules-engine';

// ── Rules index ───────────────────────────────────────────────────────────────
// Populated at startup by initRulesIndex(). Maps rulesetName → compiled graph.
let _rulesIndex = {};

/**
 * Initialize the rules index used by evaluate: steps.
 * Call once at server startup after discovering and compiling rules files.
 * @param {Object} index - map of rulesetName → compiled graph
 */
export function initRulesIndex(index) {
  _rulesIndex = index ?? {};
}

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
  const found = lookupValue(value, context);
  if (found !== undefined) return found;
  // Where a value is looked up rather than filled in — a guard, a where: —
  // a missing $request field is undefined and anything else missing is null,
  // as it always has been. Filling in uses fillValue instead.
  return typeof value === 'string' && value.startsWith('$request.') ? undefined : null;
}

/**
 * `a.b[0].c` read as resolveDotPath reads it, but undefined when any of it
 * isn't there and a null at the end kept as null.
 */
function lookupPath(obj, path) {
  if (obj === null || obj === undefined || !path) return undefined;
  let current = obj;
  for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Look up a value expression as resolveValue does, but tell a value that is
 * null from one that isn't there: undefined when the expression finds
 * nothing, null when what it finds is null. Filling a body to a schema needs
 * the difference (fitToSchema).
 *
 * @param {*} value - The value or expression to resolve
 * @param {Object} context
 * @returns {*} The value, or undefined when there is none
 */
export function lookupValue(value, context) {
  if (value === null || value === undefined) {
    return value === null ? null : undefined;
  }

  if (typeof value === 'string') {
    // A string with value expressions embedded in braces, as OpenAPI runtime
    // expressions embed them: "workflow.{$params.timerType}.{$object.id}".
    // Each is looked up as a lone value expression would be, and the pieces
    // joined; nothing is evaluated. A missing value contributes nothing.
    if (value.includes('{$')) {
      return value.replace(/\{(\$[^{}]+)\}/g, (_, expression) => {
        const part = resolveValue(expression, context);
        return part === null || part === undefined ? '' : String(part);
      });
    }

    if (value === '$now') {
      return context.now ?? new Date().toISOString();
    }

    if (value.startsWith('$now+') || value.startsWith('$now-') || value.startsWith('$now@')) {
      const now = context.now ? new Date(context.now) : new Date();
      return resolveTimeToken(value, now);
    }

    if (value === '$object') return context.object ?? undefined;
    if (value === '$caller') return context.caller ?? undefined;
    if (value === '$request') return context.request ?? undefined;

    if (value.startsWith('$caller.')) {
      const field = value.slice('$caller.'.length);
      return lookupPath(context.caller, field);
    }

    if (value.startsWith('$object.')) {
      const field = value.slice('$object.'.length);
      return lookupPath(context.object, field);
    }

    if (value.startsWith('$request.')) {
      // A nested path, $request.lostStretch.startedAt, as $object's are.
      return lookupPath(context.request, value.slice('$request.'.length));
    }

    if (value.startsWith('$this.')) {
      return lookupPath(context.this, value.slice('$this.'.length));
    }

    if (value.startsWith('$params.')) {
      return lookupPath(context.params, value.slice('$params.'.length));
    }

    // Entity alias: $alias.field from context.entities
    // Handles any $prefix.field not matched above (e.g. $application.id, $snapQueue.id)
    if (value.startsWith('$') && value.includes('.')) {
      const dot = value.indexOf('.');
      const alias = value.slice(1, dot);
      const field = value.slice(dot + 1);
      if (context.entities !== undefined) {
        // An alias the entities map doesn't have finds nothing.
        return alias in context.entities ? lookupPath(context.entities[alias], field) : undefined;
      }
    }

    // Bare alias: $alias with no field — returns the whole entity.
    if (value.startsWith('$') && !value.includes('.')) {
      const alias = value.slice(1);
      if (context.entities !== undefined) {
        return context.entities[alias] ?? undefined;
      }
    }
  }

  return value;
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
      const value = resolveBodyValue(val, context);
      if (value !== undefined) result[key] = value;
    }
  }
  return result;
}

/**
 * Fill in a value from a value expression: what it finds, a null it finds, or
 * undefined when it finds nothing — which the caller leaves out
 * (docs/conventions/resources.yaml, null_and_absent).
 *
 * @param {*} value
 * @param {Object} context
 * @returns {*}
 */
export function fillValue(value, context) {
  return lookupValue(value, context);
}

/**
 * A call's body with each null its route's request schema doesn't accept
 * left out, where the context carries the schemas (step-calls.js, schemasFor).
 */
function fitBody(method, path, body, context) {
  return context.schemas?.body(method, path, body) ?? body;
}

/** An object of value expressions filled in, leaving out what found nothing. */
function fillFields(fields, context) {
  const result = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    const filled = fillValue(value, context);
    if (filled !== undefined) result[key] = filled;
  }
  return result;
}

/**
 * Resolve a single body value that may be a string expression, literal, array, or nested object.
 * Recurses into nested objects so expressions like { status: "confirmed", ids: "$this.data.ids" }
 * have their string fields resolved. A field whose expression finds nothing
 * is left out; an item of a list, which has no place to leave out, is null.
 */
export function resolveBodyValue(val, context) {
  if (typeof val === 'string') return fillValue(val, context);
  if (Array.isArray(val)) return val.map(item => resolveBodyValue(item, context) ?? null);
  if (val && typeof val === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(val)) {
      const value = resolveBodyValue(v, context);
      if (value !== undefined) result[k] = value;
    }
    return result;
  }
  return val;
}

/**
 * The variables a guard, `if:` or `match:` expression sees: `caller`,
 * `object`, `request`, `params`, `this` (the triggering event), `now`, and
 * each context binding by its alias. A binding never shadows a runtime
 * variable.
 */
function expressionContext(celData) {
  const ctx = {
    caller: celData.caller || {},
    object: celData.object || {},
    request: celData.request || {},
    params: celData.params || {},
    this: celData.this || {},
    now: celData.now || new Date().toISOString(),
  };
  for (const [alias, entity] of Object.entries(celData.entities || {})) {
    if (!(alias in ctx)) ctx[alias] = entity;
  }
  return ctx;
}

/**
 * Evaluate a CEL condition. An expression that does not evaluate — CEL names
 * why, e.g. a field the record does not have — is false, and the reason is
 * logged, since the contract is what needs fixing.
 *
 * @param {string} condition - CEL expression string
 * @param {Object} celData - caller, object, request, params, this, now, entities
 * @returns {boolean}
 */
function evaluateCEL(condition, celData) {
  if (!condition || typeof condition !== 'string') return true;
  try {
    return Boolean(evaluateExpression(condition, expressionContext(celData)));
  } catch (e) {
    console.warn(`CEL "${condition}" did not evaluate: ${e.message}`);
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
  const actions = machine.actions || [];

  const operation = actions.find(op => {
    if (op.id !== transitionName) return false;
    // In-place action with no transition.from — valid from any state
    if (!op.transition?.from) return true;
    const from = op.transition.from;
    return Array.isArray(from) ? from.includes(resource.status) : from === resource.status;
  });

  if (operation) {
    return { operation, error: null };
  }

  const opExists = actions.some(op => op.id === transitionName);
  if (!opExists) {
    return { operation: null, error: `Unknown action: ${transitionName}` };
  }

  // Read the way a guard's refusal reads: what was asked, and what it needs.
  const object = String(machine.object ?? 'record').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const from = [...new Set(actions.filter(op => op.id === transitionName).flatMap(op => [op.transition.from].flat()))];
  const states = from.length < 2 ? from.join('') : `${from.slice(0, -1).join(', ')} or ${from.at(-1)}`;
  return {
    operation: null,
    error: `Can't ${transitionName.replace(/-/g, ' ')} this ${object}. It requires that the ${object} is ${states}, and it is ${resource.status}.`
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
// Calls still sending `body:`, warned about once each.
const warnedBodies = new Set();

function warnDeprecatedBody(method, rawPath) {
  const call = `${method} ${rawPath}`;
  if (warnedBodies.has(call)) return;
  warnedBodies.add(call);
  console.warn(`call: ${call} sends body:, which is deprecated — write requestBody: {payload: …}. It is still read, and will be removed in a later release.`);
}

function applyCallObjectStep(spec, context, pendingCreates, pendingOperations, pendingAppends) {
  const method = 'POST' in spec ? 'POST' : 'PATCH' in spec ? 'PATCH' : 'GET' in spec ? 'GET' : 'DELETE' in spec ? 'DELETE' : null;
  if (!method) {
    console.warn('call: (object form) step missing POST, PATCH, GET, or DELETE key — skipping');
    return;
  }

  const rawPath = spec[method];
  const path = interpolatePath(rawPath, context);
  if (spec.body !== undefined && spec.requestBody === undefined) warnDeprecatedBody(method, rawPath);
  const body = fitBody(method, path, resolveBody(spec.requestBody?.payload ?? spec.body, context), context);

  if (method === 'POST') {
    if (rawPath.includes('{') || rawPath.includes('$')) {
      // Operation trigger: POST to domain/collection/{alias.id}/operation or $ref.field/operation
      pendingOperations.push({ path, rawPath, body });
    } else {
      // Collection create: POST to domain/collection
      const domain = rawPath.split('/')[0];
      const entity = deriveCollectionName(rawPath, domain);
      const pathSegs = rawPath.split('/').filter(s => s && !s.startsWith('{'));
      const lastSeg = pathSegs[pathSegs.length - 1] || '';
      const eventObject = (lastSeg.endsWith('s') ? lastSeg.slice(0, -1) : lastSeg).replace(/-/g, '_');
      const stubUrl = '/' + rawPath.split('/').slice(1).join('/');
      pendingCreates.push({ entity, domain, eventObject, stubUrl, data: body });
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
 * Walked by applySteps, and by applyStepsInOrder for an action, which
 * performs each call to an operation as the walk reaches it.
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
function* walkSteps(steps, resource, context, store, pending) {
  const { pendingCreates, pendingOperations, pendingAppends, pendingProcedures, pendingEvents } = pending;
  if (!steps) return;

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
      yield* walkSteps(branchSteps, resource, context, store, pending);
      continue;
    }

    // match: step — dispatch on the value of a CEL expression
    if (step.match !== undefined) {
      let matchValue;
      try {
        matchValue = evaluateExpression(step.match, expressionContext(context));
      } catch (e) {
        console.warn(`CEL "${step.match}" did not evaluate: ${e.message}`);
      }
      const branches = step.when || {};
      const matchedSteps = branches[matchValue];
      if (matchedSteps) {
        yield* walkSteps(matchedSteps, resource, context, store, pending);
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
          yield* walkSteps(step.do || [], resource, itemContext, store, pending);
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
        const { items: allItems } = store.findAll(collection, {});
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
        ({ items } = store.findAll(collection, query));
      }

      for (const item of items) {
        const itemContext = {
          ...context,
          entities: { ...(context.entities ?? {}), [itemAlias]: item },
        };
        yield* walkSteps(forEachSteps || [], resource, itemContext, store, pending);
      }
    } else if (step.set) {
      // Later steps read $object as this step left it — a timer set for the
      // expiresAt just defaulted, say.
      // A value expression that finds nothing sets nothing, and a null sets
      // nothing where the field doesn't accept one.
      const value = fillValue(step.set.value, context);
      if (value !== undefined && (value !== null || (context.schemas?.field(step.set.field, null) ?? true))) {
        resource[step.set.field] = value;
        if (context.object && context.object !== resource) context.object[step.set.field] = value;
      }
    } else if (step.emit) {
      // An emit declaring no data carries none, rather than an empty object.
      const filled = step.emit.data ? fillFields(step.emit.data, context) : undefined;
      const data = context.schemas?.event(step.emit.type, filled) ?? filled;
      pendingEvents.push({ type: step.emit.type, data, subject: step.emit.subject ? resolveValue(step.emit.subject, context) : undefined, causationid: step.emit.causationid ? resolveValue(step.emit.causationid, context) : undefined });
    } else if (step.evaluate) {
      const graph = _rulesIndex[step.evaluate];
      if (!graph) {
        console.warn(`evaluate: ruleset "${step.evaluate}" not found in rules index — skipping`);
        continue;
      }
      // An input may be an object of value expressions, resolved as a call's
      // body is — a household assembled from the records it's read from.
      const inputs = resolveBodyValue(step.inputs || {}, context);
      const nodes = evaluateRules(graph, inputs);
      if (step.bind) {
        if (!context.entities) context.entities = {};
        if (typeof step.bind === 'string') {
          const alias = step.bind.startsWith('$') ? step.bind.slice(1) : step.bind;
          context.entities[alias] = nodes;
        } else if (typeof step.bind === 'object') {
          for (const [localAlias, factName] of Object.entries(step.bind)) {
            context.entities[localAlias] = nodes[factName]?.value ?? null;
          }
        }
      }
    } else if (step.call !== undefined) {
      // A call to an operation by its operationId, or to one held in data
      // (`$request.call`), is performed where it stands: the walk waits for
      // its outcome, so a step after it runs after it.
      if (isOperationCall(step.call)) {
        yield { step, context };
        continue;
      }
      // call: can be a string (procedure name) or an object (HTTP operation, formerly invoke:)
      if (typeof step.call === 'string') {
        // String form: call a named procedure — handled by the runner, not here.
        // Its with: is read where the call stands, inside a forEach its item.
        pendingProcedures.push({ procedureId: step.call, with: step.with, at: context });
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
        const body = fitBody('POST', path, resolveBody(step.body, context), context);
        if (rawPath.includes('{')) {
          pendingOperations.push({ path, rawPath, body });
        } else {
          const domain = rawPath.split('/')[0];
          const entity = deriveCollectionName(rawPath, domain);
          const pathSegs = rawPath.split('/').filter(s => s && !s.startsWith('{'));
          const lastSeg = pathSegs[pathSegs.length - 1] || '';
          const eventObject = (lastSeg.endsWith('s') ? lastSeg.slice(0, -1) : lastSeg).replace(/-/g, '_');
          pendingCreates.push({ entity, domain, eventObject, data: body });
        }
      } else {
        // Legacy object form: { POST: path, body: ... }
        applyCallObjectStep(step.invoke, context, pendingCreates, pendingOperations, pendingAppends);
      }
    }
  }

}

function emptyPending() {
  return { pendingCreates: [], pendingOperations: [], pendingAppends: [], pendingProcedures: [], pendingEvents: [] };
}

/**
 * Whether a call names an operation — `{ operationId, parameters, requestBody }` —
 * or takes one from data, `$request.call`, rather than naming a procedure or a
 * method and path.
 *
 * @param {*} call - A step's `call:`
 * @returns {boolean}
 */
export function isOperationCall(call) {
  if (typeof call === 'string') return call.startsWith('$');
  return Boolean(call && typeof call === 'object' && 'operationId' in call);
}

/**
 * The operation call a step makes, its value expressions resolved.
 *
 * @param {string|Object} call - A step's `call:`
 * @param {Object} context
 * @returns {{ operationId: string, parameters?: Array, requestBody?: { contentType?: string, payload?: * } }|null}
 */
export function operationCallOf(call, context) {
  if (typeof call === 'string') {
    const value = resolveValue(call, context);
    return value && typeof value === 'object' && value.operationId ? value : null;
  }
  const resolved = { operationId: call.operationId };
  if (call.parameters) {
    resolved.parameters = call.parameters.map((p) => ({ ...p, value: resolveValue(p.value, context) }));
  }
  if (call.requestBody !== undefined) {
    resolved.requestBody = { ...call.requestBody };
    if (call.requestBody.payload !== undefined) {
      const payload = resolveBodyValue(call.requestBody.payload, context);
      resolved.requestBody.payload = context.schemas?.call(call.operationId, call.requestBody.contentType, payload) ?? payload;
    }
  }
  return resolved;
}

/**
 * Apply a list of steps, collecting what they leave to be done.
 *
 * A call to an operation is performed only in an action (applyStepsInOrder),
 * where its outcome can decide the action's; anywhere else it is skipped,
 * with a warning naming it.
 *
 * @param {Array} steps
 * @param {Object} resource - Mutated in place
 * @param {Object} context
 * @param {Object} store
 * @returns {{
 *   pendingCreates: Array<{ entity: string, data: Object }>,
 *   pendingOperations: Array<{ path: string, rawPath: string, body: Object }>,
 *   pendingAppends: Array<{ path: string, body: Object }>,
 *   pendingProcedures: Array<{ procedureId?: string }>,
 *   pendingEvents: Array<{ action: string, data: Object }>
 * }}
 */
export function applySteps(steps, resource, context, store) {
  const pending = emptyPending();
  for (const { step } of walkSteps(steps, resource, context, store, pending)) {
    const named = typeof step.call === 'string' ? step.call : step.call.operationId;
    console.warn(`call: ${named} calls an operation, which only a state machine action can do — skipping`);
  }
  return pending;
}

/**
 * The entities a call's `catch:` steps see: the failure under the name its
 * `as` gives, `error` by default as in Serverless Workflow — the HTTP status
 * alongside the error body's code, message and details.
 *
 * @param {Object} step - A call step with `catch:`
 * @param {{ status: number, body: * }} outcome
 * @param {Object} [entities]
 * @returns {Object}
 */
export function caughtEntities(step, outcome, entities = {}) {
  const body = outcome.body && typeof outcome.body === 'object' ? outcome.body : {};
  return { ...entities, [step.catch.as ?? 'error']: { status: outcome.status, ...body } };
}

/**
 * Apply an action's steps in order, performing each call to an operation as
 * it is reached.
 *
 * A call that fails stops the walk. What the steps did up to then is
 * returned under `failed`, with the step and the outcome, for the action to
 * discard: `catch:` runs instead of them, and with none the action fails.
 *
 * @param {Array} steps
 * @param {Object} resource - Mutated in place
 * @param {Object} context
 * @param {Object} store
 * @param {(call: Object, step: Object) => Promise<{ ok: boolean, status: number, body: * }>} perform
 * @returns {Promise<ReturnType<typeof applySteps> & { failed?: { step: Object, call: Object, outcome: Object } }>}
 */
export async function applyStepsInOrder(steps, resource, context, store, perform) {
  const pending = emptyPending();
  const walker = walkSteps(steps, resource, context, store, pending);
  for (let next = walker.next(); !next.done; next = walker.next()) {
    const { step, context: at } = next.value;
    const call = operationCallOf(step.call, at);
    const outcome = call
      ? await perform(call, step)
      : { ok: false, status: 500, body: { code: 'INTERNAL_ERROR', message: `call: ${step.call} names no operation call` } };
    if (!outcome.ok) {
      walker.return();
      return { ...pending, failed: { step, call, outcome } };
    }
    bindOutcome(step, at, outcome);
  }
  return pending;
}

/**
 * Bind what a call to an operation answered, for the steps after it: the
 * whole response body to one name (`bind: $inputs`), or chosen fields of it
 * to names of their own (`bind: { asOf: interviewDate }`).
 *
 * @param {Object} step - The call step
 * @param {Object} context - The context the steps after it read
 * @param {{ body?: * }} outcome - The call's successful outcome
 */
function bindOutcome(step, context, outcome) {
  if (!step.bind) return;
  if (!context.entities) context.entities = {};
  if (typeof step.bind === 'string') {
    context.entities[step.bind.replace(/^\$/, '')] = outcome.body ?? null;
    return;
  }
  for (const [alias, field] of Object.entries(step.bind)) {
    context.entities[alias] = resolveDotPath(outcome.body, field.replace(/^\$/, '')) ?? null;
  }
}

/**
 * Apply steps in order, performing each call to an operation as it is reached
 * — for a procedure or an event's reaction, which, unlike an action, mostly
 * make no such call. With none, the steps are applied at once and their
 * result returned as it is; at the first call, the rest follows the call's
 * outcome and a promise is returned. A call that fails stops the walk, as in
 * applyStepsInOrder; without `perform`, a call is skipped with a warning, as
 * in applySteps.
 *
 * @param {Array} steps
 * @param {Object} resource - Mutated in place
 * @param {Object} context
 * @param {Object} store
 * @param {Function|null} perform - As for applyStepsInOrder
 * @returns {Object|Promise<Object>} As applyStepsInOrder resolves to
 */
export function applyStepsWithCalls(steps, resource, context, store, perform) {
  const pending = emptyPending();
  const walker = walkSteps(steps, resource, context, store, pending);
  const advance = () => {
    for (let next = walker.next(); !next.done; next = walker.next()) {
      const { step, context: at } = next.value;
      if (!perform) {
        const named = typeof step.call === 'string' ? step.call : step.call.operationId;
        console.warn(`call: ${named} calls an operation, which nothing here can make — skipping`);
        continue;
      }
      const call = operationCallOf(step.call, at);
      const outcome = call
        ? perform(call, step)
        : Promise.resolve({ ok: false, status: 500, body: { code: 'INTERNAL_ERROR', message: `call: ${step.call} names no operation call` } });
      return outcome.then((result) => {
        if (result.ok) {
          bindOutcome(step, at, result);
          return advance();
        }
        walker.return();
        return { ...pending, failed: { step, call, outcome: result } };
      });
    }
    return pending;
  };
  return advance();
}

/**
 * Go on with a value now, or once it settles when it is a promise — so what
 * makes no call stays synchronous.
 *
 * @template T, U
 * @param {T|Promise<T>} value
 * @param {(value: T) => U} next
 * @returns {U|Promise<U>}
 */
export function whenReady(value, next) {
  return value && typeof value.then === 'function' ? value.then(next) : next(value);
}

/**
 * Apply a single set effect to a resource.
 * @param {Object} effect - Effect definition with field and value
 * @param {Object} resource - The resource to modify (mutated in place)
 * @param {Object} context - Context with caller info
 */
export function applySetEffect(effect, resource, context) {
  const value = fillValue(effect.value, context);
  if (value !== undefined) {
    resource[effect.field] = value;
  }
}

/**
 * Apply a single create effect — resolves all fields and returns the data to create.
 * Engine stays pure: no database dependency.
 * @param {Object} effect - Effect definition with entity and fields
 * @param {Object} context - Context with caller, object, and now info
 * @returns {{ entity: string, data: Object }}
 */
export function applyCreateEffect(effect, context) {
  return { entity: effect.entity, data: fillFields(effect.fields, context) };
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
  return { action: effect.action, data: fillFields(effect.data, context) };
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
