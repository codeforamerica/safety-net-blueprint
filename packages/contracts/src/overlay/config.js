/**
 * Centralized overlay configuration.
 *
 * States declare cross-cutting choices (casing, pagination, search,
 * relationship style) via a `config` root key in any overlay YAML file.
 * This module discovers, validates, and merges those declarations so
 * downstream transforms can consume them.
 */

import { readFileSync } from 'fs';
import yaml from 'js-yaml';

// =============================================================================
// Schema
// =============================================================================

const CONFIG_SCHEMA = {
  'x-casing': {
    type: 'string',
    values: ['camelCase', 'snake_case'],
    default: 'camelCase'
  },
  'x-pagination': {
    type: 'object',
    properties: {
      style: { values: ['offset', 'cursor', 'page', 'links'], default: 'offset' }
    }
  },
  'x-search': {
    type: 'object',
    properties: {
      style: { values: ['simple', 'filtered', 'post-search'], default: 'simple' }
    }
  },
  'x-relationship': {
    type: 'object',
    properties: {
      style: { values: ['links-only', 'expand', 'include', 'embed'], default: 'links-only' }
    }
  }
};

// =============================================================================
// Extraction
// =============================================================================

/**
 * Scan discovered overlay files for `config` root keys.
 * Merges configs from multiple files. Errors if the same config key
 * (e.g., `x-casing`) appears in more than one file.
 *
 * @param {string[]} overlayFiles - Paths to overlay files (already filtered by `overlay: 1.0.0`)
 * @returns {{ config: object|null, errors: string[] }}
 */
function extractConfig(overlayFiles) {
  const merged = {};
  const errors = [];
  const keyOrigins = {};  // key -> source file path

  for (const filePath of overlayFiles) {
    let parsed;
    try {
      const content = readFileSync(filePath, 'utf8');
      parsed = yaml.load(content);
    } catch {
      continue; // skip unparseable files
    }

    if (!parsed || !parsed.config || typeof parsed.config !== 'object') {
      continue;
    }

    for (const [key, value] of Object.entries(parsed.config)) {
      if (key in keyOrigins) {
        errors.push(
          `Config key "${key}" defined in multiple files: ${keyOrigins[key]} and ${filePath}`
        );
      } else {
        keyOrigins[key] = filePath;
        merged[key] = value;
      }
    }
  }

  const config = Object.keys(merged).length > 0 ? merged : null;
  return { config, errors };
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a config object against the schema.
 *
 * @param {object} config
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config || typeof config !== 'object') {
    return { errors, warnings };
  }

  for (const [key, value] of Object.entries(config)) {
    const schemaDef = CONFIG_SCHEMA[key];

    if (!schemaDef) {
      warnings.push(`Unknown config key: "${key}"`);
      continue;
    }

    if (schemaDef.type === 'string') {
      if (typeof value !== 'string' || !schemaDef.values.includes(value)) {
        errors.push(
          `Invalid value for "${key}": "${value}". Must be one of: ${schemaDef.values.join(', ')}`
        );
      }
    } else if (schemaDef.type === 'object') {
      if (typeof value !== 'object' || value === null) {
        errors.push(`"${key}" must be an object`);
        continue;
      }

      for (const [prop, propValue] of Object.entries(value)) {
        const propDef = schemaDef.properties?.[prop];
        if (!propDef) {
          warnings.push(`Unknown property "${prop}" in "${key}"`);
          continue;
        }
        if (!propDef.values.includes(propValue)) {
          errors.push(
            `Invalid value for "${key}.${prop}": "${propValue}". Must be one of: ${propDef.values.join(', ')}`
          );
        }
      }
    }
  }

  return { errors, warnings };
}

// =============================================================================
// Defaults
// =============================================================================

/**
 * Returns the default config object with all keys set to their defaults.
 */
function getConfigDefaults() {
  const defaults = {};

  for (const [key, schemaDef] of Object.entries(CONFIG_SCHEMA)) {
    if (schemaDef.type === 'string') {
      defaults[key] = schemaDef.default;
    } else if (schemaDef.type === 'object') {
      const obj = {};
      for (const [prop, propDef] of Object.entries(schemaDef.properties)) {
        obj[prop] = propDef.default;
      }
      defaults[key] = obj;
    }
  }

  return defaults;
}

export { CONFIG_SCHEMA, extractConfig, validateConfig, getConfigDefaults };
