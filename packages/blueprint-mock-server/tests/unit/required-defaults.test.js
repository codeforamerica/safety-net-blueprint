/**
 * Unit tests for extractRequiredDefaults and create-handler null/absent behavior.
 *
 * Companion to issue #341 (scope-creep). The engine guarantees the
 * response schema's `required` contract for every persisted resource:
 *   - required + type: array          -> defaults to []
 *   - required + type: ['X', 'null']  -> defaults to null
 *   - required + non-nullable scalar  -> no default (caller must supply)
 *   - non-required                    -> no default (omitted, not null)
 *
 * Critically, optional non-nullable fields must be OMITTED from stored records,
 * not null-initialized. null and absent are semantically distinct in OpenAPI 3.1:
 * a field typed as `string` (non-nullable) cannot validly hold null. Emitting null
 * for such a field produces spec-invalid responses that break generated Zod validators
 * (.optional() rejects null; only .nullable() accepts it).
 *
 * See docs/guides/mock-server.md — "Record shape on create" for the full rule.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { extractRequiredDefaults } from '../../src/route-generator.js';
import { createCreateHandler } from '../../src/handlers/create-handler.js';
import { clearAll, registerCollectionDefaults } from '../../src/database-manager.js';

// =============================================================================
// Existing behavior: required arrays default to []
// =============================================================================

test('extractRequiredDefaults — required array field defaults to []', () => {
  const schema = {
    required: ['evidence'],
    properties: {
      evidence: { type: 'array' },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), { evidence: [] });
});

test('extractRequiredDefaults — multiple required arrays', () => {
  const schema = {
    required: ['evidence', 'documentRequests'],
    properties: {
      evidence: { type: 'array' },
      documentRequests: { type: 'array' },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), {
    evidence: [],
    documentRequests: [],
  });
});

// =============================================================================
// New behavior: required nullable fields default to null
// =============================================================================

test('extractRequiredDefaults — required nullable string defaults to null', () => {
  const schema = {
    required: ['description'],
    properties: {
      description: { type: ['string', 'null'] },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), { description: null });
});

test('extractRequiredDefaults — required nullable object defaults to null', () => {
  const schema = {
    required: ['case'],
    properties: {
      case: { type: ['object', 'null'], properties: {} },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), { case: null });
});

test('extractRequiredDefaults — required nullable date-time defaults to null', () => {
  const schema = {
    required: ['dueAt'],
    properties: {
      dueAt: { type: ['string', 'null'], format: 'date-time' },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), { dueAt: null });
});

test('extractRequiredDefaults — required nullable array defaults to null (nullable wins over array)', () => {
  // A field declared as both array and null is genuinely optional content
  // even when required — null is more honest than [] because the schema
  // explicitly says "may be null".
  const schema = {
    required: ['tags'],
    properties: {
      tags: { type: ['array', 'null'] },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), { tags: null });
});

// =============================================================================
// Non-defaulting cases
// =============================================================================

test('extractRequiredDefaults — non-required nullable field is not defaulted', () => {
  // If it's not in required[], the response is allowed to omit it entirely.
  const schema = {
    required: [],
    properties: {
      maybe: { type: ['string', 'null'] },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), {});
});

test('extractRequiredDefaults — required non-nullable scalar is not defaulted', () => {
  // Caller MUST supply these — defaulting would mask a real validation gap.
  const schema = {
    required: ['name'],
    properties: {
      name: { type: 'string' },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), {});
});

test('extractRequiredDefaults — required field absent from properties is not defaulted', () => {
  const schema = {
    required: ['ghost'],
    properties: {},
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), {});
});

// =============================================================================
// Edge cases
// =============================================================================

test('extractRequiredDefaults — null/undefined schema returns empty map', () => {
  assert.deepStrictEqual(extractRequiredDefaults(null), {});
  assert.deepStrictEqual(extractRequiredDefaults(undefined), {});
});

test('extractRequiredDefaults — schema without required[] returns empty map', () => {
  const schema = {
    properties: {
      foo: { type: ['string', 'null'] },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), {});
});

test('extractRequiredDefaults — allOf is flattened', () => {
  const schema = {
    allOf: [
      { required: ['evidence'], properties: { evidence: { type: 'array' } } },
      { required: ['note'], properties: { note: { type: ['string', 'null'] } } },
    ],
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), {
    evidence: [],
    note: null,
  });
});

test('extractRequiredDefaults — mixed shape (the Task schema case)', () => {
  // Mirrors the actual Task schema from workflow-openapi.yaml that triggered
  // this fix: id/name/status are non-nullable required, description is
  // nullable required, and engine-created tasks omit description.
  const schema = {
    required: ['id', 'name', 'description', 'status', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      description: { type: ['string', 'null'] },
      status: { type: 'string', enum: ['pending', 'in_progress'] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  };
  assert.deepStrictEqual(extractRequiredDefaults(schema), { description: null });
});

// =============================================================================
// Create handler: optional field null/absent behavior
// =============================================================================

function makeHandler(schema) {
  const collection = `test-null-defaults-${Date.now()}`;
  const endpoint = { collectionName: collection, requestSchema: schema };
  const apiMetadata = { serverBasePath: '/test', name: 'test' };
  const handler = createCreateHandler(apiMetadata, endpoint, 'http://localhost:1080', null);
  return { handler, collection };
}

function callHandler(handler, body) {
  return new Promise((resolve) => {
    let statusCode, responseBody;
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          header: () => ({ json: (b) => { responseBody = b; resolve({ statusCode, responseBody }); } }),
          json: (b) => { responseBody = b; resolve({ statusCode, responseBody }); }
        };
      },
      json: (b) => { responseBody = b; resolve({ statusCode: 200, responseBody }); }
    };
    const req = { body, params: {}, path: '/test', headers: {}, query: {} };
    handler(req, res);
  });
}

test('create handler — optional non-nullable field is omitted from stored record', async () => {
  // Fields declared optional (not in required) and non-nullable must be absent
  // in the stored record, not null. null is not a valid value for a non-nullable field.
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      residency: { type: 'object' },  // optional, non-nullable
    },
    required: ['name'],
  };
  const { handler, collection } = makeHandler(schema);
  try {
    const { statusCode, responseBody } = await callHandler(handler, { name: 'Alice' });
    assert.strictEqual(statusCode, 201);
    assert.ok(!('residency' in responseBody), 'optional non-nullable field must be absent, not null');
    assert.strictEqual(responseBody.residency, undefined);
  } finally {
    clearAll(collection);
  }
});

test('create handler — required nullable field is null-initialized via collection defaults', async () => {
  // Required-nullable defaults are applied at the database layer via
  // registerCollectionDefaults / extractRequiredDefaults, not in the create handler.
  // This test verifies the full path: collection defaults spread before request data.
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
    required: ['name'],
  };
  const { handler, collection } = makeHandler(schema);
  // Simulate what route-generator does: register collection defaults from response schema
  registerCollectionDefaults(collection, { description: null });
  try {
    const { statusCode, responseBody } = await callHandler(handler, { name: 'Alice' });
    assert.strictEqual(statusCode, 201);
    assert.ok('description' in responseBody, 'required nullable field must be present via collection defaults');
    assert.strictEqual(responseBody.description, null);
  } finally {
    clearAll(collection);
  }
});

test('create handler — optional nullable field is omitted (optional wins)', async () => {
  // Optional nullable fields are also omitted — the field is not required,
  // so absent is the correct representation when not provided.
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      note: { type: ['string', 'null'] },  // optional, nullable
    },
    required: ['name'],
  };
  const { handler, collection } = makeHandler(schema);
  try {
    const { statusCode, responseBody } = await callHandler(handler, { name: 'Alice' });
    assert.strictEqual(statusCode, 201);
    assert.ok(!('note' in responseBody), 'optional nullable field must be absent when not provided');
  } finally {
    clearAll(collection);
  }
});

test('create handler — provided optional field is stored as-is', async () => {
  // When a value is explicitly provided, it should always be stored regardless of type.
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      residency: { type: 'object' },
    },
    required: ['name'],
  };
  const { handler, collection } = makeHandler(schema);
  try {
    const { statusCode, responseBody } = await callHandler(handler, { name: 'Alice', residency: { state: 'CA' } });
    assert.strictEqual(statusCode, 201);
    assert.deepStrictEqual(responseBody.residency, { state: 'CA' });
  } finally {
    clearAll(collection);
  }
});
