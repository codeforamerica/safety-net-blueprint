/**
 * CEL expression evaluator.
 *
 * Wraps @bufbuild/cel — a spec-compliant, browser-compatible CEL implementation
 * with an official conformance test corpus (@bufbuild/cel-spec).
 *
 * Evaluate a CEL expression against a context object.
 *
 * @param {string} expr    - CEL expression string
 * @param {Object} context - flat map of variable names to values
 * @returns {*} evaluated result (plain JS)
 * @throws {Error} with CEL's own message when the expression does not evaluate
 */

import { run, isCelError, isCelList, isCelMap } from '@bufbuild/cel';

/**
 * Recursively convert CEL output types to plain JavaScript values.
 * - CelList  → Array
 * - CelMap   → Object
 * - bigint   → number (CEL integers; safe for eligibility rule values)
 */
function celToJs(val) {
  if (typeof val === 'bigint') return Number(val);
  if (isCelList(val)) return [...val].map(celToJs);
  if (isCelMap(val)) return Object.fromEntries([...val].map(([k, v]) => [celToJs(k), celToJs(v)]));
  return val;
}

export function evaluateCEL(expr, context = {}) {
  if (!expr || typeof expr !== 'string') {
    throw new Error(`Not a CEL expression: ${JSON.stringify(expr)}`);
  }

  const result = run(expr, context);

  // CEL's own message is the only thing that says *why*. Swallowing it and
  // returning undefined left every failure reading "Expression failed to
  // evaluate", which cannot be acted on — the most common cause is a type
  // mismatch CEL names precisely, e.g. "found no matching overload for '_*_'
  // applied to '(double, int)'" when an input meets an integer literal.
  if (isCelError(result)) throw new Error(result.message);

  return celToJs(result);
}
