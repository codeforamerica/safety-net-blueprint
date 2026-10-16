/**
 * The blueprint's expression language: CEL, with no dialect.
 *
 * Guards, `if:` and `match:` steps, context-binding `where`s, composition
 * filters and `x-derived` fields are all CEL, evaluated here by
 * `@bufbuild/cel`, a spec-compliant implementation with the official
 * conformance corpus. Core owns it so validation can parse an expression with
 * the same implementation the mock server evaluates it with — one notion of
 * CEL, where there were three: a JavaScript syntax check posing as a CEL
 * parse, a regex transpiler to JavaScript, and the real thing.
 *
 * Its own subpath export, `@codeforamerica/blueprint-core/cel`, so a consumer
 * that never evaluates an expression does not load it. The rules engine
 * evaluates rulesets with it too, so a ruleset and a state machine guard are
 * the same language.
 */

import { run, parse, plan, celEnv, celError, isCelError, isCelList, isCelMap } from '@bufbuild/cel';
import { toJson } from '@bufbuild/protobuf';
import { TimestampSchema, DurationSchema } from '@bufbuild/protobuf/wkt';

// CEL's timestamp and duration values are protobuf well-known types, whose
// specified JSON forms are RFC 3339 and decimal seconds with an `s` suffix.
const WELL_KNOWN_JSON = {
  'google.protobuf.Timestamp': TimestampSchema,
  'google.protobuf.Duration': DurationSchema,
};

/** The underlying message, whether CEL handed back a wrapper or the value. */
function protoMessage(val) {
  if (typeof val !== 'object' || val === null) return null;
  return val.$typeName ? val : (val.message?.$typeName ? val.message : null);
}

/** CEL's values as plain JavaScript: lists, maps, integers, timestamps and durations. */
function celToJs(val) {
  if (typeof val === 'bigint') return Number(val);
  const message = protoMessage(val);
  const schema = message && WELL_KNOWN_JSON[message.$typeName];
  if (schema) return toJson(schema, message);
  if (isCelList(val)) return [...val].map(celToJs);
  if (isCelMap(val)) return Object.fromEntries([...val].map(([k, v]) => [celToJs(k), celToJs(v)]));
  return val;
}

/**
 * Evaluate a CEL expression, as text or already parsed.
 *
 * A parsed expression is for a caller that takes one apart: the rules engine
 * splits `&&`, `||` and `? :` to give each operand its own state. Turning a
 * piece back into text does not work in general — the parser expands
 * `exists`, `all` and `filter` into comprehensions, which have no text form —
 * so it is planned directly, which is what evaluating the text does with the
 * expression it parses.
 *
 * A JavaScript `undefined` is bound as CEL `null`, which is what an absent
 * value is in the data the blueprint evaluates against. A field a record does
 * not have is still an error — CEL's "no such key" — and `has()` is how an
 * expression asks.
 *
 * @param {string|import('@bufbuild/cel').Expr} expr
 * @param {Object<string, unknown>} [context] - Variables, by name
 * @returns {unknown} The result, as plain JavaScript
 * @throws {Error} With CEL's own message, when the expression does not evaluate
 */
export function evaluateCEL(expr, context = {}) {
  const parsed = typeof expr === 'object' && expr !== null;
  if (!parsed && (!expr || typeof expr !== 'string')) {
    throw new Error(`Not a CEL expression: ${JSON.stringify(expr)}`);
  }
  const bindings = {};
  for (const [name, value] of Object.entries(context)) bindings[name] = value === undefined ? null : value;
  let result;
  if (parsed) {
    try {
      result = plan(celEnv(), expr)(bindings);
    } catch (e) {
      result = celError(e);
    }
  } else {
    result = run(expr, bindings);
  }
  if (isCelError(result)) throw new Error(result.message);
  return celToJs(result);
}

/**
 * Why an expression is not CEL, or null when it parses.
 *
 * @param {string} expr
 * @returns {string|null}
 */
export function celSyntaxError(expr) {
  if (!expr || typeof expr !== 'string' || !expr.trim()) return 'expression is empty';
  try {
    parse(expr);
    return null;
  } catch (e) {
    return e.message.split('\n')[0];
  }
}
