import { walkAst, parseFormula, latestFormula } from './formula-utils.js';

/**
 * Finds derived rules that sum 2+ calls to the same data_relation — the
 * scalar-accumulator pattern. In rulespec this typically appears as accumulation
 * over an enum-discriminated data_relation (e.g. summing hours by activity kind):
 *
 *   hours_of_activity_in_month(person, work, month)
 *   + hours_of_activity_in_month(person, community_service, month)
 *   + hours_of_activity_in_month(person, work_program, month)
 *
 * The translator must recognize this as a collection aggregate rather than
 * independent additions, since a declarative target will evaluate these as a fold.
 */
export function classifyScalarAccumulators(rulespec) {
  const { derivedRules, dataRelations } = rulespec;
  const dataRelationNames = new Set(dataRelations.map(dr => dr.name));
  const result = [];

  for (const dr of derivedRules) {
    const formula = latestFormula(dr);
    if (formula == null) continue;

    const ast = parseFormula(formula);
    if (!ast) continue;

    // Accumulation requires addition: range comparisons (>=, <=) on the same callable
    // are membership-test, not scalar-accumulator. Only flag when a + or - binary
    // operator is present in the formula connecting repeated calls.
    let hasAddition = false;
    walkAst(ast, node => {
      if (node.type === 'Binary' && (node.op === '+' || node.op === '-')) hasAddition = true;
    });
    if (!hasAddition) continue;

    // Count how many times each data_relation name is called
    const callCounts = new Map();
    walkAst(ast, node => {
      if (node.type === 'Call' && dataRelationNames.has(node.name)) {
        callCounts.set(node.name, (callCounts.get(node.name) ?? 0) + 1);
      }
    });

    // Any data_relation called 2+ times with addition present → accumulation pattern
    for (const [, count] of callCounts) {
      if (count >= 2) {
        result.push({ pattern: 'scalar-accumulator', node: dr.name, ruleId: dr.name });
        break; // one finding per derived rule
      }
    }
  }

  return result;
}
