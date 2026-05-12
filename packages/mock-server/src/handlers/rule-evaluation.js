/**
 * Shared helper for processing pending rule evaluations.
 * Used by both the transition handler and create handler.
 */

import jsonLogic from 'json-logic-js';
import { create, update, findAll, findById } from '../database-manager.js';
import { findRuleSet } from '../rules-loader.js';
import { buildRuleContext, evaluateRuleSet, evaluateAllMatchRuleSet, resolvePath } from '../rules-engine.js';
import { executeActions } from '../action-handlers.js';
import { deriveCollectionName } from '../collection-utils.js';
import { applySteps } from '../state-machine-engine.js';

/**
 * Build the dependencies object for action handlers (external rule sets path).
 */
function buildDependencies() {
  return {
    findByField(collection, field, value) {
      const { items } = findAll(collection, { [field]: value }, { limit: 1 });
      return items.length > 0 ? items[0] : null;
    }
  };
}

/**
 * Resolve a dot-notation path against an object.
 */
function resolveDotPath(obj, path) {
  if (obj == null || !path) return null;
  return path.split('.').reduce((cur, key) => (cur == null ? null : cur[key]), obj) ?? null;
}

/**
 * Resolve context bindings for a rule set by fetching related entities from the database.
 * Bindings are resolved in order; each binding can reference previously resolved entities
 * via its `from` path (chaining). The calling resource fields are also available in `from`
 * path resolution without namespace prefix.
 *
 * Returns null if any required entity cannot be found — the caller should skip the rule set.
 * Logs a warning and skips the binding if `from` resolves to no value on the resource.
 *
 * @param {Array} contextBindings - Array of { as, entity, from } binding objects from ruleSet.context
 * @param {Object} resource - The primary resource being evaluated
 * @returns {Object|null} Map of alias → fetched entity, or null if a required entity is missing
 */
export function resolveContextEntities(contextBindings, resource) {
  const resolved = {};

  for (const binding of contextBindings || []) {
    if (typeof binding !== 'object' || !binding.as || !binding.from) continue;

    // Extract dot-path from from field (string or JSON Logic {var: "path"} form)
    const fromPath = typeof binding.from === 'string'
      ? binding.from
      : (typeof binding.from?.var === 'string' ? binding.from.var : null);

    if (fromPath === null) {
      console.warn(`Context binding "${binding.as}": complex JSON Logic "from" is not supported — skipping binding`);
      continue;
    }

    // Resolve the from path against resource fields + previously resolved entities (chaining).
    const lookupContext = { ...resource, ...resolved };
    const fromValue = resolvePath(lookupContext, fromPath);

    if (binding.entity) {
      // Entity binding — fromValue is an ID; fetch the entity by that ID
      const collectionName = binding.entity.split('/').pop();

      if (!fromValue) {
        if (binding.optional) {
          console.warn(
            `Context binding "${binding.as}": "${fromPath}" resolved to no value — skipping binding (optional)`
          );
          continue;
        }
        console.error(
          `Context binding "${binding.as}": "${fromPath}" resolved to no value — skipping rule set`
        );
        return null;
      }

      const entity = findById(collectionName, fromValue);
      if (!entity) {
        if (binding.optional) {
          console.warn(
            `Context binding "${binding.as}": "${binding.entity}" with id "${fromValue}" not found — skipping binding (optional)`
          );
          continue;
        }
        console.error(
          `Context binding "${binding.as}": "${binding.entity}" with id "${fromValue}" not found — skipping rule set`
        );
        return null;
      }

      resolved[binding.as] = entity;
    } else {
      // Collection binding — fromValue is bound directly (no entity lookup)
      if (fromValue === undefined || fromValue === null) {
        if (binding.optional) {
          console.warn(
            `Context binding "${binding.as}": "${fromPath}" resolved to no value — skipping binding (optional)`
          );
          continue;
        }
        console.error(
          `Context binding "${binding.as}": "${fromPath}" resolved to no value — skipping rule set`
        );
        return null;
      }

      resolved[binding.as] = fromValue;
    }
  }

  return resolved;
}

/**
 * Resolve a where clause value expression against the current resolution context.
 * Supports: $object.field, $this.field, $alias.field, literal strings.
 */
function resolveWhereValue(val, resource, context, resolved) {
  if (typeof val !== 'string') return val;
  if (val.startsWith('$object.')) return resource[val.slice('$object.'.length)];
  if (val.startsWith('$this.')) return resolveDotPath(context?.this, val.slice('$this.'.length));
  if (val.startsWith('$') && val.includes('.')) {
    const dot = val.indexOf('.');
    return resolveDotPath(resolved[val.slice(1, dot)], val.slice(dot + 1));
  }
  return val;
}

/**
 * Resolve context bindings from a state machine inline rule's `context:` array.
 * Each item is { alias: { from, where?, optional? } }.
 *
 * RETURN TYPE — single entity vs. array:
 *   where: { id: <value> }           → single entity (findById); null if not found
 *   where: { otherField: <value> }   → array of all matching records (may be empty)
 *   JSON Logic where:                → array of all records passing the condition
 *   (no where)                       → not valid; binding is skipped with a warning
 *
 * WHERE CLAUSE — two supported forms:
 *
 *   (1) Field-value equality pairs. Values may be:
 *         $object.field  → field on the primary resource being evaluated
 *         $this.field    → field on the triggering event/context (nested dot paths ok)
 *         $alias.field   → field on a previously resolved binding (chaining)
 *         literal string → exact match value
 *
 *       { id: $this.subject }              → single entity lookup
 *       { applicationId: $application.id } → all members for this application → array
 *       { name: snap-intake }              → first queue with that name → single (id field absent)
 *
 *   (2) JSON Logic expression — use when you need inequality, AND/OR, or computed
 *       conditions. Evaluated per-candidate record; matching records are collected
 *       into an array. Variable references:
 *         { var: "fieldName" }        → field on the candidate record
 *         { var: "this.field" }       → field on the triggering event/context
 *         { var: "alias.field" }      → field on a previously resolved binding
 *
 * Bindings are resolved in order; each binding may reference previously resolved aliases.
 * Required bindings that cannot be resolved cause null to be returned (rule is skipped).
 * Optional bindings that fail resolve to null or [] and are included in the map.
 *
 * @param {Array} contextBindings - Array of single-key objects { alias: { from, where, optional } }
 * @param {Object} resource - Primary resource for $object.field resolution
 * @param {Object} [context] - Step context for $this.field and previously resolved alias resolution
 * @returns {Object|null} Map of alias → entity|array|null, or null if a required binding fails
 */
export function resolveInlineRuleContext(contextBindings, resource, context) {
  const resolved = {};

  for (const binding of contextBindings || []) {
    const alias = Object.keys(binding)[0];
    const config = binding[alias];
    if (!config || !config.from) continue;

    const collection = deriveCollectionName(config.from, config.from.split('/')[0]);
    const where = config.where;

    if (!where) {
      console.warn(`Context binding "${alias}": no where clause — skipping binding`);
      if (config.optional) { resolved[alias] = null; continue; }
      return null;
    }

    // Detect where form: JSON Logic if top-level keys include logic operators;
    // otherwise treat as field-value equality pairs.
    const logicOperators = new Set(['==', '!=', '>', '>=', '<', '<=', 'and', 'or', 'not', 'in', '!', 'if', 'var', 'missing', 'all', 'none', 'some', 'merge', 'cat', 'substr', 'log']);
    const isJsonLogic = Object.keys(where).some(k => logicOperators.has(k));

    if (isJsonLogic) {
      // JSON Logic where: fetch all records and return the first match.
      // ContextBinding always returns a single entity. Use forEach: to iterate over all matches.
      const { items: allItems } = findAll(collection, {});
      const logicData = {
        this: context?.this ?? {},
        object: resource,
        ...Object.fromEntries(Object.entries(resolved))
      };
      const entity = allItems.find(item => {
        try {
          return jsonLogic.apply(where, { ...logicData, ...item });
        } catch (e) {
          console.warn(`Context binding "${alias}": JSON Logic where filter error — ${e.message}`);
          return false;
        }
      }) ?? null;

      if (!entity) {
        if (config.optional) { resolved[alias] = null; continue; }
        console.error(`Context binding "${alias}": JSON Logic where matched no records — skipping rule`);
        return null;
      }
      resolved[alias] = entity;
      continue;
    }

    // Field-value equality pairs: resolve each value expression
    const query = {};
    for (const [field, val] of Object.entries(where)) {
      query[field] = resolveWhereValue(val, resource, context, resolved);
    }

    // If any where-clause value resolved to undefined, the source field doesn't exist —
    // the entity can't be found (don't fall through to an unfiltered query).
    const hasUndefinedValue = Object.values(query).some(v => v === undefined);
    if (hasUndefinedValue) {
      if (config.optional) { resolved[alias] = null; continue; }
      return null;
    }

    if (query.id) {
      // id lookup → single entity
      const entity = findById(collection, query.id);
      if (!entity) {
        if (config.optional) { resolved[alias] = null; continue; }
        return null;
      }
      resolved[alias] = entity;
    } else {
      // Non-id lookup → first match (single entity).
      // Use forEach: to iterate over all matching records.
      const { items } = findAll(collection, query, { limit: 1 });
      const entity = items.length > 0 ? items[0] : null;
      if (!entity) {
        if (config.optional) { resolved[alias] = null; continue; }
        return null;
      }
      resolved[alias] = entity;
    }
  }

  return resolved;
}

/**
 * Resolve context bindings across multiple scope levels in declaration order.
 * Domain → machine → trigger/operation. Each layer can reference aliases resolved
 * by prior layers (chaining across levels). Inner scope wins on name conflict.
 *
 * Returns null if any required binding in any layer fails — the caller should
 * skip the trigger or operation.
 *
 * @param {Array<Array|null|undefined>} layers - Binding arrays in scope order (outermost first)
 * @param {Object} resource - Primary resource for $object.* resolution
 * @param {Object} baseContext - Base step context (caller, this, now, existing entities)
 * @returns {Object|null} Merged entities map, or null if a required binding failed
 */
export function resolveContextLayers(layers, resource, baseContext) {
  let entities = { ...(baseContext.entities || {}) };
  for (const bindings of layers) {
    if (!bindings || bindings.length === 0) continue;
    const layerContext = { ...baseContext, entities };
    const resolved = resolveInlineRuleContext(bindings, resource, layerContext);
    if (resolved === null) return null;
    Object.assign(entities, resolved);
  }
  return entities;
}

/**
 * Apply a pending array-append (PATCH with $push body) to a resource in the database.
 * @param {{ path: string, body: Object }} append - Resolved path and body with $push values
 */
function applyPendingAppend({ path, body }) {
  const parts = path.split('/');
  const id = parts.pop();
  const collectionPath = parts.join('/');
  const domain = parts[0];
  const collection = deriveCollectionName(collectionPath, domain);

  const existing = findById(collection, id);
  if (!existing) {
    console.error(`applyPendingAppend: ${collection}/${id} not found`);
    return;
  }

  const patch = {};
  for (const [field, val] of Object.entries(body || {})) {
    if (val && typeof val === 'object' && '$push' in val) {
      const currentArr = Array.isArray(existing[field]) ? existing[field] : [];
      patch[field] = [...currentArr, val['$push']];
    } else {
      patch[field] = val;
    }
  }

  update(collection, id, patch);
}

/**
 * Evaluate inline state machine rules (defined in the `rules:` block of a state machine YAML).
 *
 * Handles creates and appends directly (no circular dependency with state-machine-runner).
 * Returns pending operation triggers (POST to path with {template}) for callers to handle
 * via executeTransition — those require state machine lookup which callers already have.
 *
 * @param {string} ruleId - The rule id to find
 * @param {Array} inlineRules - The `rules:` array from the state machine top-level doc
 * @param {Object} resource - Resource to mutate in place
 * @param {Object} context - State machine context ({ caller, object, request, this, entities, now })
 * @returns {Array<{ path: string, rawPath: string, body: Object }>} Pending operation triggers
 */
function evaluateInlineRule(ruleId, inlineRules, resource, context) {
  const rule = (inlineRules || []).find(r => r.id === ruleId);
  if (!rule) {
    console.warn(`Inline rule "${ruleId}" not found in state machine`);
    return [];
  }

  const entities = resolveInlineRuleContext(rule.context, resource, context);
  if (entities === null) return []; // required binding failed

  // Extend step context with resolved entities (alias → entity, no $ prefix)
  const stepContext = { ...context, entities: { ...(context.entities || {}), ...entities } };

  // Build JSON Logic data with $ prefix for condition evaluation
  const data = { '$object': { ...resource } };
  for (const [alias, entity] of Object.entries(entities)) {
    data[`$${alias}`] = entity; // may be null for optional-not-found
  }

  const conditions = [...(rule.conditions || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const allPendingOperations = [];

  for (const cond of conditions) {
    let matches = false;
    try {
      matches = cond.condition === true || jsonLogic.apply(cond.condition, data);
    } catch (e) {
      console.warn(`Inline rule "${ruleId}" condition "${cond.id}" evaluation error: ${e.message}`);
      continue;
    }

    if (matches) {
      const { pendingCreates, pendingOperations, pendingAppends, pendingRuleEvaluations } =
        applySteps(cond.then || [], resource, stepContext);

      for (const { entity, data: createData } of pendingCreates) {
        try {
          create(entity, createData);
        } catch (e) {
          console.error(`evaluateInlineRule: create "${entity}" failed: ${e.message}`);
        }
      }

      for (const append of pendingAppends) {
        applyPendingAppend(append);
      }

      allPendingOperations.push(...pendingOperations);

      if (pendingRuleEvaluations.length > 0) {
        const { pendingOperations: nestedOps } = processRuleEvaluations(
          pendingRuleEvaluations, resource, null, null, inlineRules, stepContext
        );
        allPendingOperations.push(...(nestedOps || []));
      }

      if (rule.evaluation !== 'all-match') break; // first-match-wins
    }
  }

  return allPendingOperations;
}

/**
 * Process pending rule evaluations against a resource.
 * Handles both external rule files ({ ruleType }) and inline state machine rules ({ ruleId }).
 *
 * @param {Array<{ ruleType?: string, ruleId?: string }>} pendingRuleEvaluations
 * @param {Object} resource - Resource to mutate
 * @param {Array} rules - All loaded rules from discoverRules()
 * @param {string} domain - Domain name (e.g., "workflow")
 * @param {Array} [inlineRules] - Inline rules from stateMachine.rules (new format)
 * @param {Object} [context] - State machine context for inline rule step evaluation
 * @returns {{ pendingOperations: Array }} Collected pending operation triggers from inline rules
 */
export function processRuleEvaluations(pendingRuleEvaluations, resource, rules, domain, inlineRules = [], context = null) {
  const allPendingOperations = [];
  if (!pendingRuleEvaluations || pendingRuleEvaluations.length === 0) return { pendingOperations: allPendingOperations };

  const deps = buildDependencies();
  const stepContext = context ?? { caller: { id: 'system', roles: [] }, object: { ...resource }, request: {}, now: new Date().toISOString() };

  for (const item of pendingRuleEvaluations) {
    const { ruleType, ruleId } = item;

    if (ruleId) {
      const ops = evaluateInlineRule(ruleId, inlineRules, resource, stepContext);
      allPendingOperations.push(...ops);
      continue;
    }

    if (!rules || !ruleType) continue;

    // External rules file — look up by domain + ruleType
    const found = findRuleSet(rules, domain, ruleType);
    if (!found) continue;

    const { ruleSet } = found;
    const resolvedEntities = resolveContextEntities(ruleSet.context, resource);
    if (resolvedEntities === null) continue; // required entity not found — skip rule set

    const contextData = buildRuleContext(resource, resolvedEntities);

    if (ruleSet.evaluation === 'all-match') {
      const results = evaluateAllMatchRuleSet(ruleSet, contextData);
      for (const result of results) {
        executeActions(result.action, resource, deps, result.fallbackAction);
      }
    } else {
      const result = evaluateRuleSet(ruleSet, contextData);
      if (result.matched) {
        executeActions(result.action, resource, deps, result.fallbackAction);
      }
    }
  }

  return { pendingOperations: allPendingOperations };
}
