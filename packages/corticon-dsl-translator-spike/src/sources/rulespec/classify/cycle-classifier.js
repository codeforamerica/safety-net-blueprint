import { walkAst, parseFormula, latestFormula } from './formula-utils.js';

/**
 * Finds derived rules whose formula directly references themselves — a self-referential
 * cycle. In a declarative evaluation model this is circular and unresolvable. In rulespec
 * it most likely indicates an authoring error; the translator cannot produce a valid
 * expression fact from a self-referential definition.
 */
export function classifyCycles(rulespec) {
  const { derivedRules } = rulespec;
  const result = [];

  for (const dr of derivedRules) {
    const formula = latestFormula(dr);
    if (formula == null) continue;

    const ast = parseFormula(formula);
    if (!ast) continue;

    let selfRef = false;
    walkAst(ast, node => {
      if ((node.type === 'Call' || node.type === 'Identifier') && node.name === dr.name) {
        selfRef = true;
      }
    });

    if (selfRef) {
      result.push({ pattern: 'cycle', node: dr.name, ruleId: dr.name });
    }
  }

  return result;
}
