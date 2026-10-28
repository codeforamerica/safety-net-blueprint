/**
 * The work requirements scenarios, as inputs a ruleset can evaluate.
 *
 * Each fixture in tests/scenarios/ gives a scenario's own answers and leaves
 * every other question to its `unanswered` block: the answer that grants
 * nothing, since the rules give nothing a default. This fills them in, so the
 * tests and the work requirements demo read a scenario the same way.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => yaml.load(readFileSync(join(here, 'scenarios', `${name}.yaml`), 'utf8'));

const medicaid = fixture('medicaid-work-requirements');
const snap = fixture('snap-work-requirements');

/**
 * A Medicaid scenario's answers, every one it leaves out answered so it grants
 * nothing, each month's included.
 *
 * @param {{ given?: object, months?: object[] }} scenario
 */
export function medicaidInputs(scenario) {
  const { unanswered } = medicaid;
  const groups = ['determination', 'person', 'health', 'verification'];
  return {
    ...Object.fromEntries(groups.map((group) => [group, { ...unanswered[group], ...scenario.given?.[group] }])),
    months: (scenario.months ?? []).map((month) => ({ ...unanswered.month, ...month })),
  };
}

/**
 * A SNAP case's answers, every one it leaves out answered so it grants
 * nothing, North Carolina's own questions included for a case there. Age has
 * no such answer.
 *
 * @param {object} person
 * @param {string} [state]
 */
export function snapInputs(person, state) {
  const { unanswered } = snap;
  return { person: { ...unanswered.person, ...(state === 'NC' ? unanswered.northCarolina : {}), ...person } };
}

/**
 * Every scenario for a ruleset: `{ id, story, state, inputs, expect }`, and
 * for Medicaid `expectMonths`.
 *
 * @param {'medicaidWorkRequirements'|'snapWorkRequirements'} ruleset
 */
export function scenariosFor(ruleset) {
  if (ruleset === 'medicaidWorkRequirements') {
    return medicaid.scenarios.map((s) => ({
      id: s.id, story: s.story, state: s.state, inputs: medicaidInputs(s), expect: s.expect ?? {}, expectMonths: s.expectMonths ?? [],
    }));
  }
  if (ruleset === 'snapWorkRequirements') {
    return snap.cases.map((c) => ({
      id: c.name, story: c.name, state: c.state, inputs: snapInputs(c.person, c.state), expect: c.expect ?? {},
    }));
  }
  throw new Error(`No scenarios for ${ruleset}`);
}
