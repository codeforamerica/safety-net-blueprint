import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../scripts/evaluate.js');
const FIXTURES = join(__dirname, 'fixtures/evaluate');

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('blueprint-evaluate CLI', () => {
  test('outputs valid JSON with the four result buckets on success', () => {
    const { status, stdout } = run(
      `--graph=${FIXTURES}/simple-graph.yaml`,
      `--inputs=${FIXTURES}/inputs-full.json`,
    );
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.ok('complete' in result);
    assert.ok('placeholder' in result);
    assert.ok('missing' in result);
    assert.ok('errors' in result);
  });

  test('missing facts appear in the missing bucket when inputs are partial', () => {
    const { status, stdout } = run(
      `--graph=${FIXTURES}/simple-graph.yaml`,
      `--inputs=${FIXTURES}/inputs-partial.json`,
    );
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.ok(Object.keys(result.missing).length > 0);
  });

  test('multiple --inputs files are merged', () => {
    const { status, stdout } = run(
      `--graph=${FIXTURES}/simple-graph.yaml`,
      `--inputs=${FIXTURES}/inputs-partial.json`,
      `--inputs=${FIXTURES}/inputs-full.json`,
    );
    assert.equal(status, 0);
    const result = JSON.parse(stdout);
    assert.equal(Object.keys(result.missing).length, 0);
  });

  test('exits 1 when --graph is missing', () => {
    const { status, stderr } = run(`--inputs=${FIXTURES}/inputs-full.json`);
    assert.equal(status, 1);
    assert.match(stderr, /--graph is required/);
  });

  test('exits 1 when the graph file does not exist', () => {
    const { status, stderr } = run('--graph=nonexistent.yaml');
    assert.equal(status, 1);
    assert.match(stderr, /Could not read/);
  });

  test('exits 1 for an unknown --engine value', () => {
    const { status, stderr } = run(
      `--graph=${FIXTURES}/simple-graph.yaml`,
      '--engine=unknown',
    );
    assert.equal(status, 1);
    assert.match(stderr, /--engine must be/);
  });
});
