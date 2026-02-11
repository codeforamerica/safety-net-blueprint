/**
 * Unit tests for resolve-overlay.js
 * Tests overlay discovery, target-api/target-version disambiguation,
 * and version extraction from filenames.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import {
  discoverOverlayFiles,
  analyzeTargetLocations,
  resolveActionTargets,
  getVersionFromFilename
} from '../../scripts/resolve-overlay.js';

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

});
