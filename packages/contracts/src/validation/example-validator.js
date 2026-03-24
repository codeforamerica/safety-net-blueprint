/**
 * Shared example validation logic.
 * Validates a flat map of example values against a map of JSON schemas.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

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
