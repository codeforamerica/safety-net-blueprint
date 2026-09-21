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
 * @returns {*} evaluated result (plain JS); undefined on any error
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
  if (!expr || typeof expr !== 'string') return undefined;
  const result = run(expr, context);
  if (isCelError(result)) return undefined;
  return celToJs(result);
}
