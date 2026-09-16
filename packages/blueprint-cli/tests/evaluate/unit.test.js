/**
 * Behavioral tests for the blueprint-evaluate CLI.
 *
 * Tests CLI behavior: exit codes, output structure, error messages, and flag handling.
 * For byte-for-byte output comparisons against committed goldens, see golden.test.js.
 *
 * Fixture inputs:  tests/fixtures/alerts-rules.yaml
 *                  tests/fixtures/alerts-rules-examples.yaml
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/evaluate.js');
const SHARED = join(__dirname, '../fixtures');

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('blueprint-evaluate CLI — rules doc', () => {
  test('outputs a flat nodes map with type and state on each fact', () => {
    const { status, stdout } = run(
      `--spec=${SHARED}/alerts-rules.yaml`,
      '--ruleset=urgency',
      `--input=${JSON.stringify({ notice: { status: 'sent', daysSinceCreated: 5 }, policy: { urgencyThresholdDays: 3 } })}`,
    );
    assert.equal(status, 0);
    const nodes = JSON.parse(stdout);
    assert.ok('isUrgent' in nodes, 'isUrgent fact should be present');
    assert.ok('urgencyLevel' in nodes, 'urgencyLevel fact should be present');
    assert.equal(nodes.isUrgent.type, 'output');
    assert.equal(nodes.isUrgent.state, 'complete');
    assert.equal(nodes.isUrgent.value, true);
  });

  test('missing inputs produce state: missing on dependent facts', () => {
    const { status, stdout } = run(
      `--spec=${SHARED}/alerts-rules.yaml`,
      '--ruleset=urgency',
      `--input=${JSON.stringify({ notice: { status: 'sent' }, policy: { urgencyThresholdDays: 3 } })}`,
    );
    assert.equal(status, 0);
    const nodes = JSON.parse(stdout);
    const missingFacts = Object.values(nodes).filter(n => n.state === 'missing');
    assert.ok(missingFacts.length > 0, 'some facts should be missing');
  });

  test('--input as inline JSON string', () => {
    const { status, stdout } = run(
      `--spec=${SHARED}/alerts-rules.yaml`,
      '--ruleset=urgency',
      `--input=${JSON.stringify({ notice: { status: 'sent', daysSinceCreated: 5 }, policy: { urgencyThresholdDays: 3 } })}`,
    );
    assert.equal(status, 0);
    const nodes = JSON.parse(stdout);
    assert.equal(nodes.isUrgent.value, true);
  });

  test('defaults to empty inputs when --input is omitted', () => {
    const { status, stdout } = run(
      `--spec=${SHARED}/alerts-rules.yaml`,
      '--ruleset=urgency',
    );
    assert.equal(status, 0);
    const nodes = JSON.parse(stdout);
    const missingFacts = Object.values(nodes).filter(n => n.state === 'missing');
    assert.ok(missingFacts.length > 0, 'all facts should be missing with no inputs');
  });

  test('exits 1 when file does not exist', () => {
    const { status, stderr } = run('--spec=nonexistent.yaml');
    assert.equal(status, 1);
    assert.match(stderr, /Could not read/);
  });

  test('exits 1 for an unknown --engine value', () => {
    const { status, stderr } = run(
      `--spec=${SHARED}/alerts-rules.yaml`,
      '--ruleset=urgency',
      '--engine=unknown',
    );
    assert.equal(status, 1);
    assert.match(stderr, /--engine must be/);
  });

  test('defaults to first ruleset when --ruleset is omitted', () => {
    const { status, stdout } = run(
      `--spec=${SHARED}/alerts-rules.yaml`,
      `--input=${JSON.stringify({ notice: { status: 'sent' }, policy: { urgencyThresholdDays: 3 } })}`,
    );
    assert.equal(status, 0);
    const nodes = JSON.parse(stdout);
    assert.equal(nodes.isUrgent.value, null);
  });

  test('exits 1 when --ruleset names a ruleset that does not exist', () => {
    const { status, stderr } = run(
      `--spec=${SHARED}/alerts-rules.yaml`,
      '--ruleset=nonexistent',
    );
    assert.equal(status, 1);
    assert.match(stderr, /not found/);
  });

  test('exits 1 when <file> is missing', () => {
    const { status, stderr } = run();
    assert.equal(status, 1);
    assert.match(stderr, /<file> is required/);
  });
});

describe('blueprint-evaluate CLI — rules examples file (batch mode)', () => {
  test('outputs one object per ruleset with an array of node maps per example', () => {
    const { status, stdout, stderr } = run(`--spec=${SHARED}/alerts-rules-examples.yaml`);
    assert.equal(status, 0, `script failed:\n${stderr}`);
    const output = JSON.parse(stdout);
    assert.ok('urgency' in output, 'output should have urgency ruleset');
    assert.ok(Array.isArray(output.urgency), 'ruleset output should be an array');
    assert.equal(output.urgency.length, 2, 'should have one entry per example');
  });

  test('first example (full inputs) produces complete facts', () => {
    const { status, stdout } = run(`--spec=${SHARED}/alerts-rules-examples.yaml`);
    assert.equal(status, 0);
    const output = JSON.parse(stdout);
    const firstExample = output.urgency[0];
    assert.equal(firstExample.isUrgent.state, 'complete');
    assert.equal(firstExample.isUrgent.value, true);
  });

  test('second example (partial inputs) produces missing facts', () => {
    const { status, stdout } = run(`--spec=${SHARED}/alerts-rules-examples.yaml`);
    assert.equal(status, 0);
    const output = JSON.parse(stdout);
    const secondExample = output.urgency[1];
    const missingFacts = Object.values(secondExample).filter(n => n.state === 'missing');
    assert.ok(missingFacts.length > 0, 'some facts should be missing');
  });

  test('each example result contains type and state on each fact', () => {
    const { status, stdout } = run(`--spec=${SHARED}/alerts-rules-examples.yaml`);
    assert.equal(status, 0);
    const output = JSON.parse(stdout);
    for (const exampleResult of output.urgency) {
      for (const node of Object.values(exampleResult)) {
        assert.ok('type' in node, 'each fact node should have a type');
        assert.ok('state' in node, 'each fact node should have a state');
      }
    }
  });
});
