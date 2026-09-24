import { describe, it } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { convertToJsonSchema } from '../../scripts/export-schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

});
