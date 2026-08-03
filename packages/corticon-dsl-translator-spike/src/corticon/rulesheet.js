import { parseCorticonXml, asArray } from './xml.js';
import { extractExpression } from './expression.js';

// A self-closing <condition/> or <action/> means that column doesn't apply to this
// rule row -- kept as `null`, not dropped, so array position still lines up with
// every other rule's condition/action arrays in the same rulesheet. Confirmed real
// and column-aligned by position: DC Medicaid's own `MAGI Eligibility Groups.ers`
// has condition index 1 be a `Person.age` check in both real rules that use it,
// regardless of which other columns either rule leaves blank. Recognizing "every
// condition/action in this rule is null" as Corticon Studio's own reserved
// blank/template row (see the doc comment on `rules` below) is the CALLER's job,
// not ingestion's -- filtering it out here would silently re-introduce the same
// index-misalignment-with-Corticon's-own-ruleId bug this shape fixes.
function extractCell(cell) {
  if (!cell || !cell.opaqueExpression) return null;
  return {
    expression: cell.opaqueExpression['@_expression'],
    ...extractExpression(cell.opaqueExpression.parserOutput),
  };
}

/**
 * Extract this rulesheet's real filters (confirmed real in Mortgage's
 * Select_Credit.ers: `liability.accountType = 'CreditLine'`, filtering a
 * collection before rules evaluate it). Filters live under
 * `rulesheetViewList.filterSection.filterItemList`, not under `ruleset` like
 * conditions/actions -- Corticon's Studio-only "full" vs "limiting" distinction
 * (see decision-rules-dsl.md Decision 9) isn't visible in this static structure;
 * only the filter expression itself is.
 */
function extractFilters(rulesheetViewList) {
  return asArray(rulesheetViewList?.filterSection?.filterItemList)
    .map((item) => {
      const cell = item?.expressionCell;
      if (!cell?.parserOutput) return null;
      return { expression: cell['@_external'], ...extractExpression(cell.parserOutput) };
    })
    .filter(Boolean);
}

/**
 * True if every condition and action in this rule is null -- Corticon Studio's own
 * reserved blank/template row (confirmed real, always rule index 0, in both the
 * real vendored Mortgage/Select_Credit.ers and DC Medicaid's own MAGI Eligibility
 * Groups.ers), not a real rule with actual logic. Exported so graph/classify/
 * translate all use this one definition rather than each re-deriving their own.
 */
export function isBlankTemplateRule(rule) {
  return rule.conditions.every((c) => c === null) && rule.actions.every((a) => a === null);
}

// A "#//@ruleset/@X.N" EMF-style cross-reference resolves to the plain index N --
// confirmed real, and the only form seen: `documentingRuleStatements`,
// `ruleModelElements`, etc. all use it.
function refIndex(ref) {
  const match = /\.(\d+)$/.exec(ref ?? '');
  return match ? Number(match[1]) : undefined;
}

// Real, human-authored per-rule business documentation -- confirmed in both DC
// Medicaid's MAGI Eligibility Groups.ers ("Aged blind disabled", one rule) and the
// real vendored Mortgage/Regular_NoData.ers ("If number of times late 30 days was
// not set due to a lack of data, set it to 0", all four real rules) -- an explicit,
// confirmed association, not a positional guess: a <rule>'s own
// `documentingRuleStatements` attribute names a `<ruleStatement>` by index, which
// itself carries `ruleModelElements` pointing back at the same rule -- both
// directions of one real link. Not every rule has one (MAGI's is sparse: only 1 of
// 18 rules).
function extractRuleStatements(ruleset) {
  return asArray(ruleset?.ruleStatement).map((stmt) => ({
    severity: stmt?.['@_post'],
    text: stmt?.text?.['@_expression'],
  }));
}

// Column-level metadata from Corticon Studio's own decision-table grid view
// (rulesheetViewList.actionSection/conditionSection) -- captured faithfully in its
// own right, NOT claimed to align 1:1 by position with any specific rule's own
// `conditions`/`actions` array. Checked whether it does and confirmed it doesn't:
// DC Medicaid's MAGI Eligibility Groups.ers has 7 actionItemList blocks but only 3
// real actions on rule index 0 (6 on most others), and 22 conditionItemList blocks
// but only 21 conditions on rule index 0. The real per-rule column-to-label
// correspondence isn't understood yet -- surfacing that correspondence would mean
// guessing, not translating. `naturalLanguageText` is real and valuable regardless:
// a human-authored description per column (confirmed real in MAGI Eligibility
// Groups.ers, e.g. "Contigent upon household income being under 223% of FPL, this
// household member is eligible for Medicaid..."), a far better label for a
// human-facing view than the raw expression text (`Person.cohort +=
// Cohort.newUnique[...]`) -- worth revisiting for the Phase 5 rules-visualization
// work (issue #388) once the correspondence is figured out.
function extractColumnDefinitions(itemLists) {
  return asArray(itemLists).map((item) => ({
    external: item?.expressionCell?.['@_external'],
    naturalLanguageText: item?.naturalLanguageText?.['@_value'],
  }));
}

/** Parse a Corticon Rulesheet (.ers) file into { rules, filters, vocabulary }. */
export function parseRulesheet(filePath) {
  const doc = parseCorticonXml(filePath);
  const root = doc['com.corticon.rulesemf.assetmodel:RulesheetAsset'];
  const ruleset = root?.ruleset;

  // Every real <rule> element is kept, in document order, with NO filtering --
  // array index always matches Corticon's own rule/ruleId numbering exactly. An
  // earlier version filtered out any rule whose conditions/actions were all
  // self-closing, on the theory that it must be Corticon Studio's reserved
  // blank/template row (confirmed real: rule index 0 is entirely self-closing in
  // both the real vendored Mortgage/Select_Credit.ers and DC Medicaid's own MAGI
  // Eligibility Groups.ers). But that filter operated AFTER extraction already
  // collapsed "genuinely no <condition>/<action> elements at all" and "elements
  // present but every one self-closing" to the identical empty shape -- it had no
  // way to tell a real reserved row apart from a real numbered rule whose own
  // content simply failed to extract for some other reason. Recognizing the
  // reserved row is now the caller's job (see graph/build-graph.js), done
  // explicitly against the real, visible `conditions`/`actions` null-arrays below,
  // not silently inside ingestion.
  const ruleStatements = extractRuleStatements(ruleset);
  const rules = asArray(ruleset?.rule).map((rule) => {
    const statementIndex = refIndex(rule?.['@_documentingRuleStatements']);
    return {
      conditions: asArray(rule?.condition).map(extractCell),
      actions: asArray(rule?.action).map(extractCell),
      comment: statementIndex !== undefined ? ruleStatements[statementIndex] : undefined,
    };
  });

  return {
    vocabulary: ruleset?.['@_vocabulary'],
    rules,
    filters: extractFilters(root?.rulesheetViewList),
    actionColumns: extractColumnDefinitions(root?.rulesheetViewList?.actionSection?.actionItemList),
    conditionColumns: extractColumnDefinitions(root?.rulesheetViewList?.conditionSection?.conditionItemList),
  };
}
