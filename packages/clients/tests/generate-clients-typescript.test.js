import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseArgs, createOpenApiTsConfig, domainToAnnotationExportName, generateAnnotationsAndPolicies, collectNullableFieldNames, patchZodGenForNullable } from '../scripts/generate-clients-typescript.js';

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

    it('uses domain property from file as domain name', async () => {
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
      const domains = [];
      await generateAnnotationsAndPolicies(specsDir, outputDir, domains);
      assert.ok(domains.includes('intake'));
      assert.ok(readAnnotations(outputDir, 'intake').includes('export const Annotations'));
    });

    it('uses domain property over filename when they differ', async () => {
      const { specsDir, outputDir } = makeDir({
        'foo-annotations.yaml': `
domain: intake
schema:
  application.submittedAt:
    policies: [snap-processing-clock]
operations: {}
events: {}
`,
      });
      const domains = [];
      await generateAnnotationsAndPolicies(specsDir, outputDir, domains);
      assert.ok(domains.includes('intake'), 'should use domain from file, not filename');
      assert.ok(!domains.includes('foo'), 'should not use filename-derived name');
    });

    it('falls back to filename when domain property is absent', async () => {
      const { specsDir, outputDir } = makeDir({
        'workflow-annotations.yaml': `
schema:
  task.assignedAt:
    policies: []
operations: {}
events: {}
`,
      });
      const domains = [];
      await generateAnnotationsAndPolicies(specsDir, outputDir, domains);
      assert.ok(domains.includes('workflow'));
    });

    it('generates exports for multiple domains', async () => {
      const { specsDir, outputDir } = makeDir({
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
      const domains = [];
      await generateAnnotationsAndPolicies(specsDir, outputDir, domains);
      assert.ok(domains.includes('intake'));
      assert.ok(domains.includes('workflow'));
      assert.ok(readAnnotations(outputDir, 'intake').includes('export const Annotations'));
      assert.ok(readAnnotations(outputDir, 'workflow').includes('export const Annotations'));
    });

    it('merges multiple files with the same domain', async () => {
      const { specsDir, outputDir } = makeDir({
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
      const domains = [];
      await generateAnnotationsAndPolicies(specsDir, outputDir, domains);
      assert.deepStrictEqual(domains, ['intake']);
      const content = readAnnotations(outputDir, 'intake');
      assert.ok(content.includes('application.submittedAt'));
      assert.ok(content.includes('application.members.ssn'));
    });

    it('generates no annotation files when no annotation files are present', async () => {
      const { specsDir, outputDir } = makeDir({
        'intake-openapi.yaml': 'openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\n',
      });
      const domains = [];
      await generateAnnotationsAndPolicies(specsDir, outputDir, domains);
      assert.deepStrictEqual(domains, []);
      assert.throws(() => readAnnotations(outputDir, 'intake'), 'annotations.ts should not be written');
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
