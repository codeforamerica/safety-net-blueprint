/**
 * The SNAP work requirements ruleset against its cases.
 *
 * Each case in tests/scenarios/snap-work-requirements.yaml gives some answers
 * and the values facts must take. The ruleset gives nothing a default, so
 * every question a case doesn't answer takes the answer that grants nothing,
 * from the fixture's `unanswered` block. A value of null means not decided:
 * the fact is missing.
 *
 * A case for a state runs against the rules with that state's file in
 * states/ applied.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { evaluate } from '@codeforamerica/blueprint-rules-engine';
import { graphFor } from '../rulesets.js';

const here = dirname(fileURLToPath(import.meta.url));
const { unanswered, cases } = yaml.load(readFileSync(join(here, '..', 'scenarios', 'snap-work-requirements.yaml'), 'utf8'));
const graph = graphFor('snapWorkRequirements');

/**
 * A case's answers, with every question it leaves out answered so it grants
 * nothing, North Carolina's own questions included for a case there. Age has
 * no such answer.
 */
const inputsOf = (person, state) => ({
  person: { ...unanswered.person, ...(state === 'NC' ? unanswered.northCarolina : {}), ...person },
});

/** A list of exemption codes is a set: the order is the rules' own, and nothing depends on it. */
const sorted = (value) => (Array.isArray(value) ? [...value].sort() : value);

describe('SNAP work requirements cases', () => {
  for (const c of cases) {
    test(c.state ? `${c.name} (${c.state})` : c.name, () => {
      const nodes = evaluate(c.state ? graphFor('snapWorkRequirements', c.state) : graph, inputsOf(c.person, c.state));
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
