/**
 * Leaving out a null the schema a value goes into doesn't accept.
 *
 * A value expression that finds nothing is already left out where it's
 * filled in (state-machine-engine.js, fillValue). What one finds can still be
 * null, and null and absent are different (docs/conventions/resources.yaml,
 * null_and_absent): a property that accepts null gets the null; one that
 * doesn't is left out. With no schema, nothing rules a null out, so it stays.
 *
 * A required property left out fails the schema, which names it.
 */

import { propertiesOf } from './handlers/expand-utils.js';

/**
 * A value with each null its schema doesn't accept left out.
 *
 * @param {*} value - A body, event data, a response, or a record's fields
 * @param {object|null|undefined} schema - What it goes into
 * @param {(schema: *) => *} [follow] - Resolves a ref, as an API's resolve.schema does
 * @returns {*}
 */
export function fitToSchema(value, schema, follow = (x) => x) {
  if (!schema) return value;
  if (Array.isArray(value)) {
    const items = itemsOf(schema, follow);
    return items ? value.map((item) => fitToSchema(item, items, follow)) : value;
  }
  if (!value || typeof value !== 'object') return value;

  const sources = propertiesOf(schema, follow);
  const fitted = {};
  for (const [name, item] of Object.entries(value)) {
    const declared = sources.filter((properties) => name in properties).map((properties) => properties[name]);
    if (item === null && declared.length > 0 && !declared.every((d) => acceptsNull(d, follow))) continue;
    fitted[name] = declared.length > 0 ? fitToSchema(item, { allOf: declared }, follow) : item;
  }
  return fitted;
}

/** The schema of a list's items, where the list's schema or one it's composed of says. */
function itemsOf(schema, follow) {
  const resolved = follow(schema);
  if (!resolved || typeof resolved !== 'object') return null;
  if (resolved.items) return resolved.items;
  for (const member of resolved.allOf ?? []) {
    const items = itemsOf(member, follow);
    if (items) return items;
  }
  return null;
}

/**
 * Whether a schema accepts null: a type that includes it, a const or enum
 * that holds it, or no constraint saying otherwise. Every member of an allOf
 * has to accept it, and some member of an anyOf or oneOf.
 *
 * @param {*} schema
 * @param {(schema: *) => *} [follow]
 * @returns {boolean}
 */
export function acceptsNull(schema, follow = (x) => x, seen = new Set()) {
  if (schema === false) return false;
  const resolved = follow(schema);
  if (!resolved || typeof resolved !== 'object') return true;
  // A ref that leads nowhere here says nothing against null.
  if (typeof resolved.$ref === 'string') return true;
  if (seen.has(resolved)) return true;
  seen.add(resolved);

  if ('const' in resolved) return resolved.const === null;
  if (Array.isArray(resolved.enum)) return resolved.enum.includes(null);
  if (resolved.type !== undefined && ![].concat(resolved.type).includes('null')) return false;
  if (Array.isArray(resolved.allOf) && !resolved.allOf.every((m) => acceptsNull(m, follow, seen))) return false;
  for (const key of ['anyOf', 'oneOf']) {
    if (Array.isArray(resolved[key]) && !resolved[key].some((m) => acceptsNull(m, follow, seen))) return false;
  }
  return true;
}
