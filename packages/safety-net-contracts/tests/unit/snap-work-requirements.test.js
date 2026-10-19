/**
 * The SNAP work requirements ruleset against its cases.
 *
 * Each case in tests/scenarios/snap-work-requirements.yaml gives some answers
 * and the values facts must take. The ruleset gives nothing a default, so
 * every question a case doesn't answer takes the answer that grants nothing,
 * from the fixture's `unanswered` block. A value of null means not decided:
 * the fact is missing.
 *
 * Cases for a state wait for the state overlays; until then they are listed
 * as todo.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { discover, load, generate } from '@codeforamerica/blueprint-core';
import { evaluate } from '@codeforamerica/blueprint-rules-engine';

const here = dirname(fileURLToPath(import.meta.url));
const specArg = process.argv.find((a) => a.startsWith('--spec='));
const CONTRACTS_DIR = specArg ? specArg.slice('--spec='.length) : resolve(here, '..', '..', 'src');

const { unanswered, cases } = yaml.load(readFileSync(join(here, '..', 'scenarios', 'snap-work-requirements.yaml'), 'utf8'));
const graph = generate(discover(CONTRACTS_DIR).map(load), 'graph')
  .find(({ graph }) => graph.ruleset === 'snapWorkRequirements').graph;

/** A case's answers, with every question it leaves out answered so it grants nothing. Age has no such answer. */
const inputsOf = (person) => ({ person: { ...unanswered.person, ...person } });

/** A list of exemption codes is a set: the order is the rules' own, and nothing depends on it. */
const sorted = (value) => (Array.isArray(value) ? [...value].sort() : value);

describe('SNAP work requirements cases', () => {
  for (const c of cases) {
    if (c.state) {
      test.todo(`${c.name} (${c.state}): waits for the state overlays`);
      continue;
    }

    test(c.name, () => {
      const nodes = evaluate(graph, inputsOf(c.person));
      for (const [fact, expected] of Object.entries(c.expect)) {
        const node = nodes[fact];
        if (expected === null) {
          assert.equal(node?.state, 'missing', `${fact} is not decided: ${JSON.stringify(node)}`);
          continue;
        }
        assert.ok(node && node.state !== 'missing' && node.state !== 'error', `${fact}: ${JSON.stringify(node)}`);
        assert.deepEqual(sorted(node.value), sorted(expected), fact);
      }
    });
  }
});
