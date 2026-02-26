/**
 * API Pattern Validator
 *
 * Validates that OpenAPI specs follow established API design patterns:
 * - Search: List endpoints must use SearchQueryParam
 * - Pagination: List endpoints must have LimitParam and OffsetParam
 * - List Response: Must have items, total, limit, offset, hasNext
 * - Consistent HTTP methods and response codes
 */

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

  const properties = schema.properties || {};
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

  if (!spec.paths) {
    return errors;
  }

  for (const [path, methods] of Object.entries(spec.paths)) {
    // Validate GET endpoints
    if (methods.get) {
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
