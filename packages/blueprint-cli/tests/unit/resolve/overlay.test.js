/**
 * Unit tests for the CLI's resolve script.
 *
 * Only what remains the CLI's own concern after the pipeline moved into
 * blueprint-core: finding overlay files on disk, reading an env file, and
 * rewriting canonical blueprint URIs to relative paths at write time.
 *
 * Overlay targeting, environment filtering, variable substitution, enum
 * injection, event prefixing and ref alignment are tested in
 * blueprint-core/tests/unit/resolve/ and .../generate/ against the passes
 * themselves.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import {
  discoverOverlayFiles,
  parseEnvFile,
  rewriteBaseRefs,
} from '../../../scripts/resolve.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
test('resolve-overlay tests', async (t) => {

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
      const resolveScript = join(__dirname, '../../..', 'scripts', 'resolve.js');

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
