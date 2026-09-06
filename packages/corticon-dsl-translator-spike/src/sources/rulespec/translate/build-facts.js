import { translateFormula } from './formula-to-cel.js';

/** Sig types that indicate the first element is an "entity" position. */
const ENTITY_SIG_TYPES = new Set(['Person', 'Case', 'Month', 'Day']);

/** Period types that appear as temporal position markers in signatures. */
const PERIOD_SIG_TYPES = new Set(['Month', 'Day', 'Eternity']);

/** Primitive return types: when the last sig element is one of these, it is
 *  the return type and is not a discriminator even if it were an enum name. */
const PRIMITIVE_SIG_TYPES = new Set(['Integer', 'Money', 'Rate', 'Date', 'Boolean', 'String']);

/**
 * Translates a loaded rulespec model into blueprint-dsl facts.
 *
 * @param {{
 *   types: Map<string, {kind: string, values?: (string|object)[]}>
 *   parameters: object[]
 *   dataRelations: object[]
 *   derivedRules: object[]
 * }} rulespec - Output of loadRulespec()
 * @param {string} [domain] - Domain segment for universal fact paths (e.g. "medicaid")
 * @param {string} [graphName] - Graph name segment for universal fact paths (e.g. "communityEngagement")
 * @returns {{ facts: object[], translationLog: object[] }}
 */
export function buildFacts(rulespec, domain, graphName) {
  const { types, parameters, dataRelations, derivedRules } = rulespec;

  // Universal fact path helper: /${domain}/${graphName}/${factName}
  function factPath(name) {
    if (domain && graphName) return `/${domain}/${graphName}/${name}`;
    // Fallback for callers that don't supply domain/graphName (e.g. direct unit tests)
    return name;
  }

  // ── Build translation context ────────────────────────────────────────────

  const enumValues = new Set();
  const enumTypes = new Set();
  for (const [typeName, typeDef] of types) {
    if (typeDef.kind === 'enum') {
      enumTypes.add(typeName);
      for (const v of typeDef.values ?? []) {
        enumValues.add(typeof v === 'string' ? v : String(v));
      }
    }
  }

  const parameterNames = new Set(parameters.map(p => p.name));
  const dataRelationNames = new Set(dataRelations.map(dr => dr.name));

  const callables = new Map();
  for (const dr of dataRelations) {
    callables.set(dr.name, { sigTypes: dr.signature ?? [] });
  }
  for (const dr of derivedRules) {
    const sigTypes = [];
    if (dr.entity) sigTypes.push(dr.entity);
    if (dr.period) sigTypes.push(dr.period);
    callables.set(dr.name, { sigTypes });
  }

  const ctx = { parameterNames, enumValues, callables, dataRelationNames, domain, graphName };

  // ── Translate ────────────────────────────────────────────────────────────

  const facts = [];
  const translationLog = [];

  // 1. Parameters → writable facts with placeholder
  for (const param of parameters) {
    const versions = param.versions ?? [];
    const latestFormula = versions.length > 0 ? versions[versions.length - 1].formula : undefined;
    const path = factPath(param.name);
    const fact = { path, writable: true };
    if (latestFormula !== undefined) fact.placeholder = String(latestFormula);
    facts.push(fact);
    translationLog.push({ node: param.name, factPath: path, pattern: 'input', role: 'input', translated: true });
  }

  // 2. Data relations → writable facts (expand discriminator enum positions)
  for (const dr of dataRelations) {
    const sig = dr.signature ?? [];

    const discPositions = [];
    for (let i = 1; i < sig.length - 1; i++) {
      const t = sig[i];
      if (enumTypes.has(t) && !ENTITY_SIG_TYPES.has(t) && !PERIOD_SIG_TYPES.has(t)) {
        discPositions.push(i);
      }
    }

    if (discPositions.length === 0) {
      const path = factPath(dr.name);
      facts.push({ path, writable: true });
      translationLog.push({ node: dr.name, factPath: path, pattern: 'input', role: 'input', translated: true });
    } else {
      const discPos = discPositions[0];
      const discTypeName = sig[discPos];
      const discTypeDef = types.get(discTypeName);
      const discValues = discTypeDef?.values ?? [];
      if (discValues.length === 0) {
        const path = factPath(dr.name);
        translationLog.push({ node: dr.name, pattern: 'no-default', role: 'input', translated: false, note: `discriminator type '${discTypeName}' has no known values` });
        facts.push({ path, writable: true });
      } else {
        for (const val of discValues) {
          const valStr = typeof val === 'string' ? val : String(val);
          const path = factPath(`${dr.name}_${valStr}`);
          facts.push({ path, writable: true });
          translationLog.push({ node: dr.name, factPath: path, pattern: 'input', role: 'input', translated: true });
        }
      }
    }
  }

  // 3. Derived rules → expression facts
  for (const dr of derivedRules) {
    const versions = dr.versions ?? [];
    if (versions.length === 0) {
      translationLog.push({ node: dr.name, pattern: 'no-writer', role: 'derived', translated: false });
      continue;
    }
    const latestVersion = versions[versions.length - 1];
    const formulaStr = latestVersion.formula;
    if (formulaStr == null) {
      translationLog.push({ node: dr.name, pattern: 'no-writer', role: 'derived', translated: false });
      continue;
    }

    const path = factPath(dr.name);

    let expression;
    try {
      expression = translateFormula(String(formulaStr), ctx);
    } catch (err) {
      translationLog.push({ node: dr.name, factPath: path, pattern: 'cycle-unclassified', role: 'derived', translated: false, note: err.message });
      continue;
    }

    facts.push({ path, expression });
    translationLog.push({ node: dr.name, factPath: path, pattern: 'derived', role: 'derived', translated: true });
  }

  return { facts, translationLog };
}

/** Returns the entity path segment from a signature array. */
function entityPrefixFromSig(sig) {
  if (sig.length > 0 && (ENTITY_SIG_TYPES.has(sig[0]) || PERIOD_SIG_TYPES.has(sig[0]))) {
    return sig[0].toLowerCase();
  }
  return 'context';
}
