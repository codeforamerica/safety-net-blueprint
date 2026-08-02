import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseRuletest } from '../ingest/ruletest.js';

const MEDICAID_APPLICANT_TEST = 'fixtures/dc-medicaid-chip/Medicaid Applicant/Test.ert';

function findFiles(dir, extension) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...findFiles(full, extension));
    else if (entry.endsWith(extension)) results.push(full);
  }
  return results;
}

test('parses every real .ert fixture without error', () => {
  for (const dir of ['fixtures/dc-medicaid-chip', 'fixtures/irr', 'fixtures/mortgage']) {
    for (const file of findFiles(dir, '.ert')) {
      assert.doesNotThrow(() => parseRuletest(file), `should parse ${file}`);
    }
  }
});

test('parses every real testsheetAssets block, including more than one per file', () => {
  const sheets = parseRuletest(MEDICAID_APPLICANT_TEST);
  assert.equal(sheets.length, 4, 'confirmed real testsheetAssets block count');
});

test('extracts real input entities from testsheetViewList, not the empty testsheet.input placeholder', () => {
  const sheets = parseRuletest(MEDICAID_APPLICANT_TEST);
  const sheetWithInput = sheets.find((s) => s.input.length > 0);
  assert.ok(sheetWithInput, 'expected at least one testsheet with real input data');
  const person = sheetWithInput.input[0];
  assert.equal(person.entityType, 'Person');
  assert.ok(person.attributes.fullName, 'expected a real attribute value');
});

test('extracts the real captured rule trace, matching Corticon\'s own computed MedicaidEligible result', () => {
  const sheets = parseRuletest(MEDICAID_APPLICANT_TEST);
  const trace = sheets.flatMap((s) => s.trace);
  const medicaidEligibleEntries = trace.filter((t) => t.attribute === 'MedicaidEligible');
  assert.ok(medicaidEligibleEntries.length > 0, 'expected real MedicaidEligible trace entries');
  // Corticon's own trace serialization is inconsistent within the same file --
  // `rulesheet` is sometimes a full `file:/...` path and sometimes just the bare
  // rulesheet name (confirmed real, not a parsing bug), so match both forms.
  assert.ok(
    medicaidEligibleEntries.every((t) => /Flatten|Parse Cohorts/.test(t.rulesheet ?? '')),
    'MedicaidEligible is jointly determined by Parse Cohorts.ers and Flatten.ers, per the cross-rulesheet Fact assembly finding'
  );
});

test('a testsheet\'s own <input>/<expectedOutput> elements are confirmed empty placeholders', () => {
  // Not asserted directly here since parseRuletest already reads from testsheetViewList
  // instead -- this test exists to document *why*, so a future refactor doesn't
  // accidentally revert to reading the empty placeholder.
  const sheets = parseRuletest(MEDICAID_APPLICANT_TEST);
  assert.ok(sheets.some((s) => s.input.length > 0), 'if this ever fails, re-check testsheet.input vs testsheetViewList.inputRoot');
});
