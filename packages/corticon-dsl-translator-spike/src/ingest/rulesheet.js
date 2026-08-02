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

/** Parse a Corticon Rulesheet (.ers) file into { rules, vocabulary }. */
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
  };
}
