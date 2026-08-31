import { walkAst, parseFormula, latestFormula } from './formula-utils.js';

/**
 * Finds derived rules whose formula directly calls 2+ other derived rules — the
 * composition pattern. The rule's value is assembled from multiple sub-computations,
 * each defined as its own derived rule. The translator must inline or reference these
 * sub-computations rather than treating the composing rule as a single expression.
 *
 * Example:
 *   demonstrates_community_engagement calls meets_education_test, meets_income_test,
 *   meets_seasonal_income_test, and combined_qualifying_hours — four sub-rules composed
 *   via boolean `or`.
 *
 * ruleIds: the constituent derived rules called by this rule (the sub-computations).
 * node: the composing rule itself.
 */
export function classifyComposition(rulespec) {
  const { derivedRules } = rulespec;
  const derivedRuleNames = new Set(derivedRules.map(dr => dr.name));
  const result = [];

  for (const dr of derivedRules) {
    const formula = latestFormula(dr);
    if (formula == null) continue;

    const ast = parseFormula(formula);
    if (!ast) continue;

    const calledDerived = new Set();
    walkAst(ast, node => {
      if (node.type === 'Call' && node.name !== dr.name && derivedRuleNames.has(node.name)) {
        calledDerived.add(node.name);
      }
      if (node.type === 'Identifier' && node.name !== dr.name && derivedRuleNames.has(node.name)) {
        calledDerived.add(node.name);
      }
    });

    if (calledDerived.size >= 2) {
      result.push({
        pattern: 'composition',
        node: dr.name,
        ruleIds: [...calledDerived],
      });
    }
  }

  return result;
}
