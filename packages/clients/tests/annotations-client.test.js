/**
 * Functional tests for generated annotation client exports.
 *
 * Uses fixture annotation YAML files (not real contracts) to verify:
 *   - Each domain gets its own Annotations export inside its domain directory
 *   - Domains are isolated — annotations from one domain don't appear in another
 *   - Overlay files for the same domain are merged into a single Annotations export
 *   - Schema, operations, and events are accessible in the expected shape
 *   - policies, programs, and dataClassification arrays are accessible per entry
 *   - Consumer access patterns work as expected (filter by program, find PII fields, etc.)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { generateAnnotationsAndPolicies } from '../scripts/generate-clients-typescript.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../../packages/contracts');

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
 * plain objects, keyed by domain name (e.g. { intake: { schema: {}, operations: {}, events: {} } }).
 * Mirrors the runtime access pattern: `intake.Annotations.schema[...]`.
 */
async function generate(files) {
  const { specsDir, outputDir } = makeDir(files);
  const domains = [];
  await generateAnnotationsAndPolicies(specsDir, outputDir, domains);

  // Each domain gets its own annotations.ts: export const Annotations = <JSON> as const;
  const result = {};
  for (const domain of domains) {
    const content = readFileSync(join(outputDir, domain, 'annotations.ts'), 'utf8');
    const match = content.match(/export const Annotations = ([\s\S]+?) as const;/);
    if (match) result[domain] = JSON.parse(match[1]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Multiple domains — separate exports
// ---------------------------------------------------------------------------

describe('multiple domains produce separate named exports', () => {
  it('generates intake and workflow as separate domain exports', async () => {
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

    assert.ok(exports.intake, 'intake annotations should be exported');
    assert.ok(exports.workflow, 'workflow annotations should be exported');
  });

  it('intake Annotations schema is accessible by field path', async () => {
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

    const field = exports.intake.schema['application.submittedAt'];
    assert.ok(field, 'field annotation should be present');
    assert.ok(field.policies.includes('snap-processing-clock'));
    assert.ok(field.programs.includes('snap'));
    assert.ok(field.programs.includes('medicaid'));
  });

  it('workflow Annotations operations are accessible by key', async () => {
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

    const op = exports.workflow.operations['task.claim'];
    assert.ok(op, 'operation annotation should be present');
    assert.ok(op.policies.includes('workflow-assignment-policy'));
  });
});

// ---------------------------------------------------------------------------
// Domain isolation — annotations don't bleed across domains
// ---------------------------------------------------------------------------

describe('domain isolation', () => {
  it('intake schema keys do not appear in workflow Annotations', async () => {
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

    assert.ok(!exports.workflow.schema['application.submittedAt'],
      'intake schema key should not appear in workflow Annotations');
    assert.ok(!exports.intake.operations['task.claim'],
      'workflow operation key should not appear in intake Annotations');
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

    const schema = exports.intake.schema;
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

    const ops = exports.intake.operations;
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

    const field = exports.intake.schema['application.submittedAt'];
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

    const field = exports.intake.schema['application.members[].personalInformation.ssn'];
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

    const event = exports.intake.events['intake.application.submitted'];
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
    const { intake: IntakeAnnotations } = await generate(FIXTURE);

    const snapFields = Object.entries(IntakeAnnotations.schema)
      .filter(([, v]) => v.programs?.includes('snap'))
      .map(([k]) => k);

    assert.ok(snapFields.includes('application.submittedAt'));
    assert.ok(snapFields.includes('application.registerToVote'));
    assert.ok(!snapFields.includes('application.nonexistent'));
  });

  it('find all PII fields', async () => {
    const { intake: IntakeAnnotations } = await generate(FIXTURE);

    const piiFields = Object.entries(IntakeAnnotations.schema)
      .filter(([, v]) => v.dataClassification?.includes('pii'))
      .map(([k]) => k);

    assert.ok(piiFields.includes('application.members[].personalInformation.ssn'));
    assert.ok(piiFields.includes('application.members[].personalInformation.dateOfBirth'));
    assert.ok(piiFields.includes('application.incomes[]'));
    assert.ok(!piiFields.includes('application.submittedAt'));
  });

  it('find fields carrying FTI data classification', async () => {
    const { intake: IntakeAnnotations } = await generate(FIXTURE);

    const ftiFields = Object.entries(IntakeAnnotations.schema)
      .filter(([, v]) => v.dataClassification?.includes('fti'))
      .map(([k]) => k);

    assert.ok(ftiFields.includes('application.incomes[]'));
    assert.ok(!ftiFields.includes('application.members[].personalInformation.ssn'));
  });

  it('look up which policies govern an operation', async () => {
    const { intake: IntakeAnnotations } = await generate(FIXTURE);

    const submitPolicies = IntakeAnnotations.operations['application.submit']?.policies ?? [];

    assert.ok(submitPolicies.includes('snap-processing-clock'));
    assert.ok(submitPolicies.includes('snap-right-to-apply'));
  });

  it('check whether an operation requires supervisor review', async () => {
    const { intake: IntakeAnnotations } = await generate(FIXTURE);

    const requiresSupervisorReview = (operationKey) =>
      IntakeAnnotations.operations[operationKey]?.policies?.includes('snap-supervisor-review') ?? false;

    assert.equal(requiresSupervisorReview('application.approve-determination'), true);
    assert.equal(requiresSupervisorReview('application.submit'), false);
  });

  it('find all fields that cite a specific policy', async () => {
    const { intake: IntakeAnnotations } = await generate(FIXTURE);

    const fieldsWithPolicy = (policyId) =>
      Object.entries(IntakeAnnotations.schema)
        .filter(([, v]) => v.policies?.includes(policyId))
        .map(([k]) => k);

    const clockFields = fieldsWithPolicy('snap-processing-clock');
    assert.ok(clockFields.includes('application.submittedAt'));
    assert.ok(!clockFields.includes('application.registerToVote'));
  });

  it('look up which policies are triggered by an event', async () => {
    const { intake: IntakeAnnotations } = await generate(FIXTURE);

    const eventPolicies = IntakeAnnotations.events['intake.application.submitted']?.policies ?? [];

    assert.ok(eventPolicies.includes('snap-processing-clock'));
  });

  it('check whether a field is PII before logging or storing it', async () => {
    const { intake: IntakeAnnotations } = await generate(FIXTURE);

    const isPii = (fieldPath) =>
      IntakeAnnotations.schema[fieldPath]?.dataClassification?.includes('pii') ?? false;

    assert.equal(isPii('application.members[].personalInformation.ssn'), true);
    assert.equal(isPii('application.submittedAt'), false);
  });
});

// ---------------------------------------------------------------------------
// Contract-grounded tests — generated against the real contracts directory
// ---------------------------------------------------------------------------

describe('contract-grounded: intake annotations from real contracts', () => {
  let intakeAnnotations;

  it('generates intake Annotations from packages/contracts', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'snb-contracts-'));
    const domains = [];
    await generateAnnotationsAndPolicies(contractsDir, outputDir, domains);
    assert.ok(domains.includes('intake'), 'intake should be detected as an annotation domain');

    const content = readFileSync(join(outputDir, 'intake', 'annotations.ts'), 'utf8');
    const match = content.match(/export const Annotations = ([\s\S]+?) as const;/);
    assert.ok(match, 'annotations.ts should export Annotations const');
    intakeAnnotations = JSON.parse(match[1]);
  });

  it('intake Annotations.schema contains known annotated fields', () => {
    assert.ok(intakeAnnotations.schema['application.submittedAt'], 'application.submittedAt should be annotated');
    assert.ok(intakeAnnotations.schema['application.registerToVote'], 'application.registerToVote should be annotated');
    assert.ok(intakeAnnotations.schema['application.isExpedited'], 'application.isExpedited should be annotated');
  });

  it('intake Annotations.schema fields reference known policy IDs', () => {
    const submittedAt = intakeAnnotations.schema['application.submittedAt'];
    assert.ok(Array.isArray(submittedAt.policies), 'policies should be an array');
    assert.ok(submittedAt.policies.includes('snap-processing-clock'), 'application.submittedAt should cite snap-processing-clock');
  });

  it('intake Annotations.operations contains known operations', () => {
    assert.ok(Object.keys(intakeAnnotations.operations).length > 0, 'operations should not be empty');
  });

  it('intake Annotations.events contains known events', () => {
    assert.ok(Object.keys(intakeAnnotations.events).length > 0, 'events should not be empty');
  });

  it('filter PII fields from real intake schema annotations', () => {
    const piiFields = Object.entries(intakeAnnotations.schema)
      .filter(([, v]) => v.dataClassification?.includes('pii'))
      .map(([k]) => k);
    assert.ok(piiFields.length > 0, 'should have PII-classified fields in intake annotations');
  });
});
