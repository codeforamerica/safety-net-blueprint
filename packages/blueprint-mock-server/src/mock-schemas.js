/**
 * Checking what a person hands the mock against the schema that describes it.
 *
 * The mock's own inputs — stubs, real-endpoint configuration — are not part
 * of any contract set, so there is no OpenAPI document to validate them
 * against. Each has a JSON Schema in `schemas/` instead, and this turns ajv's
 * errors into sentences that name the thing that was wrong.
 *
 * Schemas are imported as JSON rather than read from disk, because the same
 * checks run in a page.
 */

import { createAjv } from './schema-registry.js';

let ajv = null;
const compiled = new WeakMap();

function validatorFor(schema) {
  ajv ??= createAjv();
  if (!compiled.has(schema)) compiled.set(schema, ajv.compile(schema));
  return compiled.get(schema);
}

/** Keys that were renamed, so an old name is told what it became. */
const RENAMED = { respond: 'response' };

/**
 * One ajv error as a sentence.
 *
 * @param {object} error
 * @param {string} subject - What is being described, e.g. 'HTTP stub'
 * @param {string} path - Dotted path under the subject, '' for the subject itself
 */
function describe(error, subject, path) {
  const under = path ? `${path}.` : '';
  if (error.keyword === 'additionalProperties') {
    const key = error.params.additionalProperty;
    if (RENAMED[key]) return `${subject} "${under}${key}" was renamed to "${RENAMED[key]}"`;
    return `${subject} has an unknown key "${under}${key}"`;
  }
  if (error.keyword === 'required') {
    return `${subject} needs "${under}${error.params.missingProperty}"`;
  }
  return path ? `${subject} "${path}" ${error.message}` : `${subject} ${error.message}`;
}

/**
 * Throw, naming every way `document` disagrees with `schema`, one per line.
 *
 * @param {object} schema
 * @param {unknown} document
 * @param {(pointer: string) => [string, string]} subjectOf - From an error's
 *   JSON pointer, the subject to name and the dotted path left under it.
 *   Lets a list name each entry by something a person wrote, rather than by
 *   its index.
 * @param {Record<string, string>} [messages] - A sentence to use in place of
 *   ajv's own for a keyword, where ajv's says nothing a person could act on.
 */
export function assertValid(schema, document, subjectOf, messages = {}) {
  const validate = validatorFor(schema);
  if (validate(document)) return;
  const problems = validate.errors
    // A failed `oneOf` reports each branch's own failure as well, and those
    // say what one alternative wanted rather than what is wrong.
    .filter((error) => !error.schemaPath.includes('/oneOf/'))
    .map((error) => {
      const [subject, path] = subjectOf(error.instancePath);
      return messages[error.keyword] ? `${subject} ${messages[error.keyword]}` : describe(error, subject, path);
    });
  throw new Error([...new Set(problems)].join('\n'));
}

/** A JSON pointer as a dotted path: '/match/url' → 'match.url'. */
export function dotted(pointer) {
  return pointer.split('/').slice(1).join('.');
}
