/**
 * Unit tests for resolve-overlay.js
 * Tests overlay discovery, target-api/target-version disambiguation,
 * version extraction from filenames, environment filtering,
 * and placeholder substitution.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
import yaml from 'js-yaml';
import {
  discoverOverlayFiles,
  analyzeTargetLocations,
  resolveActionTargets,
  applyOverlayWithTargets,
  getVersionFromFilename,
  filterByEnvironment,
  parseEnvFile,
  substitutePlaceholders,
  detectComponentPrefix,
  rewriteOverlayRefs,
  rewriteBaseRefs,
  generateRpcOverlays,
  buildEnumSourceIndex,
  findEnumSources,
  parseEnumSource,
  applyEnumSourceInjections,
  injectPrefixInStateMachine,
  injectPrefixInAsyncApi
} from '../scripts/resolve.js';

// Use checkPathExists from the overlay module (same as the script does)
import { checkPathExists } from '@codeforamerica/blueprint-core/overlay';

function createTmpDir() {
  const dir = join(tmpdir(), `resolve-overlay-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeYaml(dir, filename, content) {
  const filePath = join(dir, filename);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, yaml.dump(content));
  return filePath;
}

test('resolve-overlay tests', async (t) => {

  // ===========================================================================
  // getVersionFromFilename
  // ===========================================================================

  await t.test('getVersionFromFilename - no suffix returns 1', () => {
    assert.strictEqual(getVersionFromFilename('items.yaml'), 1);
    assert.strictEqual(getVersionFromFilename('things.yaml'), 1);
  });

  await t.test('getVersionFromFilename - v2 suffix returns 2', () => {
    assert.strictEqual(getVersionFromFilename('items-v2.yaml'), 2);
  });

  await t.test('getVersionFromFilename - v3 suffix returns 3', () => {
    assert.strictEqual(getVersionFromFilename('things-v3.yaml'), 3);
  });

  await t.test('getVersionFromFilename - handles nested paths', () => {
    assert.strictEqual(getVersionFromFilename('components/items-v2.yaml'), 2);
    assert.strictEqual(getVersionFromFilename('deep/nested/foo.yaml'), 1);
  });

  // ===========================================================================
  // discoverOverlayFiles
  // ===========================================================================

  await t.test('discoverOverlayFiles - finds overlay files with overlay: 1.0.0', () => {
    const dir = createTmpDir();
    try {
      writeYaml(dir, 'first.yaml', { overlay: '1.0.0', actions: [] });
      writeYaml(dir, 'second.yaml', { overlay: '1.0.0', actions: [] });

      const found = discoverOverlayFiles(dir);
      assert.strictEqual(found.length, 2);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('discoverOverlayFiles - skips non-overlay yaml files', () => {
    const dir = createTmpDir();
    try {
      writeYaml(dir, 'overlay.yaml', { overlay: '1.0.0', actions: [] });
      writeYaml(dir, 'not-overlay.yaml', { openapi: '3.1.0', info: { title: 'Test' } });

      const found = discoverOverlayFiles(dir);
      assert.strictEqual(found.length, 1);
      assert.ok(found[0].endsWith('overlay.yaml'));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('discoverOverlayFiles - discovers nested overlay files', () => {
    const dir = createTmpDir();
    try {
      writeYaml(dir, 'top.yaml', { overlay: '1.0.0', actions: [] });
      writeYaml(dir, 'sub/nested.yaml', { overlay: '1.0.0', actions: [] });

      const found = discoverOverlayFiles(dir);
      assert.strictEqual(found.length, 2);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('discoverOverlayFiles - returns empty for non-existent dir', () => {
    const found = discoverOverlayFiles('/tmp/does-not-exist-' + Date.now());
    assert.strictEqual(found.length, 0);
  });

  // ===========================================================================
  // target-api disambiguation
  // ===========================================================================

  await t.test('target-api - matches correct spec by x-api-id', () => {
    const yamlFiles = [
      {
        relativePath: 'things.yaml',
        spec: {
          info: { 'x-api-id': 'things-api' },
          components: { schemas: { Thing: { properties: { name: { type: 'string' } } } } }
        }
      },
      {
        relativePath: 'items.yaml',
        spec: {
          info: { 'x-api-id': 'items-api' },
          components: { schemas: { Thing: { properties: { name: { type: 'string' } } } } }
        }
      }
    ];

    const overlay = {
      actions: [
        {
          target: '$.components.schemas.Thing.properties.name',
          'target-api': 'things-api',
          update: { maxLength: 100 }
        }
      ]
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.strictEqual(warnings.length, 0);
    const targets = actionTargets.get(0);
    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0], 'things.yaml');
  });

  await t.test('target-api - no match produces warning', () => {
    const yamlFiles = [
      {
        relativePath: 'things.yaml',
        spec: {
          info: { 'x-api-id': 'things-api' },
          components: { schemas: { Thing: { properties: { name: { type: 'string' } } } } }
        }
      }
    ];

    const overlay = {
      actions: [
        {
          target: '$.components.schemas.Thing.properties.name',
          'target-api': 'nonexistent-api',
          description: 'Bad target-api',
          update: { maxLength: 100 }
        }
      ]
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('target-api/target-version filters'));
    assert.deepStrictEqual(actionTargets.get(0), []);
  });

  // ===========================================================================
  // target-version disambiguation
  // ===========================================================================

  await t.test('target-version - matches v2 file only', () => {
    const yamlFiles = [
      {
        relativePath: 'foo.yaml',
        spec: { Foo: { properties: { bar: { type: 'string' } } } }
      },
      {
        relativePath: 'foo-v2.yaml',
        spec: { Foo: { properties: { bar: { type: 'string' } } } }
      }
    ];

    const overlay = {
      actions: [
        {
          target: '$.Foo.properties.bar',
          'target-version': 2,
          update: { maxLength: 50 }
        }
      ]
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.strictEqual(warnings.length, 0);
    const targets = actionTargets.get(0);
    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0], 'foo-v2.yaml');
  });

  await t.test('target-version - matches v1 (no suffix) file only', () => {
    const yamlFiles = [
      {
        relativePath: 'foo.yaml',
        spec: { Foo: { properties: { bar: { type: 'string' } } } }
      },
      {
        relativePath: 'foo-v2.yaml',
        spec: { Foo: { properties: { bar: { type: 'string' } } } }
      }
    ];

    const overlay = {
      actions: [
        {
          target: '$.Foo.properties.bar',
          'target-version': 1,
          update: { maxLength: 50 }
        }
      ]
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.strictEqual(warnings.length, 0);
    const targets = actionTargets.get(0);
    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0], 'foo.yaml');
  });

  // ===========================================================================
  // Multi-file ambiguity
  // ===========================================================================

  await t.test('multi-file match without disambiguator warns and skips', () => {
    const yamlFiles = [
      {
        relativePath: 'a.yaml',
        spec: { Shared: { properties: { x: { type: 'string' } } } }
      },
      {
        relativePath: 'b.yaml',
        spec: { Shared: { properties: { x: { type: 'string' } } } }
      }
    ];

    const overlay = {
      actions: [
        {
          target: '$.Shared.properties.x',
          description: 'Ambiguous target',
          update: { maxLength: 10 }
        }
      ]
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('multiple files'));
    assert.ok(warnings[0].includes('target-api'));
    assert.deepStrictEqual(actionTargets.get(0), []);
  });

  await t.test('single file match auto-applies without disambiguator', () => {
    const yamlFiles = [
      {
        relativePath: 'only.yaml',
        spec: { Unique: { properties: { x: { type: 'string' } } } }
      }
    ];

    const overlay = {
      actions: [
        {
          target: '$.Unique.properties.x',
          update: { maxLength: 10 }
        }
      ]
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.strictEqual(warnings.length, 0);
    assert.deepStrictEqual(actionTargets.get(0), ['only.yaml']);
  });

  // ===========================================================================
  // add: action — file matching uses parent path
  // ===========================================================================

  await t.test('add: action matches file via parent path when target key does not exist', () => {
    // The target $.compositions.itemReview.include does not exist, but
    // $.compositions.itemReview does. analyzeTargetLocations should use
    // the parent path so the file is matched and the action is applied.
    const yamlFiles = [
      {
        relativePath: 'test-compositions.yaml',
        spec: {
          compositions: {
            itemReview: {
              compositeType: 'sectionView',
              resource: 'items',
            },
          },
        },
      },
    ];

    const overlay = {
      actions: [
        {
          target: '$.compositions.itemReview.include',
          file: 'test-compositions.yaml',
          description: 'Add root-level include',
          add: { members: { resource: 'item-parts', bind: 'itemId' } },
        },
      ],
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.strictEqual(warnings.length, 0);
    assert.deepStrictEqual(actionTargets.get(0), ['test-compositions.yaml']);
  });

  await t.test('add: action with explicit file warns when parent path does not exist in that file', () => {
    const yamlFiles = [
      {
        relativePath: 'test-compositions.yaml',
        spec: { compositions: {} },
      },
    ];

    const overlay = {
      actions: [
        {
          target: '$.compositions.nonExistent.include',
          file: 'test-compositions.yaml',
          description: 'Bad parent path',
          add: { members: {} },
        },
      ],
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.ok(warnings.length > 0);
    assert.deepStrictEqual(actionTargets.get(0), []);
  });

  await t.test('add: action auto-resolves to single file via parent path', () => {
    const yamlFiles = [
      {
        relativePath: 'test-compositions.yaml',
        spec: {
          compositions: {
            itemReview: { compositeType: 'sectionView' },
          },
        },
      },
      {
        relativePath: 'other.yaml',
        spec: { something: { else: true } },
      },
    ];

    const overlay = {
      actions: [
        {
          target: '$.compositions.itemReview.newKey',
          description: 'Add new key without explicit file',
          add: { value: 42 },
        },
      ],
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.strictEqual(warnings.length, 0);
    assert.deepStrictEqual(actionTargets.get(0), ['test-compositions.yaml']);
  });

  // ===========================================================================
  // filterByEnvironment
  // ===========================================================================

  await t.test('filterByEnvironment - keeps node matching target env', () => {
    const spec = {
      paths: {
        '/users': {
          'x-environments': ['production', 'staging'],
          get: { summary: 'List users' }
        }
      }
    };

    const result = filterByEnvironment(spec, 'production');
    assert.ok(result.paths['/users']);
    assert.strictEqual(result.paths['/users'].get.summary, 'List users');
  });

  await t.test('filterByEnvironment - removes node not matching target env', () => {
    const spec = {
      paths: {
        '/debug': {
          'x-environments': ['dev'],
          get: { summary: 'Debug endpoint' }
        },
        '/users': {
          get: { summary: 'List users' }
        }
      }
    };

    const result = filterByEnvironment(spec, 'production');
    assert.strictEqual(result.paths['/debug'], undefined);
    assert.ok(result.paths['/users']);
  });

  await t.test('filterByEnvironment - strips x-environments from surviving nodes', () => {
    const spec = {
      paths: {
        '/users': {
          'x-environments': ['production'],
          get: { summary: 'List users' }
        }
      }
    };

    const result = filterByEnvironment(spec, 'production');
    assert.strictEqual(result.paths['/users']['x-environments'], undefined);
    assert.strictEqual(result.paths['/users'].get.summary, 'List users');
  });

  await t.test('filterByEnvironment - nested: parent kept but child with wrong env removed', () => {
    const spec = {
      components: {
        schemas: {
          User: {
            properties: {
              name: { type: 'string' },
              debugInfo: {
                'x-environments': ['dev'],
                type: 'object',
                properties: { trace: { type: 'string' } }
              }
            }
          }
        }
      }
    };

    const result = filterByEnvironment(spec, 'production');
    assert.ok(result.components.schemas.User.properties.name);
    assert.strictEqual(result.components.schemas.User.properties.debugInfo, undefined);
  });

  await t.test('filterByEnvironment - node without x-environments always kept', () => {
    const spec = {
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/users': { get: { summary: 'List users' } }
      }
    };

    const result = filterByEnvironment(spec, 'production');
    assert.strictEqual(result.info.title, 'Test API');
    assert.ok(result.paths['/users']);
  });

  await t.test('filterByEnvironment - handles primitive values unchanged', () => {
    const spec = {
      info: { title: 'Test', version: '1.0.0' },
      count: 42,
      enabled: true
    };

    const result = filterByEnvironment(spec, 'production');
    assert.strictEqual(result.count, 42);
    assert.strictEqual(result.enabled, true);
    assert.strictEqual(result.info.title, 'Test');
  });

  await t.test('filterByEnvironment - filters array items with x-environments', () => {
    const spec = {
      servers: [
        { url: 'https://api.example.com', 'x-environments': ['production'] },
        { url: 'https://dev.example.com', 'x-environments': ['dev'] },
        { url: 'https://common.example.com' }
      ]
    };

    const result = filterByEnvironment(spec, 'production');
    assert.strictEqual(result.servers.length, 2);
    assert.strictEqual(result.servers[0].url, 'https://api.example.com');
    assert.strictEqual(result.servers[1].url, 'https://common.example.com');
    // x-environments stripped from surviving array item
    assert.strictEqual(result.servers[0]['x-environments'], undefined);
  });

  // ===========================================================================
  // parseEnvFile
  // ===========================================================================

  await t.test('parseEnvFile - parses key=value pairs', () => {
    const dir = createTmpDir();
    try {
      const envPath = join(dir, '.env');
      writeFileSync(envPath, 'API_URL=https://api.example.com\nDB_HOST=localhost\n');
      const vars = parseEnvFile(envPath);
      assert.strictEqual(vars.API_URL, 'https://api.example.com');
      assert.strictEqual(vars.DB_HOST, 'localhost');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('parseEnvFile - strips quotes and ignores comments', () => {
    const dir = createTmpDir();
    try {
      const envPath = join(dir, '.env');
      writeFileSync(envPath, '# This is a comment\nAPI_KEY="my-secret"\nNAME=\'quoted\'\n\nBLANK_LINE_ABOVE=yes\n');
      const vars = parseEnvFile(envPath);
      assert.strictEqual(vars.API_KEY, 'my-secret');
      assert.strictEqual(vars.NAME, 'quoted');
      assert.strictEqual(vars.BLANK_LINE_ABOVE, 'yes');
      assert.strictEqual(Object.keys(vars).length, 3);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  // ===========================================================================
  // substitutePlaceholders
  // ===========================================================================

  await t.test('substitutePlaceholders - replaces ${VAR} from vars', () => {
    const spec = {
      servers: [{ url: '${API_URL}/v1' }]
    };
    const warnings = [];
    const result = substitutePlaceholders(spec, { API_URL: 'https://api.example.com' }, warnings);
    assert.strictEqual(result.servers[0].url, 'https://api.example.com/v1');
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('substitutePlaceholders - process.env overrides file values', () => {
    const spec = { url: '${HOST}' };
    // Simulate merged vars: file value overridden by process.env
    const fileVars = { HOST: 'from-file' };
    const envVars = { HOST: 'from-env' };
    const merged = { ...fileVars, ...envVars };
    const warnings = [];
    const result = substitutePlaceholders(spec, merged, warnings);
    assert.strictEqual(result.url, 'from-env');
  });

  await t.test('substitutePlaceholders - warns on unresolved placeholder', () => {
    const spec = { url: '${MISSING_VAR}' };
    const warnings = [];
    const result = substitutePlaceholders(spec, {}, warnings);
    assert.strictEqual(result.url, '${MISSING_VAR}');
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0], 'MISSING_VAR');
  });

  await t.test('substitutePlaceholders - non-string values unchanged', () => {
    const spec = { port: 8080, enabled: true, tags: ['a', 'b'] };
    const warnings = [];
    const result = substitutePlaceholders(spec, {}, warnings);
    assert.strictEqual(result.port, 8080);
    assert.strictEqual(result.enabled, true);
    assert.deepStrictEqual(result.tags, ['a', 'b']);
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('substitutePlaceholders - multiple placeholders in one string', () => {
    const spec = { url: '${PROTO}://${HOST}:${PORT}' };
    const warnings = [];
    const result = substitutePlaceholders(spec, { PROTO: 'https', HOST: 'api.example.com', PORT: '443' }, warnings);
    assert.strictEqual(result.url, 'https://api.example.com:443');
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('substitutePlaceholders - deduplicates warning for same var', () => {
    const spec = { a: '${X}', b: '${X}', c: '${Y}' };
    const warnings = [];
    substitutePlaceholders(spec, {}, warnings);
    assert.strictEqual(warnings.length, 2);
    assert.ok(warnings.includes('X'));
    assert.ok(warnings.includes('Y'));
  });

  // ===========================================================================
  // detectComponentPrefix
  // ===========================================================================

  await t.test('detectComponentPrefix - detects ./ prefix from external $ref', () => {
    const spec = {
      paths: {
        '/items': {
          get: {
            responses: {
              '400': { $ref: './components/responses.yaml#/BadRequest' }
            }
          }
        }
      }
    };
    assert.strictEqual(detectComponentPrefix(spec), './');
  });

  await t.test('detectComponentPrefix - detects relative path prefix', () => {
    const spec = {
      paths: {
        '/items': {
          get: {
            responses: {
              '400': { $ref: '../../contracts/components/responses.yaml#/BadRequest' }
            }
          }
        }
      }
    };
    assert.strictEqual(detectComponentPrefix(spec), '../../contracts/');
  });

  await t.test('detectComponentPrefix - skips internal refs (#/components/...)', () => {
    const spec = {
      paths: {
        '/items': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Item' }
                  }
                }
              }
            }
          }
        }
      }
    };
    // No external component refs found, should return default
    assert.strictEqual(detectComponentPrefix(spec), './');
  });

  await t.test('detectComponentPrefix - returns ./ when no refs found', () => {
    const spec = { info: { title: 'Test' } };
    assert.strictEqual(detectComponentPrefix(spec), './');
  });

  // ===========================================================================
  // rewriteOverlayRefs
  // ===========================================================================

  await t.test('rewriteOverlayRefs - rewrites ./ prefix to new prefix', () => {
    const overlay = {
      actions: [{
        target: '$.paths',
        update: {
          '/items/{id}/approve': {
            post: {
              responses: {
                '400': { $ref: './components/responses.yaml#/BadRequest' },
                '404': { $ref: './components/responses.yaml#/NotFound' }
              }
            }
          }
        }
      }]
    };

    const result = rewriteOverlayRefs(overlay, './', '../../contracts/');
    const responses = result.actions[0].update['/items/{id}/approve'].post.responses;
    assert.strictEqual(responses['400'].$ref, '../../contracts/components/responses.yaml#/BadRequest');
    assert.strictEqual(responses['404'].$ref, '../../contracts/components/responses.yaml#/NotFound');
  });

  await t.test('rewriteOverlayRefs - returns same object when prefixes match', () => {
    const overlay = { actions: [{ target: '$.paths', update: {} }] };
    const result = rewriteOverlayRefs(overlay, './', './');
    assert.deepStrictEqual(result, overlay);
  });

  await t.test('rewriteOverlayRefs - does not rewrite non-component $refs', () => {
    const overlay = {
      actions: [{
        target: '$.paths',
        update: {
          '/items/{id}/approve': {
            post: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Item' }
                    }
                  }
                }
              }
            }
          }
        }
      }]
    };

    const result = rewriteOverlayRefs(overlay, './', '../../contracts/');
    const schema = result.actions[0].update['/items/{id}/approve'].post.responses['200'].content['application/json'].schema;
    assert.strictEqual(schema.$ref, '#/components/schemas/Item');
  });

  // ===========================================================================
  // generateRpcOverlays (integration-style, uses temp dir)
  // ===========================================================================

  await t.test('generateRpcOverlays - generates overlay from state machine + API spec', () => {
    const dir = createTmpDir();
    try {
      // Write a minimal API spec
      writeYaml(dir, 'test-openapi.yaml', {
        openapi: '3.1.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              summary: 'List items',
              operationId: 'listItems',
              tags: ['Items'],
              responses: { '200': { description: 'OK' } }
            }
          },
          '/items/{itemId}': {
            parameters: [{ $ref: '#/components/parameters/ItemIdParam' }],
            get: {
              summary: 'Get item',
              operationId: 'getItem',
              tags: ['Items'],
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Item' }
                    }
                  }
                }
              }
            }
          }
        },
        components: {
          parameters: {
            ItemIdParam: { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }
          },
          schemas: {
            Item: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } } }
          }
        }
      });

      // Write a state machine
      writeYaml(dir, 'test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        version: '1.0',
        domain: 'test',
        apiSpec: 'test-openapi.yaml',
        machines: [{
          object: 'Item',
          states: [{ id: 'draft' }, { id: 'published' }],
          initialState: 'draft',
          actions: [
            { id: 'publish', transition: { from: 'draft', to: 'published' } }
          ]
        }]
      });

      const yamlFiles = [
        {
          relativePath: 'test-openapi.yaml',
          spec: yaml.load(readFileSync(join(dir, 'test-openapi.yaml'), 'utf8'))
        },
        {
          relativePath: 'test-state-machine.yaml',
          spec: yaml.load(readFileSync(join(dir, 'test-state-machine.yaml'), 'utf8'))
        }
      ];

      const rpcOverlays = generateRpcOverlays(yamlFiles);

      assert.strictEqual(rpcOverlays.length, 1);

      const { overlay, stateMachine } = rpcOverlays[0];
      assert.strictEqual(stateMachine.domain, 'test');
      assert.strictEqual(overlay.info.title, 'test RPC Overlay');
      assert.strictEqual(overlay.actions.length, 1);

      // The overlay should target $.paths and add the RPC endpoint
      const action = overlay.actions[0];
      assert.strictEqual(action.target, '$.paths');
      assert.ok(action.update['/items/{itemId}/publish']);
      assert.strictEqual(action.update['/items/{itemId}/publish'].post.operationId, 'publishItem');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('generateRpcOverlays - applies overlay to add RPC paths to spec', () => {
    const dir = createTmpDir();
    try {
      // Write a minimal API spec with external component $refs
      writeYaml(dir, 'test-openapi.yaml', {
        openapi: '3.1.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/items/{itemId}': {
            parameters: [{ $ref: '#/components/parameters/ItemIdParam' }],
            get: {
              tags: ['Items'],
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } }
                },
                '400': { $ref: './components/responses.yaml#/BadRequest' }
              }
            }
          }
        },
        components: {
          parameters: { ItemIdParam: { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } } },
          schemas: { Item: { type: 'object' } }
        }
      });

      writeYaml(dir, 'test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        version: '1.0',
        domain: 'test',
        apiSpec: 'test-openapi.yaml',
        machines: [{
          object: 'Item',
          states: [{ id: 'draft' }, { id: 'published' }],
          initialState: 'draft',
          actions: [
            { id: 'publish', transition: { from: 'draft', to: 'published' } },
            { id: 'archive', transition: { from: 'published', to: 'draft' } }
          ]
        }]
      });

      const yamlFiles = [
        {
          relativePath: 'test-openapi.yaml',
          spec: yaml.load(readFileSync(join(dir, 'test-openapi.yaml'), 'utf8'))
        },
        {
          relativePath: 'test-state-machine.yaml',
          spec: yaml.load(readFileSync(join(dir, 'test-state-machine.yaml'), 'utf8'))
        }
      ];

      const rpcOverlays = generateRpcOverlays(yamlFiles);
      assert.strictEqual(rpcOverlays.length, 1);

      // Now apply the overlay through the full pipeline
      const { overlay } = rpcOverlays[0];
      const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
      const { actionTargets } = resolveActionTargets(actionFileMap);
      const { results } = applyOverlayWithTargets(yamlFiles, overlay, actionTargets, dir);

      const resolved = results.get('test-openapi.yaml');
      assert.ok(resolved.paths['/items/{itemId}/publish'], 'Should have publish RPC path');
      assert.ok(resolved.paths['/items/{itemId}/archive'], 'Should have archive RPC path');
      assert.strictEqual(resolved.paths['/items/{itemId}/publish'].post.operationId, 'publishItem');
      assert.strictEqual(resolved.paths['/items/{itemId}/archive'].post.operationId, 'archiveItem');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('generateRpcOverlays - RPC patches from multiple domains all survive (loop accumulation)', () => {
    const dir = createTmpDir();
    try {
      const makeApiSpec = (resource, pathParam) => ({
        openapi: '3.1.0',
        info: { title: `${resource} API`, version: '1.0.0' },
        paths: {
          [`/${resource.toLowerCase()}s/{${pathParam}}`]: {
            parameters: [{ name: pathParam, in: 'path', required: true, schema: { type: 'string' } }],
            get: {
              tags: [resource],
              responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: `#/components/schemas/${resource}` } } } } }
            }
          }
        },
        components: { schemas: { [resource]: { type: 'object' } } }
      });

      const makeStateMachine = (domain, resource, apiSpec) => ({
        '$schema': 'state-machine-schema.yaml',
        version: '1.0',
        domain,
        apiSpec,
        machines: [{
          object: resource,
          states: [{ id: 'draft' }, { id: 'active' }],
          initialState: 'draft',
          actions: [{ id: 'activate', transition: { from: 'draft', to: 'active' } }]
        }]
      });

      writeYaml(dir, 'foo-openapi.yaml', makeApiSpec('Foo', 'fooId'));
      writeYaml(dir, 'bar-openapi.yaml', makeApiSpec('Bar', 'barId'));
      writeYaml(dir, 'foo-state-machine.yaml', makeStateMachine('foo', 'Foo', 'foo-openapi.yaml'));
      writeYaml(dir, 'bar-state-machine.yaml', makeStateMachine('bar', 'Bar', 'bar-openapi.yaml'));

      const yamlFiles = ['foo-openapi.yaml', 'bar-openapi.yaml', 'foo-state-machine.yaml', 'bar-state-machine.yaml']
        .map(f => ({ relativePath: f, spec: yaml.load(readFileSync(join(dir, f), 'utf8')) }));

      const rpcOverlays = generateRpcOverlays(yamlFiles);
      assert.strictEqual(rpcOverlays.length, 2);

      // Apply overlays the same way resolve.js does — each iteration must build on currentResults
      let currentResults = null;
      for (const { overlay } of rpcOverlays) {
        const currentInputFiles = currentResults
          ? [...currentResults.entries()].map(([relativePath, spec]) => ({ relativePath, spec }))
          : yamlFiles;
        const actionFileMap = analyzeTargetLocations(overlay, currentInputFiles);
        const { actionTargets } = resolveActionTargets(actionFileMap);
        const { results } = applyOverlayWithTargets(currentInputFiles, overlay, actionTargets, dir);
        currentResults = results;
      }

      // Both domains' RPC paths must be present — the loop must not overwrite earlier iterations
      const foo = currentResults.get('foo-openapi.yaml');
      const bar = currentResults.get('bar-openapi.yaml');
      assert.ok(foo.paths['/foos/{fooId}/activate'], 'foo RPC path should be present');
      assert.ok(bar.paths['/bars/{barId}/activate'], 'bar RPC path should be present');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('applyOverlayWithTargets - warns when update: used with array on behavioral YAML', () => {
    const dir = createTmpDir();
    try {
      const stateMachineYaml = {
        '$schema': 'state-machine-schema.yaml',
        domain: 'test',
        object: 'Item',
        states: [{ id: 'draft' }, { id: 'published' }],
        initialState: 'draft',
        actions: []
      };
      writeYaml(dir, 'test-state-machine.yaml', stateMachineYaml);

      const yamlFiles = [{
        relativePath: 'test-state-machine.yaml',
        sourcePath: join(dir, 'test-state-machine.yaml'),
        spec: stateMachineYaml
      }];

      const overlay = {
        info: { title: 'Test Overlay', version: '1.0.0' },
        actions: [{
          target: '$.states',
          description: 'Replace states',
          update: [{ id: 'active' }, { id: 'closed' }]
        }]
      };

      const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
      const { actionTargets } = resolveActionTargets(actionFileMap);
      const { results, warnings } = applyOverlayWithTargets(yamlFiles, overlay, actionTargets, dir);

      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings[0].includes('"update:"'), 'Warning should mention update:');
      assert.ok(warnings[0].includes('append:'), 'Warning should suggest append:');
      assert.ok(results instanceof Map, 'results should still be a Map');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('generateRpcOverlays - returns empty when no state machines exist', () => {
    const yamlFiles = [{ relativePath: 'test-openapi.yaml', spec: { openapi: '3.1.0' } }];
    const result = generateRpcOverlays(yamlFiles);
    assert.strictEqual(result.length, 0);
  });

  await t.test('generateRpcOverlays - rewrites $ref prefix when spec uses non-default prefix', () => {
    const dir = createTmpDir();
    try {
      // API spec uses a different component prefix
      writeYaml(dir, 'test-openapi.yaml', {
        openapi: '3.1.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/items/{itemId}': {
            parameters: [{ $ref: '#/components/parameters/ItemIdParam' }],
            get: {
              tags: ['Items'],
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } }
                },
                '400': { $ref: '../../contracts/components/responses.yaml#/BadRequest' }
              }
            }
          }
        },
        components: {
          parameters: { ItemIdParam: { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } } },
          schemas: { Item: { type: 'object' } }
        }
      });

      writeYaml(dir, 'test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        version: '1.0',
        domain: 'test',
        apiSpec: 'test-openapi.yaml',
        machines: [{
          object: 'Item',
          states: [{ id: 'draft' }, { id: 'published' }],
          initialState: 'draft',
          actions: [
            { id: 'publish', transition: { from: 'draft', to: 'published' } }
          ]
        }]
      });

      const yamlFiles = [
        {
          relativePath: 'test-openapi.yaml',
          spec: yaml.load(readFileSync(join(dir, 'test-openapi.yaml'), 'utf8'))
        },
        {
          relativePath: 'test-state-machine.yaml',
          spec: yaml.load(readFileSync(join(dir, 'test-state-machine.yaml'), 'utf8'))
        }
      ];

      const rpcOverlays = generateRpcOverlays(yamlFiles);
      const { overlay } = rpcOverlays[0];

      // Response $refs should use the detected prefix, not ./
      const publishEndpoint = overlay.actions[0].update['/items/{itemId}/publish'];
      assert.strictEqual(
        publishEndpoint.post.responses['400'].$ref,
        '../../contracts/components/responses.yaml#/BadRequest'
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

});

// =============================================================================
// x-enum-source injection
// =============================================================================

test('x-enum-source injection', async (t) => {

  await t.test('parseEnumSource - parses valid syntax', () => {
    assert.deepStrictEqual(parseEnumSource('slaTypes[].id'), { collection: 'slaTypes', field: 'id' });
    assert.deepStrictEqual(parseEnumSource('states[].id'), { collection: 'states', field: 'id' });
  });

  await t.test('parseEnumSource - returns null for invalid syntax', () => {
    assert.strictEqual(parseEnumSource('slaTypes.id'), null);
    assert.strictEqual(parseEnumSource('slaTypes[]'), null);
    assert.strictEqual(parseEnumSource(''), null);
  });

  await t.test('findEnumSources - finds string form annotation', () => {
    const spec = {
      SlaInfo: {
        properties: {
          slaTypeCode: { type: 'string', 'x-enum-source': 'slaTypes[].id' },
          status: { type: 'string' }
        }
      }
    };
    const findings = findEnumSources(spec);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].path, 'SlaInfo.properties.slaTypeCode');
    assert.strictEqual(findings[0].source, 'slaTypes[].id');
    assert.strictEqual(findings[0].machine, null);
  });

  await t.test('findEnumSources - finds object form annotation with machine', () => {
    const spec = {
      Widget: {
        properties: {
          status: { type: 'string', 'x-enum-source': { source: 'states[].id', machine: 'Widget' } }
        }
      }
    };
    const findings = findEnumSources(spec);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].path, 'Widget.properties.status');
    assert.strictEqual(findings[0].source, 'states[].id');
    assert.strictEqual(findings[0].machine, 'Widget');
  });

  await t.test('findEnumSources - object form without machine defaults to null', () => {
    const spec = {
      Schema: {
        properties: {
          status: { type: 'string', 'x-enum-source': { source: 'states[].id' } }
        }
      }
    };
    const findings = findEnumSources(spec);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].machine, null);
  });

  await t.test('findEnumSources - finds multiple annotations', () => {
    const spec = {
      SchemaA: {
        properties: { code: { type: 'string', 'x-enum-source': 'slaTypes[].id' } }
      },
      SchemaB: {
        properties: { status: { type: 'string', 'x-enum-source': 'states[].id' } }
      }
    };
    const findings = findEnumSources(spec);
    assert.strictEqual(findings.length, 2);
  });

  await t.test('findEnumSources - returns empty when no annotations', () => {
    const spec = { Item: { properties: { status: { type: 'string' } } } };
    assert.deepStrictEqual(findEnumSources(spec), []);
  });

  await t.test('buildEnumSourceIndex - indexes slaTypes from sla-types yaml', () => {
    const currentResults = new Map([
      ['test-sla-types.yaml', {
        '$schema': 'sla-types-schema.yaml',
        slaTypes: [
          { id: 'type_a', name: 'Type A' },
          { id: 'type_b', name: 'Type B' }
        ]
      }]
    ]);
    const index = buildEnumSourceIndex(currentResults);
    assert.deepStrictEqual(index['slaTypes'], ['type_a', 'type_b']);
  });

  await t.test('buildEnumSourceIndex - indexes states from state-machine yaml (legacy top-level format)', () => {
    const currentResults = new Map([
      ['test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        states: [
          { id: 'pending', slaClock: 'running' },
          { id: 'completed', slaClock: 'stopped' }
        ]
      }]
    ]);
    const index = buildEnumSourceIndex(currentResults);
    assert.deepStrictEqual(index['states'], ['pending', 'completed']);
  });

  await t.test('buildEnumSourceIndex - indexes states from machines[].states format', () => {
    const currentResults = new Map([
      ['test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        machines: [
          { object: 'Item', states: [{ id: 'pending' }, { id: 'in_progress' }, { id: 'completed' }] }
        ]
      }]
    ]);
    const index = buildEnumSourceIndex(currentResults);
    assert.deepStrictEqual(index['states'], ['pending', 'in_progress', 'completed']);
    assert.deepStrictEqual(index['states:Item'], ['pending', 'in_progress', 'completed']);
  });

  await t.test('buildEnumSourceIndex - indexes per-machine states for multi-machine state files', () => {
    const currentResults = new Map([
      ['test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        machines: [
          { object: 'Widget', states: [{ id: 'draft' }, { id: 'submitted' }, { id: 'closed' }] },
          { object: 'Part', states: [{ id: 'pending' }, { id: 'satisfied' }, { id: 'waived' }] }
        ]
      }]
    ]);
    const index = buildEnumSourceIndex(currentResults);
    // Flat union for string form
    assert.deepStrictEqual(index['states'], ['draft', 'submitted', 'closed', 'pending', 'satisfied', 'waived']);
    // Per-machine keys for object form
    assert.deepStrictEqual(index['states:Widget'], ['draft', 'submitted', 'closed']);
    assert.deepStrictEqual(index['states:Part'], ['pending', 'satisfied', 'waived']);
  });

  await t.test('buildEnumSourceIndex - returns empty when no behavioral yamls', () => {
    const currentResults = new Map([
      ['test-openapi.yaml', { openapi: '3.1.0' }]
    ]);
    assert.deepStrictEqual(buildEnumSourceIndex(currentResults), {});
  });

  await t.test('applyEnumSourceInjections - injects enum and strips annotation', () => {
    const currentResults = new Map([
      ['test-sla-types.yaml', {
        '$schema': 'sla-types-schema.yaml',
        slaTypes: [{ id: 'type_a' }, { id: 'type_b' }]
      }],
      ['components/sla.yaml', {
        SlaInfo: {
          properties: {
            slaTypeCode: { type: 'string', 'x-enum-source': 'slaTypes[].id', description: 'SLA type' }
          }
        }
      }]
    ]);

    const warnings = applyEnumSourceInjections(currentResults);
    assert.strictEqual(warnings.length, 0);

    const resolved = currentResults.get('components/sla.yaml');
    const field = resolved.SlaInfo.properties.slaTypeCode;
    assert.deepStrictEqual(field.enum, ['type_a', 'type_b']);
    assert.strictEqual(field.type, 'string');
    assert.strictEqual(field.description, 'SLA type');
    assert.strictEqual(field['x-enum-source'], undefined);
  });

  await t.test('applyEnumSourceInjections - injects states enum', () => {
    const currentResults = new Map([
      ['test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        states: [{ id: 'pending' }, { id: 'in_progress' }, { id: 'completed' }]
      }],
      ['test-openapi.yaml', {
        Item: {
          properties: {
            status: { type: 'string', 'x-enum-source': 'states[].id', description: 'Lifecycle state' }
          }
        }
      }]
    ]);

    applyEnumSourceInjections(currentResults);
    const field = currentResults.get('test-openapi.yaml').Item.properties.status;
    assert.deepStrictEqual(field.enum, ['pending', 'in_progress', 'completed']);
    assert.strictEqual(field['x-enum-source'], undefined);
  });

  await t.test('applyEnumSourceInjections - object form with machine scopes to correct machine', () => {
    const currentResults = new Map([
      ['test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        machines: [
          { object: 'Widget', states: [{ id: 'draft' }, { id: 'submitted' }, { id: 'closed' }] },
          { object: 'Part', states: [{ id: 'pending' }, { id: 'satisfied' }, { id: 'waived' }] }
        ]
      }],
      ['test-openapi.yaml', {
        Widget: {
          properties: {
            status: { type: 'string', 'x-enum-source': { source: 'states[].id', machine: 'Widget' } }
          }
        },
        Part: {
          properties: {
            status: { type: 'string', 'x-enum-source': { source: 'states[].id', machine: 'Part' } }
          }
        }
      }]
    ]);

    const warnings = applyEnumSourceInjections(currentResults);
    assert.strictEqual(warnings.length, 0);

    const resolved = currentResults.get('test-openapi.yaml');
    assert.deepStrictEqual(resolved.Widget.properties.status.enum, ['draft', 'submitted', 'closed']);
    assert.deepStrictEqual(resolved.Part.properties.status.enum, ['pending', 'satisfied', 'waived']);
    assert.strictEqual(resolved.Widget.properties.status['x-enum-source'], undefined);
    assert.strictEqual(resolved.Part.properties.status['x-enum-source'], undefined);
  });

  await t.test('applyEnumSourceInjections - warns when machine name not found in index', () => {
    const currentResults = new Map([
      ['test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        machines: [
          { object: 'Widget', states: [{ id: 'draft' }] }
        ]
      }],
      ['test-openapi.yaml', {
        Schema: {
          properties: {
            status: { type: 'string', 'x-enum-source': { source: 'states[].id', machine: 'UnknownMachine' } }
          }
        }
      }]
    ]);

    const warnings = applyEnumSourceInjections(currentResults);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('UnknownMachine'));
  });

  await t.test('applyEnumSourceInjections - warns on missing collection', () => {
    const currentResults = new Map([
      ['test-state-machine.yaml', {
        '$schema': 'state-machine-schema.yaml',
        states: [{ id: 'pending' }]
      }],
      ['some-openapi.yaml', {
        Schema: {
          properties: {
            code: { type: 'string', 'x-enum-source': 'unknownCollection[].id' }
          }
        }
      }]
    ]);

    const warnings = applyEnumSourceInjections(currentResults);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('unknownCollection'));
  });

  await t.test('applyEnumSourceInjections - warns on invalid syntax', () => {
    const currentResults = new Map([
      ['test-sla-types.yaml', { '$schema': 'sla-types-schema.yaml', slaTypes: [{ id: 'type_a' }] }],
      ['some-openapi.yaml', {
        Schema: {
          properties: {
            code: { type: 'string', 'x-enum-source': 'bad-syntax' }
          }
        }
      }]
    ]);

    const warnings = applyEnumSourceInjections(currentResults);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('invalid syntax'));
  });

  await t.test('applyEnumSourceInjections - no-ops when no behavioral yamls present', () => {
    const currentResults = new Map([
      ['some-openapi.yaml', {
        Schema: { properties: { code: { type: 'string', 'x-enum-source': 'slaTypes[].id' } } }
      }]
    ]);

    const warnings = applyEnumSourceInjections(currentResults);
    assert.strictEqual(warnings.length, 0);
    // Annotation should remain untouched since there's nothing to inject
    const field = currentResults.get('some-openapi.yaml').Schema.properties.code;
    assert.strictEqual(field['x-enum-source'], 'slaTypes[].id');
  });

  // ===========================================================================
  // injectPrefixInStateMachine
  // ===========================================================================

  await t.test('injectPrefixInStateMachine - prepends prefix to machine events and emit steps', () => {
    const spec = {
      machines: [{
        object: 'Widget',
        events: [{ type: 'test.widget.submitted', steps: [] }],
        actions: [{
          id: 'submit',
          steps: [{ emit: { type: 'test.widget.submitted', data: {} } }]
        }]
      }]
    };

    const result = injectPrefixInStateMachine(spec, 'org.example.');

    assert.strictEqual(result.machines[0].events[0].type, 'org.example.test.widget.submitted');
    assert.strictEqual(result.machines[0].actions[0].steps[0].emit.type, 'org.example.test.widget.submitted');
  });

  await t.test('injectPrefixInStateMachine - passes through unchanged when no machines array', () => {
    const spec = { domain: 'test', context: null };
    const result = injectPrefixInStateMachine(spec, 'org.example.');
    assert.deepStrictEqual(result, spec);
  });

  await t.test('injectPrefixInStateMachine - does not mutate the original spec', () => {
    const spec = {
      machines: [{ object: 'Widget', actions: [{ id: 'submit', steps: [{ emit: { type: 'test.widget.submitted' } }] }] }]
    };
    injectPrefixInStateMachine(spec, 'org.example.');
    assert.strictEqual(spec.machines[0].actions[0].steps[0].emit.type, 'test.widget.submitted');
  });

  await t.test('injectPrefixInStateMachine - prepends prefix to emit steps nested in then/do/forEach.do', () => {
    const spec = {
      machines: [{
        object: 'Widget',
        actions: [{
          id: 'route',
          steps: [{
            if: '$object.isExpedited == true',
            then: [{ emit: { type: 'test.widget.expedited' } }],
            else: [{ emit: { type: 'test.widget.standard' } }]
          }]
        }]
      }]
    };

    const result = injectPrefixInStateMachine(spec, 'org.example.');
    const ifStep = result.machines[0].actions[0].steps[0];
    assert.strictEqual(ifStep.then[0].emit.type, 'org.example.test.widget.expedited');
    assert.strictEqual(ifStep.else[0].emit.type, 'org.example.test.widget.standard');
  });

  // ===========================================================================
  // injectPrefixInAsyncApi
  // ===========================================================================

  await t.test('injectPrefixInAsyncApi - prepends prefix to channel addresses and message names', () => {
    const spec = {
      channels: {
        'test.widget.submitted': {
          address: 'test.widget.submitted',
          messages: {}
        }
      },
      components: {
        messages: {
          WidgetSubmitted: { name: 'test.widget.submitted' }
        },
        schemas: {}
      }
    };

    const result = injectPrefixInAsyncApi(spec, 'org.example.');

    assert.ok('org.example.test.widget.submitted' in result.channels);
    assert.strictEqual(result.channels['org.example.test.widget.submitted'].address, 'org.example.test.widget.submitted');
    assert.strictEqual(result.components.messages.WidgetSubmitted.name, 'org.example.test.widget.submitted');
  });

  await t.test('injectPrefixInAsyncApi - passes through unchanged when no channels', () => {
    const spec = { asyncapi: '3.0.0', info: { title: 'Test', version: '1.0.0' } };
    const result = injectPrefixInAsyncApi(spec, 'org.example.');
    assert.deepStrictEqual(result, spec);
  });

  await t.test('injectPrefixInAsyncApi - does not mutate the original spec', () => {
    const spec = {
      channels: { 'test.widget.submitted': { address: 'test.widget.submitted' } }
    };
    injectPrefixInAsyncApi(spec, 'org.example.');
    assert.ok('test.widget.submitted' in spec.channels);
  });

  // ===========================================================================
  // Policy file overlay support
  // ===========================================================================

  await t.test('applyOverlayWithTargets - overlay can update an existing platform policy', () => {
    const dir = createTmpDir();
    try {
      writeYaml(dir, 'test-registry-policies.yaml', {
        version: '1.0',
        policies: {
          'test-policy-alpha': {
            citation: '§ 1.1',
            description: 'All members of group alpha.',
            programs: ['program_a']
          },
          'test-policy-beta': {
            citation: '§ 1.2',
            description: 'Any member may apply for program_a benefits.',
            programs: ['program_a']
          }
        }
      });

      const yamlFiles = [
        {
          relativePath: 'test-registry-policies.yaml',
          sourcePath: join(dir, 'test-registry-policies.yaml'),
          spec: yaml.load(readFileSync(join(dir, 'test-registry-policies.yaml'), 'utf8'))
        }
      ];

      const overlay = {
        overlay: '1.0.0',
        info: { title: 'Test state overlay', version: '1.0.0' },
        actions: [
          {
            target: '$.policies.test-policy-alpha.description',
            update: 'All members of group alpha — state-specific definition.'
          }
        ]
      };

      const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
      const { actionTargets } = resolveActionTargets(actionFileMap);
      const { results } = applyOverlayWithTargets(yamlFiles, overlay, actionTargets, dir);

      const resolved = results.get('test-registry-policies.yaml');
      assert.strictEqual(
        resolved.policies['test-policy-alpha'].description,
        'All members of group alpha — state-specific definition.'
      );
      // Unchanged policy should be unaffected
      assert.strictEqual(resolved.policies['test-policy-beta'].citation, '§ 1.2');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('applyOverlayWithTargets - overlay can add a state-specific policy to the registry', () => {
    const dir = createTmpDir();
    try {
      writeYaml(dir, 'test-registry-policies.yaml', {
        version: '1.0',
        policies: {
          'test-policy-alpha': {
            citation: '§ 1.1',
            description: 'All members of group alpha.',
            programs: ['program_a']
          }
        }
      });

      const yamlFiles = [
        {
          relativePath: 'test-registry-policies.yaml',
          sourcePath: join(dir, 'test-registry-policies.yaml'),
          spec: yaml.load(readFileSync(join(dir, 'test-registry-policies.yaml'), 'utf8'))
        }
      ];

      const overlay = {
        overlay: '1.0.0',
        info: { title: 'Test state overlay', version: '1.0.0' },
        actions: [
          {
            target: '$.policies',
            update: {
              'state-policy-gamma': {
                citation: '§ 2.1',
                description: 'State-specific adjustment for qualifying households.',
                programs: ['program_a']
              }
            }
          }
        ]
      };

      const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
      const { actionTargets } = resolveActionTargets(actionFileMap);
      const { results } = applyOverlayWithTargets(yamlFiles, overlay, actionTargets, dir);

      const resolved = results.get('test-registry-policies.yaml');
      assert.ok(resolved.policies['state-policy-gamma'], 'State-specific policy should be present');
      assert.strictEqual(resolved.policies['state-policy-gamma'].citation, '§ 2.1');
      // Platform policy should be unaffected
      assert.strictEqual(resolved.policies['test-policy-alpha'].citation, '§ 1.1');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  // ===========================================================================
  // rewriteBaseRefs
  // ===========================================================================

  await t.test('rewriteBaseRefs - rewrites canonical URI ref in root-level spec', () => {
    const spec = {
      paths: {
        '/items': {
          get: {
            parameters: [{ $ref: 'https://blueprint.codeforamerica.org/base/components/parameters.yaml#/LimitParam' }]
          }
        }
      }
    };
    const result = rewriteBaseRefs(spec, 'items-openapi.yaml');
    const ref = result.paths['/items'].get.parameters[0].$ref;
    assert.strictEqual(ref, 'base/components/parameters.yaml#/LimitParam');
  });

  await t.test('rewriteBaseRefs - rewrites canonical URI ref in nested spec', () => {
    const spec = {
      paths: {
        '/items': {
          get: {
            parameters: [{ $ref: 'https://blueprint.codeforamerica.org/base/components/parameters.yaml#/LimitParam' }]
          }
        }
      }
    };
    const result = rewriteBaseRefs(spec, 'domains/test/test-openapi.yaml');
    const ref = result.paths['/items'].get.parameters[0].$ref;
    assert.strictEqual(ref, '../../base/components/parameters.yaml#/LimitParam');
  });

  await t.test('rewriteBaseRefs - preserves fragment', () => {
    const spec = { $ref: 'https://blueprint.codeforamerica.org/base/schemas/enums.yaml#/$defs/RoleType' };
    const result = rewriteBaseRefs(spec, 'foo-openapi.yaml');
    assert.strictEqual(result.$ref, 'base/schemas/enums.yaml#/$defs/RoleType');
  });

  await t.test('rewriteBaseRefs - handles ref without fragment', () => {
    const spec = { $ref: 'https://blueprint.codeforamerica.org/base/components/responses.yaml' };
    const result = rewriteBaseRefs(spec, 'foo-openapi.yaml');
    assert.strictEqual(result.$ref, 'base/components/responses.yaml');
  });

  await t.test('rewriteBaseRefs - leaves non-blueprint refs unchanged', () => {
    const spec = {
      $ref: './components/responses.yaml#/BadRequest',
      other: { $ref: '#/components/schemas/Foo' }
    };
    const result = rewriteBaseRefs(spec, 'foo-openapi.yaml');
    assert.strictEqual(result.$ref, './components/responses.yaml#/BadRequest');
    assert.strictEqual(result.other.$ref, '#/components/schemas/Foo');
  });

  await t.test('rewriteBaseRefs - rewrites multiple refs in one spec', () => {
    const spec = {
      a: { $ref: 'https://blueprint.codeforamerica.org/base/components/parameters.yaml#/SortParam' },
      b: { $ref: 'https://blueprint.codeforamerica.org/base/schemas/enums.yaml#/$defs/Status' }
    };
    const result = rewriteBaseRefs(spec, 'foo-openapi.yaml');
    assert.strictEqual(result.a.$ref, 'base/components/parameters.yaml#/SortParam');
    assert.strictEqual(result.b.$ref, 'base/schemas/enums.yaml#/$defs/Status');
  });

  // ===========================================================================
  // Canonical URI end-to-end (resolve pipeline)
  // ===========================================================================

  await t.test('resolve rewrites canonical blueprint URIs and copies base contracts to output', async () => {
    const { spawnSync } = await import('child_process');
    const { existsSync } = await import('fs');

    const dir = createTmpDir();
    try {
      // Spec using canonical blueprint URI ref
      writeYaml(join(dir, 'spec'), 'items-openapi.yaml', {
        openapi: '3.1.0',
        info: { title: 'Items', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              parameters: [{ $ref: 'https://blueprint.codeforamerica.org/base/components/parameters.yaml#/LimitParam' }],
              responses: { '200': { description: 'ok' } }
            }
          }
        }
      });

      // Minimal overlay (no x-base needed)
      writeYaml(join(dir, 'overlay'), 'config.yaml', {
        overlay: '1.0.0',
        info: { title: 'Test config', version: '1.0.0' },
        actions: []
      });

      const outDir = join(dir, 'out');
      const resolveScript = join(__dirname, '..', 'scripts', 'resolve.js');

      const result = spawnSync(
        process.execPath,
        [resolveScript, `--spec=${join(dir, 'spec')}`, `--overlay=${join(dir, 'overlay')}`, `--out=${outDir}`],
        { encoding: 'utf8' }
      );

      assert.strictEqual(result.status, 0, `resolve failed:\n${result.stderr}`);

      // Blueprint-core base contracts should be copied into out/base/
      assert.ok(
        existsSync(join(outDir, 'base', 'components', 'parameters.yaml')),
        'base contracts should be copied to out/base/'
      );

      // The spec in out/ should have the canonical URI rewritten to a real relative path
      const outSpec = yaml.load(readFileSync(join(outDir, 'items-openapi.yaml'), 'utf8'));
      const ref = outSpec.paths['/items'].get.parameters[0].$ref;
      assert.strictEqual(ref, 'base/components/parameters.yaml#/LimitParam');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

});
