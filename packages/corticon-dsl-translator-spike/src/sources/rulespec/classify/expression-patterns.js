import { walkAst, parseFormula, latestFormula } from './formula-utils.js';

const LOWER_OPS = new Set(['>=', '>']);
const UPPER_OPS = new Set(['<=', '<']);

function identName(node) {
  return node?.type === 'Identifier' ? node.name : null;
}

/**
 * True if the AST contains an IfThenElse node — the conditional expression pattern.
 * Rulespec formulas use `if cond then x else y`; the translator emits a CEL ternary.
 */
function hasConditional(ast) {
  let found = false;
  walkAst(ast, node => { if (node.type === 'IfThenElse') found = true; });
  return found;
}

/**
 * True if the AST contains a range-membership pattern: two comparisons on the
 * same identifier connected by `and`, using opposing lower/upper bound operators.
 * Example: `age_in_years(person, month) >= ce_applicable_min_age and
 *            age_in_years(person, month) < ce_applicable_max_age`.
 *
 * Matches both Call-on-same-name and bare Identifier forms.
 */
function hasRangeMembership(ast) {
  let found = false;
  walkAst(ast, node => {
    if (node.type !== 'Binary' || node.op !== 'and') return;
    const { left, right } = node;
    if (!left || !right || left.type !== 'Binary' || right.type !== 'Binary') return;
    const isRangeOps = (
      (LOWER_OPS.has(left.op) && UPPER_OPS.has(right.op)) ||
      (UPPER_OPS.has(left.op) && LOWER_OPS.has(right.op))
    );
    if (!isRangeOps) return;
    // Same name must appear on the "subject" side of both comparisons
    const leftIdent = identName(left.left) ?? (left.left?.type === 'Call' ? left.left.name : null);
    const rightIdent = identName(right.left) ?? (right.left?.type === 'Call' ? right.left.name : null);
    if (leftIdent && leftIdent === rightIdent) found = true;
  });
  return found;
}

/**
 * True if the AST contains a List literal node — indicates a list-membership test,
 * e.g. `[val1, val2, val3]` used in a comparison or passed as an argument.
 */
function hasListLiteral(ast) {
  let found = false;
  walkAst(ast, node => { if (node.type === 'List') found = true; });
  return found;
}

/**
 * Scans all derived rules for expression-level pattern findings:
 *
 * - `expression` (conditional) — formula contains an if/then/else
 * - `membership-test` (range)  — two bound comparisons on the same subject
 * - `membership-test` (list)   — formula contains a list literal
 *
 * One finding is emitted per pattern per derived rule.
 */
export function classifyExpressionPatterns(rulespec) {
  const { derivedRules } = rulespec;
  const result = [];

  for (const dr of derivedRules) {
    const formula = latestFormula(dr);
    if (formula == null) continue;

    const ast = parseFormula(formula);
    if (!ast) continue;

    const ruleId = dr.name;

    if (hasConditional(ast)) {
      result.push({ pattern: 'expression', variant: 'conditional', node: dr.name, ruleId, expression: formula });
    }
    if (hasRangeMembership(ast)) {
      result.push({ pattern: 'membership-test', variant: 'range', node: dr.name, ruleId, expression: formula });
    }
    if (hasListLiteral(ast)) {
      result.push({ pattern: 'membership-test', variant: 'list', node: dr.name, ruleId, expression: formula });
    }
  }

  return result;
}
