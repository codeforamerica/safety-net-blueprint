/**
 * Unit tests for overlay config discovery, validation, and defaults.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { extractConfig, validateConfig, getConfigDefaults } from '../../src/overlay/config.js';

function createTmpDir() {
  const dir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeOverlay(dir, filename, config, actions = []) {
  const overlay = { overlay: '1.0.0', info: { title: filename, version: '1.0.0' }, actions };
  if (config !== undefined) {
    overlay.config = config;
  }
  const filePath = join(dir, filename);
  writeFileSync(filePath, yaml.dump(overlay));
  return filePath;
}

test('config tests', async (t) => {

  // ===========================================================================
  // extractConfig
  // ===========================================================================

  await t.test('extractConfig - finds config in an overlay file', () => {
    const dir = createTmpDir();
    try {
      const f = writeOverlay(dir, 'state.yaml', { 'x-casing': 'snake_case' });
      const { config, errors } = extractConfig([f]);
      assert.deepStrictEqual(config, { 'x-casing': 'snake_case' });
      assert.strictEqual(errors.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('extractConfig - merges config from multiple overlay files', () => {
    const dir = createTmpDir();
    try {
      const f1 = writeOverlay(dir, 'casing.yaml', { 'x-casing': 'snake_case' });
      const f2 = writeOverlay(dir, 'pagination.yaml', { 'x-pagination': { style: 'cursor' } });
      const { config, errors } = extractConfig([f1, f2]);
      assert.deepStrictEqual(config, {
        'x-casing': 'snake_case',
        'x-pagination': { style: 'cursor' }
      });
      assert.strictEqual(errors.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('extractConfig - errors when same key appears in multiple files', () => {
    const dir = createTmpDir();
    try {
      const f1 = writeOverlay(dir, 'a.yaml', { 'x-casing': 'snake_case' });
      const f2 = writeOverlay(dir, 'b.yaml', { 'x-casing': 'camelCase' });
      const { errors } = extractConfig([f1, f2]);
      assert.strictEqual(errors.length, 1);
      assert.ok(errors[0].includes('x-casing'));
      assert.ok(errors[0].includes('multiple files'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('extractConfig - returns null config when no overlay files have config', () => {
    const dir = createTmpDir();
    try {
      const f = writeOverlay(dir, 'no-config.yaml', undefined);
      const { config, errors } = extractConfig([f]);
      assert.strictEqual(config, null);
      assert.strictEqual(errors.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('extractConfig - works with a single overlay file', () => {
    const dir = createTmpDir();
    try {
      const f = writeOverlay(dir, 'single.yaml', {
        'x-casing': 'snake_case',
        'x-pagination': { style: 'cursor' },
        'x-search': { style: 'filtered' },
        'x-relationship': { style: 'embed' }
      });
      const { config, errors } = extractConfig([f]);
      assert.deepStrictEqual(config, {
        'x-casing': 'snake_case',
        'x-pagination': { style: 'cursor' },
        'x-search': { style: 'filtered' },
        'x-relationship': { style: 'embed' }
      });
      assert.strictEqual(errors.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // validateConfig
  // ===========================================================================

  await t.test('validateConfig - accepts valid config with all known keys', () => {
    const config = {
      'x-casing': 'snake_case',
      'x-pagination': { style: 'cursor' },
      'x-search': { style: 'filtered' },
      'x-relationship': { style: 'embed' }
    };
    const { errors, warnings } = validateConfig(config);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('validateConfig - accepts partial config (subset of keys)', () => {
    const { errors, warnings } = validateConfig({ 'x-casing': 'camelCase' });
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('validateConfig - errors on invalid style values', () => {
    const { errors } = validateConfig({ 'x-pagination': { style: 'infinite-scroll' } });
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('x-pagination.style'));
    assert.ok(errors[0].includes('infinite-scroll'));
  });

  await t.test('validateConfig - errors on invalid x-casing value', () => {
    const { errors } = validateConfig({ 'x-casing': 'SCREAMING_SNAKE' });
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('x-casing'));
    assert.ok(errors[0].includes('SCREAMING_SNAKE'));
  });

  await t.test('validateConfig - warns on unknown config keys', () => {
    const { errors, warnings } = validateConfig({ 'x-custom-thing': 'foo' });
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('x-custom-thing'));
  });

  await t.test('validateConfig - accepts empty config', () => {
    const { errors, warnings } = validateConfig({});
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(warnings.length, 0);
  });

  // ===========================================================================
  // getConfigDefaults
  // ===========================================================================

  await t.test('getConfigDefaults - returns expected defaults', () => {
    const defaults = getConfigDefaults();
    assert.deepStrictEqual(defaults, {
      'x-casing': 'camelCase',
      'x-pagination': { style: 'offset' },
      'x-search': { style: 'simple' },
      'x-relationship': { style: 'links-only' }
    });
  });
});
