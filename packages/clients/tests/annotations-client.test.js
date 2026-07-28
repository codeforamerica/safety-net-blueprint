/**
 * Functional tests for generated annotation client exports.
 *
 * Uses fixture annotation YAML files (not real contracts) to verify:
 *   - Each domain gets its own named export (IntakeAnnotations, WorkflowAnnotations, etc.)
 *   - Domains are isolated — annotations from one domain don't appear in another
 *   - Overlay files for the same domain are merged into a single export
 *   - Schema, operations, and events are accessible in the expected shape
 *   - policies, programs, and dataClassification arrays are accessible per entry
 *   - Consumer access patterns work as expected (filter by program, find PII fields, etc.)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateAnnotationsAndPolicies } from '../scripts/generate-clients-typescript.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDir(files) {
  const specsDir = mkdtempSync(join(tmpdir(), 'specs-'));
  const outputDir = mkdtempSync(join(tmpdir(), 'out-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(specsDir, name), content);
  }
  return { specsDir, outputDir };
}

/**
 * Generate annotations from fixture files and return the parsed exports as
 * plain objects, keyed by export name (e.g. { IntakeAnnotations: {...} }).
 */
async function generate(files) {
  const { specsDir, outputDir } = makeDir(files);
  const exportNames = [];
  await generateAnnotationsAndPolicies(specsDir, outputDir, exportNames);

  const content = readFileSync(join(outputDir, 'annotations.ts'), 'utf8');

  // Each block is: export const <Name> = <JSON> as const;
  // Extract each export's JSON body by name.
  const exports = {};
  for (const name of exportNames) {
    const match = content.match(new RegExp(`export const ${name} = ([\\s\\S]+?) as const;`));
    if (match) exports[name] = JSON.parse(match[1]);
  }
  return exports;
}

// ---------------------------------------------------------------------------
// Multiple domains — separate exports
// ---------------------------------------------------------------------------

describe('multiple domains produce separate named exports', () => {
  it('generates IntakeAnnotations and WorkflowAnnotations as separate exports', async () => {
    const exports = await generate({
      'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
    programs: [snap]
operations: {}
events: {}
`,
      'workflow-annotations.yaml': `
domain: workflow
schema: {}
operations:
  task.claim:
    policies: [workflow-assignment-policy]
    programs: [snap]
events: {}
`,
    });

    assert.ok(exports.IntakeAnnotations, 'IntakeAnnotations should be exported');
    assert.ok(exports.WorkflowAnnotations, 'WorkflowAnnotations should be exported');
  });

  it('IntakeAnnotations schema is accessible by field path', async () => {
    const exports = await generate({
      'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
    programs: [snap, medicaid]
operations: {}
events: {}
`,
    });

    const field = exports.IntakeAnnotations.schema['application.submittedAt'];
    assert.ok(field, 'field annotation should be present');
    assert.ok(field.policies.includes('snap-processing-clock'));
    assert.ok(field.programs.includes('snap'));
    assert.ok(field.programs.includes('medicaid'));
  });

  it('WorkflowAnnotations operations are accessible by key', async () => {
    const exports = await generate({
      'workflow-annotations.yaml': `
domain: workflow
schema: {}
operations:
  task.claim:
    policies: [workflow-assignment-policy]
    programs: [snap]
events: {}
`,
    });

    const op = exports.WorkflowAnnotations.operations['task.claim'];
    assert.ok(op, 'operation annotation should be present');
    assert.ok(op.policies.includes('workflow-assignment-policy'));
  });
});

// ---------------------------------------------------------------------------
// Domain isolation — annotations don't bleed across domains
// ---------------------------------------------------------------------------

describe('domain isolation', () => {
  it('intake schema keys do not appear in WorkflowAnnotations', async () => {
    const exports = await generate({
      'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
    programs: [snap]
operations: {}
events: {}
`,
      'workflow-annotations.yaml': `
domain: workflow
schema: {}
operations:
  task.claim:
    policies: [workflow-assignment-policy]
    programs: [snap]
events: {}
`,
    });

    assert.ok(!exports.WorkflowAnnotations.schema['application.submittedAt'],
      'intake schema key should not appear in WorkflowAnnotations');
    assert.ok(!exports.IntakeAnnotations.operations['task.claim'],
      'workflow operation key should not appear in IntakeAnnotations');
  });
});

// ---------------------------------------------------------------------------
// Overlay merge — multiple files for the same domain
// ---------------------------------------------------------------------------

describe('overlay: multiple files for the same domain are merged', () => {
  it('base and overlay annotation files merge into one export', async () => {
    const exports = await generate({
      'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
    programs: [snap]
operations: {}
events: {}
`,
      'intake-annotations-state.yaml': `
domain: intake
schema:
  application.countyCode:
    policies: [state-county-routing-policy]
    programs: [snap]
operations: {}
events: {}
`,
    });

    const schema = exports.IntakeAnnotations.schema;
    assert.ok(schema['application.submittedAt'], 'base annotation should be present');
    assert.ok(schema['application.countyCode'], 'overlay annotation should be present');
    assert.ok(schema['application.countyCode'].policies.includes('state-county-routing-policy'));
  });

  it('overlay-added operation is accessible alongside base operations', async () => {
    const exports = await generate({
      'intake-annotations.yaml': `
domain: intake
schema: {}
operations:
  application.submit:
    policies: [snap-processing-clock]
    programs: [snap]
events: {}
`,
      'intake-annotations-state.yaml': `
domain: intake
schema: {}
operations:
  application.submit-express:
    policies: [state-express-lane-policy]
    programs: [snap]
events: {}
`,
    });

    const ops = exports.IntakeAnnotations.operations;
    assert.ok(ops['application.submit'], 'base operation should be present');
    assert.ok(ops['application.submit-express'], 'overlay operation should be present');
  });
});

// ---------------------------------------------------------------------------
// Annotation entry shape — policies, programs, dataClassification
// ---------------------------------------------------------------------------

describe('annotation entry shape', () => {
  it('policies is an accessible array on a schema field', async () => {
    const exports = await generate({
      'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock, medicaid-processing-clock]
    programs: [snap, medicaid]
operations: {}
events: {}
`,
    });

    const field = exports.IntakeAnnotations.schema['application.submittedAt'];
    assert.ok(Array.isArray(field.policies));
    assert.equal(field.policies.length, 2);
    assert.ok(field.policies.includes('snap-processing-clock'));
    assert.ok(field.policies.includes('medicaid-processing-clock'));
  });

  it('dataClassification is an accessible array on sensitive fields', async () => {
    const exports = await generate({
      'intake-annotations.yaml': `
domain: intake
schema:
  application.members[].personalInformation.ssn:
    dataClassification: [pii]
    policies: [snap-ssn-requirement]
    programs: [snap]
operations: {}
events: {}
`,
    });

    const field = exports.IntakeAnnotations.schema['application.members[].personalInformation.ssn'];
    assert.ok(Array.isArray(field.dataClassification));
    assert.ok(field.dataClassification.includes('pii'));
  });

  it('events section is accessible with policies and programs', async () => {
    const exports = await generate({
      'intake-annotations.yaml': `
domain: intake
schema: {}
operations: {}
events:
  intake.application.submitted:
    policies: [snap-processing-clock]
    programs: [snap, medicaid]
`,
    });

    const event = exports.IntakeAnnotations.events['intake.application.submitted'];
    assert.ok(event, 'event annotation should be present');
    assert.ok(Array.isArray(event.policies));
    assert.ok(event.policies.includes('snap-processing-clock'));
    assert.ok(event.programs.includes('medicaid'));
  });
});

// ---------------------------------------------------------------------------
// Consumer access patterns
// ---------------------------------------------------------------------------

const FIXTURE = {
  'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock, medicaid-processing-clock]
    programs: [snap, medicaid]
  application.registerToVote:
    policies: [nvra-voter-registration-offer]
    programs: [snap, medicaid, tanf, chip]
  application.members[].personalInformation.ssn:
    dataClassification: [pii]
    policies: [snap-ssn-requirement]
    programs: [snap, medicaid]
  application.members[].personalInformation.dateOfBirth:
    dataClassification: [pii]
    policies: [chip-age-eligibility]
    programs: [snap, medicaid, chip]
  application.incomes[]:
    dataClassification: [pii, fti]
    policies: [snap-income-verification]
    programs: [snap, medicaid]
operations:
  application.submit:
    policies: [snap-processing-clock, snap-right-to-apply]
    programs: [snap, medicaid]
  application.approve-determination:
    policies: [snap-supervisor-review]
    programs: [snap]
events:
  intake.application.submitted:
    policies: [snap-processing-clock]
    programs: [snap, medicaid]
  intake.application.closed:
    policies: [snap-notice-of-eligibility]
    programs: [snap]
`,
};

describe('consumer access patterns', () => {
  it('filter schema fields by program — find all SNAP-relevant fields', async () => {
    const { IntakeAnnotations } = await generate(FIXTURE);

    const snapFields = Object.entries(IntakeAnnotations.schema)
      .filter(([, v]) => v.programs?.includes('snap'))
      .map(([k]) => k);

    assert.ok(snapFields.includes('application.submittedAt'));
    assert.ok(snapFields.includes('application.registerToVote'));
    assert.ok(!snapFields.includes('application.nonexistent'));
  });

  it('find all PII fields', async () => {
    const { IntakeAnnotations } = await generate(FIXTURE);

    const piiFields = Object.entries(IntakeAnnotations.schema)
      .filter(([, v]) => v.dataClassification?.includes('pii'))
      .map(([k]) => k);

    assert.ok(piiFields.includes('application.members[].personalInformation.ssn'));
    assert.ok(piiFields.includes('application.members[].personalInformation.dateOfBirth'));
    assert.ok(piiFields.includes('application.incomes[]'));
    assert.ok(!piiFields.includes('application.submittedAt'));
  });

  it('find fields carrying FTI data classification', async () => {
    const { IntakeAnnotations } = await generate(FIXTURE);

    const ftiFields = Object.entries(IntakeAnnotations.schema)
      .filter(([, v]) => v.dataClassification?.includes('fti'))
      .map(([k]) => k);

    assert.ok(ftiFields.includes('application.incomes[]'));
    assert.ok(!ftiFields.includes('application.members[].personalInformation.ssn'));
  });

  it('look up which policies govern an operation', async () => {
    const { IntakeAnnotations } = await generate(FIXTURE);

    const submitPolicies = IntakeAnnotations.operations['application.submit']?.policies ?? [];

    assert.ok(submitPolicies.includes('snap-processing-clock'));
    assert.ok(submitPolicies.includes('snap-right-to-apply'));
  });

  it('check whether an operation requires supervisor review', async () => {
    const { IntakeAnnotations } = await generate(FIXTURE);

    const requiresSupervisorReview = (operationKey) =>
      IntakeAnnotations.operations[operationKey]?.policies?.includes('snap-supervisor-review') ?? false;

    assert.equal(requiresSupervisorReview('application.approve-determination'), true);
    assert.equal(requiresSupervisorReview('application.submit'), false);
  });

  it('find all fields that cite a specific policy', async () => {
    const { IntakeAnnotations } = await generate(FIXTURE);

    const fieldsWithPolicy = (policyId) =>
      Object.entries(IntakeAnnotations.schema)
        .filter(([, v]) => v.policies?.includes(policyId))
        .map(([k]) => k);

    const clockFields = fieldsWithPolicy('snap-processing-clock');
    assert.ok(clockFields.includes('application.submittedAt'));
    assert.ok(!clockFields.includes('application.registerToVote'));
  });

  it('look up which policies are triggered by an event', async () => {
    const { IntakeAnnotations } = await generate(FIXTURE);

    const eventPolicies = IntakeAnnotations.events['intake.application.submitted']?.policies ?? [];

    assert.ok(eventPolicies.includes('snap-processing-clock'));
  });

  it('check whether a field is PII before logging or storing it', async () => {
    const { IntakeAnnotations } = await generate(FIXTURE);

    const isPii = (fieldPath) =>
      IntakeAnnotations.schema[fieldPath]?.dataClassification?.includes('pii') ?? false;

    assert.equal(isPii('application.members[].personalInformation.ssn'), true);
    assert.equal(isPii('application.submittedAt'), false);
  });
});
