import { parseCorticonXml, asArray } from './xml.js';
import { extractExpression } from './expression.js';

function extractCell(cell) {
  // A self-closing <condition/> or <action/> means that column doesn't apply to this rule row.
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

/** Parse a Corticon Rulesheet (.ers) file into { rules, filters, vocabulary }. */
export function parseRulesheet(filePath) {
  const doc = parseCorticonXml(filePath);
  const root = doc['com.corticon.rulesemf.assetmodel:RulesheetAsset'];
  const ruleset = root?.ruleset;

  const rules = asArray(ruleset?.rule)
    .map((rule) => ({
      conditions: asArray(rule?.condition).map(extractCell).filter(Boolean),
      actions: asArray(rule?.action).map(extractCell).filter(Boolean),
    }))
    // A bare <rule/> with no conditions or actions is a placeholder Corticon emits
    // as the decision table's "default"/header row — not a real rule.
    .filter((rule) => rule.conditions.length > 0 || rule.actions.length > 0);

  return {
    vocabulary: ruleset?.['@_vocabulary'],
    rules,
    filters: extractFilters(root?.rulesheetViewList),
  };
}
