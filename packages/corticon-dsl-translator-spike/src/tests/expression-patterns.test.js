import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRulesheet } from '../sources/corticon/rulesheet.js';
import { loadProject } from '../sources/corticon/project.js';
import {
  isDateArithmetic,
  isCurrencyRounding,
  actionUsesCurrencyRounding,
  isSortingOperation,
  usesSortingOperation,
  cellUsesCompoundArithmetic,
  cellUsesLogicalKeywords,
  cellUsesRangeMembership,
  cellUsesTypeConversion,
  classifyExpressionPatterns,
} from '../sources/corticon/classify/expression-patterns.js';

function allTerms(rule) {
  return [...rule.conditions, ...rule.actions].filter(Boolean).flatMap((cell) => cell.referencedTerms ?? []);
}

function allActions(rulesheet) {
  return rulesheet.rules.flatMap((rule) => rule.actions.filter(Boolean));
}

test('detects real date arithmetic in DC Medicaid\'s Person.dob.yearsBetween(today)', () => {
  const r = parseRulesheet('fixtures/corticon/government/dc-medicaid-chip/Medicaid Applicant/Create Household for Unique PrimaryInsuredId.ers');
  const matches = r.rules.flatMap(allTerms).filter(isDateArithmetic);
  assert.ok(matches.length > 0);
  assert.ok(matches.every((t) => t.fulltext.includes('yearsBetween')));
});

test('detects real date arithmetic in this fixture\'s own date-arithmetic.ers', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/date-arithmetic.ers');
  const matches = r.rules.flatMap(allTerms).filter(isDateArithmetic);
  assert.equal(matches.length, 1);
});

test('a plain attribute read is never mistaken for date arithmetic', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/decision-table.ers');
  const matches = r.rules.flatMap(allTerms).filter(isDateArithmetic);
  assert.deepEqual(matches, []);
});

test('detects currency rounding via the raw expression text fallback -- DC Medicaid\'s real .round(2) on a compound expression has no term at all', () => {
  const r = parseRulesheet('fixtures/corticon/government/dc-medicaid-chip/Medicaid Applicant/Set FPL from Household Size.ers');
  const roundingAction = allActions(r).find((a) => a.text?.includes('ActualPercentFPL'));
  assert.ok(roundingAction, 'expected to find the real ActualPercentFPL rounding action');
  assert.equal(allTerms({ conditions: [], actions: [roundingAction] }).some(isCurrencyRounding), false, 'no term represents the round() call on a compound expression');
  assert.equal(actionUsesCurrencyRounding(roundingAction), true, 'the text fallback still catches it');
});

test('detects currency rounding via a real METHOD term -- this fixture\'s round(2) on a bare attribute', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/decimal-rounding.ers');
  const roundingAction = allActions(r).find((a) => a.text?.includes('incomeRounded'));
  assert.ok(allTerms({ conditions: [], actions: [roundingAction] }).some(isCurrencyRounding));
  assert.equal(actionUsesCurrencyRounding(roundingAction), true);
});

test('detects real sorting/ranking in DC Medicaid\'s Parse Cohorts.ers', () => {
  const r = parseRulesheet('fixtures/corticon/government/dc-medicaid-chip/Medicaid Applicant/Parse Cohorts.ers');
  const matches = r.rules.flatMap(allTerms).filter(isSortingOperation);
  assert.ok(matches.length > 0);
});

test('detects real sorting/ranking in this fixture\'s own sort-ranking.ers', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/sort-ranking.ers');
  const matches = r.rules.flatMap(allTerms).filter(isSortingOperation);
  assert.equal(matches.length, 1);
});

test('detects real sorting/ranking via the raw expression text fallback -- IRR\'s filter-level flows->sortedBy(installment)->first has no term for it at all', () => {
  // Confirmed real gap, the same class as actionUsesCurrencyRounding's: IRR's
  // `initial values.ers` filter's COLLECTION term has text/fulltext reading
  // only "flows"/"flows->asSequence->first" -- no "sortedBy" substring anywhere
  // in the parsed term tree, unlike the action-level cases above.
  const r = parseRulesheet('fixtures/corticon/vendor-samples/irr/initial values.ers');
  assert.equal(r.filters.flatMap((f) => f.referencedTerms ?? []).some(isSortingOperation), false, 'no term represents the real sortedBy call in this filter');
  assert.ok(r.filters.some(usesSortingOperation), 'the text fallback still catches it');
});

test('classifyExpressionPatterns finds all three kinds across a whole real project, including the raw-text-fallback cases', () => {
  const project = loadProject('fixtures/corticon/government/dc-medicaid-chip');
  const results = classifyExpressionPatterns(project);
  const byPattern = (pattern) => results.filter((r) => r.pattern === pattern);
  assert.ok(byPattern('date-arithmetic').some((r) => r.ruleId.includes('Create Household')));
  assert.ok(byPattern('rounding').some((r) => r.ruleId.includes('Set FPL from Household Size')), 'must catch the compound-expression .round(2) via the text fallback, not just a term match');
  assert.ok(byPattern('sort').some((r) => r.ruleId.includes('Parse Cohorts')));
});

test('classifyExpressionPatterns surfaces IRR\'s real filter-level sorting via the text fallback, with ruleId :* since it\'s not tied to a specific rule', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/irr');
  const results = classifyExpressionPatterns(project).filter((r) => r.ruleId === 'initial values.ers:*');
  assert.equal(results.length, 1);
  assert.equal(results[0].pattern, 'sort');
});

test('detects compound arithmetic in this fixture\'s own operator-precedence.ers', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/operator-precedence.ers');
  const allCells = r.rules.flatMap((rule) => [...rule.conditions, ...rule.actions].filter(Boolean));
  assert.ok(allCells.some(cellUsesCompoundArithmetic));
});

test('a plain string concatenation with only + operators is not mistaken for compound arithmetic', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/type-conversion.ers');
  const allCells = r.rules.flatMap((rule) => [...rule.conditions, ...rule.actions].filter(Boolean));
  assert.equal(allCells.some(cellUsesCompoundArithmetic), false, '+ without * or / is not mixed-precedence arithmetic');
});

test('detects logical keywords (and/or/not) in this fixture\'s own logical-operators.ers', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/logical-operators.ers');
  const allCells = r.rules.flatMap((rule) => [...rule.conditions, ...rule.actions].filter(Boolean));
  const matches = allCells.filter(cellUsesLogicalKeywords);
  assert.ok(matches.length > 0);
  assert.ok(matches.some((c) => /\band\b/.test(c.text)));
  assert.ok(matches.some((c) => /\bnot\b/.test(c.text)));
});

test('a plain comparison condition is never mistaken for a logical keyword', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/decision-table.ers');
  const allCells = r.rules.flatMap((rule) => [...rule.conditions, ...rule.actions].filter(Boolean));
  assert.equal(allCells.some(cellUsesLogicalKeywords), false);
});

test('detects membership-test/range syntax in this fixture\'s own range-membership.ers', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/range-membership.ers');
  const allCells = r.rules.flatMap((rule) => [...rule.conditions, ...rule.actions].filter(Boolean));
  const matches = allCells.filter(cellUsesRangeMembership);
  assert.equal(matches.length, 3, 'one range condition per real rule: [0..17], [18..64], [65..150)');
});

test('detects type conversion (.toString()) in this fixture\'s own type-conversion.ers', () => {
  const r = parseRulesheet('fixtures/corticon/synthetic/all-patterns/type-conversion.ers');
  const allCells = r.rules.flatMap((rule) => [...rule.conditions, ...rule.actions].filter(Boolean));
  assert.ok(allCells.some(cellUsesTypeConversion));
});

test('classifyExpressionPatterns finds all four new kinds in the all-patterns fixture', () => {
  const project = loadProject('fixtures/corticon/synthetic/all-patterns');
  const results = classifyExpressionPatterns(project);
  const byPattern = (pattern, variant) => results.filter((r) => r.pattern === pattern && (!variant || r.variant === variant));
  assert.ok(byPattern('operator-precedence').some((r) => r.ruleId.includes('operator-precedence.ers')));
  assert.ok(byPattern('logical-operators').some((r) => r.ruleId.includes('logical-operators.ers')));
  assert.ok(byPattern('membership-test', 'range').some((r) => r.ruleId.includes('range-membership.ers')));
  assert.ok(byPattern('coercion').some((r) => r.ruleId.includes('type-conversion.ers')));
});
