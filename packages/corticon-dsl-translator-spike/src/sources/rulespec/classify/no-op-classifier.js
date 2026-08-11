import { latestFormula } from './formula-utils.js';

/**
 * Finds derived rules that have no formula — no-ops from a translation standpoint.
 * These rules produce no computable output and are excluded from fact compilation.
 * Likely authoring gaps or placeholder stubs awaiting implementation.
 */
export function classifyNoOps(rulespec) {
  const { derivedRules } = rulespec;
  const result = [];

  for (const dr of derivedRules) {
    if (latestFormula(dr) == null) {
      result.push({ pattern: 'no-op', ruleId: dr.name });
    }
  }

  return result;
}
