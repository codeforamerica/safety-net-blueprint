import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseArgs, createOpenApiTsConfig } from '../scripts/generate-clients-typescript.js';

describe('Client Generation', () => {
  describe('parseArgs', () => {
    it('should parse specs parameter', () => {
      const result = parseArgs(['--specs=./resolved']);

      assert.strictEqual(result.specs, './resolved');
      assert.strictEqual(result.out, null);
      assert.strictEqual(result.help, false);
    });

    it('should parse out parameter', () => {
      const result = parseArgs(['--out=./src/api']);

      assert.strictEqual(result.specs, null);
      assert.strictEqual(result.out, './src/api');
      assert.strictEqual(result.help, false);
    });

    it('should parse both specs and out parameters', () => {
      const result = parseArgs(['--specs=./resolved', '--out=./src/api']);

      assert.strictEqual(result.specs, './resolved');
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
      const result = parseArgs(['--specs=./resolved', '--help']);

      assert.strictEqual(result.specs, './resolved');
      assert.strictEqual(result.help, true);
    });

    it('should handle absolute paths', () => {
      const result = parseArgs(['--specs=/absolute/path/resolved', '--out=/absolute/path/api']);

      assert.strictEqual(result.specs, '/absolute/path/resolved');
      assert.strictEqual(result.out, '/absolute/path/api');
    });

    it('should handle paths with spaces by preserving them', () => {
      const result = parseArgs(['--specs=./path with spaces']);

      assert.strictEqual(result.specs, './path with spaces');
    });

    it('should return defaults when no arguments provided', () => {
      const result = parseArgs([]);

      assert.strictEqual(result.specs, null);
      assert.strictEqual(result.out, null);
      assert.strictEqual(result.help, false);
    });

    it('should ignore unrecognized arguments', () => {
      const result = parseArgs(['--specs=./resolved', '--unknown=value']);

      assert.strictEqual(result.specs, './resolved');
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
});
