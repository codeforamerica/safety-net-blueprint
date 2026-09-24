/**
 * Shared CEL evaluator for the mock server.
 *
 * Used by both the state machine engine (guard conditions, if-step expressions)
 * and the composition assembler (filter and derive expressions).
 *
 * CEL-to-JavaScript transformations applied:
 *   has(field)              — field is present, non-null, non-empty string
 *   .size()                 — collection or string length
 *   .contains(value)        — collection or string membership
 *   "x" in arr              — array membership with string literal LHS
 *   $var in arr             — array membership with variable LHS
 *   .filter(var, pred)      — filter collection
 *   .map(var, expr)         — transform collection
 *   .all(var, pred)         — all items satisfy predicate
 *   .exists(var, pred)      — any item satisfies predicate
 *
 * @param {string} expr - CEL expression string
 * @param {Object} context - Flat map of variable names to values available in the expression
 * @returns {*} Evaluated result; undefined on error
 */
/** A JavaScript identifier, and nothing that could close the parameter list. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The context entries safe to bind as parameters of a generated function.
 *
 * A context key becomes a parameter name, and some callers build the context
 * by spreading a stored record — so a record saved with a crafted property
 * name would otherwise inject into the parameter list. Anything that is not a
 * plain identifier is dropped, which makes the expression fail to resolve
 * rather than run.
 *
 * @param {Object} context
 * @returns {{ names: string[], values: unknown[] }}
 */
export function bindableContext(context = {}) {
  const names = Object.keys(context).filter((key) => IDENTIFIER.test(key));
  return { names, values: names.map((name) => context[name]) };
}

export function evaluateCEL(expr, context = {}) {
  if (!expr || typeof expr !== 'string') return undefined;
  try {
    const jsExpr = expr
      .replace(/\bhas\((\w+)\)/g, '(typeof $1 !== "undefined" && $1 !== null && $1 !== "")')
      .replace(/\.size\(\)/g, '.length')
      .replace(/\.contains\(([^)]+)\)/g, '.includes($1)')
      .replace(/"([^"]+)"\s+in\s+([\w$.]+)/g, '(Array.isArray($2) ? $2.includes("$1") : false)')
      .replace(/([$][\w$.]+)\s+in\s+([$][\w$.]+)/g, '(Array.isArray($2) ? $2.includes($1) : false)')
      .replace(/\.(filter|map)\((\w+),\s*([^)]+(?:\([^)]*\))*[^)]*)\)/g, (_, fn, v, pred) => `.${fn}(${v} => (${pred}))`)
      .replace(/\.all\((\w+),\s*([^)]+(?:\([^)]*\))*[^)]*)\)/g, '.every($1 => ($2))')
      .replace(/\.exists\((\w+),\s*([^)]+(?:\([^)]*\)[^)]*)*)\)/g, '.some($1 => ($2))');

    const { names, values } = bindableContext(context);

    const fn = new Function(...names, `return (${jsExpr});`);
    return fn(...values);
  } catch (e) {
    console.warn(`CEL evaluation error for "${expr}": ${e.message}`);
    return undefined;
  }
}
