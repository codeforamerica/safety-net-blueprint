/**
 * Unit tests for extractRequiredDefaults.
 *
 * Companion to issue #341 (scope-creep). The engine guarantees the
 * response schema's `required` contract for every persisted resource:
 *   - required + type: array          -> defaults to []
 *   - required + type: ['X', 'null']  -> defaults to null
 *   - required + non-nullable scalar  -> no default (caller must supply)
 *   - non-required                    -> no default
 *
 * Without this guarantee, state-machine procedures that create resources
 * without explicitly setting every required-nullable field (e.g.
 * intake.application.submitted -> POST workflow/tasks) silently produce
 * records where the field is `undefined`, which fails downstream Zod
 * validation in generated TypeScript clients.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { extractRequiredDefaults } from '../../src/route-generator.js';

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
