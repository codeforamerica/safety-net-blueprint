/**
 * Shared example validation logic.
 * Validates a flat map of example values against a map of JSON schemas.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Seed data may contain $now time tokens (e.g. "$now-30d") in date-time fields.
// These are resolved at runtime by the mock server — treat them as valid here.
const TIME_TOKEN_RE = /^\$now([+-]\d+[dhwm])?(?:@\d{1,2}:\d{2})?$/;
const isDateTimeOrToken = (v) => TIME_TOKEN_RE.test(v) || !isNaN(Date.parse(v));
ajv.addFormat('date-time', { validate: isDateTimeOrToken });
ajv.addFormat('date', { validate: (v) => TIME_TOKEN_RE.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v) });

/**
 * Derive schema name from an example key.
 * e.g., "QueueExample1" → "Queue", "TaskAuditEventExample2" → "TaskAuditEvent"
 * @param {string} key
 * @returns {string}
 */
export function deriveSchemaName(key) {
  return key.replace(/Example\d+$/, '');
}

/**
 * Validate one value against one schema.
 *
 * The caller decides which schema applies. Deriving it from the example's
 * key cannot be relied on — a collection's records are keyed after the
 * collection, which is not always the schema name.
 *
 * @param {object} value - The example record
 * @param {object} schema - Schema it must satisfy
 * @returns {Array<{instancePath: string, message: string}>}
 */
export function validateAgainstSchema(value, schema) {
  if (ajv.validate(schema, value)) return [];
  return (ajv.errors || []).map((err) => ({
    instancePath: err.instancePath || '',
    message: err.message,
  }));
}

/**
 * Errors from a validator ajv already compiled.
 *
 * The schema-object form below cannot be used on a contract set that still
 * carries its `$ref`s: ajv needs to know which document a schema came from to
 * resolve a relative ref out of it, and a detached object does not say (#448).
 * So the caller resolves the validator by pointer, through `schema-registry`,
 * and hands it here.
 *
 * `missingProperty` is carried through because the message alone does not say
 * which property is missing in a form a caller can match on, and a caller that
 * knows some properties are never stored needs to tell those apart.
 *
 * @param {import('ajv').ValidateFunction} validateFn
 * @param {object} value - The example record
 * @returns {Array<{instancePath: string, message: string, missingProperty?: string}>}
 */
export function errorsFrom(validateFn, value) {
  if (validateFn(value)) return [];
  return (validateFn.errors || []).map((err) => ({
    instancePath: err.instancePath || '',
    message: err.message,
    missingProperty: err.params?.missingProperty,
  }));
}

/**
 * Validate a flat map of example values against schemas.
 *
 * @param {Object} flatExamples - Plain { key: dataObject } map
 * @param {Object} schemas      - { schemaName: schemaObject } from a dereferenced spec
 * @returns {Array<{key: string, instancePath: string, message: string}>}
 */
export function validateExamples(flatExamples, schemas) {
  const errors = [];

  for (const [key, value] of Object.entries(flatExamples)) {
    if (!value || typeof value !== 'object') continue;

    const schemaName = deriveSchemaName(key);
    const schema = schemas[schemaName];
    if (!schema) continue;

    const valid = ajv.validate(schema, value);
    if (!valid) {
      for (const err of (ajv.errors || [])) {
        errors.push({ key, instancePath: err.instancePath || '', message: err.message });
      }
    }
  }

  return errors;
}
