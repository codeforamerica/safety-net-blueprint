import { asArray } from './xml.js';

/**
 * Extract a clean term tree from a Corticon `<terms>` element (referencedTermList /
 * modifiedTermList entry), following `parentTerm` chains down to the root entity —
 * e.g. `Household.applicant.isCHIPEligible` becomes a chain of { text, datatype, termtype }.
 */
function extractTerm(term) {
  if (!term) return null;
  const node = {
    text: term['@_text'],
    datatype: term['@_datatype'],
    termtype: term['@_termtype'],
    fulltext: term['@_fulltext'],
  };
  if (term.parentTerm) {
    node.parent = extractTerm(term.parentTerm);
  }
  return node;
}

/**
 * Extract a clean, engine-agnostic shape from a Corticon `parserOutput` node
 * (found identically under Rulesheet conditions/actions and Ruleflow branch
 * conditions — same `com.corticon.rulesemf.asg:Expression` structure everywhere).
 */
export function extractExpression(parserOutput) {
  if (!parserOutput) return null;
  return {
    text: parserOutput['@_text'],
    datatype: parserOutput['@_datatype'],
    expressionType: parserOutput['@_expressiontype'],
    referencedTerms: asArray(parserOutput.referencedTermList?.terms).map(extractTerm),
    modifiedTerms: asArray(parserOutput.modifiedTermList?.terms).map(extractTerm),
  };
}

/** Flatten a term chain (from extractTerm) into a dotted path string, e.g. "Household.applicant.isCHIPEligible". */
export function termPath(term) {
  if (!term) return undefined;
  const parts = [];
  let current = term;
  while (current) {
    parts.unshift(current.text);
    current = current.parent;
  }
  return parts.join('.');
}
