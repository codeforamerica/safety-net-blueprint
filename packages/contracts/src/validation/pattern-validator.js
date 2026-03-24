/**
 * API Pattern Validator
 *
 * Validates that OpenAPI specs follow established API design patterns:
 * - Search: List endpoints must use SearchQueryParam
 * - Pagination: List endpoints must have LimitParam and OffsetParam
 * - List Response: Must have items, total, limit, offset, hasNext
 * - Consistent HTTP methods and response codes
 * - FK fields (ending in Id, format: uuid) must declare x-relationship
 */

// =============================================================================
// Foreign Key Validation Helpers
// =============================================================================

/**
 * Walk all properties of a schema, recursing into allOf branches and inline
 * nested objects/arrays. Yields { propName, propSchema, propPath } for each
 * discovered property. Does NOT recurse into $ref branches (unresolved).
 */
function* walkProperties(schema, pathPrefix = '') {
  if (!schema || typeof schema !== 'object') return;

  const branches = [schema];
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      if (!branch.$ref) branches.push(branch);
    }
  }

  for (const branch of branches) {
    if (!branch.properties) continue;
    for (const [propName, propSchema] of Object.entries(branch.properties)) {
      if (!propSchema || propSchema.$ref) continue;
      const propPath = pathPrefix ? `${pathPrefix}.${propName}` : propName;
      yield { propName, propSchema, propPath };

      if (propSchema.type === 'object' || propSchema.properties) {
        yield* walkProperties(propSchema, propPath);
      }
      if (propSchema.type === 'array' && propSchema.items && !propSchema.items.$ref) {
        yield* walkProperties(propSchema.items, `${propPath}[]`);
      }
    }
  }
}

/**
 * Returns true if the property is a UUID FK field that requires x-relationship:
 * name ends in 'Id' (not exactly 'id'), type: string, format: uuid.
 */
function isFkField(propName, propSchema) {
  if (propName === 'id') return false;
  if (!propName.endsWith('Id')) return false;
  return propSchema.type === 'string' && propSchema.format === 'uuid';
}

/**
 * Validates that FK fields (properties ending in 'Id' with format: uuid)
 * have x-relationship declared. Use resource: External for fields referencing
 * records outside the blueprint.
 * @param {Object} spec - The OpenAPI spec object
 * @param {Array} errors - Array to push errors to
 */
export function validateForeignKeys(spec, errors) {
  const schemas = spec.components?.schemas;
  if (!schemas) return;

  for (const [schemaName, schema] of Object.entries(schemas)) {
    for (const { propName, propSchema, propPath } of walkProperties(schema)) {
      if (!isFkField(propName, propSchema)) continue;

      if (!propSchema['x-relationship']?.resource) {
        errors.push({
          path: `components/schemas/${schemaName}/${propPath}`,
          rule: 'fk-x-relationship-required',
          message: `Schema "${schemaName}": "${propName}" is a UUID FK field and must declare x-relationship: { resource: ResourceName }. Use resource: External for external system references.`,
          severity: 'error'
        });
      }
    }
  }
}

/**
 * Validates that list endpoints (collection GET) have required parameters
 * @param {string} path - The endpoint path
 * @param {Object} operation - The OpenAPI operation object
 * @param {Array} errors - Array to push errors to
 */
export function validateListEndpointParameters(path, operation, errors) {
  const params = operation.parameters || [];

  // Check for $ref patterns in parameters
  const paramRefs = params
    .filter(p => p.$ref)
    .map(p => p.$ref);

  const paramNames = params
    .filter(p => p.name)
    .map(p => p.name);

  // Must have SearchQueryParam (by ref or by name 'q')
  const hasSearchParam = paramRefs.some(ref => ref.includes('SearchQueryParam')) ||
                         paramNames.includes('q');
  if (!hasSearchParam) {
    errors.push({
      path,
      rule: 'list-endpoint-search-param',
      message: `GET ${path} must reference SearchQueryParam or have 'q' parameter`,
      severity: 'error'
    });
  }

  // Must have LimitParam
  const hasLimitParam = paramRefs.some(ref => ref.includes('LimitParam')) ||
                        paramNames.includes('limit');
  if (!hasLimitParam) {
    errors.push({
      path,
      rule: 'list-endpoint-limit-param',
      message: `GET ${path} must reference LimitParam or have 'limit' parameter`,
      severity: 'error'
    });
  }

  // Must have OffsetParam
  const hasOffsetParam = paramRefs.some(ref => ref.includes('OffsetParam')) ||
                         paramNames.includes('offset');
  if (!hasOffsetParam) {
    errors.push({
      path,
      rule: 'list-endpoint-offset-param',
      message: `GET ${path} must reference OffsetParam or have 'offset' parameter`,
      severity: 'error'
    });
  }
}

/**
 * Validates that list endpoint responses have required properties
 * @param {string} path - The endpoint path
 * @param {Object} operation - The OpenAPI operation object
 * @param {Array} errors - Array to push errors to
 */
export function validateListResponseSchema(path, operation, errors) {
  const response200 = operation.responses?.['200'];
  if (!response200) {
    errors.push({
      path,
      rule: 'list-endpoint-200-response',
      message: `GET ${path} must have a 200 response`,
      severity: 'error'
    });
    return;
  }

  const schema = response200.content?.['application/json']?.schema;
  if (!schema) {
    errors.push({
      path,
      rule: 'list-endpoint-response-schema',
      message: `GET ${path} 200 response must have application/json schema`,
      severity: 'error'
    });
    return;
  }

  // If schema is a $ref, we can't validate properties here (would need dereferencing)
  // Skip property validation for referenced schemas
  if (schema.$ref) {
    return;
  }

  // Collect properties from allOf branches (supports shared Pagination component)
  let properties = schema.properties || {};
  if (schema.allOf) {
    properties = {};
    for (const branch of schema.allOf) {
      if (branch.properties) {
        Object.assign(properties, branch.properties);
      }
      // Recognize $ref to pagination.yaml as providing pagination properties
      if (branch.$ref && branch.$ref.includes('pagination.yaml')) {
        Object.assign(properties, {
          total: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          hasNext: { type: 'boolean' }
        });
      }
    }
  }

  const requiredProps = ['items', 'total', 'limit', 'offset'];

  for (const prop of requiredProps) {
    if (!properties[prop]) {
      errors.push({
        path,
        rule: `list-endpoint-response-${prop}`,
        message: `GET ${path} 200 response schema must have '${prop}' property`,
        severity: 'error'
      });
    }
  }

  // hasNext is recommended but not required
  if (!properties.hasNext) {
    errors.push({
      path,
      rule: 'list-endpoint-response-hasNext',
      message: `GET ${path} 200 response schema should have 'hasNext' property`,
      severity: 'warn'
    });
  }

  // items must be an array
  if (properties.items && properties.items.type !== 'array') {
    errors.push({
      path,
      rule: 'list-endpoint-items-array',
      message: `GET ${path} 'items' property must be an array`,
      severity: 'error'
    });
  }
}

/**
 * Validates POST endpoint patterns
 * @param {string} path - The endpoint path
 * @param {Object} operation - The OpenAPI operation object
 * @param {Array} errors - Array to push errors to
 */
export function validatePostEndpoint(path, operation, errors) {
  // Must have Location header in 201 response
  const response201 = operation.responses?.['201'];
  if (response201 && !response201.headers?.Location) {
    errors.push({
      path,
      rule: 'post-location-header',
      message: `POST ${path} 201 response should have Location header`,
      severity: 'warn'
    });
  }

  // Must have request body
  if (!operation.requestBody) {
    errors.push({
      path,
      rule: 'post-request-body',
      message: `POST ${path} must have a request body`,
      severity: 'error'
    });
  }
}

/**
 * Validates PATCH endpoint patterns
 * @param {string} path - The endpoint path
 * @param {Object} operation - The OpenAPI operation object
 * @param {Array} errors - Array to push errors to
 */
export function validatePatchEndpoint(path, operation, errors) {
  // Must have request body
  if (!operation.requestBody) {
    errors.push({
      path,
      rule: 'patch-request-body',
      message: `PATCH ${path} must have a request body`,
      severity: 'error'
    });
  }

  // Must return 200 with updated resource
  if (!operation.responses?.['200']) {
    errors.push({
      path,
      rule: 'patch-200-response',
      message: `PATCH ${path} must return 200 with updated resource`,
      severity: 'error'
    });
  }
}

/**
 * Validates that single-resource GET endpoints have proper error handling
 * @param {string} path - The endpoint path
 * @param {Object} operation - The OpenAPI operation object
 * @param {Array} errors - Array to push errors to
 */
export function validateSingleResourceGet(path, operation, errors) {
  // Must handle 404
  if (!operation.responses?.['404']) {
    errors.push({
      path,
      rule: 'get-single-404',
      message: `GET ${path} must handle 404 Not Found`,
      severity: 'error'
    });
  }
}

/**
 * Validates that error responses use shared response definitions
 * @param {string} path - The endpoint path
 * @param {string} method - The HTTP method
 * @param {Object} operation - The OpenAPI operation object
 * @param {Array} errors - Array to push errors to
 */
export function validateSharedErrorResponses(path, method, operation, errors) {
  const responses = operation.responses || {};

  // Check 400 Bad Request
  if (responses['400'] && !responses['400'].$ref) {
    errors.push({
      path,
      rule: 'shared-400-response',
      message: `${method.toUpperCase()} ${path} 400 response should use shared $ref`,
      severity: 'warn'
    });
  }

  // Check 404 Not Found
  if (responses['404'] && !responses['404'].$ref) {
    errors.push({
      path,
      rule: 'shared-404-response',
      message: `${method.toUpperCase()} ${path} 404 response should use shared $ref`,
      severity: 'warn'
    });
  }

  // Check 500 Internal Server Error
  if (responses['500'] && !responses['500'].$ref) {
    errors.push({
      path,
      rule: 'shared-500-response',
      message: `${method.toUpperCase()} ${path} 500 response should use shared $ref`,
      severity: 'warn'
    });
  }
}

/**
 * Check if a GET operation returns application/json (not SSE, file downloads, etc.)
 * @param {Object} operation - The OpenAPI operation object
 * @returns {boolean}
 */
export function hasJsonResponse(operation) {
  return !!operation.responses?.['200']?.content?.['application/json'];
}

/**
 * Check if path is a collection endpoint (no {id} parameter)
 * @param {string} path - The endpoint path
 * @returns {boolean}
 */
export function isCollectionPath(path) {
  return !path.includes('{');
}

/**
 * Check if path is a single resource endpoint (has {id} parameter)
 * @param {string} path - The endpoint path
 * @returns {boolean}
 */
export function isSingleResourcePath(path) {
  return path.includes('{');
}

/**
 * Check if path is an action/RPC endpoint (has segments after the {id} parameter)
 * Examples: /pizzas/{pizzaId}/start-preparing, /tasks/{taskId}/claim
 * @param {string} path - The endpoint path
 * @returns {boolean}
 */
export function isActionPath(path) {
  const lastBrace = path.lastIndexOf('}');
  if (lastBrace === -1) return false;
  return path.substring(lastBrace + 1).includes('/');
}

/**
 * Main validation function for a single spec
 * @param {Object} spec - The OpenAPI spec object
 * @param {string} specName - Name of the spec file
 * @returns {Array} Array of validation errors/warnings
 */
export function validateSpec(spec, specName) {
  const errors = [];

  // Validate FK x-relationship annotations
  validateForeignKeys(spec, errors);

  if (!spec.paths) {
    return errors.map(e => ({ ...e, spec: specName }));
  }

  for (const [path, methods] of Object.entries(spec.paths)) {
    // Validate GET endpoints (skip non-JSON endpoints like SSE streams)
    if (methods.get && hasJsonResponse(methods.get)) {
      if (isCollectionPath(path)) {
        // List endpoint validations
        validateListEndpointParameters(path, methods.get, errors);
        validateListResponseSchema(path, methods.get, errors);
      } else if (isSingleResourcePath(path)) {
        // Single resource GET validations
        validateSingleResourceGet(path, methods.get, errors);
      }
    }

    // Validate POST endpoints (skip CRUD checks for action/RPC endpoints)
    if (methods.post) {
      if (!isActionPath(path)) {
        validatePostEndpoint(path, methods.post, errors);
      }
      validateSharedErrorResponses(path, 'post', methods.post, errors);
    }

    // Validate PATCH endpoints
    if (methods.patch) {
      validatePatchEndpoint(path, methods.patch, errors);
      validateSharedErrorResponses(path, 'patch', methods.patch, errors);
    }

    // Validate DELETE endpoints
    if (methods.delete) {
      validateSharedErrorResponses(path, 'delete', methods.delete, errors);
    }

    // Validate GET endpoints for shared error responses
    if (methods.get) {
      validateSharedErrorResponses(path, 'get', methods.get, errors);
    }
  }

  return errors.map(e => ({ ...e, spec: specName }));
}
