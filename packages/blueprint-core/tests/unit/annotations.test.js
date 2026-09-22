import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { loadAnnotations } from '../../src/annotations.js';
import { registryEntries, registryTypes } from '../../src/registries.js';

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
      assert.deepStrictEqual(result, { schema: {}, operations: {}, events: {}, facts: {}, registryTypes: new Set() });
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

  await t.test('loads facts section', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'intake-annotations.yaml'), yaml.dump({
        domain: 'intake',
        facts: {
          incomeInconsistency: { guidance: 'Ask about unreported income sources.' },
          abawdMembers: { guidance: 'Confirm ABAWD exemption or refer to SNAP E&T.', policies: ['snap-abawd'] },
        },
      }));
      const result = loadAnnotations('intake', dir);
      assert.deepStrictEqual(result.facts['incomeInconsistency'], { guidance: 'Ask about unreported income sources.' });
      assert.deepStrictEqual(result.facts['abawdMembers'].policies, ['snap-abawd']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('deep-merges facts across files', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'intake-annotations.yaml'), yaml.dump({
        facts: { incomeInconsistency: { policies: ['snap-income'] } },
      }));
      writeFileSync(join(dir, 'intake-annotations-guidance.yaml'), yaml.dump({
        facts: { incomeInconsistency: { guidance: 'Ask about unreported income.' } },
      }));
      const result = loadAnnotations('intake', dir);
      const entry = result.facts['incomeInconsistency'];
      assert.deepStrictEqual(entry.policies, ['snap-income']);
      assert.strictEqual(entry.guidance, 'Ask about unreported income.');
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
    assert.deepStrictEqual(result, { schema: {}, operations: {}, events: {}, facts: {}, registryTypes: new Set() });
  });
});

// Registries are generic: core knows the format, not which types exist.
// 'policies' is used here only because it is a realistic type name.
test('registryEntries', async (t) => {
  const registry = (type, entries) => ({
    path: `/tmp/platform-registry-${type}.yaml`,
    relativePath: `platform-registry-${type}.yaml`,
    type: 'registry',
    content: { $schema: 'registry-schema.yaml', version: '1.0', type, entries },
  });

  await t.test('returns empty object when no registry of that type exists', () => {
    assert.deepStrictEqual(registryEntries([], 'policies'), {});
  });

  await t.test('returns entries, preserving type-specific fields', () => {
    const docs = [registry('policies', {
      'snap-processing-clock': {
        citation: '7 CFR § 273.2(g)(1)',
        description: 'Processing deadline.',
        programs: ['snap'],
      },
    })];

    const result = registryEntries(docs, 'policies');
    assert.strictEqual(result['snap-processing-clock'].citation, '7 CFR § 273.2(g)(1)');
    assert.deepStrictEqual(result['snap-processing-clock'].programs, ['snap']);
  });

  await t.test('merges registries of the same type, later overriding earlier', () => {
    const docs = [
      registry('policies', { 'policy-a': { description: 'A.' }, shared: { description: 'baseline.' } }),
      registry('policies', { 'policy-b': { description: 'B.' }, shared: { description: 'state override.' } }),
    ];

    const result = registryEntries(docs, 'policies');
    assert.ok(result['policy-a']);
    assert.ok(result['policy-b']);
    assert.strictEqual(result.shared.description, 'state override.');
  });

  await t.test('ignores registries of other types', () => {
    const docs = [
      registry('policies', { 'policy-a': { description: 'A.' } }),
      registry('patterns', { 'pattern-a': { description: 'P.' } }),
    ];

    assert.deepStrictEqual(Object.keys(registryEntries(docs, 'policies')), ['policy-a']);
    assert.deepStrictEqual(Object.keys(registryEntries(docs, 'patterns')), ['pattern-a']);
  });

  await t.test('reports every declared type without knowing them in advance', () => {
    const docs = [registry('policies', { a: { description: 'A.' } }), registry('design-patterns', { b: { description: 'B.' } })];
    assert.deepStrictEqual(registryTypes(docs), new Set(['policies', 'design-patterns']));
  });
});
