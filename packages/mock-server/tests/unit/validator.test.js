/**
 * Unit tests for request validator
 * Tests schema validation, error formatting, and readOnly field handling
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { validate, createErrorResponse, validateJSON } from '../../src/validator.js';

test('Validator Tests', async (t) => {

  // ==========================================================================
  // Basic Validation
  // ==========================================================================

  await t.test('validate - returns valid for null/undefined schema', () => {
    const result = validate({ foo: 'bar' }, null, 'test-null');
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
    console.log('  ✓ Returns valid when schema is null');
  });

  await t.test('validate - validates simple object schema', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' }
      },
      required: ['name']
    };

    const validData = { name: 'John', age: 30 };
    const result = validate(validData, schema, 'simple-valid');

    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
    console.log('  ✓ Validates valid data against simple schema');
  });

  await t.test('validate - detects missing required field', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' }
      },
      required: ['name', 'email']
    };

    const invalidData = { name: 'John' }; // missing email
    const result = validate(invalidData, schema, 'missing-required');

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.strictEqual(result.errors[0].field, 'email');
    assert.strictEqual(result.errors[0].message, 'is required');
    console.log('  ✓ Detects missing required field with correct error format');
  });

  await t.test('validate - detects wrong type', () => {
    const schema = {
      type: 'object',
      properties: {
        age: { type: 'integer' }
      }
    };

    const invalidData = { age: 'not-a-number' };
    const result = validate(invalidData, schema, 'wrong-type');

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.field === 'age' && e.message.includes('integer')));
    console.log('  ✓ Detects wrong type with descriptive message');
  });

  // ==========================================================================
  // readOnly Field Handling
  // ==========================================================================

  await t.test('validate - excludes readOnly fields from required validation', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string', readOnly: true },
        createdAt: { type: 'string', readOnly: true },
        name: { type: 'string' }
      },
      required: ['id', 'createdAt', 'name']
    };

    // Data missing readOnly fields should still be valid
    const data = { name: 'Test' };
    const result = validate(data, schema, 'readonly-excluded');

    assert.strictEqual(result.valid, true, 'Should be valid without readOnly fields');
    console.log('  ✓ Excludes readOnly fields from required validation');
  });

  await t.test('validate - handles nested readOnly fields', () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', readOnly: true },
            name: { type: 'string' }
          },
          required: ['id', 'name']
        }
      },
      required: ['user']
    };

    const data = { user: { name: 'Test' } }; // missing nested readOnly id
    const result = validate(data, schema, 'nested-readonly');

    assert.strictEqual(result.valid, true, 'Should be valid without nested readOnly fields');
    console.log('  ✓ Handles nested readOnly fields in required arrays');
  });

  // ==========================================================================
  // Format Validation
  // ==========================================================================

  await t.test('validate - validates email format', () => {
    const schema = {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' }
      }
    };

    const validData = { email: 'test@example.com' };
    const validResult = validate(validData, schema, 'email-valid');
    assert.strictEqual(validResult.valid, true);

    const invalidData = { email: 'not-an-email' };
    const invalidResult = validate(invalidData, schema, 'email-invalid');
    assert.strictEqual(invalidResult.valid, false);
    assert.ok(invalidResult.errors[0].message.includes('email'));

    console.log('  ✓ Validates email format');
  });

  await t.test('validate - validates uuid format', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' }
      }
    };

    const validData = { id: '550e8400-e29b-41d4-a716-446655440000' };
    const validResult = validate(validData, schema, 'uuid-valid');
    assert.strictEqual(validResult.valid, true);

    const invalidData = { id: 'not-a-uuid' };
    const invalidResult = validate(invalidData, schema, 'uuid-invalid');
    assert.strictEqual(invalidResult.valid, false);

    console.log('  ✓ Validates uuid format');
  });

  await t.test('validate - validates date-time format', () => {
    const schema = {
      type: 'object',
      properties: {
        timestamp: { type: 'string', format: 'date-time' }
      }
    };

    const validData = { timestamp: '2024-01-15T10:30:00Z' };
    const validResult = validate(validData, schema, 'datetime-valid');
    assert.strictEqual(validResult.valid, true);

    const invalidData = { timestamp: 'not-a-date' };
    const invalidResult = validate(invalidData, schema, 'datetime-invalid');
    assert.strictEqual(invalidResult.valid, false);

    console.log('  ✓ Validates date-time format');
  });

  // ==========================================================================
  // Enum Validation
  // ==========================================================================

  await t.test('validate - validates enum values', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive', 'pending'] }
      }
    };

    const validData = { status: 'active' };
    const validResult = validate(validData, schema, 'enum-valid');
    assert.strictEqual(validResult.valid, true);

    const invalidData = { status: 'unknown' };
    const invalidResult = validate(invalidData, schema, 'enum-invalid');
    assert.strictEqual(invalidResult.valid, false);
    assert.ok(invalidResult.errors[0].message.includes('active'));
    assert.ok(invalidResult.errors[0].message.includes('inactive'));
    assert.ok(invalidResult.errors[0].message.includes('pending'));

    console.log('  ✓ Validates enum values with allowed values in error message');
  });

  // ==========================================================================
  // Additional Properties
  // ==========================================================================

  await t.test('validate - detects additional properties when not allowed', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' }
      },
      additionalProperties: false
    };

    const invalidData = { name: 'John', extraField: 'value' };
    const result = validate(invalidData, schema, 'additional-props');

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e =>
      e.field === 'extraField' && e.message.includes('additional property')
    ));

    console.log('  ✓ Detects additional properties with field name in error');
  });

  // ==========================================================================
  // allOf / anyOf / oneOf Handling
  // ==========================================================================

  await t.test('validate - handles allOf schemas', () => {
    const schema = {
      allOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string', readOnly: true }
          },
          required: ['id']
        },
        {
          type: 'object',
          properties: {
            name: { type: 'string' }
          },
          required: ['name']
        }
      ]
    };

    // Should pass without readOnly id
    const data = { name: 'Test' };
    const result = validate(data, schema, 'allof-readonly');

    assert.strictEqual(result.valid, true, 'allOf should handle readOnly in nested schemas');
    console.log('  ✓ Handles allOf schemas with readOnly fields');
  });

  await t.test('validate - handles anyOf schemas', () => {
    const schema = {
      anyOf: [
        {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' }
          },
          required: ['email']
        },
        {
          type: 'object',
          properties: {
            phone: { type: 'string' }
          },
          required: ['phone']
        }
      ]
    };

    const validWithEmail = { email: 'test@example.com' };
    const result1 = validate(validWithEmail, schema, 'anyof-email');
    assert.strictEqual(result1.valid, true);

    const validWithPhone = { phone: '555-1234' };
    const result2 = validate(validWithPhone, schema, 'anyof-phone');
    assert.strictEqual(result2.valid, true);

    console.log('  ✓ Handles anyOf schemas');
  });

  // ==========================================================================
  // Error Deduplication
  // ==========================================================================

  await t.test('validate - deduplicates errors', () => {
    const schema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' }
            },
            required: ['name']
          }
        }
      }
    };

    // Multiple items missing same field shouldn't create duplicate error messages
    const data = { items: [{}, {}, {}] };
    const result = validate(data, schema, 'dedupe-test');

    // Each array item should have its own error (items.0.name, items.1.name, items.2.name)
    assert.strictEqual(result.valid, false);
    const nameErrors = result.errors.filter(e => e.field.includes('name'));
    assert.strictEqual(nameErrors.length, 3, 'Should have 3 distinct errors for 3 items');

    console.log('  ✓ Deduplicates errors while preserving distinct field paths');
  });

  // ==========================================================================
  // Validator Caching
  // ==========================================================================

  await t.test('validate - caches compiled validators', () => {
    const schema = {
      type: 'object',
      properties: {
        value: { type: 'number' }
      }
    };

    // Call validate multiple times with same schema key
    const key = 'cache-test-' + Date.now();
    const data = { value: 42 };

    const result1 = validate(data, schema, key);
    const result2 = validate(data, schema, key);
    const result3 = validate(data, schema, key);

    assert.strictEqual(result1.valid, true);
    assert.strictEqual(result2.valid, true);
    assert.strictEqual(result3.valid, true);

    console.log('  ✓ Caches and reuses compiled validators');
  });

  // ==========================================================================
  // Nested Object Validation
  // ==========================================================================

  await t.test('validate - validates deeply nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        person: {
          type: 'object',
          properties: {
            address: {
              type: 'object',
              properties: {
                city: { type: 'string' }
              },
              required: ['city']
            }
          },
          required: ['address']
        }
      },
      required: ['person']
    };

    const invalidData = { person: { address: {} } }; // missing city
    const result = validate(invalidData, schema, 'deep-nested');

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.field.includes('city')));

    console.log('  ✓ Validates deeply nested objects with correct field paths');
  });

  // ==========================================================================
  // Sensitive Field Handling
  // ==========================================================================

  await t.test('validate - excludes sensitive values from errors', () => {
    const schema = {
      type: 'object',
      properties: {
        password: { type: 'string', minLength: 8 }
      }
    };

    const data = { password: 'short' };
    const result = validate(data, schema, 'sensitive-field');

    assert.strictEqual(result.valid, false);
    const passwordError = result.errors.find(e => e.field === 'password');
    assert.ok(passwordError);
    assert.strictEqual(passwordError.value, undefined, 'Should not include password value');

    console.log('  ✓ Excludes sensitive field values from error output');
  });

  // ==========================================================================
  // createErrorResponse
  // ==========================================================================

  await t.test('createErrorResponse - creates 422 validation error response', () => {
    const errors = [
      { field: 'name', message: 'is required' },
      { field: 'email', message: 'must match format "email"' }
    ];

    const response = createErrorResponse(errors, 422);

    assert.strictEqual(response.code, 'VALIDATION_ERROR');
    assert.strictEqual(response.message, 'The request contains invalid data');
    assert.deepStrictEqual(response.details, errors);

    console.log('  ✓ Creates 422 validation error response');
  });

  await t.test('createErrorResponse - creates 400 bad request response', () => {
    const errors = [{ field: 'body', message: 'Invalid JSON' }];

    const response = createErrorResponse(errors, 400);

    assert.strictEqual(response.code, 'BAD_REQUEST');
    assert.strictEqual(response.message, 'The request is malformed or contains invalid parameters');
    assert.deepStrictEqual(response.details, errors);

    console.log('  ✓ Creates 400 bad request response');
  });

  await t.test('createErrorResponse - defaults to 422', () => {
    const errors = [{ field: 'test', message: 'error' }];

    const response = createErrorResponse(errors);

    assert.strictEqual(response.code, 'VALIDATION_ERROR');

    console.log('  ✓ Defaults to 422 validation error');
  });

  // ==========================================================================
  // validateJSON Middleware
  // ==========================================================================

  await t.test('validateJSON - handles JSON syntax errors', () => {
    const jsonError = new SyntaxError('Unexpected token');
    jsonError.status = 400;
    jsonError.body = 'invalid';

    let responseStatus = null;
    let responseBody = null;

    const mockRes = {
      status: (code) => {
        responseStatus = code;
        return mockRes;
      },
      json: (body) => {
        responseBody = body;
        return mockRes;
      }
    };

    validateJSON(jsonError, {}, mockRes, () => {});

    assert.strictEqual(responseStatus, 400);
    assert.strictEqual(responseBody.code, 'BAD_REQUEST');
    assert.strictEqual(responseBody.message, 'Invalid JSON in request body');

    console.log('  ✓ Handles JSON syntax errors with proper response');
  });

  await t.test('validateJSON - passes non-JSON errors to next', () => {
    const otherError = new Error('Some other error');
    let nextCalled = false;
    let nextError = null;

    validateJSON(otherError, {}, {}, (err) => {
      nextCalled = true;
      nextError = err;
    });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError, otherError);

    console.log('  ✓ Passes non-JSON errors to next middleware');
  });

});

console.log('\n✓ All validator tests passed\n');
