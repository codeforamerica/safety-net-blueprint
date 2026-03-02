/**
 * Unit tests for reconcile-examples.js
 * Tests schema resolution, value generation, and example reconciliation.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  resolveSchema,
  generateValue,
  generateObject,
  reconcileExample
} from '../../scripts/reconcile-examples.js';

test('reconcile-examples tests', async (t) => {

  // ===========================================================================
  // resolveSchema
  // ===========================================================================

  await t.test('resolveSchema - returns empty structure for null/undefined', () => {
    const result = resolveSchema(null);
    assert.strictEqual(result.type, 'object');
    assert.deepStrictEqual(result.properties, {});
    assert.deepStrictEqual(result.required, []);
  });

  await t.test('resolveSchema - passes through simple schema', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' }
      }
    };
    const result = resolveSchema(schema);
    assert.strictEqual(result.type, 'object');
    assert.deepStrictEqual(result.required, ['name']);
    assert.ok(result.properties.name);
    assert.ok(result.properties.age);
  });

  await t.test('resolveSchema - flattens allOf and merges properties', () => {
    const schema = {
      allOf: [
        {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' }
          }
        },
        {
          type: 'object',
          required: ['id', 'firstName'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' }
          }
        }
      ]
    };
    const result = resolveSchema(schema);
    assert.strictEqual(result.type, 'object');
    assert.deepStrictEqual(result.required, ['id', 'firstName']);
    assert.ok(result.properties.firstName);
    assert.ok(result.properties.lastName);
    assert.ok(result.properties.id);
    assert.ok(result.properties.email);
  });

  await t.test('resolveSchema - deduplicates required fields', () => {
    const schema = {
      allOf: [
        { type: 'object', required: ['name'] },
        { type: 'object', required: ['name', 'id'] }
      ]
    };
    const result = resolveSchema(schema);
    assert.deepStrictEqual(result.required, ['name', 'id']);
  });

  // ===========================================================================
  // generateValue
  // ===========================================================================

  await t.test('generateValue - uses inline example', () => {
    const result = generateValue('foo', { type: 'string', example: 'bar' });
    assert.strictEqual(result.value, 'bar');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - picks first enum value', () => {
    const result = generateValue('status', { type: 'string', enum: ['active', 'inactive'] });
    assert.strictEqual(result.value, 'active');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - uses default value', () => {
    const result = generateValue('limit', { type: 'integer', default: 25 });
    assert.strictEqual(result.value, 25);
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - string uuid format', () => {
    const result = generateValue('id', { type: 'string', format: 'uuid' });
    assert.strictEqual(result.value, '00000000-0000-0000-0000-000000000000');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - string date-time format', () => {
    const result = generateValue('createdAt', { type: 'string', format: 'date-time' });
    assert.strictEqual(result.value, '2024-01-01T00:00:00Z');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - string date format', () => {
    const result = generateValue('dateOfBirth', { type: 'string', format: 'date' });
    assert.strictEqual(result.value, '2024-01-01');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - string email format', () => {
    const result = generateValue('email', { type: 'string', format: 'email' });
    assert.strictEqual(result.value, 'user@example.com');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - string uri format', () => {
    const result = generateValue('url', { type: 'string', format: 'uri' });
    assert.strictEqual(result.value, 'https://example.com');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - plain string falls back with low confidence', () => {
    const result = generateValue('description', { type: 'string' });
    assert.strictEqual(result.value, 'example');
    assert.strictEqual(result.confident, false);
  });

  await t.test('generateValue - integer returns 0', () => {
    const result = generateValue('count', { type: 'integer' });
    assert.strictEqual(result.value, 0);
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - number returns 0', () => {
    const result = generateValue('amount', { type: 'number' });
    assert.strictEqual(result.value, 0);
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - boolean returns false', () => {
    const result = generateValue('enabled', { type: 'boolean' });
    assert.strictEqual(result.value, false);
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - array returns empty array', () => {
    const result = generateValue('tags', { type: 'array', items: { type: 'string' } });
    assert.deepStrictEqual(result.value, []);
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - field name heuristic: email', () => {
    const result = generateValue('contactEmail', { type: 'string' });
    assert.strictEqual(result.value, 'user@example.com');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - field name heuristic: phone', () => {
    const result = generateValue('phoneNumber', { type: 'string' });
    assert.strictEqual(result.value, '+1-555-000-0000');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - field name heuristic: Id suffix', () => {
    const result = generateValue('personId', { type: 'string' });
    assert.strictEqual(result.value, '00000000-0000-0000-0000-000000000000');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - field name heuristic: name', () => {
    const result = generateValue('lastName', { type: 'string' });
    assert.strictEqual(result.value, 'Example Name');
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - field name heuristic: status without enum', () => {
    const result = generateValue('status', { type: 'string' });
    assert.strictEqual(result.value, 'active');
    assert.strictEqual(result.confident, false);
  });

  await t.test('generateValue - fallback for null schema', () => {
    const result = generateValue('unknown', null);
    assert.strictEqual(result.value, 'TODO');
    assert.strictEqual(result.confident, false);
  });

  await t.test('generateValue - nested object recurses', () => {
    const result = generateValue('address', {
      type: 'object',
      required: ['city'],
      properties: {
        city: { type: 'string', example: 'Springfield' },
        state: { type: 'string' }
      }
    });
    assert.strictEqual(result.value.city, 'Springfield');
    assert.strictEqual(result.value.state, undefined); // not required, no example
    assert.strictEqual(result.confident, true);
  });

  await t.test('generateValue - allOf schema recurses', () => {
    const result = generateValue('person', {
      allOf: [
        { type: 'object', properties: { firstName: { type: 'string' } } },
        { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }
      ]
    });
    assert.strictEqual(result.value.id, '00000000-0000-0000-0000-000000000000');
    assert.strictEqual(result.confident, true);
  });

  // ===========================================================================
  // generateObject
  // ===========================================================================

  await t.test('generateObject - fills required properties', () => {
    const schema = {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        optional: { type: 'string' }
      }
    };
    const { obj, warnings } = generateObject(schema);
    assert.ok('name' in obj);
    assert.strictEqual(obj.email, 'user@example.com');
    assert.strictEqual(obj.optional, undefined);
  });

  await t.test('generateObject - includes optional properties with example', () => {
    const schema = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        nickname: { type: 'string', example: 'Buddy' }
      }
    };
    const { obj } = generateObject(schema);
    assert.strictEqual(obj.nickname, 'Buddy');
  });

  // ===========================================================================
  // reconcileExample
  // ===========================================================================

  await t.test('reconcileExample - keeps existing valid properties', () => {
    const example = { id: 'abc-123', name: 'Alice', email: 'alice@test.com' };
    const schema = {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' }
      }
    };

    const { reconciled, added, pruned, flagged } = reconcileExample(example, schema);
    assert.strictEqual(reconciled.id, 'abc-123');
    assert.strictEqual(reconciled.name, 'Alice');
    assert.strictEqual(reconciled.email, 'alice@test.com');
    assert.strictEqual(added.length, 0);
    assert.strictEqual(pruned.length, 0);
    assert.strictEqual(flagged.length, 0);
  });

  await t.test('reconcileExample - prunes removed properties', () => {
    const example = { id: 'abc', name: 'Alice', obsoleteField: 'gone' };
    const schema = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' }
      }
    };

    const { reconciled, pruned } = reconcileExample(example, schema);
    assert.strictEqual(reconciled.obsoleteField, undefined);
    assert.ok(pruned.includes('obsoleteField'));
  });

  await t.test('reconcileExample - adds missing required properties', () => {
    const example = { id: 'abc' };
    const schema = {
      type: 'object',
      required: ['id', 'email'],
      properties: {
        id: { type: 'string' },
        email: { type: 'string', format: 'email' }
      }
    };

    const { reconciled, added } = reconcileExample(example, schema);
    assert.strictEqual(reconciled.email, 'user@example.com');
    assert.strictEqual(added.length, 1);
    assert.strictEqual(added[0].property, 'email');
  });

  await t.test('reconcileExample - flags low-confidence values', () => {
    const example = { id: 'abc' };
    const schema = {
      type: 'object',
      required: ['id', 'description'],
      properties: {
        id: { type: 'string' },
        description: { type: 'string' }
      }
    };

    const { reconciled, flagged } = reconcileExample(example, schema);
    assert.strictEqual(reconciled.description, 'example');
    assert.strictEqual(flagged.length, 1);
    assert.strictEqual(flagged[0].property, 'description');
  });

  await t.test('reconcileExample - recurses into nested objects', () => {
    const example = {
      id: 'abc',
      address: {
        city: 'Springfield',
        obsoleteZip: '12345'
      }
    };
    const schema = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        address: {
          type: 'object',
          required: ['city', 'state'],
          properties: {
            city: { type: 'string' },
            state: { type: 'string' }
          }
        }
      }
    };

    const { reconciled, added, pruned } = reconcileExample(example, schema);
    assert.strictEqual(reconciled.address.city, 'Springfield');
    assert.strictEqual(reconciled.address.obsoleteZip, undefined);
    assert.ok(pruned.some(p => p === 'address.obsoleteZip'));
    assert.ok(added.some(a => a.property === 'address.state'));
  });

  await t.test('reconcileExample - replaces invalid enum values', () => {
    const example = { id: 'abc', status: 'pending' };
    const schema = {
      type: 'object',
      required: ['id', 'status'],
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['submitted', 'approved', 'denied'] }
      }
    };

    const { reconciled, added } = reconcileExample(example, schema);
    assert.strictEqual(reconciled.status, 'submitted'); // first enum value
    assert.strictEqual(added.length, 1);
    assert.strictEqual(added[0].property, 'status');
    assert.ok(added[0].was); // reports what it replaced
  });

  await t.test('reconcileExample - keeps valid enum values', () => {
    const example = { id: 'abc', status: 'approved' };
    const schema = {
      type: 'object',
      required: ['id', 'status'],
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['submitted', 'approved', 'denied'] }
      }
    };

    const { reconciled, added } = reconcileExample(example, schema);
    assert.strictEqual(reconciled.status, 'approved'); // kept
    assert.strictEqual(added.length, 0);
  });

  await t.test('reconcileExample - no changes returns empty lists', () => {
    const example = { id: 'abc', name: 'Alice' };
    const schema = {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' }
      }
    };

    const { reconciled, added, pruned, flagged } = reconcileExample(example, schema);
    assert.deepStrictEqual(reconciled, { id: 'abc', name: 'Alice' });
    assert.strictEqual(added.length, 0);
    assert.strictEqual(pruned.length, 0);
    assert.strictEqual(flagged.length, 0);
  });

  await t.test('reconcileExample - handles allOf schema', () => {
    const example = { id: 'abc' };
    const schema = {
      allOf: [
        {
          type: 'object',
          properties: {
            firstName: { type: 'string' }
          }
        },
        {
          type: 'object',
          required: ['id', 'firstName'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        }
      ]
    };

    const { reconciled, added } = reconcileExample(example, schema);
    assert.strictEqual(reconciled.id, 'abc');
    assert.ok(added.some(a => a.property === 'firstName'));
  });

});
