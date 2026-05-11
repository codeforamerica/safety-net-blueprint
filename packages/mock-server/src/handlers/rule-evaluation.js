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
 * Resolve context bindings from a state machine inline rule's `context:` array.
 * Each item is { alias: { from, where, optional } }.
 *
 * Supports where clauses that query by any field — not just id:
 *   where: { name: snap-intake }  → findAll by name (first match)
 *   where: { id: $object.subjectId } → findById
 *
 * Where clause values support expressions:
 *   $object.field  → resource[field]
 *   $this.field    → context.this[field] (nested dot paths supported)
 *   $alias.field   → previously resolved entities[alias][field]
 *   plain string   → literal value
 *
 * Returns a map of alias → entity (WITHOUT $ prefix).
 * Optional bindings that fail resolve as null (included in map for condition checks).
 * Required bindings that fail cause null to be returned (caller skips rule).
 *
 * @param {Array} contextBindings - Array of single-key objects
 * @param {Object} resource - The primary resource for $object.field resolution
 * @param {Object} [context] - Step context for $this.field and previously resolved alias resolution
 * @returns {Object|null} Map of alias → entity (or null), or null if a required binding fails
 */
function resolveInlineRuleContext(contextBindings, resource, context) {
  const resolved = {};

  for (const binding of contextBindings || []) {
    const alias = Object.keys(binding)[0];
    const config = binding[alias];
    if (!config || !config.from) continue;

    const collection = deriveCollectionName(config.from, config.from.split('/')[0]);
    const where = config.where || {};

    // Resolve where clause values — supports $object.field, $this.field, $alias.field, literals
    const query = {};
    for (const [field, val] of Object.entries(where)) {
      if (typeof val === 'string') {
        if (val.startsWith('$object.')) {
          query[field] = resource[val.slice('$object.'.length)];
        } else if (val.startsWith('$this.')) {
          query[field] = resolveDotPath(context?.this, val.slice('$this.'.length));
        } else if (val.startsWith('$') && val.includes('.')) {
          const dot = val.indexOf('.');
          const refAlias = val.slice(1, dot);
          const refField = val.slice(dot + 1);
          query[field] = resolveDotPath(resolved[refAlias], refField);
        } else {
          query[field] = val;
        }
      } else {
        query[field] = val;
      }
    }

    // If any where-clause value resolved to undefined, the source field doesn't exist
    // on the resource — the entity can't be found (don't fall through to an unfiltered query).
    const hasUndefinedValue = Object.values(query).some(v => v === undefined);
    if (hasUndefinedValue) {
      if (config.optional) { resolved[alias] = null; continue; }
      return null;
    }

    // Fetch entity — by id (findById) or by other field (findAll first match)
    let entity = null;
    if (query.id) {
      entity = findById(collection, query.id);
    } else {
      const { items } = findAll(collection, query, { limit: 1 });
      entity = items.length > 0 ? items[0] : null;
    }

    if (!entity) {
      if (config.optional) {
        resolved[alias] = null; // present as null so condition checks can test for it
        continue;
      }
      return null; // required binding failed — skip rule
    }

    resolved[alias] = entity;
  }

  return resolved;
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
