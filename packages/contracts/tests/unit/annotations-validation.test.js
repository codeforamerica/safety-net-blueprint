/**
 * Unit tests for validate-annotations.js
 *
 * Tests buildResourceSchemaMap, validateAnnotationPath,
 * buildStateMachineActionIndex, validateAnnotationOperation,
 * buildPolicyIndex, and validateAnnotationPolicyCitations.
 * Smoke tests run real annotation files against real specs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import {
  buildResourceSchemaMap,
  validateAnnotationPath,
  buildStateMachineActionIndex,
  validateAnnotationOperation,
  buildPolicyIndex,
  validateAnnotationPolicyCitations,
} from '../../scripts/validate-annotations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractsRoot = join(__dirname, '../../');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResourceSchemaMap(schemas = {}) {
  // schemas: { resourceKey → { properties: [...fieldNames] } }
  const map = new Map();
  for (const [resourceKey, { properties }] of Object.entries(schemas)) {
    const spec = {
      components: { schemas: { [resourceKey]: { type: 'object', properties: Object.fromEntries(properties.map(p => [p, { type: 'string' }])) } } },
    };
    map.set(resourceKey, { spec, schema: spec.components.schemas[resourceKey] });
  }
  return map;
}

// ---------------------------------------------------------------------------
// validateAnnotationPath
// ---------------------------------------------------------------------------

describe('validateAnnotationPath', () => {
  const schemaMap = makeResourceSchemaMap({
    application: { properties: ['status', 'programsAppliedFor', 'submittedAt', 'householdInfo'] },
  });

  // Nested schema for deeper path tests
  const nestedSpec = {
    components: {
      schemas: {
        HouseholdInfo: {
          type: 'object',
          properties: { utilitiesIncludedInRent: { type: 'boolean' } },
        },
        Application: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            programsAppliedFor: { type: 'array', items: { type: 'string' } },
            householdInfo: { $ref: '#/components/schemas/HouseholdInfo' },
          },
        },
      },
    },
  };
  const nestedMap = new Map([
    ['application', { spec: nestedSpec, schema: nestedSpec.components.schemas.Application }],
  ]);

  test('passes for top-level resource annotation (no field path)', () => {
    assert.equal(validateAnnotationPath('application', schemaMap), null);
  });

  test('passes for known top-level field', () => {
    assert.equal(validateAnnotationPath('application.status', schemaMap), null);
  });

  test('passes for array-marker field (strips [])', () => {
    assert.equal(validateAnnotationPath('application.programsAppliedFor[]', schemaMap), null);
  });

  test('errors for unknown resource', () => {
    const result = validateAnnotationPath('unknown.field', schemaMap);
    assert.ok(result?.includes('not found'));
  });

  test('errors for unknown field on known resource', () => {
    const result = validateAnnotationPath('application.nonExistent', schemaMap);
    assert.ok(result?.includes('does not exist'));
  });

  test('passes for nested field path through $ref', () => {
    assert.equal(validateAnnotationPath('application.householdInfo.utilitiesIncludedInRent', nestedMap), null);
  });

  test('errors for non-existent nested field path', () => {
    const result = validateAnnotationPath('application.householdInfo.nonExistent', nestedMap);
    assert.ok(result?.includes('does not exist'));
  });

  test('handles deeply nested path with multiple [] markers', () => {
    // application.members[].citizenship.citizenshipStatus → strip [] → application.members.citizenship.citizenshipStatus
    // In our simple map, members is not defined, so it should error
    const result = validateAnnotationPath('application.members[].citizenship.citizenshipStatus', schemaMap);
    assert.ok(result?.includes('does not exist'));
  });

  test('returns null for empty schema map (no specs loaded)', () => {
    assert.equal(validateAnnotationPath('application.status', new Map()), null);
  });
});

// ---------------------------------------------------------------------------
// Scenario tests — simulate overlay changes; assert validator catches stale paths
// ---------------------------------------------------------------------------

describe('scenario: field rename — overlay renames programsAppliedFor → programs', () => {
  // Resolved spec after the rename: Application no longer has programsAppliedFor
  const schemaMap = makeResourceSchemaMap({
    application: { properties: ['id', 'status', 'programs', 'submittedAt'] },
  });

  test('catches stale application.programsAppliedFor path (old field name)', () => {
    const result = validateAnnotationPath('application.programsAppliedFor', schemaMap);
    assert.ok(result?.includes('does not exist'), `Expected error for stale field name but got: ${result}`);
  });

  test('passes with application.programs path (updated field name)', () => {
    assert.equal(validateAnnotationPath('application.programs', schemaMap), null);
  });
});

describe('scenario: field rename in nested object — overlay renames subfield', () => {
  // HouseholdInfo.utilitiesIncluded renamed to utilitiesIncludedInRent
  const spec = {
    components: {
      schemas: {
        HouseholdInfo: {
          type: 'object',
          properties: { utilitiesIncludedInRent: { type: 'boolean' } },
        },
        Application: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            householdInfo: { $ref: '#/components/schemas/HouseholdInfo' },
          },
        },
      },
    },
  };
  const schemaMap = new Map([
    ['application', { spec, schema: spec.components.schemas.Application }],
  ]);

  test('catches stale application.householdInfo.utilitiesIncluded (old nested field)', () => {
    const result = validateAnnotationPath('application.householdInfo.utilitiesIncluded', schemaMap);
    assert.ok(result?.includes('does not exist'), `Expected error for stale nested field but got: ${result}`);
  });

  test('passes with application.householdInfo.utilitiesIncludedInRent (updated nested field)', () => {
    assert.equal(validateAnnotationPath('application.householdInfo.utilitiesIncludedInRent', schemaMap), null);
  });
});

describe('scenario: resource rename — overlay renames application schema → intake-application', () => {
  // Schema key changed; old key is gone
  const schemaMap = makeResourceSchemaMap({
    'intake-application': { properties: ['id', 'status', 'programsAppliedFor'] },
  });

  test('catches stale application.status path (old resource key)', () => {
    const result = validateAnnotationPath('application.status', schemaMap);
    assert.ok(result?.includes('not found'), `Expected not-found error for stale resource key but got: ${result}`);
  });

  test('passes with intake-application.status path (updated resource key)', () => {
    assert.equal(validateAnnotationPath('intake-application.status', schemaMap), null);
  });
});

// ---------------------------------------------------------------------------
// Smoke tests — real annotation files against real OpenAPI specs
// ---------------------------------------------------------------------------

describe('smoke tests — real annotation files', () => {
  test('intake-annotations.yaml paths all resolve against intake-openapi.yaml', () => {
    const resourceSchemaMap = buildResourceSchemaMap(contractsRoot);

    let doc;
    try {
      doc = yaml.load(readFileSync(join(contractsRoot, 'intake-annotations.yaml'), 'utf8'));
    } catch {
      return; // skip if file doesn't exist
    }

    const errors = [];
    for (const pathKey of Object.keys(doc?.schema || {})) {
      const err = validateAnnotationPath(pathKey, resourceSchemaMap);
      if (err) errors.push({ pathKey, err });
    }

    assert.deepEqual(
      errors,
      [],
      `Annotation path errors:\n${errors.map(e => `  "${e.pathKey}": ${e.err}`).join('\n')}`
    );
  });
});

// ---------------------------------------------------------------------------
// validateAnnotationOperation
// ---------------------------------------------------------------------------

describe('validateAnnotationOperation', () => {
  const actionIndex = new Set([
    'application.submit',
    'application.close',
    'verification.satisfy',
  ]);

  test('passes for a known operation', () => {
    assert.equal(validateAnnotationOperation('application.submit', actionIndex), null);
  });

  test('errors for an operation on an unknown object', () => {
    const result = validateAnnotationOperation('widget.submit', actionIndex);
    assert.ok(result?.includes('does not match'));
  });

  test('errors for a known object but unknown action id', () => {
    const result = validateAnnotationOperation('application.nonexistent', actionIndex);
    assert.ok(result?.includes('does not match'));
  });

  test('returns null when action index is empty (no state machines loaded)', () => {
    assert.equal(validateAnnotationOperation('application.submit', new Set()), null);
  });
});

describe('scenario: action rename — overlay renames submit → file', () => {
  const actionIndex = new Set(['application.file', 'application.close']);

  test('catches stale application.submit after rename to application.file', () => {
    const result = validateAnnotationOperation('application.submit', actionIndex);
    assert.ok(result?.includes('does not match'));
  });

  test('passes with application.file after rename', () => {
    assert.equal(validateAnnotationOperation('application.file', actionIndex), null);
  });
});

describe('smoke tests — real annotation operations vs state machines', () => {
  test('intake-annotations.yaml operations all match declared state machine actions', () => {
    const actionIndex = buildStateMachineActionIndex(contractsRoot);

    let doc;
    try {
      doc = yaml.load(readFileSync(join(contractsRoot, 'intake-annotations.yaml'), 'utf8'));
    } catch {
      return;
    }

    const errors = [];
    for (const operationKey of Object.keys(doc?.operations || {})) {
      const err = validateAnnotationOperation(operationKey, actionIndex);
      if (err) errors.push({ operationKey, err });
    }

    assert.deepEqual(
      errors,
      [],
      `Operation key errors:\n${errors.map(e => `  "${e.operationKey}": ${e.err}`).join('\n')}`
    );
  });
});

// ---------------------------------------------------------------------------
// validateAnnotationPolicyCitations
// ---------------------------------------------------------------------------

describe('validateAnnotationPolicyCitations', () => {
  const policyIndex = new Set(['snap-processing-clock', 'medicaid-processing-clock', 'nvra-voter-registration-offer']);

  test('passes when all schema policy citations exist in the registry', () => {
    const doc = {
      schema: { 'application.submittedAt': { policies: ['snap-processing-clock', 'medicaid-processing-clock'] } },
    };
    assert.deepEqual(validateAnnotationPolicyCitations(doc, policyIndex), []);
  });

  test('errors when a schema policy citation is unknown', () => {
    const doc = {
      schema: { 'application.submittedAt': { policies: ['snap-processing-clock', 'typo-policy'] } },
    };
    const errors = validateAnnotationPolicyCitations(doc, policyIndex);
    assert.ok(errors.some(e => e.includes('"typo-policy"')));
    assert.ok(errors.some(e => e.includes('schema')));
  });

  test('errors when an operations policy citation is unknown', () => {
    const doc = {
      operations: { 'application.submit': { policies: ['deleted-policy'] } },
    };
    const errors = validateAnnotationPolicyCitations(doc, policyIndex);
    assert.ok(errors.some(e => e.includes('"deleted-policy"')));
    assert.ok(errors.some(e => e.includes('operations')));
  });

  test('errors when an events policy citation is unknown', () => {
    const doc = {
      events: { 'intake.application.submitted': { policies: ['unknown-policy'] } },
    };
    const errors = validateAnnotationPolicyCitations(doc, policyIndex);
    assert.ok(errors.some(e => e.includes('"unknown-policy"')));
    assert.ok(errors.some(e => e.includes('events')));
  });

  test('passes when policies array is empty', () => {
    const doc = { schema: { 'application.channel': { policies: [] } } };
    assert.deepEqual(validateAnnotationPolicyCitations(doc, policyIndex), []);
  });

  test('passes when no policies key is present on an entry', () => {
    const doc = { schema: { 'application.channel': { programs: ['snap'] } } };
    assert.deepEqual(validateAnnotationPolicyCitations(doc, policyIndex), []);
  });

  test('returns empty array when policy index is empty (no registry loaded)', () => {
    const doc = { schema: { 'application.submittedAt': { policies: ['snap-processing-clock'] } } };
    assert.deepEqual(validateAnnotationPolicyCitations(doc, new Set()), []);
  });
});

describe('scenario: policy deleted from registry', () => {
  // Registry after snap-processing-clock was removed
  const policyIndex = new Set(['medicaid-processing-clock']);

  test('catches stale snap-processing-clock citation after policy is deleted', () => {
    const doc = {
      schema: { 'application.submittedAt': { policies: ['snap-processing-clock', 'medicaid-processing-clock'] } },
    };
    const errors = validateAnnotationPolicyCitations(doc, policyIndex);
    assert.ok(errors.some(e => e.includes('"snap-processing-clock"')));
  });

  test('does not flag the surviving medicaid-processing-clock citation', () => {
    const doc = {
      schema: { 'application.submittedAt': { policies: ['medicaid-processing-clock'] } },
    };
    assert.deepEqual(validateAnnotationPolicyCitations(doc, policyIndex), []);
  });
});

describe('smoke tests — real annotation policy citations vs policy registry', () => {
  test('intake-annotations.yaml policy citations all exist in platform-registry-policies.yaml', () => {
    const policyIndex = buildPolicyIndex(contractsRoot);

    let doc;
    try {
      doc = yaml.load(readFileSync(join(contractsRoot, 'intake-annotations.yaml'), 'utf8'));
    } catch {
      return;
    }

    const errors = validateAnnotationPolicyCitations(doc, policyIndex);
    assert.deepEqual(
      errors,
      [],
      `Policy citation errors:\n${errors.map(e => `  ${e}`).join('\n')}`
    );
  });
});
