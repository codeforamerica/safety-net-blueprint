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
 * records outside the blueprint. Use resource: Polymorphic for fields that are
 * part of a polymorphic association (paired with a matching *Type discriminator
 * field) where the target schema varies by type and cannot be statically declared.
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
          message: `Schema "${schemaName}": "${propName}" is a UUID FK field and must declare x-relationship: { resource: ResourceName }. Use resource: External for external system references. Use resource: Polymorphic for polymorphic associations paired with a *Type discriminator field.`,
          severity: 'error'
        });
      }
    }
  }
}

// =============================================================================
// x-sortable Validation
// =============================================================================

/**
 * Lexical rule for sort-field names. Enforced at lint time (here) and at
 * runtime (sort-parser) as defense in depth. This is a security boundary:
 * field names are interpolated into raw SQL (ORDER BY) and json_extract
 * path strings, which SQLite does not parameterize. Permitting any
 * character outside this allowlist enables SQL or JSON-path injection.
 *
 * Matches: ASCII identifier segments joined by single dots, e.g.
 *   createdAt
 *   name.lastName
 *   citizenshipInfo.status
 */
export const SORTABLE_FIELD_REGEX = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * Field-name patterns whose ordering can leak information about records
 * (sort-as-oracle). When any of these appear in `x-sortable.fields` the
 * validator emits a warning. State authors can intentionally suppress by
 * not flagging the field; the warning is advisory, not blocking.
 *
 * This list is non-exhaustive — it catches the most common cases. For full
 * coverage of state-specific or domain-specific sensitive fields, mark the
 * schema property with `x-pii: true`; the validator honors that annotation
 * via findPropertyByPath regardless of name.
 */
const SENSITIVE_FIELD_NAMES = /^(ssn|socialSecurityNumber|dateOfBirth|dob|birthDate|taxpayerId|taxpayerNumber|ein|riskScore|fraudScore|isFlagged|email|phoneNumber|address|bankAccount|routingNumber|incomeAmount|annualIncome)$/i;

/**
 * Resolve an internal JSON pointer like "#/components/schemas/Task" against
 * the spec root. Returns null for unresolvable or external refs.
 */
function resolveLocalRef(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  const segments = ref.slice(2).split('/');
  let node = spec;
  for (const seg of segments) {
    if (node == null || typeof node !== 'object') return null;
    node = node[seg];
  }
  return node ?? null;
}

/**
 * Locate the items-element schema for a list endpoint's 200 response.
 * Handles allOf branches (Pagination + properties.items pattern) and
 * follows a single layer of $ref into components.schemas. Returns the
 * resolved item schema, or null if it can't be determined statically.
 */
function resolveListItemSchema(spec, operation) {
  const responseSchema = operation.responses?.['200']?.content?.['application/json']?.schema;
  if (!responseSchema) return null;

  // Search both the top-level properties and allOf branches for an `items` array.
  const containers = [responseSchema];
  if (Array.isArray(responseSchema.allOf)) containers.push(...responseSchema.allOf);

  for (const container of containers) {
    const itemsProp = container?.properties?.items;
    if (itemsProp?.type === 'array' && itemsProp.items) {
      const itemSchema = itemsProp.items;
      if (itemSchema.$ref) return resolveLocalRef(spec, itemSchema.$ref);
      return itemSchema;
    }
  }
  return null;
}

/**
 * Test whether a dot-path resolves to a property on the given schema.
 * Follows local $ref, allOf branches, and nested object/array shapes.
 * The `pii` out-parameter is set to true if any traversed segment carries
 * `x-pii: true`. Returns { found: boolean, pii: boolean }.
 */
function findPropertyByPath(spec, schema, dotPath, visited = new Set()) {
  if (!schema || typeof schema !== 'object') return { found: false, pii: false };
  if (schema.$ref) {
    // Cycle guard is scoped to the active descent: add on entry, remove on
    // exit. Otherwise a $ref visited in one allOf/oneOf branch would block
    // sibling branches that legitimately reference the same schema.
    if (visited.has(schema.$ref)) return { found: false, pii: false };
    visited.add(schema.$ref);
    try {
      const resolved = resolveLocalRef(spec, schema.$ref);
      return findPropertyByPath(spec, resolved, dotPath, visited);
    } finally {
      visited.delete(schema.$ref);
    }
  }

  // Collect property containers (top-level + allOf branches)
  const containers = [schema];
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) containers.push(branch);
  }
  if (Array.isArray(schema.oneOf)) {
    for (const branch of schema.oneOf) containers.push(branch);
  }
  if (Array.isArray(schema.anyOf)) {
    for (const branch of schema.anyOf) containers.push(branch);
  }

  const [head, ...rest] = dotPath.split('.');
  for (const container of containers) {
    if (container?.$ref) {
      const r = findPropertyByPath(spec, container, dotPath, visited);
      if (r.found) return r;
      continue;
    }
    const prop = container?.properties?.[head];
    if (!prop) continue;
    const pii = prop['x-pii'] === true;
    if (rest.length === 0) return { found: true, pii };
    // Recurse into nested object
    const deeper = findPropertyByPath(spec, prop, rest.join('.'), visited);
    if (deeper.found) return { found: true, pii: pii || deeper.pii };
  }
  return { found: false, pii: false };
}

/**
 * Parse a sort-string expression (the same syntax accepted by the runtime
 * query parameter) into [{name, descending}]. Returns null if the input is
 * not a string. Field names are returned raw — caller validates lexically.
 */
function parseSortExpression(expr) {
  if (typeof expr !== 'string') return null;
  return expr
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(token => {
      if (token.startsWith('-')) return { name: token.slice(1), descending: true };
      return { name: token, descending: false };
    });
}

/**
 * Validates the x-sortable extension on a list operation, including:
 *   - structural shape (`fields` required, others optional)
 *   - cross-reference of every field name against the response schema
 *   - lexical identifier regex on every field name (security boundary)
 *   - that SortParam is referenced in parameters
 *   - advisory warning for sensitive-field names that leak via sort order
 *
 * @param {Object} spec - The full OpenAPI spec (for $ref resolution)
 * @param {string} path - The endpoint path
 * @param {Object} operation - The OpenAPI operation object
 * @param {Array} errors - Array to push errors / warnings to
 */
export function validateSortableExtension(spec, path, operation, errors) {
  const ext = operation['x-sortable'];
  if (ext === undefined) return;

  // Structural — fields is required and non-empty
  if (!Array.isArray(ext.fields) || ext.fields.length === 0) {
    errors.push({
      path,
      rule: 'sortable-fields-required',
      message: `GET ${path} x-sortable must declare a non-empty 'fields' array`,
      severity: 'error'
    });
    return;
  }

  // SortParam must be referenced — match end of $ref path to avoid false
  // positives on names like "MySortParamExtended" or "LegacySortParam".
  const params = operation.parameters || [];
  const hasSortParam = params.some(p => /(^|[/#])SortParam$/.test(p.$ref ?? '')) ||
                       params.some(p => p.name === 'sort');
  if (!hasSortParam) {
    errors.push({
      path,
      rule: 'sortable-param-required',
      message: `GET ${path} declares x-sortable but does not reference SortParam in parameters`,
      severity: 'error'
    });
  }

  const itemSchema = resolveListItemSchema(spec, operation);

  // Validate each field in fields[]
  for (const fieldName of ext.fields) {
    if (typeof fieldName !== 'string' || !SORTABLE_FIELD_REGEX.test(fieldName)) {
      errors.push({
        path,
        rule: 'sortable-field-lexical',
        message: `GET ${path} x-sortable.fields entry "${fieldName}" must match ${SORTABLE_FIELD_REGEX} (security: field names are interpolated into SQL identifiers)`,
        severity: 'error'
      });
      continue;
    }
    if (itemSchema) {
      const { found, pii } = findPropertyByPath(spec, itemSchema, fieldName);
      if (!found) {
        errors.push({
          path,
          rule: 'sortable-field-unknown',
          message: `GET ${path} x-sortable.fields entry "${fieldName}" does not resolve to a property on the response item schema`,
          severity: 'error'
        });
        continue;
      }
      const sensitiveName = SENSITIVE_FIELD_NAMES.test(fieldName.split('.').pop() || '');
      if (pii || sensitiveName) {
        errors.push({
          path,
          rule: 'sortable-sensitive-field',
          message: `GET ${path} x-sortable.fields entry "${fieldName}" appears to be sensitive — sort order is an information-disclosure oracle even when the field is not projected`,
          severity: 'warn'
        });
      }
    }
  }

  // Validate default
  if (ext.default !== undefined) {
    const parsed = parseSortExpression(ext.default);
    if (parsed === null) {
      errors.push({
        path,
        rule: 'sortable-default-type',
        message: `GET ${path} x-sortable.default must be a string`,
        severity: 'error'
      });
    } else {
      for (const { name } of parsed) {
        if (!SORTABLE_FIELD_REGEX.test(name)) {
          errors.push({
            path,
            rule: 'sortable-default-lexical',
            message: `GET ${path} x-sortable.default field "${name}" must match ${SORTABLE_FIELD_REGEX}`,
            severity: 'error'
          });
          continue;
        }
        if (!ext.fields.includes(name)) {
          errors.push({
            path,
            rule: 'sortable-default-not-in-fields',
            message: `GET ${path} x-sortable.default references "${name}" which is not in x-sortable.fields`,
            severity: 'error'
          });
        }
      }
    }
  }

  // Validate tieBreaker
  if (ext.tieBreaker !== undefined && ext.tieBreaker !== null) {
    if (typeof ext.tieBreaker !== 'string') {
      errors.push({
        path,
        rule: 'sortable-tieBreaker-type',
        message: `GET ${path} x-sortable.tieBreaker must be a string or null`,
        severity: 'error'
      });
    } else if (!SORTABLE_FIELD_REGEX.test(ext.tieBreaker)) {
      errors.push({
        path,
        rule: 'sortable-tieBreaker-lexical',
        message: `GET ${path} x-sortable.tieBreaker "${ext.tieBreaker}" must match ${SORTABLE_FIELD_REGEX}`,
        severity: 'error'
      });
    } else if (itemSchema) {
      const { found } = findPropertyByPath(spec, itemSchema, ext.tieBreaker);
      if (!found) {
        errors.push({
          path,
          rule: 'sortable-tieBreaker-unknown',
          message: `GET ${path} x-sortable.tieBreaker "${ext.tieBreaker}" does not resolve to a property on the response item schema`,
          severity: 'error'
        });
      }
    }
  }

  // Validate maxFields
  if (ext.maxFields !== undefined) {
    if (!Number.isInteger(ext.maxFields) || ext.maxFields < 1) {
      errors.push({
        path,
        rule: 'sortable-maxFields-type',
        message: `GET ${path} x-sortable.maxFields must be a positive integer`,
        severity: 'error'
      });
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
        validateSortableExtension(spec, path, methods.get, errors);
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
