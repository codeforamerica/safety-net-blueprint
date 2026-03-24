/**
 * OpenAPI Specification Validator
 * Validates OpenAPI specs for structural correctness and $ref resolution
 */

import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { validateExamples } from './example-validator.js';

/**
 * Validate components/examples values against their corresponding schemas.
 * @param {Object} spec - Dereferenced OpenAPI spec
 * @param {Array} errors - Errors array to push into
 */
function validateInlineExamples(spec, errors) {
  const componentExamples = spec?.components?.examples;
  const schemas = spec?.components?.schemas;
  if (!componentExamples || !schemas) return;

  // Unwrap OpenAPI example objects ({ summary, value }) to flat { key: dataValue }
  const flat = {};
  for (const [key, example] of Object.entries(componentExamples)) {
    if (example?.value && typeof example.value === 'object') flat[key] = example.value;
  }

  for (const { key, instancePath, message } of validateExamples(flat, schemas)) {
    errors.push({
      type: 'example',
      path: key,
      message: `Example '${key}'${instancePath}: ${message}`
    });
  }
}

/**
 * Validation result structure
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether validation passed
 * @property {Array} errors - Array of error objects
 * @property {Array} warnings - Array of warning objects
 */

/**
 * Validate OpenAPI specification
 * @param {string} specPath - Path to OpenAPI spec file
 * @returns {Promise<ValidationResult>} Validation result
 */
export async function validateSpec(specPath) {
  const errors = [];
  const warnings = [];
  
  try {
    // Check if file exists
    if (!existsSync(specPath)) {
      errors.push({
        type: 'file',
        path: specPath,
        message: 'File does not exist'
      });
      return { valid: false, errors, warnings };
    }
    
    // Try to load and parse the YAML/JSON
    let rawSpec;
    try {
      const content = readFileSync(specPath, 'utf8');
      rawSpec = yaml.load(content);
    } catch (error) {
      errors.push({
        type: 'parse',
        path: specPath,
        message: `Failed to parse file: ${error.message}`
      });
      return { valid: false, errors, warnings };
    }
    
    // Validate OpenAPI version
    if (!rawSpec.openapi) {
      errors.push({
        type: 'structure',
        path: specPath,
        message: 'Missing "openapi" field (must be OpenAPI 3.x)'
      });
    } else if (!rawSpec.openapi.startsWith('3.')) {
      warnings.push({
        type: 'version',
        path: specPath,
        message: `OpenAPI version ${rawSpec.openapi} detected. Only 3.x is fully supported.`
      });
    }
    
    // Validate required fields
    if (!rawSpec.info) {
      errors.push({
        type: 'structure',
        path: specPath,
        message: 'Missing required "info" field'
      });
    }
    
    if (!rawSpec.paths || Object.keys(rawSpec.paths).length === 0) {
      warnings.push({
        type: 'structure',
        path: specPath,
        message: 'No paths defined in specification'
      });
    }
    
    // Try to dereference (resolve all $refs)
    let dereferencedSpec;
    try {
      dereferencedSpec = await $RefParser.dereference(specPath, {
        dereference: {
          circular: 'ignore'
        }
      });
    } catch (error) {
      errors.push({
        type: 'reference',
        path: specPath,
        message: `Failed to resolve $refs: ${error.message}`
      });
      return { valid: false, errors, warnings };
    }

    // Validate inline examples against their schemas
    validateInlineExamples(dereferencedSpec, errors);
    
  } catch (error) {
    errors.push({
      type: 'unknown',
      path: specPath,
      message: `Unexpected error: ${error.message}`
    });
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate all OpenAPI specs
 * @param {Array} apiSpecs - Array of {name, specPath} objects
 * @returns {Promise<Object>} Validation results keyed by API name
 */
export async function validateAll(apiSpecs) {
  const results = {};

  for (const api of apiSpecs) {
    const specResult = await validateSpec(api.specPath);
    results[api.name] = {
      spec: specResult,
      valid: specResult.valid
    };
  }

  return results;
}

/**
 * Format validation results for console output
 * @param {Object} results - Validation results
 * @param {Object} options - Formatting options
 * @param {boolean} options.detailed - Show all errors (default: false, shows first 3)
 * @returns {string} Formatted output
 */
export function formatResults(results, options = {}) {
  const lines = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let validCount = 0;

  for (const [apiName, result] of Object.entries(results)) {
    const specErrors = result.spec.errors.length;
    const specWarnings = result.spec.warnings.length;

    totalErrors += specErrors;
    totalWarnings += specWarnings;

    if (result.valid) {
      validCount++;
      lines.push(`  ✓ ${apiName}`);
      if (specWarnings > 0) {
        lines.push(`    ${specWarnings} warning(s)`);
      }
    } else {
      lines.push(`  ✗ ${apiName}`);

      if (specErrors > 0) {
        lines.push(`    Spec: ${specErrors} error(s)`);
        for (const error of result.spec.errors.slice(0, 3)) {
          lines.push(`      - ${error.message}`);
        }
        if (specErrors > 3) {
          lines.push(`      ... and ${specErrors - 3} more`);
        }
      }
    }
  }
  
  const summary = [
    '',
    '='.repeat(70),
    'Validation Summary:',
    '='.repeat(70),
    `  Total APIs: ${Object.keys(results).length}`,
    `  Valid: ${validCount}`,
    `  Invalid: ${Object.keys(results).length - validCount}`,
    `  Total Errors: ${totalErrors}`,
    `  Total Warnings: ${totalWarnings}`,
    '',
    ...lines
  ];
  
  return summary.join('\n');
}

/**
 * Get validation status emoji and message
 * @param {ValidationResult} result - Validation result
 * @returns {Object} Status info
 */
export function getValidationStatus(result) {
  if (!result.valid) {
    return {
      emoji: '❌',
      status: 'INVALID',
      message: `${result.errors.length} error(s) found`
    };
  } else if (result.warnings.length > 0) {
    return {
      emoji: '⚠️',
      status: 'VALID_WITH_WARNINGS',
      message: `${result.warnings.length} warning(s)`
    };
  } else {
    return {
      emoji: '✓',
      status: 'VALID',
      message: 'All checks passed'
    };
  }
}
