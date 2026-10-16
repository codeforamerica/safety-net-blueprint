/**
 * Request validator using JSON Schema / OpenAPI schemas
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createAjv, registerDocuments, validatorForRef } from './schema-registry.js';

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
 * An ajv that knows the contract set, for schemas that still carry `$ref`s.
 *
 * A module-level instance because `validate` is reached from handlers that are
 * built once at boot and called per request, and threading it through every
 * one of them would be a lot of plumbing for a value that never changes. Same
 * shape as the compiled-validator cache above, and as the event bus.
 *
 * Null until a boot path registers the documents, which is what lets the
 * fallback below keep working: a schema with no refs validates the same way it
 * always did, so tests that pass a plain schema need no registry (#448).
 *
 * @type {import('ajv').default|null}
 */
let registryAjv = null;

/**
 * Hand the validator the document set, so it can resolve refs.
 *
 * Called once per boot, by whichever path assembled the documents — `setup.js`
 * from a directory, `browser.js` from an artifact.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {{ registered: number, skipped: string[] }}
 */
export function initSchemaRegistry(docs) {
  // createAjv already adds the format validators; adding them twice throws
  // on the second `formatMaximum` registration.
  registryAjv = createAjv({ validateFormats: true, coerceTypes: false });
  const result = registerDocuments(registryAjv, docs);
  validators.clear();
  return result;
}

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

  // Strip $id and $schema so AJV doesn't try to register shared sub-schemas
  // (e.g., schemas/common/income.yaml) multiple times when the same file is
  // referenced by more than one OpenAPI spec.
  //
  // This path only handles schemas with no cross-file refs to resolve. It used
  // to say the validator "only needs to check structure, not resolve
  // cross-schema $refs by ID", which held only because $RefParser had already
  // inlined them. It does not any more — resolving by ID is exactly what
  // schema-registry.js does, and a schema that needs it comes through
  // `resolveValidator` instead (#448).
  delete prepared.$id;
  delete prepared.$schema;

  // Strip `nullable` — it's an OpenAPI 3.0 extension keyword, not a JSON Schema
  // concept. AJV 8.x has a built-in `nullable` handler from its JTD vocabulary
  // that requires `type` to be present in the same object, which throws on the
  // common OpenAPI pattern `{ allOf: [$ref: ...], nullable: true }`. Nullability
  // is enforced at the OpenAPI spec layer; the mock server doesn't need to validate it.
  delete prepared.nullable;
  
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

  // Handle array items
  if (prepared.items && typeof prepared.items === 'object') {
    prepared.items = prepareSchemaForValidation(prepared.items);
  }

  // Recurse into $defs
  if (prepared.$defs && typeof prepared.$defs === 'object') {
    prepared.$defs = Object.fromEntries(
      Object.entries(prepared.$defs).map(([k, v]) => [k, prepareSchemaForValidation(v)])
    );
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

/** Schemas already reported as uncompilable, so each is said once. */
const uncompilable = new Set();

/**
 * The validator for a schema, by whichever route can produce one.
 *
 * Prefers the registry, which resolves `$ref`s against the document the schema
 * was declared in. Falls back to compiling the object, which is right for a
 * schema carrying no refs — and can fail outright for one that does, since a
 * detached object gives ajv no base to resolve against. A compile error here
 * would otherwise surface as an unhandled MissingRefError inside a request
 * handler, which is a bad place to learn that a contract ref is wrong.
 *
 * Note the two resolvers do not agree in one case: core's `followRef` retries
 * a ref with its leading `../` segments stripped, so a ref written one level
 * too shallow still resolves for anything reading documents. ajv does
 * ordinary URI arithmetic and will not find it. That set is malformed either
 * way, but it reaches this function rather than failing earlier.
 *
 * @param {object} schema
 * @param {string} schemaKey
 * @param {{ relativePath?: string, ref?: string|null }|null} source
 * @returns {import('ajv').ValidateFunction|null}
 */
function resolveValidator(schema, schemaKey, source) {
  if (registryAjv && source?.relativePath && source?.ref) {
    const fromRegistry = validatorForRef(registryAjv, source.relativePath, source.ref);
    if (fromRegistry) return fromRegistry;
  }

  try {
    return getValidator(schemaKey, schema);
  } catch {
    return null;
  }
}

/**
 * Validate request data against a schema.
 *
 * `source` says where the schema came from, which matters when it still
 * carries `$ref`s: ajv resolves a ref relative to the document holding it, and
 * a detached schema object says nothing about which document that was — the
 * failure reads "from id #", no base at all. Given a source, the schema is
 * addressed by ref through the registry instead, so ajv resolves it itself.
 *
 * Omit `source` and it compiles the object as before, which is right for a
 * schema with no refs to resolve.
 *
 * @param {Object} data - Data to validate
 * @param {Object} schema - JSON Schema
 * @param {string} schemaKey - Unique key for caching the validator
 * @param {{ relativePath?: string, ref?: string|null }} [source] - The document
 *   the schema was declared in, and the ref naming it
 * @returns {Object} {valid: boolean, errors: Array}
 */
export function validate(data, schema, schemaKey, source = null) {
  if (!schema) {
    return { valid: true, errors: [] };
  }

  const validator = resolveValidator(schema, schemaKey, source);
  if (!validator) {
    // Nothing to validate against, and a request is not the place to discover
    // that. Reported once per schema so it is visible without one line per
    // request; the contract set is what needs fixing.
    if (!uncompilable.has(schemaKey)) {
      uncompilable.add(schemaKey);
      console.warn(
        `Warning: no validator could be compiled for "${schemaKey}", so requests to it ` +
        'are not checked. A $ref in its schema names nothing in the contract set — ' +
        'check the relative path, including how many `../` segments it leads with.'
      );
    }
    return { valid: true, errors: [] };
  }

  const valid = validator(data);
  
  if (valid) {
    return { valid: true, errors: [] };
  }
  
  // Log raw validation errors for debugging.
  //
  // Reached through `globalThis` because this module is in the browser entry's
  // graph: a bare `process` is a ReferenceError in a page, and this line sits
  // on the validation-failure path, so every rejected request came back as a
  // 500 "process is not defined" instead of the 422 naming the field.
  if (globalThis.process?.env?.DEBUG_VALIDATION) {
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
