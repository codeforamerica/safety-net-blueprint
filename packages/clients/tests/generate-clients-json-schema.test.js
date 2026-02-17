import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { convertToJsonSchema, loadSpec } from '../scripts/generate-clients-json-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const specsDir = join(__dirname, '../../contracts');

describe('OpenAPI to JSON Schema Conversion', () => {
  describe('convertToJsonSchema', () => {
    it('should add JSON Schema metadata', () => {
      const input = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      };

      const result = convertToJsonSchema(input, 'TestSchema');

      assert.strictEqual(result.$schema, 'https://json-schema.org/draft/2020-12/schema');
      assert.strictEqual(result.$id, '#/components/schemas/TestSchema');
    });

    it('should remove discriminator keyword', () => {
      const input = {
        type: 'object',
        discriminator: {
          propertyName: 'type',
          mapping: {
            dog: '#/components/schemas/Dog',
            cat: '#/components/schemas/Cat'
          }
        },
        properties: {
          type: { type: 'string' }
        }
      };

      const result = convertToJsonSchema(input, 'Pet');

      assert.strictEqual(result.discriminator, undefined);
      assert.strictEqual(result.properties.type.type, 'string');
    });

    it('should remove xml keyword', () => {
      const input = {
        type: 'object',
        xml: {
          name: 'pet',
          wrapped: true
        },
        properties: {
          name: { type: 'string' }
        }
      };

      const result = convertToJsonSchema(input, 'Pet');

      assert.strictEqual(result.xml, undefined);
    });

    it('should remove example keyword', () => {
      const input = {
        type: 'object',
        example: { name: 'Fluffy' },
        properties: {
          name: {
            type: 'string',
            example: 'Spot'
          }
        }
      };

      const result = convertToJsonSchema(input, 'Pet');

      assert.strictEqual(result.example, undefined);
      assert.strictEqual(result.properties.name.example, undefined);
    });

    it('should remove externalDocs keyword', () => {
      const input = {
        type: 'object',
        externalDocs: {
          url: 'https://example.com/docs',
          description: 'More info'
        },
        properties: {
          name: { type: 'string' }
        }
      };

      const result = convertToJsonSchema(input, 'Pet');

      assert.strictEqual(result.externalDocs, undefined);
    });

    it('should preserve standard JSON Schema properties', () => {
      const input = {
        type: 'object',
        required: ['name', 'age'],
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100
          },
          age: {
            type: 'integer',
            minimum: 0,
            maximum: 150
          }
        }
      };

      const result = convertToJsonSchema(input, 'Person');

      assert.deepStrictEqual(result.required, ['name', 'age']);
      assert.strictEqual(result.additionalProperties, false);
      assert.strictEqual(result.properties.name.type, 'string');
      assert.strictEqual(result.properties.name.minLength, 1);
      assert.strictEqual(result.properties.name.maxLength, 100);
      assert.strictEqual(result.properties.age.type, 'integer');
      assert.strictEqual(result.properties.age.minimum, 0);
      assert.strictEqual(result.properties.age.maximum, 150);
    });

    it('should handle nested objects and remove OpenAPI keywords recursively', () => {
      const input = {
        type: 'object',
        example: { top: 'level' },
        properties: {
          address: {
            type: 'object',
            example: { street: '123 Main St' },
            properties: {
              street: {
                type: 'string',
                example: '456 Oak Ave'
              },
              city: {
                type: 'string',
                xml: { name: 'city-element' }
              }
            }
          }
        }
      };

      const result = convertToJsonSchema(input, 'Location');

      assert.strictEqual(result.example, undefined);
      assert.strictEqual(result.properties.address.example, undefined);
      assert.strictEqual(result.properties.address.properties.street.example, undefined);
      assert.strictEqual(result.properties.address.properties.city.xml, undefined);
      assert.strictEqual(result.properties.address.properties.street.type, 'string');
      assert.strictEqual(result.properties.address.properties.city.type, 'string');
    });

    it('should handle allOf compositions', () => {
      const input = {
        allOf: [
          { $ref: '#/components/schemas/Base' },
          {
            type: 'object',
            example: { extended: 'property' },
            properties: {
              extraField: { type: 'string' }
            }
          }
        ]
      };

      const result = convertToJsonSchema(input, 'Extended');

      assert.strictEqual(result.allOf.length, 2);
      assert.strictEqual(result.allOf[0].$ref, '#/components/schemas/Base');
      assert.strictEqual(result.allOf[1].example, undefined);
      assert.strictEqual(result.allOf[1].properties.extraField.type, 'string');
    });

    it('should handle arrays with items', () => {
      const input = {
        type: 'array',
        items: {
          type: 'object',
          example: { item: 'value' },
          properties: {
            id: { type: 'string' }
          }
        }
      };

      const result = convertToJsonSchema(input, 'ItemList');

      assert.strictEqual(result.type, 'array');
      assert.strictEqual(result.items.example, undefined);
      assert.strictEqual(result.items.properties.id.type, 'string');
    });

    it('should not modify the original schema', () => {
      const input = {
        type: 'object',
        example: { test: 'value' },
        properties: {
          name: { type: 'string' }
        }
      };

      const inputCopy = JSON.parse(JSON.stringify(input));
      convertToJsonSchema(input, 'Test');

      assert.deepStrictEqual(input, inputCopy);
    });

    it('should handle schemas with $ref', () => {
      const input = {
        type: 'object',
        properties: {
          user: {
            $ref: '#/components/schemas/User',
            example: { id: 1 }
          }
        }
      };

      const result = convertToJsonSchema(input, 'Document');

      assert.strictEqual(result.properties.user.$ref, '#/components/schemas/User');
      assert.strictEqual(result.properties.user.example, undefined);
    });

    it('should handle oneOf and anyOf compositions', () => {
      const input = {
        oneOf: [
          {
            type: 'string',
            example: 'text value'
          },
          {
            type: 'number',
            example: 42
          }
        ],
        example: 'default value'
      };

      const result = convertToJsonSchema(input, 'FlexibleType');

      assert.strictEqual(result.example, undefined);
      assert.strictEqual(result.oneOf[0].example, undefined);
      assert.strictEqual(result.oneOf[1].example, undefined);
      assert.strictEqual(result.oneOf[0].type, 'string');
      assert.strictEqual(result.oneOf[1].type, 'number');
    });

    it('should remove deprecated keyword', () => {
      const input = {
        type: 'object',
        deprecated: true,
        properties: {
          oldField: {
            type: 'string',
            deprecated: true
          },
          newField: {
            type: 'string'
          }
        }
      };

      const result = convertToJsonSchema(input, 'Legacy');

      assert.strictEqual(result.deprecated, undefined);
      assert.strictEqual(result.properties.oldField.deprecated, undefined);
      assert.strictEqual(result.properties.oldField.type, 'string');
      assert.strictEqual(result.properties.newField.type, 'string');
    });

    it('should remove x- extension properties', () => {
      const input = {
        type: 'object',
        'x-internal': true,
        'x-custom-tag': 'some-value',
        properties: {
          name: {
            type: 'string',
            'x-field-extra': { label: 'Name' }
          }
        }
      };

      const result = convertToJsonSchema(input, 'Extended');

      assert.strictEqual(result['x-internal'], undefined);
      assert.strictEqual(result['x-custom-tag'], undefined);
      assert.strictEqual(result.properties.name['x-field-extra'], undefined);
      assert.strictEqual(result.properties.name.type, 'string');
    });
  });

  describe('loadSpec', () => {
    it('should dereference internal $ref entries', async () => {
      const specPath = join(specsDir, 'persons-openapi.yaml');
      const spec = await loadSpec(specPath);

      // After dereferencing, components.schemas should contain resolved objects
      assert.ok(spec.components.schemas, 'components.schemas should exist');

      // All schemas should be resolved objects, not $ref stubs
      for (const [name, schema] of Object.entries(spec.components.schemas)) {
        assert.strictEqual(typeof schema, 'object', `${name} schema should be an object`);
        assert.ok(
          schema.type || schema.allOf || schema.oneOf || schema.anyOf || schema.properties,
          `${name} schema should have structure (type, allOf, oneOf, anyOf, or properties)`
        );
      }
    });

    it('should dereference external $ref entries', async () => {
      const specPath = join(specsDir, 'persons-openapi.yaml');
      const spec = await loadSpec(specPath);

      // External refs like ./components/parameters.yaml#/LimitParam should be resolved
      // Check that a path operation's parameters are resolved objects, not $ref strings
      const listPath = spec.paths['/persons'];
      assert.ok(listPath, '/persons path should exist');
      const getOp = listPath.get;
      assert.ok(getOp, 'GET /persons should exist');

      // Parameters should be resolved objects with 'name' and 'in' properties
      const params = getOp.parameters || listPath.parameters || [];
      assert.ok(params.length > 0, 'Should have parameters');
      for (const param of params) {
        assert.strictEqual(param.$ref, undefined, `Parameter should be dereferenced, but found $ref: ${param.$ref}`);
        assert.ok(param.name, 'Dereferenced parameter should have a name');
      }
    });

    it('should return null for non-existent files', async () => {
      const result = await loadSpec('/tmp/does-not-exist.yaml');
      assert.strictEqual(result, null);
    });
  });
});
