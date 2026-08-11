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
 * Formats a rule's conditions and actions as a plain-text IF/THEN string.
 * Multiple conditions are joined with AND (each parenthesized). When there are
 * no conditions the actions are returned without a leading "THEN". Shared by
 * visualize-rules.js (SVG box text) and visualize-translation-log.js (HTML cell) so
 * both show the same logical representation.
 *
 * Returns { conditionText, actionTexts } so callers can lay them out differently
 * (multi-line with indentation vs. flat single string, etc.).
 */
export function formatRuleText(conditions, actions) {
  const realConditions = (conditions ?? []).filter(Boolean);
  const conditionText = realConditions.length > 1
    ? realConditions.map((c) => `(${c.text})`).join(' AND ')
    : realConditions[0]?.text ?? null;
  const realActions = (actions ?? []).filter(Boolean);
  const actionTexts = realActions.length ? realActions.map((a) => a.text) : ['(no action)'];
  return { conditionText, actionTexts };
}

/**
 * True if every condition and action in this rule is null -- Corticon Studio's own
 * reserved blank/template row, not a real rule with actual logic. Confirmed real
 * in Mortgage/Select_Credit.ers and DC Medicaid's MAGI Eligibility Groups.ers. The
 * template row typically appears at index 0, but CBMS shows that index 0 can also
 * be a real unconditional rule (e.g. DF_COM_InitializeFields.ers initializes several
 * program flags at rule 0 with no conditions). The all-null check is what identifies
 * the template row, not its position. Exported so graph/classify/translate all use
 * this one definition rather than each re-deriving their own.
 */
export function isBlankTemplateRule(rule) {
  return rule.conditions.every((c) => c === null) && rule.actions.every((a) => a === null);
}

// A "#//@ruleset/@X.N" EMF-style cross-reference resolves to the plain index N --
// confirmed real, and the only form seen: `documentingRuleStatements`,
// `ruleModelElements`, etc. all use it.
function refIndex(ref) {
  if (ref == null) return undefined;
  // documentingRuleStatements is a plain integer ("0"), while overrides/overriddenBy
  // are EMF ref paths ("#//@ruleset/@rules.1") -- handle both forms.
  const emfMatch = /\.(\d+)$/.exec(ref);
  if (emfMatch) return Number(emfMatch[1]);
  const plainMatch = /^\d+$/.exec(ref.trim());
  return plainMatch ? Number(ref.trim()) : undefined;
}

// `overrides`/`overriddenBy` are space-separated lists of the same EMF ref shape
// (unlike the single-ref `documentingRuleStatements`) -- confirmed real in
// fixtures/corticon/vendor-samples/irr/evaluate npv.ers, e.g. overrides="#//@ruleset/@rules.1
// #//@ruleset/@rules.2 #//@ruleset/@rules.4".
function refIndexList(ref) {
  return (ref ?? '').split(/\s+/).filter(Boolean).map(refIndex);
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
    // Corticon's real answer to "what if two decision-table rows genuinely
    // overlap" is NOT a rulesheet-level hit-policy setting -- there isn't one.
    // The default guarantee is Design-Time-Inferencing: Corticon Studio's own
    // conflict checker enforces mutual exclusivity between rows at design time.
    // When two rows really can both match, the rule author sets an explicit
    // priority between them via Studio's own "Overrides row" UI, recorded here as
    // a real, per-rule attribute -- confirmed in fixtures/corticon/vendor-samples/irr/evaluate npv.ers
    // (rules 1 and 2 are both overridden by rules 3 and 4; rules 3 and 4 in turn
    // list EACH OTHER in both overrides and overriddenBy -- a real, if unintuitive,
    // mutual relationship in the source XML, not a strict priority chain and not a
    // bug in this extractor), and present-but-empty in DC Medicaid/CHIP's
    // Citizenship requirements.ers/MAGI Eligibility Groups.ers, confirming this
    // is a standard attribute every rule can carry, not something unique to IRR.
    const overrides = refIndexList(rule?.['@_overrides']);
    const overriddenBy = refIndexList(rule?.['@_overriddenBy']);
    return {
      conditions: asArray(rule?.condition).map(extractCell),
      actions: asArray(rule?.action).map(extractCell),
      comment: statementIndex !== undefined ? ruleStatements[statementIndex] : undefined,
      overrides: overrides.length ? overrides : undefined,
      overriddenBy: overriddenBy.length ? overriddenBy : undefined,
    };
  });

  // Sheet-level description: if the blank template rule (rules.0) carries a
  // documentingRuleStatements link, treat that statement as the rulesheet description.
  // Linking to rules.0 is the real Corticon convention -- the same per-rule link
  // used in vendored fixtures (Regular_NoData.ers), just targeting the template
  // row which is never displayed, so the description appears at sheet level only.
  const templateRule = asArray(ruleset?.rule)[0];
  const templateStatementIndex = refIndex(templateRule?.['@_documentingRuleStatements']);
  const description = templateStatementIndex !== undefined ? ruleStatements[templateStatementIndex]?.text : undefined;

  return {
    vocabulary: ruleset?.['@_vocabulary'],
    rules,
    filters: extractFilters(root?.rulesheetViewList),
    actionColumns: extractColumnDefinitions(root?.rulesheetViewList?.actionSection?.actionItemList),
    conditionColumns: extractColumnDefinitions(root?.rulesheetViewList?.conditionSection?.conditionItemList),
    description,
  };
}
