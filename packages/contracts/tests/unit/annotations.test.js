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

  await t.test('loads real intake annotations from contracts', () => {
    const result = loadAnnotations('intake');
    assert.ok(Object.keys(result.schema).length > 0, 'schema should have entries');
    assert.ok(Object.keys(result.operations).length > 0, 'operations should have entries');
    assert.ok(Object.keys(result.events).length > 0, 'events should have entries');
    assert.ok(result.schema['ApplicationMember.dateOfBirth'], 'should include dateOfBirth annotation');
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

  await t.test('loads policies from a registry file', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'platform-registry-policies.yaml'), yaml.dump({
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
      writeFileSync(join(dir, 'platform-registry-policies.yaml'), yaml.dump({
        policies: { 'policy-a': { citation: 'A', description: 'A desc.' } },
      }));
      writeFileSync(join(dir, 'platform-registry-policies-state.yaml'), yaml.dump({
        policies: { 'policy-b': { citation: 'B', description: 'B desc.' } },
      }));
      const result = loadPolicies(dir);
      assert.ok(result['policy-a']);
      assert.ok(result['policy-b']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('loads real policies from contracts', () => {
    const result = loadPolicies();
    assert.ok(Object.keys(result).length > 0, 'should have policies');
    assert.ok(result['snap-processing-clock'], 'should include snap-processing-clock');
    assert.ok(result['snap-processing-clock'].citation, 'policy should have citation');
    assert.ok(result['snap-processing-clock'].description, 'policy should have description');
  });
});
