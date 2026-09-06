/**
 * Builds a schema-conformant graph.json from a loaded rulespec model.
 *
 * Node path conventions (matching the universal graph schema):
 *   parameters    → "paramName"              (derived, constant expression)
 *   dataRelations → "$.Entity.factKey"       (input, no expression)
 *   derivedRules  → "Entity.ruleName"        (derived, CEL expression)
 *
 * Discriminated data relations (e.g. hours_of_activity_in_month with a
 * QualifyingActivityKind discriminator) are expanded into one input node
 * per enum value: $.Person.hours_of_activity_in_month_work, etc.
 *
 * Expressions use bare local variable names (last path segment) so the
 * graph evaluator can resolve them by scope without path lookups.
 */

import { parse } from '../formula-parser.js';
import { translateFormula } from '../translate/formula-to-cel.js';

const ENTITY_SIG_TYPES   = new Set(['Person', 'Case', 'Month', 'Day']);
const PERIOD_SIG_TYPES   = new Set(['Month', 'Day', 'Eternity']);
const PRIMITIVE_SIG_TYPES = new Set(['Integer', 'Money', 'Rate', 'Date', 'Boolean', 'String']);

function dtypeToJsonType(dtype) {
  if (!dtype) return undefined;
  if (dtype === 'Boolean') return 'boolean';
  if (dtype === 'Integer') return 'integer';
  if (dtype === 'Money' || dtype === 'Rate') return 'number';
  if (dtype === 'Date') return 'string';
  return 'string';
}

/** Returns the entity type name (capitalized) from a signature, or null. */
function entityFromSig(sig) {
  return (sig?.length > 0 && ENTITY_SIG_TYPES.has(sig[0])) ? sig[0] : null;
}

/**
 * Walk a formula AST and collect all full node paths it references.
 * Each path matches exactly the node path used in the `nodes` map so edges
 * can be built without a second lookup step.
 */
function collectRefs(ast, ctx, refs) {
  if (!ast || typeof ast !== 'object') return;

  if (ast.type === 'Call') {
    const { name, args } = ast;

    if (ctx.parameterNames.has(name)) {
      refs.add(`$.${name}`);
    } else {
      const callable = ctx.callables.get(name);
      if (callable) {
        const sig = callable.sigTypes ?? [];
        const callSig = sig.length > args.length ? sig.slice(0, args.length) : sig;

        // Extract discriminator values from non-entity, non-period, non-primitive sig positions
        const discValues = [];
        for (let i = 1; i < callSig.length; i++) {
          const t = callSig[i];
          if (PERIOD_SIG_TYPES.has(t) || ENTITY_SIG_TYPES.has(t) || PRIMITIVE_SIG_TYPES.has(t)) continue;
          const arg = args[i];
          if (arg?.type === 'Identifier') discValues.push(arg.name);
        }

        const suffix  = discValues.length > 0 ? '_' + discValues.join('_') : '';
        const factKey = `${name}${suffix}`;
        const entityType = entityFromSig(sig);

        if (ctx.dataRelationNames.has(name)) {
          refs.add(entityType ? `$.${entityType}.${factKey}` : `$.${factKey}`);
        } else if (ctx.derivedRuleNames.has(name)) {
          const ruleEntity = ctx.derivedRuleEntities.get(name);
          refs.add(ruleEntity ? `${ruleEntity}.${name}` : name);
        }
      }
    }

    for (const arg of args ?? []) collectRefs(arg, ctx, refs);
    return;
  }

  for (const val of Object.values(ast)) {
    if (Array.isArray(val))             val.forEach(v => collectRefs(v, ctx, refs));
    else if (val && typeof val === 'object') collectRefs(val, ctx, refs);
  }
}

/**
 * Build a schema-conformant graph from a loaded rulespec model.
 *
 * @param {object} rulespec - Output of loadRulespec() with types as a Map.
 * @returns {{ nodes: object, edges: object }}
 */
export function buildSchemaGraph(rulespec) {
  const { types, parameters, dataRelations, derivedRules } = rulespec;

  // ── Build translation context ──────────────────────────────────────────────

  const enumValues      = new Set();
  const enumTypes       = new Set();
  for (const [typeName, typeDef] of types) {
    if (typeDef.kind === 'enum') {
      enumTypes.add(typeName);
      for (const v of typeDef.values ?? []) enumValues.add(String(v));
    }
  }

  const parameterNames      = new Set(parameters.map(p => p.name));
  const dataRelationNames   = new Set(dataRelations.map(dr => dr.name));
  const derivedRuleNames    = new Set(derivedRules.map(dr => dr.name));
  const derivedRuleEntities = new Map(derivedRules.map(dr => [dr.name, dr.entity ?? null]));

  const callables = new Map();
  for (const dr of dataRelations) callables.set(dr.name, { sigTypes: dr.signature ?? [] });
  for (const dr of derivedRules) {
    const sigTypes = [];
    if (dr.entity) sigTypes.push(dr.entity);
    if (dr.period) sigTypes.push(dr.period);
    callables.set(dr.name, { sigTypes });
  }

  // localNames: true → expressions use bare variable names (e.g. enrolled_in_education_at_least_half_time)
  // instead of path-prefixed forms ($.person.enrolled_in_education_at_least_half_time)
  const transCtx = { parameterNames, enumValues, callables, dataRelationNames, localNames: true };
  const refCtx   = { parameterNames, callables, dataRelationNames, derivedRuleNames, derivedRuleEntities };

  const nodes = {};
  const edges = {};

  // ── 1. Parameters → input nodes with defaults ───────────────────────────────

  for (const param of parameters) {
    const versions = param.versions ?? [];
    const formula  = versions[versions.length - 1]?.formula;
    const nodeInfo = {};
    if (formula !== undefined) {
      const numVal = Number(formula);
      nodeInfo.default = Number.isNaN(numVal) ? String(formula) : numVal;
    }
    const type = dtypeToJsonType(param.dtype);
    if (type) nodeInfo.type = type;
    if (param.description) nodeInfo.description = param.description;
    nodes[`$.${param.name}`] = nodeInfo;
  }

  // ── 2. DataRelations → input nodes (expand discriminated variants) ─────────

  for (const dr of dataRelations) {
    const sig        = dr.signature ?? [];
    const entityType = entityFromSig(sig);
    const lastSig    = sig[sig.length - 1];
    // Signature ends with a primitive → that's the return type.
    // Ends with an entity/period → it's a boolean predicate (no explicit return type needed).
    const returnType = lastSig && PRIMITIVE_SIG_TYPES.has(lastSig)
      ? dtypeToJsonType(lastSig)
      : (lastSig && (ENTITY_SIG_TYPES.has(lastSig) || PERIOD_SIG_TYPES.has(lastSig)))
        ? 'boolean'
        : undefined;

    // Find discriminator positions (non-entity, non-period, non-primitive enum positions)
    const discPositions = [];
    for (let i = 1; i < sig.length - 1; i++) {
      const t = sig[i];
      if (enumTypes.has(t) && !ENTITY_SIG_TYPES.has(t) && !PERIOD_SIG_TYPES.has(t)) {
        discPositions.push(i);
      }
    }

    if (discPositions.length === 0) {
      const path     = entityType ? `$.${entityType}.${dr.name}` : `$.${dr.name}`;
      const nodeInfo = {};
      if (returnType)      nodeInfo.type        = returnType;
      if (dr.description)  nodeInfo.description = dr.description;
      nodes[path] = nodeInfo;
    } else {
      // Expand one node per discriminator enum value
      const discTypeName = sig[discPositions[0]];
      const discTypeDef  = types.get(discTypeName);
      const discValues   = discTypeDef?.values ?? [];
      for (const val of discValues) {
        const valStr   = String(val);
        const factKey  = `${dr.name}_${valStr}`;
        const path     = entityType ? `$.${entityType}.${factKey}` : `$.${factKey}`;
        const nodeInfo = {};
        if (returnType) nodeInfo.type = returnType;
        if (dr.description) nodeInfo.description = `${dr.description} (${valStr})`;
        nodes[path] = nodeInfo;
      }
    }
  }

  // ── 3. DerivedRules → derived nodes with CEL expressions + edges ───────────

  for (const dr of derivedRules) {
    const path     = dr.entity ? `${dr.entity}.${dr.name}` : dr.name;
    const versions = dr.versions ?? [];
    if (!versions.length) continue;
    const formula = versions[versions.length - 1]?.formula;
    if (formula == null) continue;

    const nodeInfo = {};
    try {
      nodeInfo.expression = translateFormula(String(formula), transCtx);
    } catch {
      nodeInfo.expression = String(formula); // store raw formula as fallback
    }
    const type = dtypeToJsonType(dr.dtype);
    if (type) nodeInfo.type = type;
    if (dr.description) nodeInfo.description = dr.description;
    nodes[path] = nodeInfo;

    // Build edges by walking the formula AST for referenced node paths
    try {
      const ast  = parse(String(formula));
      const refs = new Set();
      collectRefs(ast, refCtx, refs);
      if (refs.size > 0) {
        edges[dr.name] = [...refs].map(from => ({ from, to: path }));
      }
    } catch { /* skip edges for unparseable formulas */ }
  }

  return { nodes, edges };
}
