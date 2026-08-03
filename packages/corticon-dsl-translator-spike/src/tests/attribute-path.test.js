import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRulesheet } from '../corticon/rulesheet.js';
import { touchesEntityCreation } from '../graph/attribute-path.js';

test('flags the real Household.newUnique[...] entity-creation action (bare ENTITY in modifiedTerms + a NEW term)', () => {
  const r = parseRulesheet('fixtures/dc-medicaid-chip/Medicaid Applicant/Create Household for Unique PrimaryInsuredId.ers');
  const action = r.rules[0].actions.find((a) => a.text?.includes('newUnique'));
  assert.ok(touchesEntityCreation(action.modifiedTerms, action.referencedTerms));
});

test('does not flag an ordinary date-arithmetic assignment in the same rule, even though it carries a bare ENTITY term in referencedTerms', () => {
  // Person.age = Person.dob.yearsBetween(today) -- referencedTerms includes a bare
  // top-level "Person" ENTITY term (just naming the entity the read is scoped to),
  // which an earlier version of touchesEntityCreation mistook for a creation signal.
  const r = parseRulesheet('fixtures/dc-medicaid-chip/Medicaid Applicant/Create Household for Unique PrimaryInsuredId.ers');
  const action = r.rules[0].actions.find((a) => a.text?.includes('yearsBetween'));
  assert.ok(action, 'expected to find the real age-assignment action');
  assert.equal(touchesEntityCreation(action.modifiedTerms, action.referencedTerms), false);
});

test('does not flag Mortgage\'s ordinary literal assignment, even though it carries a bare ENTITY term in referencedTerms', () => {
  const r = parseRulesheet('fixtures/mortgage/Select_Credit.ers');
  for (const action of r.rules.flatMap((rule) => rule.actions)) {
    assert.equal(touchesEntityCreation(action.modifiedTerms, action.referencedTerms), false);
  }
});

test('flags the real Group Members into Households.ers association-mutation action, which has no NEW term at all', () => {
  const r = parseRulesheet('fixtures/dc-medicaid-chip/Medicaid Applicant/Group Members into Households.ers');
  const action = r.rules[0].actions.find((a) => a.text?.includes('members'));
  assert.ok(action, 'expected to find the real members-association action');
  assert.ok(touchesEntityCreation(action.modifiedTerms, action.referencedTerms));
});
