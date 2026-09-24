/**
 * Integration tests for the blueprint-evaluate CLI.
 *
 * Tests evaluate-specific behaviors: output structure, batch mode, ruleset
 * selection, and engine flag handling.
 *
 * For generic CLI behaviors (missing args, unknown flags), see cli-behavior.test.js.
 * For golden output comparison, see golden/evaluate.test.js.
 *
 * Contract inputs: packages/blueprint-harness/contracts/domains/eligibility/
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contractsDir } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/evaluate.js');
const ELIGIBILITY = join(contractsDir, 'domains/eligibility');
const RULES = join(ELIGIBILITY, 'eligibility-rules.yaml');
const EXAMPLES = join(ELIGIBILITY, 'eligibility-rules-examples.yaml');

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('blueprint-evaluate CLI — rules doc', () => {
  it('outputs a flat nodes map where each fact has type and state', () => {
    const { status, stdout, stderr } = run(`--spec=${RULES}`, '--ruleset=expeditedSnap');
    assert.equal(status, 0, `script failed:\n${stderr}`);
    const nodes = JSON.parse(stdout);
    assert.ok(Object.keys(nodes).length > 0, 'output should have at least one fact');
    for (const [name, node] of Object.entries(nodes)) {
      assert.ok('type' in node, `fact ${name} should have a type`);
      assert.ok('state' in node, `fact ${name} should have a state`);
    }
  });

  it('missing inputs produce state: missing on dependent facts', () => {
    const { status, stdout } = run(`--spec=${RULES}`, '--ruleset=expeditedSnap');
    assert.equal(status, 0);
    const nodes = JSON.parse(stdout);
    const missingFacts = Object.values(nodes).filter(n => n.state === 'missing');
    assert.ok(missingFacts.length > 0, 'some facts should be missing with no inputs');
  });

  it('provided inputs produce complete facts', () => {
    const input = JSON.stringify({
      household: { monthlyGrossIncome: 120, liquidResources: 75, monthlyShelterCost: 800, isMigrantFarmworker: false },
      policy: { incomeThreshold: 150, resourceThreshold: 100 },
    });
    const { status, stdout } = run(`--spec=${RULES}`, '--ruleset=expeditedSnap', `--input=${input}`);
    assert.equal(status, 0);
    const nodes = JSON.parse(stdout);
    const completeFacts = Object.values(nodes).filter(n => n.state === 'complete');
    assert.ok(completeFacts.length > 0, 'some facts should be complete with valid inputs');
  });

  it('--input as inline JSON string is accepted', () => {
    const { status } = run(`--spec=${RULES}`, '--ruleset=expeditedSnap', '--input={}');
    assert.equal(status, 0);
  });

  it('defaults to first ruleset when --ruleset is omitted', () => {
    const { status, stdout, stderr } = run(`--spec=${RULES}`);
    assert.equal(status, 0, `script failed:\n${stderr}`);
    const nodes = JSON.parse(stdout);
    assert.ok(Object.keys(nodes).length > 0, 'should return facts for the first ruleset');
  });

  it('exits 1 when --ruleset names a ruleset that does not exist', () => {
    const { status, stderr } = run(`--spec=${RULES}`, '--ruleset=nonexistent');
    assert.equal(status, 1);
    assert.match(stderr, /not found/);
  });

  it('exits 1 when file does not exist', () => {
    const { status, stderr } = run('--spec=nonexistent.yaml');
    assert.equal(status, 1);
    assert.match(stderr, /Could not read/);
  });

  it('exits 1 for an unknown --engine value', () => {
    const { status, stderr } = run(`--spec=${RULES}`, '--ruleset=expeditedSnap', '--engine=unknown');
    assert.equal(status, 1);
    assert.match(stderr, /--engine must be/);
  });
});

describe('blueprint-evaluate CLI — rules examples file (batch mode)', () => {
  it('outputs one object per ruleset with an array of node maps per example', () => {
    const { status, stdout, stderr } = run(`--spec=${EXAMPLES}`);
    assert.equal(status, 0, `script failed:\n${stderr}`);
    const output = JSON.parse(stdout);
    assert.ok(typeof output === 'object' && output !== null, 'output should be an object');
    const rulesets = Object.keys(output);
    assert.ok(rulesets.length > 0, 'output should have at least one ruleset');
    for (const [ruleset, examples] of Object.entries(output)) {
      assert.ok(Array.isArray(examples), `${ruleset} output should be an array`);
      assert.ok(examples.length > 0, `${ruleset} should have at least one example`);
    }
  });

  it('each example result contains facts with type and state', () => {
    const { status, stdout } = run(`--spec=${EXAMPLES}`);
    assert.equal(status, 0);
    const output = JSON.parse(stdout);
    for (const [, examples] of Object.entries(output)) {
      for (const exampleResult of examples) {
        for (const [name, node] of Object.entries(exampleResult)) {
          assert.ok('type' in node, `fact ${name} should have a type`);
          assert.ok('state' in node, `fact ${name} should have a state`);
        }
      }
    }
  });
});
