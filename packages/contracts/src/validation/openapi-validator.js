/**
 * OpenAPI Specification and Examples Validator
 * Validates OpenAPI specs and examples against schemas
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    try {
      await $RefParser.dereference(specPath, {
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
 * Validate examples against their schemas
 * @param {string} specPath - Path to OpenAPI spec file
 * @param {string} examplesPath - Path to examples YAML file
 * @returns {Promise<ValidationResult>} Validation result
 */
export async function validateExamples(specPath, examplesPath) {
  const errors = [];
  const warnings = [];
  
  try {
    // Check if examples file exists
    if (!existsSync(examplesPath)) {
      warnings.push({
        type: 'file',
        path: examplesPath,
        message: 'Examples file does not exist (optional)'
      });
      return { valid: true, errors, warnings };
    }
    
    // Load examples
    let examples;
    try {
      const content = readFileSync(examplesPath, 'utf8');
      examples = yaml.load(content);
    } catch (error) {
      errors.push({
        type: 'parse',
        path: examplesPath,
        message: `Failed to parse examples file: ${error.message}`
      });
      return { valid: false, errors, warnings };
    }
    
    if (!examples || Object.keys(examples).length === 0) {
      warnings.push({
        type: 'content',
        path: examplesPath,
        message: 'Examples file is empty'
      });
      return { valid: true, errors, warnings };
    }
    
    // Load and dereference spec
    let spec;
    try {
      spec = await $RefParser.dereference(specPath, {
        dereference: {
          circular: 'ignore'
        }
      });
    } catch (error) {
      errors.push({
        type: 'spec',
        path: specPath,
        message: `Failed to load spec: ${error.message}`
      });
      return { valid: false, errors, warnings };
    }
    
    // Extract schemas from spec
    const schemas = spec.components?.schemas || {};
    if (Object.keys(schemas).length === 0) {
      warnings.push({
        type: 'schema',
        path: specPath,
        message: 'No schemas defined in specification'
      });
      return { valid: true, errors, warnings };
    }
    
    // Find the main resource schema (usually capitalized singular form)
    // Try to match schema names with common patterns
    const resourceSchemas = Object.keys(schemas).filter(name => 
      !name.includes('List') && 
      !name.includes('Create') && 
      !name.includes('Update') &&
      !name.includes('Error') &&
      !name.includes('Response')
    );
    
    if (resourceSchemas.length === 0) {
      warnings.push({
        type: 'schema',
        path: specPath,
        message: 'Could not identify main resource schema for validation'
      });
      return { valid: true, errors, warnings };
    }
    
    // Use the first matching schema (typically the main resource)
    const mainSchema = schemas[resourceSchemas[0]];
    
    // Create AJV validator
    const ajv = new Ajv({
      strict: false,
      validateFormats: true,
      allErrors: true,
      coerceTypes: false
    });
    addFormats(ajv);
    
    // Add all schemas to AJV for reference resolution
    for (const [schemaName, schema] of Object.entries(schemas)) {
      try {
        ajv.addSchema(schema, schemaName);
      } catch (error) {
        // Schema might already be added or have issues, continue
      }
    }
    
    // Validate each example
    const validate = ajv.compile(mainSchema);
    
    for (const [exampleName, exampleData] of Object.entries(examples)) {
      // Skip list examples and payload examples
      if (exampleData?.items && Array.isArray(exampleData.items)) {
        continue; // This is a list example
      }
      
      const lowerName = exampleName.toLowerCase();
      if (lowerName.includes('payload') || 
          lowerName.includes('create') || 
          lowerName.includes('update')) {
        continue; // This is a payload example (for requests)
      }
      
      // Validate example against schema
      const valid = validate(exampleData);
      
      if (!valid) {
        const validationErrors = validate.errors || [];
        for (const err of validationErrors) {
          const field = err.instancePath ? err.instancePath.substring(1).replace(/\//g, '.') : 'root';
          
          // Enhanced error message with more context
          let message = err.message || 'validation failed';
          
          // For additionalProperties errors, show which property is not allowed
          if (err.keyword === 'additionalProperties' && err.params?.additionalProperty) {
            const fieldPath = field === 'root' ? '' : field + '.';
            message = `must NOT have additional property '${fieldPath}${err.params.additionalProperty}'`;
          }
          // For required properties, show which property is missing
          else if (err.keyword === 'required' && err.params?.missingProperty) {
            const fieldPath = field === 'root' ? '' : field + '.';
            message = `must have required property '${fieldPath}${err.params.missingProperty}'`;
          }
          // For enum errors, show allowed values
          else if (err.keyword === 'enum' && err.params?.allowedValues) {
            message = `${message} (allowed: ${err.params.allowedValues.join(', ')})`;
          }
          // For type errors, be more specific
          else if (err.keyword === 'type' && err.params?.type) {
            message = `must be ${err.params.type}`;
          }
          
          errors.push({
            type: 'validation',
            path: examplesPath,
            example: exampleName,
            field,
            message,
            keyword: err.keyword,
            details: err
          });
        }
      }
    }
    
  } catch (error) {
    errors.push({
      type: 'unknown',
      path: examplesPath,
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
 * Validate all OpenAPI specs and their examples
 * @param {Array} apiSpecs - Array of {name, specPath, examplesPath} objects
 * @returns {Promise<Object>} Validation results for all specs
 */
export async function validateAll(apiSpecs) {
  const results = {};
  
  for (const api of apiSpecs) {
    const specResult = await validateSpec(api.specPath);
    const examplesResult = api.examplesPath
      ? await validateExamples(api.specPath, api.examplesPath)
      : { valid: true, errors: [], warnings: [] };

    results[api.name] = {
      spec: specResult,
      examples: examplesResult,
      valid: specResult.valid && examplesResult.valid
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
  const { detailed = false } = options;
  const lines = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let validCount = 0;
  
  for (const [apiName, result] of Object.entries(results)) {
    const specErrors = result.spec.errors.length;
    const specWarnings = result.spec.warnings.length;
    const exampleErrors = result.examples.errors.length;
    const exampleWarnings = result.examples.warnings.length;
    
    totalErrors += specErrors + exampleErrors;
    totalWarnings += specWarnings + exampleWarnings;
    
    if (result.valid) {
      validCount++;
      lines.push(`  ✓ ${apiName}`);
      if (specWarnings > 0 || exampleWarnings > 0) {
        lines.push(`    ${specWarnings + exampleWarnings} warning(s)`);
      }
    } else {
      lines.push(`  ✗ ${apiName}`);
      
      // Show spec errors
      if (specErrors > 0) {
        lines.push(`    Spec: ${specErrors} error(s)`);
        for (const error of result.spec.errors.slice(0, 3)) {
          lines.push(`      - ${error.message}`);
        }
        if (specErrors > 3) {
          lines.push(`      ... and ${specErrors - 3} more`);
        }
      }
      
      // Show example errors
      if (exampleErrors > 0) {
        lines.push(`    Examples: ${exampleErrors} error(s)`);
        const grouped = {};
        for (const error of result.examples.errors) {
          const key = error.example || 'unknown';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(error);
        }
        
        const maxExamples = detailed ? Object.keys(grouped).length : 3;
        let shownExamples = 0;
        
        for (const [example, errs] of Object.entries(grouped)) {
          if (shownExamples >= maxExamples) break;
          
          // Show first error for this example
          const firstErr = errs[0];
          const propertyPath = firstErr.field === 'root' ? '(root)' : firstErr.field;
          lines.push(`      - ${example}: ${propertyPath} ${firstErr.message}`);
          
          // Show additional errors for same example
          const maxErrsPerExample = detailed ? errs.length : 3;
          for (let i = 1; i < Math.min(maxErrsPerExample, errs.length); i++) {
            const err = errs[i];
            const path = err.field === 'root' ? '(root)' : err.field;
            lines.push(`        ${path} ${err.message}`);
          }
          
          if (!detailed && errs.length > 3) {
            lines.push(`        ... and ${errs.length - 3} more error(s) in this example`);
          }
          
          shownExamples++;
        }
        
        if (!detailed) {
          const remainingExamples = Object.keys(grouped).length - shownExamples;
          if (remainingExamples > 0) {
            lines.push(`      ... and ${remainingExamples} more example(s) with errors`);
          }
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
