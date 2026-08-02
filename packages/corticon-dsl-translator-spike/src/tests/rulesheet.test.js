import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseRulesheet } from '../ingest/rulesheet.js';

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
  for (const dir of ['fixtures/dc-medicaid-chip', 'fixtures/irr', 'fixtures/mortgage']) {
    for (const file of findFiles(dir, '.ers')) {
      assert.doesNotThrow(() => parseRulesheet(file), `should parse ${file}`);
    }
  }
});

test('extracts the real null-check-masking pattern from Mortgage Regular_NoData.ers', () => {
  const { rules } = parseRulesheet('fixtures/mortgage/Regular_NoData.ers');
  assert.equal(rules.length, 4, 'one rule per late-payment-window attribute');

  const rule = rules[0];
  assert.equal(rule.conditions.length, 1);
  assert.equal(rule.conditions[0].text, 'loanapp.late30DaysSum = null');
  assert.equal(rule.actions[0].text, 'loanapp.late30DaysSum = 0');
  assert.equal(rule.actions[0].expressionType, 'ASSIGNMENT');
});

test('extracts the real filter pattern from Mortgage Select_Credit.ers', () => {
  const { rules } = parseRulesheet('fixtures/mortgage/Select_Credit.ers');
  const conditionTexts = rules.flatMap((r) => r.conditions.map((c) => c.text));
  assert.ok(
    conditionTexts.some((t) => t?.includes('liability->size')),
    'expected a condition referencing the filtered liability collection'
  );
});

test('MAGI Eligibility Groups decision table has the expected real scale', () => {
  const { rules } = parseRulesheet('fixtures/dc-medicaid-chip/Medicaid Applicant/MAGI Eligibility Groups.ers');
  assert.equal(rules.length, 17, 'confirmed real rule-row count from manual inspection');
});

test('a bare placeholder <rule/> with no conditions or actions is filtered out', () => {
  const { rules } = parseRulesheet('fixtures/dc-medicaid-chip/Medicaid Applicant/MAGI Eligibility Groups.ers');
  for (const rule of rules) {
    assert.ok(rule.conditions.length > 0 || rule.actions.length > 0, 'every retained rule has real content');
  }
});
