/**
 * CEL expression evaluator.
 *
 * Taken directly from the spike's mock-server/src/cel-evaluator.js.
 * Transforms CEL syntax to JavaScript-compatible equivalents before
 * evaluating via Function constructor.
 *
 * Supported CEL constructs:
 *   has(field)              — field is present, non-null, non-empty string
 *   .size()                 — collection or string length
 *   .contains(value)        — collection or string membership
 *   "x" in arr              — array membership with string literal LHS
 *   $var in arr             — array membership with variable LHS
 *   .filter(var, pred)      — filter collection
 *   .map(var, expr)         — transform collection
 *   .all(var, pred)         — all items satisfy predicate
 *   .exists(var, pred)      — any item satisfies predicate
 */

/**
 * Evaluate a CEL expression against a context object.
 *
 * @param {string} expr    - CEL expression string
 * @param {Object} context - flat map of variable names to values
 * @returns {*} evaluated result; undefined on error
 */
export function evaluateCEL(expr, context = {}) {
  if (!expr || typeof expr !== 'string') return undefined;
  try {
    const jsExpr = expr
      .replace(/\bhas\(([\w.]+)\)/g, '(typeof $1 !== "undefined" && $1 !== null && $1 !== "")')
      .replace(/\.size\(\)/g, '.length')
      .replace(/\.contains\(([^)]+)\)/g, '.includes($1)')
      .replace(/"([^"]+)"\s+in\s+([\w$.]+)/g, '(Array.isArray($2) ? $2.includes("$1") : false)')
      .replace(/([$][\w$.]+)\s+in\s+([$][\w$.]+)/g, '(Array.isArray($2) ? $2.includes($1) : false)')
      .replace(/\.(filter|map)\((\w+),\s*([^)]+(?:\([^)]*\))*[^)]*)\)/g, (_, fn, v, pred) => `.${fn}(${v} => (${pred}))`)
      .replace(/\.all\((\w+),\s*([^)]+(?:\([^)]*\))*[^)]*)\)/g, '.every($1 => ($2))')
      .replace(/\.exists\((\w+),\s*([^)]+(?:\([^)]*\)[^)]*)*)\)/g, '.some($1 => ($2))');

    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(context), `return (${jsExpr});`);
    return fn(...Object.values(context));
  } catch (e) {
    return undefined;
  }
}
