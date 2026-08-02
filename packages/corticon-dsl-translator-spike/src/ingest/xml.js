import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

// Tags that repeat unconditionally, wherever they appear (confirmed by dumping
// real jPaths from the fixtures — see the ingest/*.test.js suites).
const ALWAYS_ARRAY = new Set([
  'eClassifiers',
  'eStructuralFeatures',
  'enumerationElements',
  'customDataTypeList',
  'conditionItemList',
  'actionItemList',
  'filterItemList',
  'conditionValueSetCellList',
  'actionValueSetCellList',
  'ruleStatementItemList',
  'flowControlList',
  'flowShapeList',
  'flowEdgeList',
  'RuleTraceData',
  'children',
  'testsheetAssets',
]);

// Tags that only repeat in a specific parent context — the same tag name (e.g.
// `condition`, `branches`) can be single-valued elsewhere, so these are matched
// against the last two path segments rather than the bare tag name.
const ALWAYS_ARRAY_BY_PATH = new Set([
  'rule.condition',
  'rule.action',
  'flowControlList.branches',
  'referencedTermList.terms',
  'modifiedTermList.terms',
  'testsheet.output',
  'ruleset.rule',
  'testsheetAssets.testsheet',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (tagName, jPath) => ALWAYS_ARRAY.has(tagName) || ALWAYS_ARRAY_BY_PATH.has(jPath.split('.').slice(-2).join('.')),
});

/** Parse a Corticon XMI file (.ecore/.ers/.erf/.ert) into a plain JS object tree. */
export function parseCorticonXml(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return parser.parse(raw);
}

/** Coerce a value that may or may not already be an array into an array. Corticon XMI elements that can repeat sometimes collapse to a single object when there's exactly one. */
export function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
