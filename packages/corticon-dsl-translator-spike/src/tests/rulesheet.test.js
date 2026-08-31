import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseRulesheet, isBlankTemplateRule } from '../sources/corticon/rulesheet.js';

function findFiles(dir, extension) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...findFiles(full, extension));
    else if (entry.endsWith(extension)) results.push(full);
  }
  return results;
}

test('parses every real .ers fixture without error', () => {
  for (const dir of ['fixtures/corticon/government/dc-medicaid-chip', 'fixtures/corticon/vendor-samples/irr', 'fixtures/corticon/vendor-samples/mortgage']) {
    for (const file of findFiles(dir, '.ers')) {
      assert.doesNotThrow(() => parseRulesheet(file), `should parse ${file}`);
    }
  }
});

test('extracts the real null-check-masking pattern from Mortgage Regular_NoData.ers', () => {
  const { rules } = parseRulesheet('fixtures/corticon/vendor-samples/mortgage/Regular_NoData.ers');
  assert.equal(rules.length, 5, 'Corticon Studio\'s own reserved blank/template row (index 0) plus one rule per late-payment-window attribute');
  assert.ok(isBlankTemplateRule(rules[0]), 'rule index 0 is the reserved blank row, confirmed real, not a real rule');

  const rule = rules[1];
  assert.equal(rule.conditions.length, 4, 'one real condition plus 3 blank columns this rule doesn\'t use, kept as null to preserve column position');
  assert.equal(rule.conditions[0].text, 'loanapp.late30DaysSum = null');
  assert.deepEqual(rule.conditions.slice(1), [null, null, null]);
  assert.equal(rule.actions[0].text, 'loanapp.late30DaysSum = 0');
  assert.equal(rule.actions[0].expressionType, 'ASSIGNMENT');
  assert.equal(rule.comment.text, 'If number of times late 30 days was not set due to a lack of data, set it to 0', 'real human-authored ruleStatement documentation, confirmed real and explicitly linked via documentingRuleStatements');
});

test('extracts a rule condition that reads the filtered liability collection from Mortgage Select_Credit.ers', () => {
  const { rules } = parseRulesheet('fixtures/corticon/vendor-samples/mortgage/Select_Credit.ers');
  const conditionTexts = rules.flatMap((r) => r.conditions.filter(Boolean).map((c) => c.text));
  assert.ok(
    conditionTexts.some((t) => t?.includes('liability->size')),
    'expected a condition referencing the filtered liability collection'
  );
});

test('extracts the real filter definitions themselves from Mortgage Select_Credit.ers', () => {
  const { filters } = parseRulesheet('fixtures/corticon/vendor-samples/mortgage/Select_Credit.ers');
  assert.equal(filters.length, 2, 'confirmed two real filters: accountType and lastActivityDate');
  assert.equal(filters[0].text, "liability.accountType = 'CreditLine'");
  assert.equal(filters[1].text, 'liability.lastActivityDate > today.addYears ( -2 )');
  // The Studio-only "full" vs "limiting" distinction genuinely isn't visible in this
  // static structure -- only the filter expression itself is. See Decision 9.
});

test('a rulesheet with no filters returns an empty filters array, not undefined', () => {
  const { filters } = parseRulesheet('fixtures/corticon/vendor-samples/mortgage/Regular_NoData.ers');
  assert.deepEqual(filters, []);
});

test('MAGI Eligibility Groups decision table has the expected real scale', () => {
  const { rules } = parseRulesheet('fixtures/corticon/government/dc-medicaid-chip/Medicaid Applicant/MAGI Eligibility Groups.ers');
  assert.equal(rules.length, 18, 'confirmed real rule-row count from manual inspection: 17 real rows plus Corticon Studio\'s own reserved blank/template row (index 0), now kept rather than filtered');
});

test('a bare placeholder <rule/> with no conditions or actions is kept, not filtered, but identifiable via isBlankTemplateRule', () => {
  const { rules } = parseRulesheet('fixtures/corticon/government/dc-medicaid-chip/Medicaid Applicant/MAGI Eligibility Groups.ers');
  assert.ok(isBlankTemplateRule(rules[0]), 'rule index 0 is the reserved blank row, confirmed real, not a real rule');
  for (const rule of rules.slice(1)) {
    assert.ok(!isBlankTemplateRule(rule), 'every other retained rule has real content');
  }
});

test('a rule with a real ruleStatement documentation comment resolves it via documentingRuleStatements, confirmed real for exactly one of the 18 rules', () => {
  const { rules } = parseRulesheet('fixtures/corticon/government/dc-medicaid-chip/Medicaid Applicant/MAGI Eligibility Groups.ers');
  const commented = rules.filter((r) => r.comment);
  assert.equal(commented.length, 1, 'confirmed real: sparse, not every rule has one');
  assert.equal(commented[0].comment.text, 'Aged blind disabled');
  assert.equal(commented[0].comment.severity, 'Info');
});

test('extracts real overrides/overriddenBy rule priority from IRR evaluate npv.ers', () => {
  const { rules } = parseRulesheet('fixtures/corticon/vendor-samples/irr/evaluate npv.ers');
  assert.deepEqual(rules[1].overriddenBy, [3, 4], 'rule 1 is overridden by both rule 3 and rule 4');
  assert.equal(rules[1].overrides, undefined, 'rule 1 does not override anything itself');
  assert.deepEqual(rules[2].overriddenBy, [3, 4]);
  assert.deepEqual(rules[3].overrides, [1, 2, 4]);
  assert.deepEqual(rules[3].overriddenBy, [4]);
  assert.deepEqual(rules[4].overrides, [1, 2, 3]);
  assert.deepEqual(rules[4].overriddenBy, [3], 'rules 3 and 4 mutually list each other -- a real, if unintuitive, relationship in the source XML, not a bug in this extractor');
});

test('a rule with no override relationship leaves overrides/overriddenBy undefined, not empty arrays', () => {
  const { rules } = parseRulesheet('fixtures/corticon/government/dc-medicaid-chip/Medicaid Applicant/MAGI Eligibility Groups.ers');
  for (const rule of rules) {
    assert.equal(rule.overrides, undefined);
    assert.equal(rule.overriddenBy, undefined);
  }
});

test('column definitions are captured faithfully from the decision-table grid view, without claiming a per-rule correspondence', () => {
  const { actionColumns, conditionColumns } = parseRulesheet('fixtures/corticon/government/dc-medicaid-chip/Medicaid Applicant/MAGI Eligibility Groups.ers');
  assert.equal(actionColumns.length, 7, 'confirmed real column-definition count, independent of any single rule\'s own action count');
  assert.equal(conditionColumns.length, 22);
  assert.ok(actionColumns.some((c) => c.naturalLanguageText?.includes('Contigent upon household income')), 'real human-authored column description');
});
