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
import { evaluate } from '@codeforamerica/blueprint-rules-engine';
import { graphFor } from '../rulesets.js';
import { scenariosFor } from '../scenarios.js';

const graph = graphFor('snapWorkRequirements');

/** A list of exemption codes is a set: the order is the rules' own, and nothing depends on it. */
const sorted = (value) => (Array.isArray(value) ? [...value].sort() : value);

describe('SNAP work requirements cases', () => {
  for (const c of scenariosFor('snapWorkRequirements')) {
    test(c.state ? `${c.id} (${c.state})` : c.id, () => {
      const nodes = evaluate(c.state ? graphFor('snapWorkRequirements', c.state) : graph, c.inputs);
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

describe('SNAP work requirements, why they don\'t apply', () => {
  test('names the age cutoff, or says they apply', () => {
    const reason = (age) => evaluate(graph, { person: { age } }).notApplicableReason.value;
    assert.equal(reason(16), 'under_minimum_age');
    assert.equal(reason(70), 'over_maximum_age');
    assert.equal(reason(30), 'applies');
  });
});

describe('SNAP work requirements, what they ask', () => {
  test('someone who doesn\'t work, volunteer or train is never asked how many hours', () => {
    const nodes = evaluate(graph, { person: { age: 30, isWorking: false, isVolunteer: false, isInWorkTraining: false } });
    assert.deepEqual([nodes.meetsRequirement.state, nodes.meetsRequirement.value], ['complete', false]);
  });
});
