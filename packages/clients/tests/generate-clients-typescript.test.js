import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, createOpenApiTsConfig, domainToAnnotationExportName, collectNullableFieldNames, patchZodGenForNullable } from '../scripts/generate-clients-typescript.js';

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
