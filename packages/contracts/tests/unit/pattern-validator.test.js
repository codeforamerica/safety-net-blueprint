/**
 * Unit tests for API pattern validator
 * Tests validation of OpenAPI design patterns
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  validateListEndpointParameters,
  validateListResponseSchema,
  validatePostEndpoint,
  validatePatchEndpoint,
  validateSingleResourceGet,
  validateSharedErrorResponses,
  isCollectionPath,
  isSingleResourcePath,
  isActionPath,
  validateSpec
} from '../../src/validation/pattern-validator.js';

test('Pattern Validator Tests', async (t) => {

  // ==========================================================================
  // Path Type Detection
  // ==========================================================================

  await t.test('isCollectionPath - returns true for paths without parameters', () => {
    assert.strictEqual(isCollectionPath('/persons'), true);
    assert.strictEqual(isCollectionPath('/api/v1/users'), true);
    assert.strictEqual(isCollectionPath('/health'), true);
    console.log('  ✓ Identifies collection paths');
  });

  await t.test('isCollectionPath - returns false for paths with parameters', () => {
    assert.strictEqual(isCollectionPath('/persons/{personId}'), false);
    assert.strictEqual(isCollectionPath('/api/{version}/users'), false);
    console.log('  ✓ Rejects paths with parameters');
  });

  await t.test('isSingleResourcePath - returns true for paths with parameters', () => {
    assert.strictEqual(isSingleResourcePath('/persons/{personId}'), true);
    assert.strictEqual(isSingleResourcePath('/orgs/{orgId}/users/{userId}'), true);
    console.log('  ✓ Identifies single resource paths');
  });

  await t.test('isSingleResourcePath - returns false for collection paths', () => {
    assert.strictEqual(isSingleResourcePath('/persons'), false);
    assert.strictEqual(isSingleResourcePath('/health'), false);
    console.log('  ✓ Rejects collection paths');
  });

  await t.test('isActionPath - returns true for paths with segments after {id}', () => {
    assert.strictEqual(isActionPath('/pizzas/{pizzaId}/start-preparing'), true);
    assert.strictEqual(isActionPath('/tasks/{taskId}/claim'), true);
    assert.strictEqual(isActionPath('/orders/{orderId}/cancel'), true);
    console.log('  ✓ Identifies action/RPC paths');
  });

  await t.test('isActionPath - returns false for CRUD paths', () => {
    assert.strictEqual(isActionPath('/pizzas'), false);
    assert.strictEqual(isActionPath('/pizzas/{pizzaId}'), false);
    assert.strictEqual(isActionPath('/health'), false);
    console.log('  ✓ Rejects CRUD paths');
  });

  // ==========================================================================
  // List Endpoint Parameter Validation
  // ==========================================================================

  await t.test('validateListEndpointParameters - passes with all required params by name', () => {
    const errors = [];
    const operation = {
      parameters: [
        { name: 'q', in: 'query' },
        { name: 'limit', in: 'query' },
        { name: 'offset', in: 'query' }
      ]
    };

    validateListEndpointParameters('/persons', operation, errors);

    assert.strictEqual(errors.length, 0);
    console.log('  ✓ Passes with q, limit, offset parameters');
  });

  await t.test('validateListEndpointParameters - passes with params by $ref', () => {
    const errors = [];
    const operation = {
      parameters: [
        { $ref: './components/common-parameters.yaml#/SearchQueryParam' },
        { $ref: './components/common-parameters.yaml#/LimitParam' },
        { $ref: './components/common-parameters.yaml#/OffsetParam' }
      ]
    };

    validateListEndpointParameters('/persons', operation, errors);

    assert.strictEqual(errors.length, 0);
    console.log('  ✓ Passes with $ref parameters');
  });

  await t.test('validateListEndpointParameters - fails missing search param', () => {
    const errors = [];
    const operation = {
      parameters: [
        { name: 'limit', in: 'query' },
        { name: 'offset', in: 'query' }
      ]
    };

    validateListEndpointParameters('/persons', operation, errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].rule, 'list-endpoint-search-param');
    assert.strictEqual(errors[0].severity, 'error');
    console.log('  ✓ Detects missing search parameter');
  });

  await t.test('validateListEndpointParameters - fails missing limit param', () => {
    const errors = [];
    const operation = {
      parameters: [
        { name: 'q', in: 'query' },
        { name: 'offset', in: 'query' }
      ]
    };

    validateListEndpointParameters('/persons', operation, errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].rule, 'list-endpoint-limit-param');
    console.log('  ✓ Detects missing limit parameter');
  });

  await t.test('validateListEndpointParameters - fails missing offset param', () => {
    const errors = [];
    const operation = {
      parameters: [
        { name: 'q', in: 'query' },
        { name: 'limit', in: 'query' }
      ]
    };

    validateListEndpointParameters('/persons', operation, errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].rule, 'list-endpoint-offset-param');
    console.log('  ✓ Detects missing offset parameter');
  });

  await t.test('validateListEndpointParameters - fails with no parameters', () => {
    const errors = [];
    const operation = {};

    validateListEndpointParameters('/persons', operation, errors);

    assert.strictEqual(errors.length, 3);
    console.log('  ✓ Detects all missing parameters');
  });

  // ==========================================================================
  // List Response Schema Validation
  // ==========================================================================

  await t.test('validateListResponseSchema - passes with valid inline schema', () => {
    const errors = [];
    const operation = {
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'array', items: {} },
                  total: { type: 'integer' },
                  limit: { type: 'integer' },
                  offset: { type: 'integer' },
                  hasNext: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    };

    validateListResponseSchema('/persons', operation, errors);

    assert.strictEqual(errors.length, 0);
    console.log('  ✓ Passes with valid list response schema');
  });

  await t.test('validateListResponseSchema - skips validation for $ref schema', () => {
    const errors = [];
    const operation = {
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/PersonList'
              }
            }
          }
        }
      }
    };

    validateListResponseSchema('/persons', operation, errors);

    assert.strictEqual(errors.length, 0);
    console.log('  ✓ Skips validation for $ref schemas');
  });

  await t.test('validateListResponseSchema - fails missing 200 response', () => {
    const errors = [];
    const operation = {
      responses: {
        '201': {}
      }
    };

    validateListResponseSchema('/persons', operation, errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].rule, 'list-endpoint-200-response');
    console.log('  ✓ Detects missing 200 response');
  });

  await t.test('validateListResponseSchema - fails missing application/json', () => {
    const errors = [];
    const operation = {
      responses: {
        '200': {
          content: {
            'text/plain': {}
          }
        }
      }
    };

    validateListResponseSchema('/persons', operation, errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].rule, 'list-endpoint-response-schema');
    console.log('  ✓ Detects missing application/json content type');
  });

  await t.test('validateListResponseSchema - fails missing required properties', () => {
    const errors = [];
    const operation = {
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array' }
                }
              }
            }
          }
        }
      }
    };

    validateListResponseSchema('/persons', operation, errors);

    // Should detect missing items, total, limit, offset, hasNext (warning)
    const errorRules = errors.map(e => e.rule);
    assert.ok(errorRules.includes('list-endpoint-response-items'));
    assert.ok(errorRules.includes('list-endpoint-response-total'));
    assert.ok(errorRules.includes('list-endpoint-response-limit'));
    assert.ok(errorRules.includes('list-endpoint-response-offset'));
    console.log('  ✓ Detects missing list response properties');
  });

  await t.test('validateListResponseSchema - warns on missing hasNext', () => {
    const errors = [];
    const operation = {
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'array' },
                  total: { type: 'integer' },
                  limit: { type: 'integer' },
                  offset: { type: 'integer' }
                  // missing hasNext
                }
              }
            }
          }
        }
      }
    };

    validateListResponseSchema('/persons', operation, errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].rule, 'list-endpoint-response-hasNext');
    assert.strictEqual(errors[0].severity, 'warn');
    console.log('  ✓ Warns on missing hasNext (not error)');
  });

  await t.test('validateListResponseSchema - fails when items is not array', () => {
    const errors = [];
    const operation = {
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'object' }, // should be array
                  total: { type: 'integer' },
                  limit: { type: 'integer' },
                  offset: { type: 'integer' },
                  hasNext: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    };

    validateListResponseSchema('/persons', operation, errors);

    assert.ok(errors.some(e => e.rule === 'list-endpoint-items-array'));
    console.log('  ✓ Detects items not being an array');
  });

  // ==========================================================================
  // POST Endpoint Validation
  // ==========================================================================

  await t.test('validatePostEndpoint - passes with valid POST', () => {
    const errors = [];
    const operation = {
      requestBody: {
        content: { 'application/json': { schema: {} } }
      },
      responses: {
        '201': {
          headers: {
            Location: { schema: { type: 'string' } }
          }
        }
      }
    };

    validatePostEndpoint('/persons', operation, errors);

    assert.strictEqual(errors.length, 0);
    console.log('  ✓ Passes with valid POST endpoint');
  });

  await t.test('validatePostEndpoint - fails missing request body', () => {
    const errors = [];
    const operation = {
      responses: { '201': {} }
    };

    validatePostEndpoint('/persons', operation, errors);

    assert.ok(errors.some(e => e.rule === 'post-request-body'));
    assert.ok(errors.some(e => e.severity === 'error'));
    console.log('  ✓ Detects missing request body');
  });

  await t.test('validatePostEndpoint - warns missing Location header', () => {
    const errors = [];
    const operation = {
      requestBody: { content: {} },
      responses: {
        '201': {
          // missing Location header
        }
      }
    };

    validatePostEndpoint('/persons', operation, errors);

    assert.ok(errors.some(e => e.rule === 'post-location-header'));
    assert.ok(errors.some(e => e.severity === 'warn'));
    console.log('  ✓ Warns on missing Location header');
  });

  // ==========================================================================
  // PATCH Endpoint Validation
  // ==========================================================================

  await t.test('validatePatchEndpoint - passes with valid PATCH', () => {
    const errors = [];
    const operation = {
      requestBody: { content: {} },
      responses: { '200': {} }
    };

    validatePatchEndpoint('/persons/{personId}', operation, errors);

    assert.strictEqual(errors.length, 0);
    console.log('  ✓ Passes with valid PATCH endpoint');
  });

  await t.test('validatePatchEndpoint - fails missing request body', () => {
    const errors = [];
    const operation = {
      responses: { '200': {} }
    };

    validatePatchEndpoint('/persons/{personId}', operation, errors);

    assert.ok(errors.some(e => e.rule === 'patch-request-body'));
    console.log('  ✓ Detects missing request body');
  });

  await t.test('validatePatchEndpoint - fails missing 200 response', () => {
    const errors = [];
    const operation = {
      requestBody: { content: {} },
      responses: { '204': {} }
    };

    validatePatchEndpoint('/persons/{personId}', operation, errors);

    assert.ok(errors.some(e => e.rule === 'patch-200-response'));
    console.log('  ✓ Detects missing 200 response');
  });

  // ==========================================================================
  // Single Resource GET Validation
  // ==========================================================================

  await t.test('validateSingleResourceGet - passes with 404 response', () => {
    const errors = [];
    const operation = {
      responses: {
        '200': {},
        '404': {}
      }
    };

    validateSingleResourceGet('/persons/{personId}', operation, errors);

    assert.strictEqual(errors.length, 0);
    console.log('  ✓ Passes with 404 response defined');
  });

  await t.test('validateSingleResourceGet - fails missing 404 response', () => {
    const errors = [];
    const operation = {
      responses: {
        '200': {}
      }
    };

    validateSingleResourceGet('/persons/{personId}', operation, errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].rule, 'get-single-404');
    console.log('  ✓ Detects missing 404 response');
  });

  // ==========================================================================
  // Shared Error Response Validation
  // ==========================================================================

  await t.test('validateSharedErrorResponses - passes with $ref responses', () => {
    const errors = [];
    const operation = {
      responses: {
        '400': { $ref: './common-responses.yaml#/BadRequest' },
        '404': { $ref: './common-responses.yaml#/NotFound' },
        '500': { $ref: './common-responses.yaml#/InternalError' }
      }
    };

    validateSharedErrorResponses('/persons', 'get', operation, errors);

    assert.strictEqual(errors.length, 0);
    console.log('  ✓ Passes with $ref error responses');
  });

  await t.test('validateSharedErrorResponses - warns on inline 400 response', () => {
    const errors = [];
    const operation = {
      responses: {
        '400': { description: 'Bad Request' } // inline, not $ref
      }
    };

    validateSharedErrorResponses('/persons', 'get', operation, errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].rule, 'shared-400-response');
    assert.strictEqual(errors[0].severity, 'warn');
    console.log('  ✓ Warns on inline 400 response');
  });

  await t.test('validateSharedErrorResponses - warns on inline 404 response', () => {
    const errors = [];
    const operation = {
      responses: {
        '404': { description: 'Not Found' }
      }
    };

    validateSharedErrorResponses('/persons/{personId}', 'get', operation, errors);

    assert.ok(errors.some(e => e.rule === 'shared-404-response'));
    console.log('  ✓ Warns on inline 404 response');
  });

  await t.test('validateSharedErrorResponses - warns on inline 500 response', () => {
    const errors = [];
    const operation = {
      responses: {
        '500': { description: 'Internal Error' }
      }
    };

    validateSharedErrorResponses('/persons', 'post', operation, errors);

    assert.ok(errors.some(e => e.rule === 'shared-500-response'));
    console.log('  ✓ Warns on inline 500 response');
  });

  await t.test('validateSharedErrorResponses - includes method in message', () => {
    const errors = [];
    const operation = {
      responses: {
        '400': { description: 'Bad Request' }
      }
    };

    validateSharedErrorResponses('/persons', 'post', operation, errors);

    assert.ok(errors[0].message.includes('POST'));
    console.log('  ✓ Includes HTTP method in error message');
  });

  // ==========================================================================
  // Full Spec Validation
  // ==========================================================================

  await t.test('validateSpec - validates complete spec', () => {
    const spec = {
      paths: {
        '/persons': {
          get: {
            parameters: [
              { name: 'q', in: 'query' },
              { name: 'limit', in: 'query' },
              { name: 'offset', in: 'query' }
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/PersonList'
                    }
                  }
                }
              }
            }
          },
          post: {
            requestBody: { content: {} },
            responses: {
              '201': {
                headers: { Location: {} }
              }
            }
          }
        },
        '/persons/{personId}': {
          get: {
            responses: {
              '200': {},
              '404': { $ref: '#/NotFound' }
            }
          },
          patch: {
            requestBody: { content: {} },
            responses: { '200': {} }
          },
          delete: {
            responses: { '204': {} }
          }
        }
      }
    };

    const errors = validateSpec(spec, 'test.yaml');

    // Should have some warnings but pass main validation
    const realErrors = errors.filter(e => e.severity === 'error');
    assert.strictEqual(realErrors.length, 0, 'Should have no errors');
    assert.ok(errors.every(e => e.spec === 'test.yaml'), 'All errors should have spec name');
    console.log('  ✓ Validates complete spec structure');
  });

  await t.test('validateSpec - returns empty array for spec without paths', () => {
    const spec = {
      info: { title: 'Test', version: '1.0' }
      // no paths
    };

    const errors = validateSpec(spec, 'empty.yaml');

    assert.strictEqual(errors.length, 0);
    console.log('  ✓ Returns empty array for spec without paths');
  });

  await t.test('validateSpec - detects multiple issues in spec', () => {
    const spec = {
      paths: {
        '/persons': {
          get: {
            // missing parameters
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {} // missing required properties
                    }
                  }
                }
              }
            }
          },
          post: {
            // missing requestBody
            responses: { '201': {} }
          }
        },
        '/persons/{personId}': {
          get: {
            responses: { '200': {} } // missing 404
          }
        }
      }
    };

    const errors = validateSpec(spec, 'invalid.yaml');

    // Should detect multiple issues
    assert.ok(errors.length > 5, `Expected multiple errors, got ${errors.length}`);
    console.log(`  ✓ Detects ${errors.length} issues in invalid spec`);
  });

  await t.test('validateSpec - exempts action/RPC endpoints from CRUD POST rules', () => {
    const spec = {
      paths: {
        '/pizzas': {
          get: {
            parameters: [
              { name: 'q', in: 'query' },
              { name: 'limit', in: 'query' },
              { name: 'offset', in: 'query' }
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/PizzaList' }
                  }
                }
              }
            }
          },
          post: {
            requestBody: { content: {} },
            responses: {
              '201': { headers: { Location: {} } }
            }
          }
        },
        '/pizzas/{pizzaId}': {
          get: {
            responses: { '200': {}, '404': { $ref: '#/NotFound' } }
          },
          patch: {
            requestBody: { content: {} },
            responses: { '200': {} }
          },
          delete: {
            responses: { '204': {} }
          }
        },
        '/pizzas/{pizzaId}/start-preparing': {
          post: {
            // No requestBody — RPC endpoints don't need one
            responses: {
              '200': { content: { 'application/json': { schema: {} } } },
              '404': { $ref: '#/NotFound' },
              '500': { $ref: '#/InternalError' }
            }
          }
        },
        '/pizzas/{pizzaId}/cancel': {
          post: {
            responses: {
              '200': { content: { 'application/json': { schema: {} } } },
              '500': { $ref: '#/InternalError' }
            }
          }
        }
      }
    };

    const errors = validateSpec(spec, 'pizza.yaml');
    const postBodyErrors = errors.filter(e => e.rule === 'post-request-body');
    assert.strictEqual(postBodyErrors.length, 0, 'RPC endpoints should not trigger post-request-body errors');
    console.log('  ✓ RPC endpoints exempt from CRUD POST rules');
  });

  await t.test('validateSpec - adds spec name to all errors', () => {
    const spec = {
      paths: {
        '/test': {
          post: {} // missing requestBody
        }
      }
    };

    const errors = validateSpec(spec, 'my-spec.yaml');

    assert.ok(errors.length > 0);
    assert.ok(errors.every(e => e.spec === 'my-spec.yaml'));
    console.log('  ✓ Adds spec name to all errors');
  });

});

console.log('\n✓ All pattern validator tests passed\n');
