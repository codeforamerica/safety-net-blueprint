import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRulespec } from '../sources/rulespec/load-rulespec.js';
import { buildRulespecFacts } from '../sources/rulespec/translate-rulespec.js';

const FIXTURE = 'fixtures/rulespec/community-engagement/community-engagement.yaml';

function getFacts() {
  const rulespec = loadRulespec(FIXTURE);
  return buildRulespecFacts(rulespec);
}

test('parameters produce writable facts with placeholder from the latest version formula', () => {
  const { facts } = getFacts();
  const fact = facts.find(f => f.path === '/parameter/ce_min_monthly_hours');
  assert.ok(fact, 'should have a fact at /parameter/ce_min_monthly_hours');
  assert.equal(fact.writable, true);
  assert.equal(fact.placeholder, '80');
});

test('all four parameters produce /parameter/<name> writable facts', () => {
  const { facts } = getFacts();
  const paramFacts = facts.filter(f => f.path.startsWith('/parameter/'));
  assert.equal(paramFacts.length, 4);
  assert.ok(facts.find(f => f.path === '/parameter/federal_minimum_wage_hourly'));
  assert.ok(facts.find(f => f.path === '/parameter/ce_applicable_min_age'));
  assert.ok(facts.find(f => f.path === '/parameter/ce_applicable_max_age'));
});

test('simple data_relation (no discriminator) produces a single writable fact', () => {
  const { facts } = getFacts();
  const fact = facts.find(f => f.path === '/person/enrolled_in_education_at_least_half_time');
  assert.ok(fact, 'should have a writable fact');
  assert.equal(fact.writable, true);
  assert.equal(fact.derived, undefined);
  assert.equal(fact.placeholder, undefined);
});

test('data_relation with primitive return type (Money) produces a single fact, no expansion', () => {
  const { facts } = getFacts();
  const fact = facts.find(f => f.path === '/person/magi_monthly_income');
  assert.ok(fact, 'should have a fact for magi_monthly_income');
  assert.equal(fact.writable, true);
  // Must NOT produce magi_monthly_income_Integer or any suffixed variant
  const unexpectedSuffixed = facts.filter(f => f.path.startsWith('/person/magi_monthly_income_'));
  assert.equal(unexpectedSuffixed.length, 0);
});

test('data_relation with QualifyingActivityKind discriminator produces one fact per enum value', () => {
  const { facts } = getFacts();
  const hoaFacts = facts.filter(f => f.path.startsWith('/person/hours_of_activity_in_month'));
  // QualifyingActivityKind has 6 values
  assert.equal(hoaFacts.length, 6);
  assert.ok(facts.find(f => f.path === '/person/hours_of_activity_in_month_work'));
  assert.ok(facts.find(f => f.path === '/person/hours_of_activity_in_month_community_service'));
  assert.ok(facts.find(f => f.path === '/person/hours_of_activity_in_month_work_program'));
  assert.ok(facts.find(f => f.path === '/person/hours_of_activity_in_month_education'));
  assert.ok(facts.find(f => f.path === '/person/hours_of_activity_in_month_monthly_income'));
  assert.ok(facts.find(f => f.path === '/person/hours_of_activity_in_month_seasonal_average_income'));
});

test('derived rule combined_qualifying_hours translates discriminator calls and if/then/else', () => {
  const { facts } = getFacts();
  const fact = facts.find(f => f.path === '/person/combined_qualifying_hours');
  assert.ok(fact, 'should have a derived fact');
  assert.ok(fact.derived, 'should have a derived CEL expression');
  // Discriminator calls map to the expanded fact paths
  assert.ok(fact.derived.includes('person.hours_of_activity_in_month_work'), 'work discriminator');
  assert.ok(fact.derived.includes('person.hours_of_activity_in_month_community_service'), 'community_service discriminator');
  assert.ok(fact.derived.includes('person.hours_of_activity_in_month_work_program'), 'work_program discriminator');
  assert.ok(fact.derived.includes('person.hours_of_activity_in_month_education'), 'education discriminator');
  // if/then/else becomes a ternary
  assert.ok(fact.derived.includes('?'), 'should contain ternary operator');
  assert.ok(fact.derived.includes('person.enrolled_in_education_at_least_half_time'), 'ternary condition');
});

test('derived rule meets_income_test translates comparison with parameter multiplication', () => {
  const { facts } = getFacts();
  const fact = facts.find(f => f.path === '/person/meets_income_test');
  assert.ok(fact?.derived, 'should have a derived expression');
  assert.ok(fact.derived.includes('person.magi_monthly_income'), 'income relation');
  assert.ok(fact.derived.includes('>='), 'comparison operator');
  assert.ok(fact.derived.includes('parameter.federal_minimum_wage_hourly'), 'wage parameter');
  assert.ok(fact.derived.includes('parameter.ce_min_monthly_hours'), 'hours parameter');
  assert.ok(fact.derived.includes('*'), 'multiplication');
});

test('derived rule in_age_range translates two comparisons joined with and', () => {
  const { facts } = getFacts();
  const fact = facts.find(f => f.path === '/person/in_age_range');
  assert.ok(fact?.derived, 'should have a derived expression');
  assert.ok(fact.derived.includes('person.age_in_years'), 'age relation (appears twice)');
  assert.ok(fact.derived.includes('>='), 'lower bound comparison');
  assert.ok(fact.derived.includes('<'), 'upper bound comparison');
  assert.ok(fact.derived.includes('parameter.ce_applicable_min_age'), 'min age parameter');
  assert.ok(fact.derived.includes('parameter.ce_applicable_max_age'), 'max age parameter');
  assert.ok(fact.derived.includes('&&'), 'and conjunction');
});

test('derived rule demonstrates_community_engagement calls other derived rules by path', () => {
  const { facts } = getFacts();
  const fact = facts.find(f => f.path === '/person/demonstrates_community_engagement');
  assert.ok(fact?.derived, 'should have a derived expression');
  // Calls to other derived rules resolve via the callables map
  assert.ok(fact.derived.includes('person.meets_education_test'), 'meets_education_test');
  assert.ok(fact.derived.includes('person.meets_income_test'), 'meets_income_test');
  assert.ok(fact.derived.includes('person.meets_seasonal_income_test'), 'meets_seasonal_income_test');
  assert.ok(fact.derived.includes('person.combined_qualifying_hours'), 'combined_qualifying_hours');
  assert.ok(fact.derived.includes('parameter.ce_min_monthly_hours'), 'threshold parameter');
  assert.ok(fact.derived.includes('||'), 'or disjunction');
});

test('derived rule meets_seasonal_income_test translates and-joined clauses', () => {
  const { facts } = getFacts();
  const fact = facts.find(f => f.path === '/person/meets_seasonal_income_test');
  assert.ok(fact?.derived, 'should have a derived expression');
  assert.ok(fact.derived.includes('person.is_seasonal_worker'));
  assert.ok(fact.derived.includes('person.avg_magi_income_prior_6_months'));
  assert.ok(fact.derived.includes('&&'));
});

test('no errors in translation log for the fixture', () => {
  const { translationLog } = getFacts();
  const errors = translationLog.filter(m => m.startsWith('ERROR'));
  assert.deepEqual(errors, []);
});
