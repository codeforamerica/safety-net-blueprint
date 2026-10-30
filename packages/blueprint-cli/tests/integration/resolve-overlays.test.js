/**
 * Integration tests for blueprint-resolve's --overlay, given more than once.
 *
 * A package's contracts can depend on the package's own overlays —
 * safety-net-contracts adds its roles that way — so a state resolving them
 * applies the package's overlays and then its own. One --overlay meant
 * copying the package's files into the state's folder (#478).
 *
 * Overlays reach everything generated from the contracts, not only the
 * documents they target: a ruleset's compiled graph, which the engine runs
 * (#467), and the rules API, events AsyncAPI and endpoints generated from
 * rules, state machines and compositions (#500).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOLVE = join(__dirname, '../../scripts/resolve.js');
const HARNESS = join(__dirname, '../../../blueprint-harness/contracts');

const overlay = (title, update) => yaml.dump({
  overlay: '1.0.0',
  info: { title, version: '1.0.0' },
  actions: [{ target: '$.info.description', file: 'demo-openapi.yaml', update }],
});

describe('blueprint-resolve --overlay', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-overlays-'));
    mkdirSync(join(dir, 'spec'));
    writeFileSync(join(dir, 'spec/demo-openapi.yaml'), yaml.dump({
      openapi: '3.1.0',
      info: { title: 'Demo', version: '1.0.0', 'x-domain': 'demo', description: 'As written.' },
      paths: {},
    }));
    mkdirSync(join(dir, 'package-overlays'));
    writeFileSync(join(dir, 'package-overlays/package.yaml'), overlay('The package', 'From the package.'));
    mkdirSync(join(dir, 'state-overlays'));
    writeFileSync(join(dir, 'state-overlays/state.yaml'), overlay('The state', 'From the state.'));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const resolve = (...args) => spawnSync(process.execPath, [RESOLVE, `--spec=${join(dir, 'spec')}`, ...args], { encoding: 'utf8' });
  const description = (out) => yaml.load(readFileSync(join(out, 'demo-openapi.yaml'), 'utf8')).info.description;

  test('given more than once, applies each in the order given', () => {
    const out = join(dir, 'out-package-then-state');
    const { status, stderr } = resolve(`--overlay=${join(dir, 'package-overlays')}`, `--overlay=${join(dir, 'state-overlays')}`, `--out=${out}`);
    assert.equal(status, 0, stderr);
    assert.equal(description(out), 'From the state.');
  });

  test('the order decides which applies last', () => {
    const out = join(dir, 'out-state-then-package');
    const { status, stderr } = resolve(`--overlay=${join(dir, 'state-overlays')}`, `--overlay=${join(dir, 'package-overlays')}`, `--out=${out}`);
    assert.equal(status, 0, stderr);
    assert.equal(description(out), 'From the package.');
  });

  test('--spec given twice is refused, not silently replaced', () => {
    const { status, stderr } = spawnSync(process.execPath, [RESOLVE, '--spec=a', '--spec=b', `--out=${join(dir, 'x')}`], { encoding: 'utf8' });
    assert.notEqual(status, 0);
    assert.match(stderr, /--spec is given more than once/);
  });
});

describe('blueprint-resolve compiles rules graphs after overlays', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-graph-overlays-'));
    mkdirSync(join(dir, 'spec'));
    writeFileSync(join(dir, 'spec/demo-rules.yaml'), yaml.dump({
      $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
      domain: 'demo',
      rulesets: {
        hours: {
          endpoint: { path: '/hours' },
          inputs: { person: { type: 'object', properties: { hoursWorked: { type: 'number' } } } },
          constants: { monthlyHoursRequired: { value: 80 } },
          outputs: { meetsHours: {}, worksAtAll: {} },
          facts: [
            { path: 'meetsHours', expression: 'person.hoursWorked >= constants.monthlyHoursRequired' },
            { path: 'worksAtAll', expression: 'person.hoursWorked > 0.0' },
          ],
        },
      },
    }));
    mkdirSync(join(dir, 'state-overlays'));
    writeFileSync(join(dir, 'state-overlays/state.yaml'), yaml.dump({
      overlay: '1.0.0',
      info: { title: 'The state', version: '1.0.0' },
      actions: [
        { target: '$.rulesets.hours.constants.monthlyHoursRequired.value', file: 'demo-rules.yaml', update: 100 },
        { target: '$.rulesets.hours.outputs.worksAtAll', file: 'demo-rules.yaml', remove: true },
        { target: "$.rulesets.hours.facts[?(@.path=='worksAtAll')]", file: 'demo-rules.yaml', remove: true },
      ],
    }));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('the graph has the overlay\'s constants, outputs and facts, as the rules document does', () => {
    const out = join(dir, 'out');
    const { status, stderr } = spawnSync(process.execPath, [
      RESOLVE, `--spec=${join(dir, 'spec')}`, `--overlay=${join(dir, 'state-overlays')}`, `--out=${out}`,
    ], { encoding: 'utf8' });
    assert.equal(status, 0, stderr);

    const rules = yaml.load(readFileSync(join(out, 'demo-rules.yaml'), 'utf8')).rulesets.hours;
    const graph = yaml.load(readFileSync(join(out, 'demo-hours-graph.yaml'), 'utf8'));
    assert.equal(rules.constants.monthlyHoursRequired.value, 100, 'the rules document has the overlay');
    assert.equal(graph.constants.monthlyHoursRequired.value, 100);
    assert.deepEqual(graph.outputs, ['meetsHours']);
    assert.deepEqual(Object.keys(graph.facts), ['meetsHours']);
  });
});

describe('blueprint-resolve generates from the contracts as overlaid', () => {
  // The harness contracts, with a state overlay changing what each generated
  // document is built from.
  let dir;
  let out;
  let result;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-generated-overlays-'));
    out = join(dir, 'out');
    mkdirSync(join(dir, 'state-overlays'));
    writeFileSync(join(dir, 'state-overlays/state.yaml'), yaml.dump({
      overlay: '1.0.0',
      info: { title: 'The state', version: '1.0.0' },
      actions: [
        { target: '$.rulesets.expeditedSnap.endpoint.path', file: 'domains/eligibility/eligibility-rules.yaml', update: '/screenings/evaluate-expedited-snap' },
        { target: '$.compositions.applicationSummary.endpoint.path', file: 'domains/intake/intake-compositions.yaml', update: '/applications/{applicationId}/overview' },
        { target: "$.machines[?(@.object=='Determination')].emits[?(@.id=='complete')].description", file: 'domains/eligibility/eligibility-state-machine.yaml', update: 'Sent when every program has a decision.' },
      ],
    }));
    result = spawnSync(process.execPath, [
      RESOLVE, `--spec=${HARNESS}`, `--overlay=${join(HARNESS, 'overlays')}`, `--overlay=${join(dir, 'state-overlays')}`,
      `--env-variables=${join(HARNESS, '../environments/local.env')}`, `--out=${out}`,
    ], { encoding: 'utf8' });
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const read = (path) => yaml.load(readFileSync(join(out, path), 'utf8'));

  test('resolves', () => {
    assert.equal(result.status, 0, result.stderr);
  });

  test('the rules API documents the endpoint where the overlay moved it', () => {
    const paths = Object.keys(read('domains/eligibility/eligibility-rules-openapi.yaml').paths);
    // The last segment stays, so the scenario calling it by its operationId still finds it.
    assert.ok(paths.includes('/screenings/evaluate-expedited-snap'), paths.join(', '));
    assert.ok(!paths.includes('/determinations/evaluate-expedited-snap'));
  });

  test('the composition\'s endpoint is generated where the overlay moved it', () => {
    const paths = Object.keys(read('domains/intake/intake-openapi.yaml').paths);
    assert.ok(paths.includes('/applications/{applicationId}/overview'), 'the moved endpoint');
    assert.ok(!paths.includes('/applications/{applicationId}/summary'), 'not the base one');
  });

  test('the events AsyncAPI describes the event as the overlay does', () => {
    const text = readFileSync(join(out, 'domains/eligibility/eligibility-events-asyncapi.yaml'), 'utf8');
    assert.match(text, /Sent when every program has a decision\./);
  });
});
