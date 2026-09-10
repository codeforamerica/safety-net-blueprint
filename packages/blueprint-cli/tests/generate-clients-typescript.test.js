import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseArgs, createOpenApiTsConfig, domainToAnnotationExportName, generateAnnotationsAndPolicies, collectNullableFieldNames, patchZodGenForNullable, collectNamedEnumDefs, patchTypesGenForNamedEnums, patchDomainBarrelForNamedEnums } from '../scripts/generate-ts-clients.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Client Generation', () => {
  describe('parseArgs', () => {
    it('should parse spec parameter', () => {
      const result = parseArgs(['--spec=./resolved']);

      assert.strictEqual(result.spec, './resolved');
      assert.strictEqual(result.out, null);
      assert.strictEqual(result.help, false);
    });

    it('should parse out parameter', () => {
      const result = parseArgs(['--out=./src/api']);

      assert.strictEqual(result.spec, null);
      assert.strictEqual(result.out, './src/api');
      assert.strictEqual(result.help, false);
    });

    it('should parse both spec and out parameters', () => {
      const result = parseArgs(['--spec=./resolved', '--out=./src/api']);

      assert.strictEqual(result.spec, './resolved');
      assert.strictEqual(result.out, './src/api');
      assert.strictEqual(result.help, false);
    });

    it('should recognize --help flag', () => {
      const result = parseArgs(['--help']);

      assert.strictEqual(result.help, true);
    });

    it('should recognize -h flag', () => {
      const result = parseArgs(['-h']);

      assert.strictEqual(result.help, true);
    });

    it('should handle help with other arguments', () => {
      const result = parseArgs(['--spec=./resolved', '--help']);

      assert.strictEqual(result.spec, './resolved');
      assert.strictEqual(result.help, true);
    });

    it('should handle absolute paths', () => {
      const result = parseArgs(['--spec=/absolute/path/resolved', '--out=/absolute/path/api']);

      assert.strictEqual(result.spec, '/absolute/path/resolved');
      assert.strictEqual(result.out, '/absolute/path/api');
    });

    it('should handle paths with spaces by preserving them', () => {
      const result = parseArgs(['--spec=./path with spaces']);

      assert.strictEqual(result.spec, './path with spaces');
    });

    it('should return defaults when no arguments provided', () => {
      const result = parseArgs([]);

      assert.strictEqual(result.spec, null);
      assert.strictEqual(result.out, null);
      assert.strictEqual(result.help, false);
    });

    it('should ignore unrecognized arguments', () => {
      const result = parseArgs(['--spec=./resolved', '--unknown=value']);

      assert.strictEqual(result.spec, './resolved');
      assert.strictEqual(result.out, null);
    });
  });

  describe('createOpenApiTsConfig', () => {
    it('should generate config with correct input path', () => {
      const config = createOpenApiTsConfig('./specs/persons.yaml', './output/persons');

      assert(config.includes("input: './specs/persons.yaml'"));
    });

    it('should generate config with correct output path', () => {
      const config = createOpenApiTsConfig('./specs/persons.yaml', './output/persons');

      assert(config.includes("path: './output/persons'"));
    });

    it('should include TypeScript plugin configuration', () => {
      const config = createOpenApiTsConfig('./input.yaml', './output');

      assert(config.includes("name: '@hey-api/typescript'"));
      assert(config.includes("enums: 'javascript'"));
      assert(config.includes("style: 'PascalCase'"));
    });

    it('should include SDK plugin with validator', () => {
      const config = createOpenApiTsConfig('./input.yaml', './output');

      assert(config.includes("name: '@hey-api/sdk'"));
      assert(config.includes('validator: true'));
    });

    it('should include Zod plugin', () => {
      const config = createOpenApiTsConfig('./input.yaml', './output');

      assert(config.includes("name: 'zod'"));
    });

    it('should include Axios client plugin', () => {
      const config = createOpenApiTsConfig('./input.yaml', './output');

      assert(config.includes("name: '@hey-api/client-axios'"));
    });

    it('should configure date handling', () => {
      const config = createOpenApiTsConfig('./input.yaml', './output');

      assert(config.includes("dates: 'types+transform'"));
    });

    it('should be valid JavaScript export syntax', () => {
      const config = createOpenApiTsConfig('./input.yaml', './output');

      assert(config.startsWith('// Auto-generated openapi-ts config\nexport default {'));
      assert(config.endsWith('};\n'));
    });

    it('should handle absolute paths', () => {
      const config = createOpenApiTsConfig(
        '/absolute/path/specs/persons.yaml',
        '/absolute/path/output/persons'
      );

      assert(config.includes("input: '/absolute/path/specs/persons.yaml'"));
      assert(config.includes("path: '/absolute/path/output/persons'"));
    });

    it('should handle paths with special characters', () => {
      const config = createOpenApiTsConfig(
        './specs/persons-v2.yaml',
        './output/persons-v2'
      );

      assert(config.includes("input: './specs/persons-v2.yaml'"));
      assert(config.includes("path: './output/persons-v2'"));
    });
  });

  describe('domainToAnnotationExportName', () => {
    it('converts a single-word domain', () => {
      assert.strictEqual(domainToAnnotationExportName('intake'), 'IntakeAnnotations');
    });

    it('converts a hyphenated domain', () => {
      assert.strictEqual(domainToAnnotationExportName('case-management'), 'CaseManagementAnnotations');
    });

    it('converts a multi-segment domain', () => {
      assert.strictEqual(domainToAnnotationExportName('data-exchange-adapter'), 'DataExchangeAdapterAnnotations');
    });
  });

  describe('collectNullableFieldNames', () => {
    function makeSpecDir(files) {
      const dir = mkdtempSync(join(tmpdir(), 'spec-'));
      for (const [rel, content] of Object.entries(files)) {
        const full = join(dir, rel);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, content);
      }
      return dir;
    }

    it('returns an empty set when no nullable fields exist', () => {
      const dir = makeSpecDir({
        'test-openapi.yaml': `
components:
  schemas:
    Foo:
      type: object
      properties:
        name:
          type: string
`,
      });
      const result = collectNullableFieldNames(dir);
      assert.strictEqual(result.size, 0);
    });

    it('collects field names with nullable: true from a top-level spec file', () => {
      const dir = makeSpecDir({
        'test-openapi.yaml': `
components:
  schemas:
    Member:
      type: object
      properties:
        dateOfBirth:
          allOf:
            - $ref: './identity.yaml#/DateOfBirth'
          nullable: true
        name:
          type: string
`,
      });
      const result = collectNullableFieldNames(dir);
      assert.ok(result.has('dateOfBirth'));
      assert.ok(!result.has('name'));
    });

    it('collects nullable fields from schema files in subdirectories', () => {
      const dir = makeSpecDir({
        'schemas/common/member.yaml': `
properties:
  isDisabled:
    type: boolean
    nullable: true
  citizenshipStatus:
    type: string
`,
      });
      const result = collectNullableFieldNames(dir);
      assert.ok(result.has('isDisabled'));
      assert.ok(!result.has('citizenshipStatus'));
    });

    it('collects nullable fields from multiple files', () => {
      const dir = makeSpecDir({
        'test-openapi.yaml': `
components:
  schemas:
    Foo:
      properties:
        fieldA:
          type: string
          nullable: true
`,
        'schemas/bar.yaml': `
properties:
  fieldB:
    type: integer
    nullable: true
`,
      });
      const result = collectNullableFieldNames(dir);
      assert.ok(result.has('fieldA'));
      assert.ok(result.has('fieldB'));
    });

    it('ignores non-YAML files', () => {
      const dir = makeSpecDir({
        'README.md': 'nullable: true\n  someField:\n    type: string',
        'test-openapi.yaml': 'components:\n  schemas: {}',
      });
      // Should not throw and should return empty set
      const result = collectNullableFieldNames(dir);
      assert.strictEqual(result.size, 0);
    });
  });

  describe('generateAnnotationsAndPolicies', () => {
    function makeDir(files) {
      const specsDir = mkdtempSync(join(tmpdir(), 'specs-'));
      const outputDir = mkdtempSync(join(tmpdir(), 'out-'));
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(specsDir, name), content);
      }
      return { specsDir, outputDir };
    }

    function readAnnotations(outputDir, domain) {
      return readFileSync(join(outputDir, domain, 'annotations.ts'), 'utf8');
    }

    async function generate(files) {
      const { specsDir, outputDir } = makeDir(files);
      const domains = [];
      await generateAnnotationsAndPolicies(specsDir, outputDir, domains);
      const result = {};
      for (const domain of domains) {
        const content = readFileSync(join(outputDir, domain, 'annotations.ts'), 'utf8');
        const match = content.match(/export const Annotations = ([\s\S]+?) as const;/);
        if (match) result[domain] = JSON.parse(match[1]);
      }
      return result;
    }

    it('uses domain property from file as domain name', async () => {
      const exports = await generate({
        'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
operations: {}
events: {}
`,
      });
      assert.ok(exports.intake, 'intake domain should be exported');
    });

    it('uses domain property over filename when they differ', async () => {
      const exports = await generate({
        'foo-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
operations: {}
events: {}
`,
      });
      assert.ok(exports.intake, 'should use domain from file, not filename');
      assert.ok(!exports.foo, 'should not use filename-derived name');
    });

    it('falls back to filename when domain property is absent', async () => {
      const exports = await generate({
        'workflow-annotations.yaml': `
schema:
  task.assignedAt:
    policies: []
operations: {}
events: {}
`,
      });
      assert.ok(exports.workflow, 'workflow domain should be exported');
    });

    it('generates exports for multiple domains', async () => {
      const exports = await generate({
        'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
operations: {}
events: {}
`,
        'workflow-annotations.yaml': `
domain: workflow
schema: {}
operations:
  task.assign:
    policies: []
events: {}
`,
      });
      assert.ok(exports.intake, 'intake domain should be exported');
      assert.ok(exports.workflow, 'workflow domain should be exported');
    });

    it('merges multiple files with the same domain', async () => {
      const exports = await generate({
        'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
operations: {}
events: {}
`,
        'intake-annotations-extra.yaml': `
domain: intake
schema:
  application.members.ssn:
    dataClassification: [pii, fti]
operations: {}
events: {}
`,
      });
      assert.ok(exports.intake.schema['application.submittedAt'], 'base schema field should be present');
      assert.ok(exports.intake.schema['application.members.ssn'], 'extra schema field should be present');
      assert.deepStrictEqual(exports.intake.schema['application.members.ssn'].dataClassification, ['pii', 'fti']);
    });

    it('generates no annotation files when no annotation files are present', async () => {
      const exports = await generate({
        'intake-openapi.yaml': 'openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\n',
      });
      assert.deepStrictEqual(exports, {});
    });

    it('patches domain index.ts with Annotations re-export when index exists', async () => {
      const { specsDir, outputDir } = makeDir({
        'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
operations: {}
events: {}
`,
      });
      // Pre-create the domain index.ts as hey-api would
      const domainDir = join(outputDir, 'intake');
      mkdirSync(domainDir, { recursive: true });
      writeFileSync(join(domainDir, 'index.ts'), `export { listApplications } from './sdk.gen';\n`);

      const domains = [];
      await generateAnnotationsAndPolicies(specsDir, outputDir, domains);

      const index = readFileSync(join(domainDir, 'index.ts'), 'utf8');
      assert.ok(index.includes(`export { Annotations } from './annotations.js'`),
        'index.ts should re-export Annotations');
      assert.ok(index.includes('listApplications'), 'original exports should be preserved');
    });

    it('does not patch index.ts when it does not exist', async () => {
      const { specsDir, outputDir } = makeDir({
        'intake-annotations.yaml': `
domain: intake
schema: {}
operations: {}
events: {}
`,
      });
      // No index.ts created — just the annotations file should be written
      const domains = [];
      await generateAnnotationsAndPolicies(specsDir, outputDir, domains);
      assert.ok(domains.includes('intake'));
      // annotations.ts written, no error thrown
      assert.ok(readAnnotations(outputDir, 'intake').includes('export const Annotations'));
    });

    it('includes facts section in generated Annotations export', async () => {
      const exports = await generate({
        'intake-annotations.yaml': `
domain: intake
facts:
  snapInterviewProbes.incomeInconsistency:
    policies: [snap-income-reporting]
    dataClassification: [pii]
  snapInterviewProbes.abawdMembers:
    policies: [snap-work-requirement]
`,
      });
      assert.ok(exports.intake.facts['snapInterviewProbes.incomeInconsistency'], 'fact should be present');
      assert.ok(exports.intake.facts['snapInterviewProbes.abawdMembers'], 'second fact should be present');
    });

    it('merges facts from multiple files for the same domain', async () => {
      const exports = await generate({
        'intake-annotations.yaml': `
domain: intake
facts:
  snapInterviewProbes.incomeInconsistency:
    policies: [snap-income-reporting]
`,
        'intake-annotations-state.yaml': `
domain: intake
facts:
  snapInterviewProbes.abawdMembers:
    policies: [snap-work-requirement]
`,
      });
      assert.ok(exports.intake.facts['snapInterviewProbes.incomeInconsistency']);
      assert.ok(exports.intake.facts['snapInterviewProbes.abawdMembers']);
    });

    describe('annotation content — domain isolation', () => {
      it('intake schema keys do not appear in workflow Annotations', async () => {
        const exports = await generate({
          'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
operations: {}
events: {}
`,
          'workflow-annotations.yaml': `
domain: workflow
schema: {}
operations:
  task.claim:
    policies: [workflow-assignment-policy]
events: {}
`,
        });

        assert.ok(!exports.workflow.schema['application.submittedAt'],
          'intake schema key should not appear in workflow Annotations');
        assert.ok(!exports.intake.operations['task.claim'],
          'workflow operation key should not appear in intake Annotations');
      });
    });

    describe('annotation content — entry shape', () => {
      it('schema field is accessible by path with policies array', async () => {
        const exports = await generate({
          'intake-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock, medicaid-processing-clock]
operations: {}
events: {}
`,
        });

        const field = exports.intake.schema['application.submittedAt'];
        assert.ok(Array.isArray(field.policies));
        assert.equal(field.policies.length, 2);
        assert.ok(field.policies.includes('snap-processing-clock'));
      });

      it('dataClassification is an accessible array on sensitive fields', async () => {
        const exports = await generate({
          'intake-annotations.yaml': `
domain: intake
schema:
  application.members[].personalInformation.ssn:
    dataClassification: [pii]
    policies: [snap-ssn-requirement]
operations: {}
events: {}
`,
        });

        const field = exports.intake.schema['application.members[].personalInformation.ssn'];
        assert.ok(Array.isArray(field.dataClassification));
        assert.ok(field.dataClassification.includes('pii'));
      });

      it('events section is accessible with policies', async () => {
        const exports = await generate({
          'intake-annotations.yaml': `
domain: intake
schema: {}
operations: {}
events:
  intake.application.submitted:
    policies: [snap-processing-clock]
`,
        });

        const event = exports.intake.events['intake.application.submitted'];
        assert.ok(event, 'event annotation should be present');
        assert.ok(Array.isArray(event.policies));
        assert.ok(event.policies.includes('snap-processing-clock'));
      });

      it('facts are accessible by {ruleset}.{factName} key with dataClassification', async () => {
        const exports = await generate({
          'intake-annotations.yaml': `
domain: intake
facts:
  snapInterviewProbes.incomeInconsistency:
    policies: [snap-income-reporting]
    dataClassification: [pii]
`,
        });

        const fact = exports.intake.facts['snapInterviewProbes.incomeInconsistency'];
        assert.ok(fact, 'fact annotation should be present');
        assert.ok(fact.policies.includes('snap-income-reporting'));
        assert.ok(fact.dataClassification.includes('pii'));
      });
    });

    describe('annotation content — consumer access patterns', () => {
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

      it('filter schema fields by program', async () => {
        const { intake } = await generate(FIXTURE);
        const snapFields = Object.entries(intake.schema)
          .filter(([, v]) => v.programs?.includes('snap'))
          .map(([k]) => k);
        assert.ok(snapFields.includes('application.submittedAt'));
        assert.ok(snapFields.includes('application.registerToVote'));
        assert.ok(!snapFields.includes('application.nonexistent'));
      });

      it('find all PII fields', async () => {
        const { intake } = await generate(FIXTURE);
        const piiFields = Object.entries(intake.schema)
          .filter(([, v]) => v.dataClassification?.includes('pii'))
          .map(([k]) => k);
        assert.ok(piiFields.includes('application.members[].personalInformation.ssn'));
        assert.ok(piiFields.includes('application.members[].personalInformation.dateOfBirth'));
        assert.ok(piiFields.includes('application.incomes[]'));
        assert.ok(!piiFields.includes('application.submittedAt'));
      });

      it('find fields carrying FTI data classification', async () => {
        const { intake } = await generate(FIXTURE);
        const ftiFields = Object.entries(intake.schema)
          .filter(([, v]) => v.dataClassification?.includes('fti'))
          .map(([k]) => k);
        assert.ok(ftiFields.includes('application.incomes[]'));
        assert.ok(!ftiFields.includes('application.members[].personalInformation.ssn'));
      });

      it('look up which policies govern an operation', async () => {
        const { intake } = await generate(FIXTURE);
        const submitPolicies = intake.operations['application.submit']?.policies ?? [];
        assert.ok(submitPolicies.includes('snap-processing-clock'));
        assert.ok(submitPolicies.includes('snap-right-to-apply'));
      });

      it('check whether an operation requires supervisor review', async () => {
        const { intake } = await generate(FIXTURE);
        const requiresSupervisorReview = (key) =>
          intake.operations[key]?.policies?.includes('snap-supervisor-review') ?? false;
        assert.equal(requiresSupervisorReview('application.approve-determination'), true);
        assert.equal(requiresSupervisorReview('application.submit'), false);
      });

      it('find all schema fields that cite a specific policy', async () => {
        const { intake } = await generate(FIXTURE);
        const fieldsWithPolicy = (policyId) =>
          Object.entries(intake.schema)
            .filter(([, v]) => v.policies?.includes(policyId))
            .map(([k]) => k);
        const clockFields = fieldsWithPolicy('snap-processing-clock');
        assert.ok(clockFields.includes('application.submittedAt'));
        assert.ok(!clockFields.includes('application.registerToVote'));
      });

      it('look up which policies are triggered by an event', async () => {
        const { intake } = await generate(FIXTURE);
        const eventPolicies = intake.events['intake.application.submitted']?.policies ?? [];
        assert.ok(eventPolicies.includes('snap-processing-clock'));
      });

      it('check whether a field is PII before logging or storing it', async () => {
        const { intake } = await generate(FIXTURE);
        const isPii = (fieldPath) =>
          intake.schema[fieldPath]?.dataClassification?.includes('pii') ?? false;
        assert.equal(isPii('application.members[].personalInformation.ssn'), true);
        assert.equal(isPii('application.submittedAt'), false);
      });
    });
  });

  describe('patchZodGenForNullable', () => {
    function writeTmp(content) {
      const dir = mkdtempSync(join(tmpdir(), 'zod-'));
      const path = join(dir, 'zod.gen.ts');
      writeFileSync(path, content);
      return path;
    }

    it('adds .nullable() inside z.optional() for a matching field', () => {
      const path = writeTmp(
        `export const zFoo = z.object({\n    dateOfBirth: z.optional(zIdentityDateOfBirth),\n});\n`
      );
      patchZodGenForNullable(path, new Set(['dateOfBirth']));
      const result = readFileSync(path, 'utf8');
      assert.ok(result.includes('z.optional(zIdentityDateOfBirth.nullable())'));
    });

    it('handles nested parens correctly (e.g. z.array(z.string()))', () => {
      const path = writeTmp(
        `export const zFoo = z.object({\n    items: z.optional(z.array(z.string())),\n});\n`
      );
      patchZodGenForNullable(path, new Set(['items']));
      const result = readFileSync(path, 'utf8');
      assert.ok(result.includes('z.optional(z.array(z.string()).nullable())'));
    });

    it('skips fields not in the nullable set', () => {
      const original =
        `export const zFoo = z.object({\n    name: z.optional(z.string()),\n});\n`;
      const path = writeTmp(original);
      patchZodGenForNullable(path, new Set(['dateOfBirth']));
      assert.strictEqual(readFileSync(path, 'utf8'), original);
    });

    it('is idempotent — does not double-patch', () => {
      const path = writeTmp(
        `export const zFoo = z.object({\n    dateOfBirth: z.optional(zIdentityDateOfBirth.nullable()),\n});\n`
      );
      patchZodGenForNullable(path, new Set(['dateOfBirth']));
      const result = readFileSync(path, 'utf8');
      assert.ok(!result.includes('.nullable().nullable()'));
    });

    it('patches multiple fields in one pass', () => {
      const path = writeTmp([
        'export const zMember = z.object({',
        '    dateOfBirth: z.optional(zIdentityDateOfBirth),',
        '    isDisabled: z.optional(z.boolean()),',
        '    name: z.optional(z.string()),',
        '});',
        '',
      ].join('\n'));
      patchZodGenForNullable(path, new Set(['dateOfBirth', 'isDisabled']));
      const result = readFileSync(path, 'utf8');
      assert.ok(result.includes('zIdentityDateOfBirth.nullable()'));
      assert.ok(result.includes('z.boolean().nullable()'));
      assert.ok(!result.includes('z.string().nullable()'));
    });

    it('does nothing when nullableFields is empty', () => {
      const original =
        `export const zFoo = z.object({\n    name: z.optional(z.string()),\n});\n`;
      const path = writeTmp(original);
      patchZodGenForNullable(path, new Set());
      assert.strictEqual(readFileSync(path, 'utf8'), original);
    });

    it('skips multi-line z.optional(z.union([...])) expressions unchanged', () => {
      const original = [
        'export const zFoo = z.object({',
        '    completedAt: z.optional(z.union([',
        '        z.iso.datetime({ offset: true }),',
        '        z.null()',
        '    ])),',
        '});',
        '',
      ].join('\n');
      const path = writeTmp(original);
      patchZodGenForNullable(path, new Set(['completedAt']));
      assert.strictEqual(readFileSync(path, 'utf8'), original);
    });

    it('skips multi-line z.optional(z.enum([...])) expressions unchanged', () => {
      const original = [
        'export const zFoo = z.object({',
        "    channel: z.optional(z.enum([",
        "        'online',",
        "        'in_person'",
        '    ])),',
        '});',
        '',
      ].join('\n');
      const path = writeTmp(original);
      patchZodGenForNullable(path, new Set(['channel']));
      assert.strictEqual(readFileSync(path, 'utf8'), original);
    });
  });

});
