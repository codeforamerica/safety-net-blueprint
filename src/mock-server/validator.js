/**
 * Request validator using JSON Schema / OpenAPI schemas
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

// Create AJV instance with OpenAPI 3.1 support
const ajv = new Ajv({
  strict: false,
  validateFormats: true,
  allErrors: true,
  coerceTypes: false
});

// Add format validators (email, uuid, date, date-time, etc.)
addFormats(ajv);

// Store compiled validators
const validators = new Map();

/**
 * Get or compile a validator for a schema
 * @param {string} key - Unique key for this validator
 * @param {Object} schema - JSON Schema object
 * @returns {Function} Ajv validate function
 */
function getValidator(key, schema) {
  if (validators.has(key)) {
    return validators.get(key);
  }
  
  // Remove readOnly properties from required array for validation
  // (readOnly properties are server-generated and shouldn't be required in requests)
  const schemaForValidation = prepareSchemaForValidation(schema);
  
  const validate = ajv.compile(schemaForValidation);
  validators.set(key, validate);
  return validate;
}

/**
 * Prepare schema for request validation
 * Removes readOnly properties from required arrays
 * @param {Object} schema - Original schema
 * @returns {Object} Schema prepared for validation
 */
function prepareSchemaForValidation(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  
  const prepared = { ...schema };
  
  // If schema has properties, check for readOnly fields
  if (prepared.properties) {
    prepared.properties = { ...prepared.properties };
    
    // Remove readOnly properties from required array
    if (prepared.required && Array.isArray(prepared.required)) {
      prepared.required = prepared.required.filter(fieldName => {
        const prop = prepared.properties[fieldName];
        return !prop?.readOnly;
      });
    }
    
    // Recursively prepare nested schemas
    for (const [key, value] of Object.entries(prepared.properties)) {
      if (value && typeof value === 'object') {
        prepared.properties[key] = prepareSchemaForValidation(value);
      }
    }
  }
  
  // Handle allOf (common in Create/Update schemas)
  if (prepared.allOf && Array.isArray(prepared.allOf)) {
    prepared.allOf = prepared.allOf.map(s => prepareSchemaForValidation(s));
  }
  
  // Handle anyOf, oneOf
  if (prepared.anyOf && Array.isArray(prepared.anyOf)) {
    prepared.anyOf = prepared.anyOf.map(s => prepareSchemaForValidation(s));
  }
  
  if (prepared.oneOf && Array.isArray(prepared.oneOf)) {
    prepared.oneOf = prepared.oneOf.map(s => prepareSchemaForValidation(s));
  }
  
  return prepared;
}

/**
 * Validate request data against a schema
 * @param {Object} data - Data to validate
 * @param {Object} schema - JSON Schema
 * @param {string} schemaKey - Unique key for caching the validator
 * @returns {Object} {valid: boolean, errors: Array}
 */
export function validate(data, schema, schemaKey) {
  if (!schema) {
    return { valid: true, errors: [] };
  }
  
  const validator = getValidator(schemaKey, schema);
  const valid = validator(data);
  
  if (valid) {
    return { valid: true, errors: [] };
  }
  
  // Log raw validation errors for debugging
  if (process.env.DEBUG_VALIDATION) {
    console.log('Validation failed for:', schemaKey);
    console.log('Raw Ajv errors:', JSON.stringify(validator.errors, null, 2));
  }
  
  // Format errors for API response
  const errorList = (validator.errors || []).map(err => {
    let field = err.instancePath ? err.instancePath.substring(1).replace(/\//g, '.') : 'body';
    let message = err.message || 'validation error';
    
    // Handle additionalProperties error - include the property name
    if (err.keyword === 'additionalProperties') {
      if (err.params?.additionalProperty) {
        const additionalProp = err.params.additionalProperty;
        const basePath = field && field !== 'body' ? field + '.' : '';
        field = basePath + additionalProp;
        message = `is not allowed (additional property)`;
      } else {
        // Fallback if additionalProperty param is missing
        message = `must not have additional properties`;
        // Try to extract property names from the data
        if (err.data && typeof err.data === 'object') {
          const dataKeys = Object.keys(err.data);
          if (dataKeys.length > 0) {
            message += ` (found: ${dataKeys.join(', ')})`;
          }
        }
      }
    }
    // Handle required field error - include the missing field
    else if (err.keyword === 'required' && err.params?.missingProperty) {
      const missingProp = err.params.missingProperty;
      const basePath = field && field !== 'body' ? field + '.' : '';
      field = basePath + missingProp;
      message = `is required`;
    }
    // Handle enum errors - show allowed values
    else if (err.keyword === 'enum' && err.params?.allowedValues) {
      const allowed = err.params.allowedValues.join(', ');
      message = `must be one of: ${allowed}`;
    }
    // Handle type errors with more detail
    else if (err.keyword === 'type') {
      const expectedType = err.params?.type;
      if (expectedType) {
        message = `must be ${expectedType}`;
      }
    }
    // Handle format errors
    else if (err.keyword === 'format') {
      const format = err.params?.format;
      if (format) {
        message = `must match format "${format}"`;
      }
    }
    
    // Build error object
    const error = {
      field: field || 'body',
      message
    };
    
    // Only include value for non-sensitive fields and if it's not too large
    if (err.data !== undefined && 
        !field.toLowerCase().includes('password') && 
        !field.toLowerCase().includes('token') &&
        JSON.stringify(err.data).length < 100) {
      error.value = err.data;
    }
    
    return error;
  });
  
  // Deduplicate errors by field+message combination
  // For additional properties, we need to preserve all unique field names
  const uniqueErrors = [];
  const seen = new Set();
  
  for (const error of errorList) {
    // Create a key that includes field, message, and value (if present)
    // This ensures we don't lose information about different fields
    const key = error.value !== undefined 
      ? `${error.field}:${error.message}:${JSON.stringify(error.value)}`
      : `${error.field}:${error.message}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      uniqueErrors.push(error);
    }
  }
  
  return { valid: false, errors: uniqueErrors };
}

/**
 * Create error response for validation failures
 * @param {Array} errors - Array of validation errors
 * @param {number} statusCode - HTTP status code (400 or 422)
 * @returns {Object} Error response object
 */
export function createErrorResponse(errors, statusCode = 422) {
  const code = statusCode === 400 ? 'BAD_REQUEST' : 'VALIDATION_ERROR';
  const message = statusCode === 400 
    ? 'The request is malformed or contains invalid parameters'
    : 'The request contains invalid data';
  
  return {
    code,
    message,
    details: errors
  };
}

/**
 * Validate request body middleware
 * @param {Object} schema - JSON Schema to validate against
 * @param {string} schemaKey - Unique key for the schema
 * @returns {Function} Express middleware
 */
export function validateRequest(schema, schemaKey) {
  return (req, res, next) => {
    if (!schema) {
      return next();
    }
    
    const { valid, errors } = validate(req.body, schema, schemaKey);
    
    if (!valid) {
      return res.status(422).json(createErrorResponse(errors, 422));
    }
    
    next();
  };
}

/**
 * Validate that request body is valid JSON middleware
 */
export function validateJSON(err, req, res, next) {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      message: 'Invalid JSON in request body',
      details: [{ field: 'body', message: err.message }]
    });
  }
  next(err);
}
