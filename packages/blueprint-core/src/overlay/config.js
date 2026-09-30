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
  },
  'x-event-type-prefix': {
    type: 'string'
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
  const parsed = [];

  for (const filePath of overlayFiles) {
    try {
      parsed.push({ origin: filePath, document: yaml.load(readFileSync(filePath, 'utf8')) });
    } catch {
      continue; // skip unparseable files
    }
  }

  return mergeConfig(parsed);
}

/**
 * The same configuration, read from overlay documents already in memory.
 *
 * `resolve` is handed parsed overlays rather than paths, so it cannot go back
 * to the filesystem for their config. Both entry points merge through
 * `mergeConfig`, so a state gets the same answer whichever way its overlays
 * reached the pipeline.
 *
 * @param {object[]} overlays - Parsed overlay documents
 * @returns {{ config: object|null, errors: string[] }}
 */
function overlayConfig(overlays) {
  return mergeConfig(
    (overlays ?? []).map((document, i) => ({
      origin: document?.info?.title ?? `overlay[${i}]`,
      document,
    }))
  );
}

/**
 * Merge the `config` blocks of several overlays into one.
 *
 * A key may be set by exactly one overlay. Two overlays setting `x-casing`
 * differently have no defensible winner, so that is an error rather than a
 * last-one-wins silent resolution.
 *
 * @param {{ origin: string, document: object }[]} sources
 * @returns {{ config: object|null, errors: string[] }}
 */
function mergeConfig(sources) {
  const merged = {};
  const errors = [];
  const keyOrigins = {};  // key -> where it was set

  for (const { origin, document } of sources) {
    if (!document || !document.config || typeof document.config !== 'object') {
      continue;
    }

    for (const [key, value] of Object.entries(document.config)) {
      if (key in keyOrigins) {
        errors.push(
          `Config key "${key}" defined in multiple files: ${keyOrigins[key]} and ${origin}`
        );
      } else {
        keyOrigins[key] = origin;
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
      if (typeof value !== 'string') {
        errors.push(`"${key}" must be a string`);
      } else if (schemaDef.values && !schemaDef.values.includes(value)) {
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
      if (schemaDef.default !== undefined) defaults[key] = schemaDef.default;
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

export { CONFIG_SCHEMA, extractConfig, overlayConfig, validateConfig, getConfigDefaults };
