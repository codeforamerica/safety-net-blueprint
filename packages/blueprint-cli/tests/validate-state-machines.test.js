/**
 * Unit tests for validate/state-machines.js helpers.
 * Tests use fixture data in temp directories — no real contracts files.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { discoverStateMachines } from '../scripts/validate/state-machines.js';

// ---------------------------------------------------------------------------
// discoverStateMachines
// ---------------------------------------------------------------------------

describe('discoverStateMachines', () => {
  const SCHEMA = 'https://blueprint.codeforamerica.org/schemas/state-machine-schema.yaml';

  test('finds files with $schema: state-machine-schema.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snb-test-'));
    try {
      writeFileSync(join(dir, 'my-state-machine.yaml'), yaml.dump({
        $schema: SCHEMA,
        machines: [{ object: 'Application', states: [] }],
      }));
      const found = discoverStateMachines(dir);
      assert.equal(found.length, 1);
      assert.equal(found[0].file, 'my-state-machine.yaml');
      assert.ok(found[0].doc.machines);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('ignores files without the state-machine $schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snb-test-'));
    try {
      writeFileSync(join(dir, 'not-a-state-machine.yaml'), yaml.dump({
        openapi: '3.1.0',
        info: { title: 'Test', version: '1.0.0' },
      }));
      const found = discoverStateMachines(dir);
      assert.equal(found.length, 0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('walks subdirectories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snb-test-'));
    try {
      mkdirSync(join(dir, 'intake'));
      writeFileSync(join(dir, 'intake/intake-state-machine.yaml'), yaml.dump({
        $schema: SCHEMA,
        machines: [{ object: 'Application', states: [] }],
      }));
      const found = discoverStateMachines(dir);
      assert.equal(found.length, 1);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('reports parse errors without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snb-test-'));
    try {
      writeFileSync(join(dir, 'broken-state-machine.yaml'), ': invalid: yaml: [');
      // discoverStateMachines captures parse errors in the result so main() can report them
      const found = discoverStateMachines(dir);
      assert.equal(found.length, 1);
      assert.ok(found[0].parseError, 'parse error message should be captured');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
