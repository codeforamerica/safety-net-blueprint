/**
 * Unit tests for validate-annotations.js
 *
 * Tests buildDomainSpecMap, validateAnnotationPath,
 * buildStateMachineActionIndex, validateAnnotationOperation,
 * buildPolicyIndex, and validateAnnotationPolicyCitations.
 * Smoke tests run real annotation files against real specs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDomainSpecMap,
  validateAnnotationPath,
  buildStateMachineActionIndex,
  validateAnnotationOperation,
  buildPolicyIndex,
  validateAnnotationPolicyCitations,
  validateAnnotationEvent,
  validateFactKey,
} from '../../../scripts/validate/annotations.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal domainSpecMap for testing.
 * schemas: { PascalCaseSchemaName → { properties: [...fieldNames] } }
 */
function makeDomainSpecMap(schemas = {}, domain = 'test') {
  const spec = {
    info: { 'x-domain': domain },
    components: {
      schemas: Object.fromEntries(
        Object.entries(schemas).map(([name, { properties, refs }]) => [
          name,
          {
            type: 'object',
            properties: {
              ...Object.fromEntries((properties || []).map(p => [p, { type: 'string' }])),
              ...(refs || {}),
            },
          },
        ])
      ),
    },
  };
  return new Map([[domain, { spec, filePath: null }]]);
}

// ---------------------------------------------------------------------------
// validateAnnotationPath
// ---------------------------------------------------------------------------

describe('validateAnnotationPath', () => {
  const domainSpecMap = makeDomainSpecMap({
    Application: { properties: ['status', 'submittedAt', 'householdInfo'] },
  });

  // Nested schema for deeper path tests
  const nestedSpec = {
    info: { 'x-domain': 'test' },
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
            members: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  citizenship: {
                    type: 'object',
                    properties: { citizenshipStatus: { type: 'string' } },
                  },
                },
              },
            },
            householdInfo: { $ref: '#/components/schemas/HouseholdInfo' },
          },
        },
      },
    },
  };
  const nestedMap = new Map([['test', { spec: nestedSpec, filePath: null }]]);

  test('passes for top-level resource annotation (no field path)', () => {
    assert.equal(validateAnnotationPath('application', domainSpecMap, 'test'), null);
  });

  test('passes for known top-level field', () => {
    assert.equal(validateAnnotationPath('application.status', domainSpecMap, 'test'), null);
  });

  test('passes for array-marker field', () => {
    assert.equal(validateAnnotationPath('application.programsAppliedFor[]', nestedMap, 'test'), null);
  });

  test('errors for unknown schema', () => {
    const result = validateAnnotationPath('unknown.field', domainSpecMap, 'test');
    assert.ok(result?.includes('not found'));
  });

  test('errors for unknown field on known schema', () => {
    const result = validateAnnotationPath('application.nonExistent', domainSpecMap, 'test');
    assert.ok(result?.includes('does not exist'));
  });

  test('passes for nested field path through $ref', () => {
    assert.equal(validateAnnotationPath('application.householdInfo.utilitiesIncludedInRent', nestedMap, 'test'), null);
  });

  test('errors for non-existent nested field path', () => {
    const result = validateAnnotationPath('application.householdInfo.nonExistent', nestedMap, 'test');
    assert.ok(result?.includes('does not exist'));
  });

  test('handles deeply nested path with [] markers', () => {
    assert.equal(validateAnnotationPath('application.members[].citizenship.citizenshipStatus', nestedMap, 'test'), null);
  });

  test('returns null for empty domain spec map (no specs loaded)', () => {
    assert.equal(validateAnnotationPath('application.status', new Map(), 'test'), null);
  });
});

// ---------------------------------------------------------------------------
// Scenario tests — simulate overlay changes; assert validator catches stale paths
// ---------------------------------------------------------------------------

describe('scenario: field rename — overlay renames programsAppliedFor → programs', () => {
  // Resolved spec after the rename: Application no longer has programsAppliedFor
  const domainSpecMap = makeDomainSpecMap({
    Application: { properties: ['id', 'status', 'programs', 'submittedAt'] },
  });

  test('catches stale application.programsAppliedFor path (old field name)', () => {
    const result = validateAnnotationPath('application.programsAppliedFor', domainSpecMap, 'test');
    assert.ok(result?.includes('does not exist'), `Expected error for stale field name but got: ${result}`);
  });

  test('passes with application.programs path (updated field name)', () => {
    assert.equal(validateAnnotationPath('application.programs', domainSpecMap, 'test'), null);
  });
});

describe('scenario: field rename in nested object — overlay renames subfield', () => {
  const spec = {
    info: { 'x-domain': 'test' },
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
  const domainSpecMap = new Map([['test', { spec, filePath: null }]]);

  test('catches stale application.householdInfo.utilitiesIncluded (old nested field)', () => {
    const result = validateAnnotationPath('application.householdInfo.utilitiesIncluded', domainSpecMap, 'test');
    assert.ok(result?.includes('does not exist'), `Expected error for stale nested field but got: ${result}`);
  });

  test('passes with application.householdInfo.utilitiesIncludedInRent (updated nested field)', () => {
    assert.equal(validateAnnotationPath('application.householdInfo.utilitiesIncludedInRent', domainSpecMap, 'test'), null);
  });
});

describe('scenario: schema rename — overlay renames Application → IntakeApplication', () => {
  const domainSpecMap = makeDomainSpecMap({
    IntakeApplication: { properties: ['id', 'status', 'programsAppliedFor'] },
  });

  test('catches stale application.status path (old schema name)', () => {
    const result = validateAnnotationPath('application.status', domainSpecMap, 'test');
    assert.ok(result?.includes('not found'), `Expected not-found error for stale schema name but got: ${result}`);
  });

  test('passes with intakeApplication.status path (updated schema name)', () => {
    assert.equal(validateAnnotationPath('intakeApplication.status', domainSpecMap, 'test'), null);
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

// ---------------------------------------------------------------------------
// validateAnnotationPolicyCitations — generic section iteration
// ---------------------------------------------------------------------------

describe('validateAnnotationPolicyCitations — facts section', () => {
  const policyIndex = new Set(['snap-work-requirement']);

  test('catches unknown policy citation in facts section', () => {
    const doc = {
      facts: { 'snapInterviewProbes.abawdMembers': { policies: ['unknown-policy'] } },
    };
    const errors = validateAnnotationPolicyCitations(doc, policyIndex);
    assert.ok(errors.some(e => e.includes('"unknown-policy"')));
    assert.ok(errors.some(e => e.includes('facts')));
  });

  test('passes when facts policy citation exists in registry', () => {
    const doc = {
      facts: { 'snapInterviewProbes.abawdMembers': { policies: ['snap-work-requirement'] } },
    };
    assert.deepEqual(validateAnnotationPolicyCitations(doc, policyIndex), []);
  });

  test('skips metadata fields ($schema, version, domain)', () => {
    const doc = {
      $schema: './schemas/annotations-schema.yaml',
      version: '1.0',
      domain: 'intake',
      facts: { 'snapInterviewProbes.eligible': { policies: ['snap-work-requirement'] } },
    };
    assert.deepEqual(validateAnnotationPolicyCitations(doc, policyIndex), []);
  });
});

// ---------------------------------------------------------------------------
// validateAnnotationEvent
// ---------------------------------------------------------------------------

describe('validateAnnotationEvent', () => {
  const channels = new Set([
    'intake.application.submitted',
    'intake.application.closed',
  ]);

  test('passes for a known event channel', () => {
    assert.equal(validateAnnotationEvent('intake.application.submitted', channels), null);
  });

  test('errors for an unknown event channel', () => {
    const result = validateAnnotationEvent('intake.application.nonexistent', channels);
    assert.ok(result?.includes('not found'));
  });

  test('returns null when channel index is empty (no AsyncAPI specs loaded)', () => {
    assert.equal(validateAnnotationEvent('intake.application.submitted', new Set()), null);
  });
});

describe('scenario: event renamed — overlay renames submitted → filed', () => {
  const channels = new Set(['intake.application.filed', 'intake.application.closed']);

  test('catches stale intake.application.submitted after rename', () => {
    const result = validateAnnotationEvent('intake.application.submitted', channels);
    assert.ok(result?.includes('not found'));
  });

  test('passes with intake.application.filed after rename', () => {
    assert.equal(validateAnnotationEvent('intake.application.filed', channels), null);
  });
});

// ---------------------------------------------------------------------------
// validateFactKey
// ---------------------------------------------------------------------------

describe('validateFactKey', () => {
  const graphIndex = new Map([
    ['snapInterviewProbes', { domain: 'intake', facts: new Set(['incomeInconsistency', 'abawdMembers', 'eligible']) }],
    ['workRequirements', { domain: 'intake', facts: new Set(['exempt', 'hoursRequired']) }],
  ]);

  test('passes for a known ruleset and fact', () => {
    assert.equal(validateFactKey('snapInterviewProbes.incomeInconsistency', graphIndex), null);
  });

  test('passes for a fact in a different ruleset', () => {
    assert.equal(validateFactKey('workRequirements.exempt', graphIndex), null);
  });

  test('errors when the key has no dot separator', () => {
    const result = validateFactKey('incomeInconsistency', graphIndex);
    assert.ok(result?.includes('{ruleset}.{factName}'));
  });

  test('errors when the ruleset is not found', () => {
    const result = validateFactKey('unknownRuleset.eligible', graphIndex);
    assert.ok(result?.includes('not found'));
    assert.ok(result?.includes('unknownRuleset'));
  });

  test('errors when the fact is not in the ruleset', () => {
    const result = validateFactKey('snapInterviewProbes.nonExistentFact', graphIndex);
    assert.ok(result?.includes('nonExistentFact'));
    assert.ok(result?.includes('snapInterviewProbes'));
  });

  test('returns null when graph index is empty (no graphs loaded)', () => {
    assert.equal(validateFactKey('snapInterviewProbes.eligible', new Map()), null);
  });
});

describe('scenario: fact renamed — overlay renames eligible → qualifies', () => {
  const graphIndex = new Map([
    ['snapInterviewProbes', { domain: 'intake', facts: new Set(['incomeInconsistency', 'qualifies']) }],
  ]);

  test('catches stale snapInterviewProbes.eligible after rename', () => {
    const result = validateFactKey('snapInterviewProbes.eligible', graphIndex);
    assert.ok(result?.includes('eligible'));
  });

  test('passes with snapInterviewProbes.qualifies after rename', () => {
    assert.equal(validateFactKey('snapInterviewProbes.qualifies', graphIndex), null);
  });
});

