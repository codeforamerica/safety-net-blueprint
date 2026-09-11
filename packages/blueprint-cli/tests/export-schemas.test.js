import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { convertToJsonSchema, loadSpec, discoverSpecs } from '../scripts/export-schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures/widgets');

describe('export-schemas', () => {

  describe('convertToJsonSchema', () => {

    it('adds JSON Schema metadata', () => {
      const result = convertToJsonSchema({ type: 'object', properties: { name: { type: 'string' } } }, 'TestSchema');
      assert.strictEqual(result.$schema, 'https://json-schema.org/draft/2020-12/schema');
      assert.strictEqual(result.$id, '#/components/schemas/TestSchema');
    });

    it('removes discriminator', () => {
      const result = convertToJsonSchema({
        type: 'object',
        discriminator: { propertyName: 'type' },
        properties: { type: { type: 'string' } },
      }, 'Pet');
      assert.strictEqual(result.discriminator, undefined);
      assert.strictEqual(result.properties.type.type, 'string');
    });

    it('removes xml', () => {
      const result = convertToJsonSchema({ type: 'object', xml: { name: 'pet' }, properties: {} }, 'Pet');
      assert.strictEqual(result.xml, undefined);
    });

    it('removes example recursively', () => {
      const result = convertToJsonSchema({
        type: 'object',
        example: { name: 'Fluffy' },
        properties: { name: { type: 'string', example: 'Spot' } },
      }, 'Pet');
      assert.strictEqual(result.example, undefined);
      assert.strictEqual(result.properties.name.example, undefined);
    });

    it('removes deprecated recursively', () => {
      const result = convertToJsonSchema({
        type: 'object',
        deprecated: true,
        properties: { oldField: { type: 'string', deprecated: true } },
      }, 'Legacy');
      assert.strictEqual(result.deprecated, undefined);
      assert.strictEqual(result.properties.oldField.deprecated, undefined);
    });

    it('removes x- extension properties recursively', () => {
      const result = convertToJsonSchema({
        type: 'object',
        'x-internal': true,
        properties: { name: { type: 'string', 'x-field-extra': { label: 'Name' } } },
      }, 'Extended');
      assert.strictEqual(result['x-internal'], undefined);
      assert.strictEqual(result.properties.name['x-field-extra'], undefined);
      assert.strictEqual(result.properties.name.type, 'string');
    });

    it('handles deeply nested objects', () => {
      const result = convertToJsonSchema({
        type: 'object',
        properties: {
          address: {
            type: 'object',
            example: { street: '123 Main St' },
            properties: {
              street: { type: 'string', example: '123 Main' },
              city: { type: 'string', xml: { name: 'city' } },
            },
          },
        },
      }, 'Location');
      assert.strictEqual(result.properties.address.example, undefined);
      assert.strictEqual(result.properties.address.properties.street.example, undefined);
      assert.strictEqual(result.properties.address.properties.city.xml, undefined);
    });

    it('handles allOf compositions', () => {
      const result = convertToJsonSchema({
        allOf: [
          { $ref: '#/components/schemas/Base' },
          { type: 'object', example: { extended: 'property' }, properties: { extraField: { type: 'string' } } },
        ],
      }, 'Extended');
      assert.strictEqual(result.allOf.length, 2);
      assert.strictEqual(result.allOf[0].$ref, '#/components/schemas/Base');
      assert.strictEqual(result.allOf[1].example, undefined);
    });

    it('handles oneOf/anyOf compositions', () => {
      const result = convertToJsonSchema({
        oneOf: [
          { type: 'string', example: 'text' },
          { type: 'number', example: 42 },
        ],
        example: 'default',
      }, 'FlexibleType');
      assert.strictEqual(result.example, undefined);
      assert.strictEqual(result.oneOf[0].example, undefined);
      assert.strictEqual(result.oneOf[1].example, undefined);
    });

    it('handles arrays with items', () => {
      const result = convertToJsonSchema({
        type: 'array',
        items: { type: 'object', example: { id: 1 }, properties: { id: { type: 'string' } } },
      }, 'ItemList');
      assert.strictEqual(result.type, 'array');
      assert.strictEqual(result.items.example, undefined);
    });

    it('does not mutate the original schema', () => {
      const input = { type: 'object', example: { test: 'value' }, properties: { name: { type: 'string' } } };
      const inputCopy = JSON.parse(JSON.stringify(input));
      convertToJsonSchema(input, 'Test');
      assert.deepStrictEqual(input, inputCopy);
    });

  });

  describe('loadSpec', () => {

    it('returns null for non-existent files', async () => {
      const result = await loadSpec('/tmp/does-not-exist.yaml');
      assert.strictEqual(result, null);
    });

    it('dereferences a spec and resolves $refs', async () => {
      const specPath = join(fixturesDir, 'widgets-openapi.yaml');
      const spec = await loadSpec(specPath);
      assert.ok(spec.components?.schemas, 'components.schemas should exist');
      for (const [name, schema] of Object.entries(spec.components.schemas)) {
        assert.strictEqual(typeof schema, 'object', `${name} schema should be an object`);
        assert.ok(
          schema.type || schema.allOf || schema.oneOf || schema.anyOf || schema.properties,
          `${name} schema should have structure`
        );
      }
    });

    it('reads x-domain from spec info', async () => {
      const specPath = join(fixturesDir, 'widgets-openapi.yaml');
      const spec = await loadSpec(specPath);
      assert.strictEqual(spec.info?.['x-domain'], 'widgets');
    });

  });

  describe('discoverSpecs', () => {

    it('discovers *-openapi.yaml files in a directory', () => {
      const specs = discoverSpecs(fixturesDir);
      assert.ok(specs.length > 0, 'should find at least one spec');
      assert.ok(specs.every(s => s.fileSlug && s.path), 'each spec should have fileSlug and path');
    });

    it('uses x-domain as domain when present, falls back to filename slug', async () => {
      const specs = discoverSpecs(fixturesDir);
      const widgetSpec = specs.find(s => s.fileSlug === 'widgets');
      assert.ok(widgetSpec, 'should find widgets spec');
      const spec = await loadSpec(widgetSpec.path);
      const domain = spec.info?.['x-domain'] ?? widgetSpec.fileSlug;
      assert.strictEqual(domain, 'widgets');
    });

  });

});
