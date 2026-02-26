/**
 * Unit tests for resolve-overlay.js
 * Tests overlay discovery, target-api/target-version disambiguation,
 * version extraction from filenames, environment filtering,
 * and placeholder substitution.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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
  generateRpcOverlays
} from '../../scripts/resolve.js';

// Use checkPathExists from the overlay module (same as the script does)
import { checkPathExists } from '../../src/overlay/overlay-resolver.js';

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
    assert.strictEqual(getVersionFromFilename('applications.yaml'), 1);
    assert.strictEqual(getVersionFromFilename('persons.yaml'), 1);
  });

  await t.test('getVersionFromFilename - v2 suffix returns 2', () => {
    assert.strictEqual(getVersionFromFilename('applications-v2.yaml'), 2);
  });

  await t.test('getVersionFromFilename - v3 suffix returns 3', () => {
    assert.strictEqual(getVersionFromFilename('persons-v3.yaml'), 3);
  });

  await t.test('getVersionFromFilename - handles nested paths', () => {
    assert.strictEqual(getVersionFromFilename('components/applications-v2.yaml'), 2);
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
        relativePath: 'persons.yaml',
        spec: {
          info: { 'x-api-id': 'persons-api' },
          components: { schemas: { Person: { properties: { name: { type: 'string' } } } } }
        }
      },
      {
        relativePath: 'applications.yaml',
        spec: {
          info: { 'x-api-id': 'applications-api' },
          components: { schemas: { Person: { properties: { name: { type: 'string' } } } } }
        }
      }
    ];

    const overlay = {
      actions: [
        {
          target: '$.components.schemas.Person.properties.name',
          'target-api': 'persons-api',
          update: { maxLength: 100 }
        }
      ]
    };

    const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

    assert.strictEqual(warnings.length, 0);
    const targets = actionTargets.get(0);
    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0], 'persons.yaml');
  });

  await t.test('target-api - no match produces warning', () => {
    const yamlFiles = [
      {
        relativePath: 'persons.yaml',
        spec: {
          info: { 'x-api-id': 'persons-api' },
          components: { schemas: { Person: { properties: { name: { type: 'string' } } } } }
        }
      }
    ];

    const overlay = {
      actions: [
        {
          target: '$.components.schemas.Person.properties.name',
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
        domain: 'test',
        object: 'Item',
        apiSpec: 'test-openapi.yaml',
        states: { draft: {}, published: {} },
        initialState: 'draft',
        transitions: [
          { trigger: 'publish', from: 'draft', to: 'published' }
        ],
        requestBodies: { publish: {} }
      });

      // Collect yaml files the same way resolve.js does
      const yamlFiles = [
        {
          relativePath: 'test-openapi.yaml',
          spec: yaml.load(readFileSync(join(dir, 'test-openapi.yaml'), 'utf8'))
        }
      ];

      const rpcOverlays = generateRpcOverlays(dir, yamlFiles);

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
        domain: 'test',
        object: 'Item',
        apiSpec: 'test-openapi.yaml',
        states: { draft: {}, published: {} },
        initialState: 'draft',
        transitions: [
          { trigger: 'publish', from: 'draft', to: 'published' },
          { trigger: 'archive', from: 'published', to: 'draft' }
        ],
        requestBodies: { publish: {}, archive: {} }
      });

      const yamlFiles = [
        {
          relativePath: 'test-openapi.yaml',
          spec: yaml.load(readFileSync(join(dir, 'test-openapi.yaml'), 'utf8'))
        }
      ];

      const rpcOverlays = generateRpcOverlays(dir, yamlFiles);
      assert.strictEqual(rpcOverlays.length, 1);

      // Now apply the overlay through the full pipeline
      const { overlay } = rpcOverlays[0];
      const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
      const { actionTargets } = resolveActionTargets(actionFileMap);
      const results = applyOverlayWithTargets(yamlFiles, overlay, actionTargets, dir);

      const resolved = results.get('test-openapi.yaml');
      assert.ok(resolved.paths['/items/{itemId}/publish'], 'Should have publish RPC path');
      assert.ok(resolved.paths['/items/{itemId}/archive'], 'Should have archive RPC path');
      assert.strictEqual(resolved.paths['/items/{itemId}/publish'].post.operationId, 'publishItem');
      assert.strictEqual(resolved.paths['/items/{itemId}/archive'].post.operationId, 'archiveItem');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('generateRpcOverlays - returns empty when no state machines exist', () => {
    const dir = createTmpDir();
    try {
      writeYaml(dir, 'test-openapi.yaml', { openapi: '3.1.0', info: { title: 'Test' } });
      const yamlFiles = [{ relativePath: 'test-openapi.yaml', spec: { openapi: '3.1.0' } }];
      const result = generateRpcOverlays(dir, yamlFiles);
      assert.strictEqual(result.length, 0);
    } finally {
      rmSync(dir, { recursive: true });
    }
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
        domain: 'test',
        object: 'Item',
        apiSpec: 'test-openapi.yaml',
        states: { draft: {}, published: {} },
        initialState: 'draft',
        transitions: [{ trigger: 'publish', from: 'draft', to: 'published' }],
        requestBodies: { publish: {} }
      });

      const yamlFiles = [{
        relativePath: 'test-openapi.yaml',
        spec: yaml.load(readFileSync(join(dir, 'test-openapi.yaml'), 'utf8'))
      }];

      const rpcOverlays = generateRpcOverlays(dir, yamlFiles);
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
