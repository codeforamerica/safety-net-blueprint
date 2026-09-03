/**
 * Config loader with schema validation.
 *
 * Loads and validates a content package's config.yaml against
 * schemas/config.schema.json. Fails fast with a clear error on invalid config.
 */

import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../../schemas/config.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv({ allErrors: true, formats: { uri: true } });
const validate = ajv.compile(schema);

/**
 * Load and validate config.yaml from a content package directory.
 * Exits with an error message if validation fails.
 *
 * @param {string} contentDir - Absolute path to the content package directory.
 * @returns {object} Validated config object.
 */
export function loadConfig(contentDir) {
  const configPath = join(contentDir, 'config.yaml');
  const config = yaml.load(readFileSync(configPath, 'utf8'));
  if (!validate(config)) {
    const errors = validate.errors
      .map(e => `  ${e.instancePath || '(root)'} ${e.message}`)
      .join('\n');
    console.error(`config.yaml validation failed:\n${errors}`);
    process.exit(1);
  }
  return config;
}
