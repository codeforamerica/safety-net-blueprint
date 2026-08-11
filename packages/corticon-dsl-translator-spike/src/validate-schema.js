import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ajv = new Ajv({ allErrors: true });

function loadSchema(name) {
  return JSON.parse(readFileSync(join(__dirname, `schemas/${name}.schema.json`), 'utf-8'));
}

const compiled = {};
function getValidator(name) {
  if (!compiled[name]) compiled[name] = ajv.compile(loadSchema(name));
  return compiled[name];
}

/**
 * Validates `data` against the named schema. Prints errors and exits if invalid.
 * @param {'graph'|'patterns'|'blueprint-dsl'} schemaName
 * @param {object} data - Already-parsed JSON object.
 * @param {string} filePath - Source file path, used in error messages.
 */
export function validateSchema(schemaName, data, filePath) {
  const validate = getValidator(schemaName);
  if (validate(data)) return;
  const errors = validate.errors
    .map(e => `  ${e.instancePath || '(root)'}: ${e.message}`)
    .join('\n');
  console.error(`Schema validation failed for ${filePath} (${schemaName}):\n${errors}`);
  process.exit(1);
}
