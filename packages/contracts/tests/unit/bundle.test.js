/**
 * Unit tests for bundle.js
 * Tests that bundleSpec resolves external $refs and preserves self-contained specs.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { bundleSpec } from '../../src/bundle.js';

function createTmpDir() {
  const dir = join(tmpdir(), `bundle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('bundle tests', async (t) => {

  // ===========================================================================
  // bundleSpec - resolves external $refs
  // ===========================================================================

  await t.test('bundleSpec resolves external $refs', async () => {
    const dir = createTmpDir();
    try {
      // Write a component file that the spec will $ref
      const componentContent = yaml.dump({
        LimitParam: {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100 }
        }
      });
      mkdirSync(join(dir, 'components'), { recursive: true });
      writeFileSync(join(dir, 'components', 'parameters.yaml'), componentContent);

      // Write the main spec that references the component
      const specContent = yaml.dump({
        openapi: '3.1.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              parameters: [
                { '$ref': './components/parameters.yaml#/LimitParam' }
              ],
              responses: {
                '200': { description: 'OK' }
              }
            }
          }
        }
      });
      const specPath = join(dir, 'test-openapi.yaml');
      writeFileSync(specPath, specContent);

      const result = await bundleSpec(specPath);

      // The external $ref should be resolved/inlined
      const param = result.paths['/items'].get.parameters[0];
      assert.strictEqual(param.name, 'limit');
      assert.strictEqual(param.in, 'query');
      assert.strictEqual(param.schema.type, 'integer');
      assert.strictEqual(param.schema.minimum, 1);
      assert.strictEqual(param.schema.maximum, 100);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  // ===========================================================================
  // bundleSpec - preserves spec without external $refs
  // ===========================================================================

  await t.test('bundleSpec preserves spec without external $refs', async () => {
    const dir = createTmpDir();
    try {
      const specContent = yaml.dump({
        openapi: '3.1.0',
        info: { title: 'Self-Contained API', version: '2.0.0' },
        paths: {
          '/health': {
            get: {
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { '$ref': '#/components/schemas/Health' }
                    }
                  }
                }
              }
            }
          }
        },
        components: {
          schemas: {
            Health: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['up', 'down'] }
              }
            }
          }
        }
      });
      const specPath = join(dir, 'self-contained.yaml');
      writeFileSync(specPath, specContent);

      const result = await bundleSpec(specPath);

      // Internal $ref should be dereferenced
      assert.strictEqual(result.info.title, 'Self-Contained API');
      assert.strictEqual(result.info.version, '2.0.0');
      assert.ok(result.paths['/health'].get.responses['200']);
      // The schema should be resolved in-place
      const schema = result.paths['/health'].get.responses['200'].content['application/json'].schema;
      assert.strictEqual(schema.type, 'object');
      assert.deepStrictEqual(schema.properties.status.enum, ['up', 'down']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

});
