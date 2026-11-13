/**
 * Request validator using JSON Schema / OpenAPI schemas
 */

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createAjv, registerDocuments, validatorForRef, schemaIdFor } from './schema-registry.js';

/**
 * One mock's validator: the contract set it resolves refs against, and the
 * validators it has compiled. Each mock has its own (instance.js), so two in
 * one page each validate against their own contracts.
 *
 * Without documents, a schema with no refs still validates the same way, so
 * tests that pass a plain schema need no contract set (#448).
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]|null} [docs]
 * @returns {{ load: (docs: object[]) => { registered: number, skipped: string[] }, validate: (data: unknown, schema: object, schemaKey: string, source?: object|null) => { valid: boolean, errors: Array } }}
 */
export function createSchemaRegistry(docs = null) {
  // The 2020-12 build: OpenAPI 3.1's schema dialect
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
   * Null until the documents are loaded.
   *
   * @type {import('ajv').default|null}
   */
  let registryAjv = null;

  /** Schemas already reported as uncompilable, so each is said once. */
  const uncompilable = new Set();

  /**
   * Hand the validator the document set, so it can resolve refs.
   *
   * Called once per boot, by whichever path assembled the documents — `setup.js`
   * from a directory, `server.js` from an artifact.
   *
   * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
   * @returns {{ registered: number, skipped: string[] }}
   */
  function load(docs) {
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
   * A schema written inside a document ajv can't register — a state machine's
   * action schema — comes with that document's path and its `$defs` instead of
   * a ref, and is compiled as though it sat there, so its refs resolve the same.
   *
   * @param {object} schema
   * @param {string} schemaKey
   * @param {{ relativePath?: string, ref?: string|null, defs?: object }|null} source
   * @returns {import('ajv').ValidateFunction|null}
   */
  function resolveValidator(schema, schemaKey, source) {
    if (registryAjv && source?.relativePath && source?.ref) {
      const fromRegistry = validatorForRef(registryAjv, source.relativePath, source.ref);
      if (fromRegistry) return fromRegistry;
    }
    if (registryAjv && source?.relativePath && !source.ref) {
      // A query keeps the document's directory as the base for relative refs,
      // and keeps this schema apart from the document's own identifier.
      const $id = `${schemaIdFor(source.relativePath)}?schema=${encodeURIComponent(schemaKey)}`;
      try {
        const prepared = prepareSchemaForValidation(schema);
        return registryAjv.getSchema($id) ?? registryAjv.compile({
          ...prepared,
          $id,
          ...(source.defs && { $defs: { ...source.defs, ...prepared.$defs } }),
        });
      } catch {
        // Falls through to compiling the object alone, which reports it.
      }
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
  function validate(data, schema, schemaKey, source = null) {
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
    return errorsOf(validator, data, schemaKey);
  }

  if (docs) load(docs);
  return { load, validate };
}

/**
 * Run a compiled validator and say what it found, as the API answers it.
 *
 * @param {import('ajv').ValidateFunction} validator
 * @param {unknown} data
 * @param {string} schemaKey
 * @returns {{ valid: boolean, errors: Array }}
 */
function errorsOf(validator, data, schemaKey) {
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
    // A field a closed, composed schema does not declare — the same answer
    else if (err.keyword === 'unevaluatedProperties' && err.params?.unevaluatedProperty) {
      const basePath = field && field !== 'body' ? field + '.' : '';
      field = basePath + err.params.unevaluatedProperty;
      message = `is not allowed (additional property)`;
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
