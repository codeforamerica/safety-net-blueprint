/**
 * Unit tests for the state machine loader
 * Tests discovery and parsing of state machine YAML files
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { discoverStateMachines } from '../../src/state-machine-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createTempDir() {
  const tmpDir = join(__dirname, `tmp-sm-loader-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function removeTempDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

test('discoverStateMachines — discovers valid state machine files', () => {
  const tmpDir = createTempDir();
  try {
    const smContent = `
domain: workflow
object: Task
apiSpec: workflow-openapi.yaml
states:
  pending: {}
  in_progress: {}
initialState: pending
transitions:
  - trigger: claim
    from: pending
    to: in_progress
`;
    writeFileSync(join(tmpDir, 'workflow-state-machine.yaml'), smContent, 'utf8');
    // Also write a non-state-machine file that should be ignored
    writeFileSync(join(tmpDir, 'workflow-openapi.yaml'), 'openapi: 3.1.0', 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].domain, 'workflow');
    assert.strictEqual(results[0].object, 'Task');
    assert.strictEqual(results[0].apiSpec, 'workflow-openapi.yaml');
    assert.ok(results[0].stateMachine);
    assert.ok(results[0].filePath.includes('workflow-state-machine.yaml'));
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — returns empty array for empty directory', () => {
  const tmpDir = createTempDir();
  try {
    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 0);
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — returns empty array for nonexistent directory', () => {
  const results = discoverStateMachines('/nonexistent/path/that/does/not/exist');
  assert.strictEqual(results.length, 0);
});

test('discoverStateMachines — skips files missing domain', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'bad-state-machine.yaml'), 'object: Task\nstates: {}', 'utf8');
    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 0);
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — skips files missing object', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'bad-state-machine.yaml'), 'domain: test\nstates: {}', 'utf8');
    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 0);
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — skips invalid YAML', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'invalid-state-machine.yaml'), '{{invalid yaml:::', 'utf8');
    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 0);
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — discovers multiple state machines', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'workflow-state-machine.yaml'),
      'domain: workflow\nobject: Task\nstates: {}\ntransitions: []', 'utf8');
    writeFileSync(join(tmpDir, 'intake-state-machine.yaml'),
      'domain: intake\nobject: Application\nstates: {}\ntransitions: []', 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 2);

    const domains = results.map(r => r.domain).sort();
    assert.deepStrictEqual(domains, ['intake', 'workflow']);
  } finally {
    removeTempDir(tmpDir);
  }
});
