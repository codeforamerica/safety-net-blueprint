/**
 * Integration tests for the blueprint-evaluate CLI.
 *
 * Tests evaluate-specific behaviors: a graph file with inputs or with a rules
 * examples file, refusing files that can't be evaluated on their own, and
 * failing on facts that come back as errors.
 *
 * For generic CLI behaviors (missing args, unknown flags), see cli-behavior.test.js.
 * For golden output comparison, see golden/evaluate.test.js.
 *
 * Contract inputs: packages/blueprint-harness/generated/resolved/
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { generate, load } from '@codeforamerica/blueprint-core';

import { contractsDir, resolvedDir } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/evaluate.js');
const GRAPH = join(resolvedDir, 'domains/eligibility/eligibility-expeditedSnap-graph.yaml');
const FLAGS_GRAPH = join(resolvedDir, 'domains/intake/intake-interviewFlags-graph.yaml');
const FLAGS_EXAMPLES = join(resolvedDir, 'domains/intake/intake-rules-examples.yaml');
const RULES = join(contractsDir, 'domains/eligibility/eligibility-rules.yaml');
const EXAMPLES = join(contractsDir, 'domains/eligibility/eligibility-rules-examples.yaml');

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('blueprint-evaluate CLI — a graph file', () => {
  it('outputs a flat nodes map where each fact has type and state', () => {
    const { status, stdout, stderr } = run(`--spec=${GRAPH}`);
    assert.equal(status, 0, `script failed:\n${stderr}`);
    const nodes = JSON.parse(stdout);
    assert.ok(Object.keys(nodes).length > 0, 'output should have at least one fact');
    for (const [name, node] of Object.entries(nodes)) {
      assert.ok('type' in node, `fact ${name} should have a type`);
      assert.ok('state' in node, `fact ${name} should have a state`);
    }
  });

  it('missing inputs produce state: missing on dependent facts', () => {
    const { status, stdout } = run(`--spec=${GRAPH}`);
    assert.equal(status, 0);
    assert.ok(Object.values(JSON.parse(stdout)).some((n) => n.state === 'missing'));
  });

  it('provided inputs produce complete facts', () => {
    const input = JSON.stringify({
      household: { monthlyGrossIncome: 120, liquidResources: 75, monthlyShelterCost: 800, isMigrantFarmworker: false },
    });
    const { status, stdout } = run(`--spec=${GRAPH}`, `--input=${input}`);
    assert.equal(status, 0);
    assert.ok(Object.values(JSON.parse(stdout)).some((n) => n.state === 'complete'));
  });

  it('exits 1 when the file does not exist', () => {
    const { status, stderr } = run('--spec=nonexistent.yaml');
    assert.equal(status, 1);
    assert.match(stderr, /Could not read/);
  });

  it('exits 1 for an argument it doesn\'t take', () => {
    const { status, stderr } = run(`--spec=${GRAPH}`, '--engine=cel');
    assert.equal(status, 1);
    assert.match(stderr, /Unknown argument: --engine=cel/);
  });
});

describe('blueprint-evaluate CLI — a graph with examples', () => {
  it('evaluates each example declared for the graph\'s ruleset, one result per example', () => {
    const { status, stdout, stderr } = run(`--spec=${FLAGS_GRAPH}`, `--examples=${FLAGS_EXAMPLES}`);
    assert.equal(status, 0, `script failed:\n${stderr}`);
    const results = JSON.parse(stdout);
    assert.equal(results.length, 2);
    for (const nodes of results) assert.ok('risks.earnedIncomeVaries' in nodes);
  });

  it('evaluates a date from a schema another file declares as a date', () => {
    // Compiled from the rules file alone, the shared household's dateOfBirth
    // reached CEL as a string and both age flags came back as errors.
    const { status, stdout } = run(`--spec=${FLAGS_GRAPH}`, `--examples=${FLAGS_EXAMPLES}`);
    assert.equal(status, 0);
    const [first] = JSON.parse(stdout);
    assert.equal(first['risks.elderlyOrDisabledWithoutMedicalCosts'].state, 'complete');
    assert.equal(first['risks.childrenAndEarnersWithoutDependentCare'].state, 'complete');
  });

  it('refuses an examples file with none for the graph\'s ruleset', () => {
    const { status, stderr } = run(`--spec=${GRAPH}`, `--examples=${FLAGS_EXAMPLES}`);
    assert.equal(status, 1);
    assert.match(stderr, /declares examples for domain "intake", but the graph is for "eligibility"|declares no examples for ruleset "expeditedSnap"/);
  });

  it('refuses --input and --examples together', () => {
    const { status, stderr } = run(`--spec=${FLAGS_GRAPH}`, `--examples=${FLAGS_EXAMPLES}`, '--input={}');
    assert.equal(status, 1);
    assert.match(stderr, /can't be combined/);
  });
});

describe('blueprint-evaluate CLI — files that can\'t be evaluated on their own', () => {
  it('refuses a rules file, pointing at its graphs', () => {
    const { status, stderr } = run(`--spec=${RULES}`);
    assert.equal(status, 1);
    assert.match(stderr, /rules file, which can't be evaluated on its own/);
  });

  it('refuses a rules examples file, saying to pass it as --examples with a graph', () => {
    const { status, stderr } = run(`--spec=${EXAMPLES}`);
    assert.equal(status, 1);
    assert.match(stderr, /with this file as --examples/);
  });
});

describe('blueprint-evaluate CLI — a fact that errors', () => {
  let dir;
  before(() => {
    // Compiled by core, as resolve compiles one, from a ruleset whose fact
    // multiplies a string — which parses, and fails when evaluated.
    dir = mkdtempSync(join(tmpdir(), 'evaluate-errors-'));
    const rulesPath = join(dir, 'demo-rules.yaml');
    writeFileSync(rulesPath, yaml.dump({
      $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
      domain: 'demo',
      rulesets: {
        broken: {
          endpoint: { path: '/evaluate-broken' },
          inputs: { name: { type: 'string' } },
          facts: [{ path: 'doubled', expression: 'name * 2', type: { type: 'number' } }],
          outputs: { doubled: { type: 'number' } },
        },
      },
    }));
    const [{ graph }] = generate([load({ path: rulesPath, relativePath: 'demo-rules.yaml' })], 'graph');
    writeFileSync(join(dir, 'broken-graph.yaml'), yaml.dump(graph));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('is named on stderr, and the run exits 1', () => {
    const { status, stdout, stderr } = run(`--spec=${join(dir, 'broken-graph.yaml')}`, '--input={"name":"Ada"}');
    assert.equal(status, 1);
    assert.ok(JSON.parse(stdout).doubled, 'the answer is still printed');
    assert.match(stderr, /1 fact\(s\) could not be evaluated/);
    assert.match(stderr, /broken: doubled:/);
  });
});
