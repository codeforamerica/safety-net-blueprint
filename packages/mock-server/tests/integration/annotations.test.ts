/**
 * Client-side annotation tests.
 *
 * Validates that domain annotations are accessible from the generated TypeScript
 * client in the shape consumers expect — schema field paths, operation keys,
 * and event keys, each with policies, programs, and dataClassification arrays.
 *
 * These tests do not require the mock server to be running.
 * Run with: npm run test:integration
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntakeAnnotations } from './generated/annotations.js';

describe('IntakeAnnotations — structure', () => {
  it('exports an IntakeAnnotations object with schema, operations, and events sections', () => {
    assert.ok(IntakeAnnotations, 'IntakeAnnotations should be exported');
    assert.ok(typeof IntakeAnnotations.schema === 'object', 'schema section should be present');
    assert.ok(typeof IntakeAnnotations.operations === 'object', 'operations section should be present');
    assert.ok(typeof IntakeAnnotations.events === 'object', 'events section should be present');
  });

  it('schema section has entries', () => {
    assert.ok(Object.keys(IntakeAnnotations.schema).length > 0, 'schema should have annotated fields');
  });

  it('operations section has entries', () => {
    assert.ok(Object.keys(IntakeAnnotations.operations).length > 0, 'operations should have annotated actions');
  });

  it('events section has entries', () => {
    assert.ok(Object.keys(IntakeAnnotations.events).length > 0, 'events should have annotated event types');
  });
});

describe('IntakeAnnotations — schema field access', () => {
  it('application.submittedAt is annotated with snap and medicaid policies', () => {
    const field = IntakeAnnotations.schema['application.submittedAt'];
    assert.ok(field, 'application.submittedAt should be annotated');
    assert.ok(Array.isArray(field.policies), 'policies should be an array');
    assert.ok(field.policies.includes('snap-processing-clock'), 'should cite snap-processing-clock');
    assert.ok(field.policies.includes('medicaid-processing-clock'), 'should cite medicaid-processing-clock');
  });

  it('application.submittedAt is associated with snap and medicaid programs', () => {
    const field = IntakeAnnotations.schema['application.submittedAt'];
    assert.ok(field.programs.includes('snap'));
    assert.ok(field.programs.includes('medicaid'));
  });

  it('application.members[].personalInformation.ssn carries a pii dataClassification', () => {
    const field = IntakeAnnotations.schema['application.members[].personalInformation.ssn'];
    assert.ok(field, 'ssn field should be annotated');
    assert.ok(Array.isArray(field.dataClassification), 'dataClassification should be an array');
    assert.ok(field.dataClassification.includes('pii'), 'ssn should be classified as pii');
  });

  it('application.registerToVote cites nvra-voter-registration-offer across all four programs', () => {
    const field = IntakeAnnotations.schema['application.registerToVote'];
    assert.ok(field?.policies.includes('nvra-voter-registration-offer'));
    assert.ok(field?.programs.includes('snap'));
    assert.ok(field?.programs.includes('medicaid'));
    assert.ok(field?.programs.includes('tanf'));
    assert.ok(field?.programs.includes('chip'));
  });

  it('array-notation fields are accessible with [] markers in the key', () => {
    const field = IntakeAnnotations.schema['application.programsAppliedFor[]'];
    assert.ok(field, 'array-notation key should be accessible');
    assert.ok(Array.isArray(field.programs));
  });
});

describe('IntakeAnnotations — operations access', () => {
  it('application.submit is annotated with snap regulatory policies', () => {
    const op = IntakeAnnotations.operations['application.submit'];
    assert.ok(op, 'application.submit should be annotated');
    assert.ok(Array.isArray(op.policies), 'policies should be an array');
    assert.ok(op.policies.includes('snap-processing-clock'));
    assert.ok(op.policies.includes('snap-right-to-apply'));
  });

  it('verification.satisfy is annotated', () => {
    const op = IntakeAnnotations.operations['verification.satisfy'];
    assert.ok(op, 'verification.satisfy should be annotated');
    assert.ok(op.policies.includes('snap-verification-requirements'));
  });
});

describe('IntakeAnnotations — events access', () => {
  it('intake.application.submitted event is annotated', () => {
    const event = IntakeAnnotations.events['intake.application.submitted'];
    assert.ok(event, 'intake.application.submitted should be annotated');
    assert.ok(Array.isArray(event.policies), 'policies should be an array');
    assert.ok(event.policies.includes('snap-processing-clock'));
  });

  it('intake.verification.created event cites electronic verification policies', () => {
    const event = IntakeAnnotations.events['intake.verification.created'];
    assert.ok(event, 'intake.verification.created should be annotated');
    assert.ok(event.policies.includes('medicaid-electronic-verification-first'));
    assert.ok(event.policies.includes('snap-verification-requirements'));
  });
});
