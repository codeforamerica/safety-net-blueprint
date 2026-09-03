import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { loadAnnotations } from '../../src/annotations.js';
import { loadPolicies } from '../../src/policies.js';

function createTmpDir() {
  const dir = join(tmpdir(), `annotations-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('loadAnnotations', async (t) => {
  await t.test('returns empty sections when no files found', () => {
    const dir = createTmpDir();
    try {
      const result = loadAnnotations('nonexistent', dir);
      assert.deepStrictEqual(result, { schema: {}, operations: {}, events: {} });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('loads schema, operations, and events sections', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'intake-annotations.yaml'), yaml.dump({
        domain: 'intake',
        schema: { 'Application.programs': { programs: ['snap'] } },
        operations: { 'application.submit': { policies: ['snap-processing-clock'] } },
        events: { 'intake.application.submitted': { programs: ['snap'] } },
      }));
      const result = loadAnnotations('intake', dir);
      assert.deepStrictEqual(result.schema['Application.programs'], { programs: ['snap'] });
      assert.deepStrictEqual(result.operations['application.submit'], { policies: ['snap-processing-clock'] });
      assert.deepStrictEqual(result.events['intake.application.submitted'], { programs: ['snap'] });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('merges multiple annotation files in filename order', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'intake-annotations.yaml'), yaml.dump({
        schema: { 'Application.programs': { programs: ['snap'] } },
      }));
      writeFileSync(join(dir, 'intake-annotations-state.yaml'), yaml.dump({
        schema: { 'Application.countyCode': { programs: ['snap'] } },
      }));
      const result = loadAnnotations('intake', dir);
      assert.ok(result.schema['Application.programs']);
      assert.ok(result.schema['Application.countyCode']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('deep-merges same field path across files — does not overwrite', () => {
    // Regression: Object.assign overwrote entire entries; spread merge combines per-key fields.
    // A structured file (programs, policies) and a docs file (reason, modeling) for the same
    // field path should both survive in the merged result.
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'intake-annotations.yaml'), yaml.dump({
        schema: { 'application.programs': { programs: ['snap'], policies: ['snap-cat'] } },
      }));
      writeFileSync(join(dir, 'intake-annotations-docs.yaml'), yaml.dump({
        schema: { 'application.programs': { reason: 'Determines eligibility', modeling: 'Array of program codes' } },
      }));
      const result = loadAnnotations('intake', dir);
      const entry = result.schema['application.programs'];
      assert.deepStrictEqual(entry.programs, ['snap'], 'programs from first file should survive');
      assert.deepStrictEqual(entry.policies, ['snap-cat'], 'policies from first file should survive');
      assert.strictEqual(entry.reason, 'Determines eligibility', 'reason from second file should survive');
      assert.strictEqual(entry.modeling, 'Array of program codes', 'modeling from second file should survive');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('accepts a fileMap and matches on content.domain field', () => {
    const fileMap = new Map();
    fileMap.set('/fake/intake-annotations.yaml', {
      content: {
        domain: 'intake',
        schema: { 'Application.status': { programs: ['snap'] } },
        operations: {},
        events: {},
      },
      type: 'annotations',
      relativePath: 'intake-annotations.yaml',
      domain: 'intake',
    });
    fileMap.set('/fake/workflow-annotations.yaml', {
      content: {
        domain: 'workflow',
        schema: { 'Task.status': { programs: ['snap'] } },
        operations: {},
        events: {},
      },
      type: 'annotations',
      relativePath: 'workflow-annotations.yaml',
      domain: 'workflow',
    });

    const result = loadAnnotations('intake', fileMap);
    assert.deepStrictEqual(result.schema['Application.status'], { programs: ['snap'] });
    assert.ok(!result.schema['Task.status'], 'workflow annotation should not appear for intake domain');
  });

  await t.test('fileMap path returns empty sections when no matching domain', () => {
    const fileMap = new Map();
    fileMap.set('/fake/workflow-annotations.yaml', {
      content: { domain: 'workflow', schema: { 'Task.status': {} }, operations: {}, events: {} },
      type: 'annotations',
      relativePath: 'workflow-annotations.yaml',
      domain: 'workflow',
    });
    const result = loadAnnotations('intake', fileMap);
    assert.deepStrictEqual(result, { schema: {}, operations: {}, events: {} });
  });
});

test('loadPolicies', async (t) => {
  await t.test('returns empty object when no files found', () => {
    const dir = createTmpDir();
    try {
      const result = loadPolicies(dir);
      assert.deepStrictEqual(result, {});
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('loads policies from a policies file', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'platform-policies.yaml'), yaml.dump({
        policies: {
          'snap-processing-clock': {
            citation: '7 CFR § 273.2(g)(1)',
            description: 'Processing deadline.',
            programs: ['snap'],
          },
        },
      }));
      const result = loadPolicies(dir);
      assert.ok(result['snap-processing-clock']);
      assert.strictEqual(result['snap-processing-clock'].citation, '7 CFR § 273.2(g)(1)');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('merges multiple policy files in filename order', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'platform-policies.yaml'), yaml.dump({
        policies: { 'policy-a': { citation: 'A', description: 'A desc.' } },
      }));
      writeFileSync(join(dir, 'platform-policies-state.yaml'), yaml.dump({
        policies: { 'policy-b': { citation: 'B', description: 'B desc.' } },
      }));
      const result = loadPolicies(dir);
      assert.ok(result['policy-a']);
      assert.ok(result['policy-b']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
