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
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { evaluate } from '@codeforamerica/blueprint-rules-engine';
import { graphFor } from '../rulesets.js';

const here = dirname(fileURLToPath(import.meta.url));
const { unanswered, scenarios } = yaml.load(readFileSync(join(here, '..', 'scenarios', 'medicaid-work-requirements.yaml'), 'utf8'));
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

/** A scenario's answers, with every question it leaves out answered so it grants nothing. */
function inputsOf(scenario) {
  const groups = ['determination', 'person', 'health', 'verification'];
  return {
    ...Object.fromEntries(groups.map((group) => [group, { ...unanswered[group], ...scenario.given?.[group] }])),
    months: (scenario.months ?? []).map((month) => ({ ...unanswered.month, ...month })),
  };
}

describe('Medicaid work requirements scenarios', () => {
  for (const scenario of scenarios) {
    test(scenario.state ? `${scenario.id} (${scenario.state})` : scenario.id, () => {
      const nodes = evaluate(scenario.state ? graphFor('medicaidWorkRequirements', scenario.state) : graph, inputsOf(scenario));
      for (const [output, expected] of Object.entries(scenario.expect ?? {})) {
        const node = nodes[output];
        assert.ok(node && node.state !== 'missing' && node.state !== 'error', `${output}: ${JSON.stringify(node)}`);
        assertEqual(node.value, expected, output);
      }
      (scenario.expectMonths ?? []).forEach((expected, i) => {
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
    const inputs = inputsOf({ given: { determination: { kind: 'renewal', year: 2027 }, person: { age: 40 } } });
    delete inputs.person.hasMedicare;
    const status = evaluate(graph, inputs).status;
    assert.equal(status.state, 'missing');
    assert.ok(status.missing.includes('$.person.hasMedicare'), JSON.stringify(status.missing));
  });

  test('a question the answer doesn\'t need isn\'t asked: someone with Medicare is never asked about work', () => {
    const status = evaluate(graph, {
      determination: { kind: 'renewal', year: 2027, startedBeforeRequirement: false },
      person: { age: 40, inAdultExpansionGroup: true, hasMedicare: true },
    }).status;
    assert.deepEqual([status.state, status.value], ['complete', 'requirement_does_not_apply']);
  });

  test('a month missing an answer is named at its position', () => {
    const inputs = inputsOf({
      given: { determination: { kind: 'renewal', year: 2027 }, person: { age: 40 } },
      months: [{ monthsBefore: 1, hoursWorked: 10 }, { monthsBefore: 2 }],
    });
    delete inputs.months[1].householdIncome;
    const qualifies = evaluate(graph, inputs)['reviewMonths[].qualifies'];
    assert.deepEqual(qualifies.value, [false, null]);
    assert.ok(qualifies.missing.includes('$.months[1].householdIncome'), JSON.stringify(qualifies.missing));
  });
});
