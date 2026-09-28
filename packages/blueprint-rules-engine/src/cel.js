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
import { toJson } from '@bufbuild/protobuf';
import { TimestampSchema, DurationSchema } from '@bufbuild/protobuf/wkt';

/**
 * CEL's timestamp and duration values are the protobuf well-known types, and
 * both have a specified JSON form: RFC 3339 for Timestamp, decimal seconds
 * with an `s` suffix for Duration.
 *
 * Using that form rather than a shape of our own is what lets an engine in
 * another language produce byte-identical output for the same graph — every
 * CEL implementation already agrees on it. A house format would have to be
 * documented and matched by hand.
 */
const WELL_KNOWN_JSON = {
  'google.protobuf.Timestamp': TimestampSchema,
  'google.protobuf.Duration': DurationSchema,
};

/** The underlying message, whether CEL handed back a wrapper or the value. */
function protoMessage(val) {
  if (typeof val !== 'object' || val === null) return null;
  return val.$typeName ? val : (val.message?.$typeName ? val.message : null);
}

/**
 * Recursively convert CEL output types to plain JavaScript values.
 * - CelList             → Array
 * - CelMap              → Object
 * - bigint              → number (CEL integers; safe for eligibility values)
 * - Timestamp, Duration → their specified JSON strings
 *
 * Anything else is returned as-is. That was previously true of timestamps and
 * durations too, which meant a fact whose value was either came back holding
 * @bufbuild/cel's internal message wrapper — reported `complete`, and then
 * throwing "Converting circular structure to JSON" in whatever tried to
 * serialise it.
 */
function celToJs(val) {
  if (typeof val === 'bigint') return Number(val);

  const message = protoMessage(val);
  const schema = message && WELL_KNOWN_JSON[message.$typeName];
  if (schema) return toJson(schema, message);

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
