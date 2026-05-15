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

// =============================================================================
// New format — machines array
// =============================================================================

test('discoverStateMachines — new format: returns one entry per machine', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'intake-state-machine.yaml'), `
domain: intake
machines:
  - object: Application
    transitions: []
  - object: Verification
    transitions: []
`, 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].object, 'Application');
    assert.strictEqual(results[1].object, 'Verification');
    assert.strictEqual(results[0].domain, 'intake');
    assert.strictEqual(results[1].domain, 'intake');
    // machine points to the per-object entry, not the whole doc
    assert.strictEqual(results[0].machine.object, 'Application');
    assert.strictEqual(results[1].machine.object, 'Verification');
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — new format: skips machine entry missing object', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'test-state-machine.yaml'), `
domain: test
machines:
  - object: Task
    transitions: []
  - transitions: []
`, 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].object, 'Task');
  } finally {
    removeTempDir(tmpDir);
  }
});

// =============================================================================
// resolveExtends
// =============================================================================

test('discoverStateMachines — resolveExtends: populates _platformGuards and _platformProcedures', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'platform-state-machine.yaml'), `
guards:
  - id: callerIsSystem
    condition: '"system" in caller.roles'
procedures:
  - id: requestTimer
    description: Platform timer helper
`, 'utf8');

    writeFileSync(join(tmpDir, 'workflow-state-machine.yaml'), `
domain: workflow
extends: ./platform-state-machine.yaml
machines:
  - object: Task
    transitions: []
`, 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 1);
    const { stateMachine } = results[0];
    assert.ok(Array.isArray(stateMachine._platformGuards));
    assert.strictEqual(stateMachine._platformGuards.length, 1);
    assert.strictEqual(stateMachine._platformGuards[0].id, 'callerIsSystem');
    assert.ok(Array.isArray(stateMachine._platformProcedures));
    assert.strictEqual(stateMachine._platformProcedures[0].id, 'requestTimer');
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — resolveExtends: missing extends file does not throw', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'workflow-state-machine.yaml'), `
domain: workflow
extends: ./nonexistent-platform.yaml
machines:
  - object: Task
    transitions: []
`, 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].stateMachine._platformGuards, undefined);
  } finally {
    removeTempDir(tmpDir);
  }
});

// =============================================================================
// resolveRequestBodyRefs
// =============================================================================

test('discoverStateMachines — resolveRequestBodyRefs: resolves schema.request $ref', () => {
  const tmpDir = createTempDir();
  const schemasDir = join(tmpDir, 'schemas');
  mkdirSync(schemasDir);
  try {
    writeFileSync(join(schemasDir, 'workflow-schema.yaml'), `
$defs:
  CloseRequest:
    type: object
    required: [reason]
    properties:
      reason:
        type: string
`, 'utf8');

    writeFileSync(join(tmpDir, 'workflow-state-machine.yaml'), `
domain: workflow
machines:
  - object: Task
    transitions:
      - id: close
        schema:
          request:
            $ref: "./schemas/workflow-schema.yaml#/$defs/CloseRequest"
        guards: []
        transition: {from: open, to: closed}
        steps: []
`, 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 1);
    const transition = results[0].machine.transitions[0];
    assert.strictEqual(transition.schema.request.type, 'object');
    assert.deepStrictEqual(transition.schema.request.required, ['reason']);
    assert.ok(!transition.schema.request.$ref, '$ref should be replaced by resolved schema');
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — resolveRequestBodyRefs: unresolvable $ref is left unchanged', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'workflow-state-machine.yaml'), `
domain: workflow
machines:
  - object: Task
    transitions:
      - id: close
        schema:
          request:
            $ref: "./schemas/missing.yaml#/$defs/CloseRequest"
        guards: []
        transition: {from: open, to: closed}
        steps: []
`, 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 1);
    const transition = results[0].machine.transitions[0];
    assert.ok(transition.schema.request.$ref, '$ref should remain when file is missing');
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — resolveRequestBodyRefs: inline schema is not modified', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'workflow-state-machine.yaml'), `
domain: workflow
machines:
  - object: Task
    transitions:
      - id: close
        schema:
          request:
            type: object
            required: [reason]
        guards: []
        transition: {from: open, to: closed}
        steps: []
`, 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 1);
    const transition = results[0].machine.transitions[0];
    assert.strictEqual(transition.schema.request.type, 'object');
    assert.deepStrictEqual(transition.schema.request.required, ['reason']);
  } finally {
    removeTempDir(tmpDir);
  }
});
