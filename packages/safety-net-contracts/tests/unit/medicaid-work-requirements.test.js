/**
 * The Medicaid work requirements ruleset against its scenarios.
 *
 * Each scenario in tests/scenarios/medicaid-work-requirements.yaml gives some
 * answers and the results they must produce. The ruleset gives nothing a
 * default, so every question a scenario doesn't answer takes the answer that
 * grants nothing, from the fixture's `unanswered` block.
 *
 * A scenario for a state runs against the rules with that state's file in
 * states/ applied.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '@codeforamerica/blueprint-rules-engine';
import { graphFor } from '../rulesets.js';
import { scenariosFor, medicaidInputs as inputsOf } from '../scenarios.js';

const graph = graphFor('medicaidWorkRequirements');

/**
 * Equal, with numbers compared to within a billionth. CEL's numbers are
 * doubles, so 4 credit hours at 3 hours a week over 4.33 weeks, plus 30 hours
 * of work, is 81.96000000000001 (exact arithmetic is #494).
 */
function assertEqual(actual, expected, message) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} is not ${expected}`);
  } else {
    assert.deepEqual(actual, expected, message);
  }
}

describe('Medicaid work requirements scenarios', () => {
  for (const scenario of scenariosFor('medicaidWorkRequirements')) {
    test(scenario.state ? `${scenario.id} (${scenario.state})` : scenario.id, () => {
      const nodes = evaluate(scenario.state ? graphFor('medicaidWorkRequirements', scenario.state) : graph, scenario.inputs);
      for (const [output, expected] of Object.entries(scenario.expect)) {
        const node = nodes[output];
        assert.ok(node && node.state !== 'missing' && node.state !== 'error', `${output}: ${JSON.stringify(node)}`);
        assertEqual(node.value, expected, output);
      }
      scenario.expectMonths.forEach((expected, i) => {
        for (const [output, value] of Object.entries(expected)) {
          const node = nodes[`reviewMonths[].${output}`];
          assertEqual(node?.value?.[i], value, `month ${i + 1}: ${output} (${JSON.stringify(node)})`);
        }
      });
    });
  }
});

describe('Medicaid work requirements, partly answered', () => {
  test('an unanswered question leaves a result missing, naming it', () => {
    const inputs = inputsOf({ given: { determination: { kind: 'renewal', date: '2027-03-01' }, person: { age: 40 } } });
    delete inputs.person.hasMedicare;
    const satisfies = evaluate(graph, inputs).satisfiesRequirement;
    assert.equal(satisfies.state, 'missing');
    assert.ok(satisfies.missing.includes('$.person.hasMedicare'), JSON.stringify(satisfies.missing));
  });

  test('a question the answer doesn\'t need isn\'t asked: someone with Medicare is never asked about work', () => {
    const nodes = evaluate(graph, {
      determination: { kind: 'renewal', date: '2027-03-01', renewalStartedOn: '2027-02-01' },
      person: { age: 40, inAdultExpansionGroup: true, hasMedicare: true },
    });
    assert.deepEqual([nodes.requirementApplies.state, nodes.requirementApplies.value], ['complete', false]);
    assert.deepEqual([nodes.satisfiesRequirement.state, nodes.satisfiesRequirement.value], ['complete', true]);
  });

  test('why it doesn\'t apply is the condition that settled it, asking nothing more', () => {
    const reason = (determination, person = {}) => {
      const node = evaluate(graph, { determination, person }).notApplicableReason;
      return [node.state, node.value];
    };
    assert.deepEqual(reason({ kind: 'application', date: '2026-03-01' }), ['complete', 'not_yet_in_effect']);
    assert.deepEqual(reason({ kind: 'renewal', renewalStartedOn: '2026-12-01' }), ['complete', 'renewal_started_before_requirement']);
    assert.deepEqual(reason({ kind: 'renewal', date: '2027-03-01', renewalStartedOn: '2026-12-01' }), ['complete', 'renewal_started_before_requirement']);
    assert.deepEqual(reason({ kind: 'renewal', date: '2027-03-01', renewalStartedOn: '2027-02-01' }, { inAdultExpansionGroup: true, hasMedicare: true }), ['complete', 'has_medicare']);
    assert.deepEqual(reason({ kind: 'renewal', date: '2027-03-01', renewalStartedOn: '2027-02-01' }, { inAdultExpansionGroup: true, hasMedicare: false, age: 70 }), ['complete', 'outside_age_range']);
  });

  test('a renewal is asked when it started, an application when it\'s decided, and neither the other', () => {
    const inEffect = (determination) => evaluate(graph, { determination }).requirementInEffect;
    const renewal = inEffect({ kind: 'renewal', renewalStartedOn: '2027-02-01' });
    assert.deepEqual([renewal.state, renewal.value], ['complete', true]);
    const application = inEffect({ kind: 'application', date: '2027-02-01' });
    assert.deepEqual([application.state, application.value], ['complete', true]);
  });

  test('someone who cares for no one is never asked how they\'re related to the person they care for', () => {
    const inputs = inputsOf({ given: { determination: { kind: 'renewal', date: '2027-03-01' }, person: { age: 40 } } });
    delete inputs.person.careRelationship;
    delete inputs.person.caregivingHoursPerMonth;
    const exemptions = evaluate(graph, inputs).exemptions;
    assert.deepEqual([exemptions.state, exemptions.value], ['complete', []]);
  });

  test('a month missing an answer is named at its position', () => {
    const inputs = inputsOf({
      given: { determination: { kind: 'renewal', date: '2027-03-01' }, person: { age: 40 } },
      months: [{ monthsBefore: 1, hoursWorked: 10 }, { monthsBefore: 2 }],
    });
    delete inputs.months[1].householdIncome;
    const qualifies = evaluate(graph, inputs)['reviewMonths[].qualifies'];
    assert.deepEqual(qualifies.value, [false, null]);
    assert.ok(qualifies.missing.includes('$.months[1].householdIncome'), JSON.stringify(qualifies.missing));
  });
});
