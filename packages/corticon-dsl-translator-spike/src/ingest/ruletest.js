import { parseCorticonXml, asArray } from './xml.js';

/** Strip a Corticon vocabulary reference (e.g. "../Vocab.ecore#//Person/wages") down to its local name. */
function localName(ref) {
  if (!ref) return undefined;
  return ref.slice(ref.lastIndexOf('/') + 1);
}

/**
 * Recursively extract a Corticon test-tree `children` node (TestEntity or
 * TestAttribute) into a plain record. A TestEntity's own children are a mix of
 * TestAttribute leaves (scalar values) and nested TestEntity nodes (associations),
 * which this splits into `attributes` and `associations` respectively.
 */
function extractTreeNode(node) {
  const xsiType = node['@_xsi:type'] ?? '';
  if (xsiType.endsWith(':TestAttribute')) {
    return { kind: 'attribute', name: localName(node['@_eAttribute']), value: node['@_value'] };
  }
  if (xsiType.endsWith(':TestEntity')) {
    const attributes = {};
    const associations = {};
    for (const child of asArray(node.children).map(extractTreeNode)) {
      if (child.kind === 'attribute') attributes[child.name] = child.value;
      else if (child.kind === 'entity') {
        (associations[child.entityType] ??= []).push(child);
      }
    }
    return {
      kind: 'entity',
      nodeId: node['@_nodeID'],
      entityType: localName(node['@_eClass']),
      attributes,
      associations,
    };
  }
  return { kind: 'unknown', raw: node };
}

/** Extract the real captured rulesheet-by-rulesheet, rule-by-rule execution trace from a testsheet's <output> section. */
function extractRuleTrace(output) {
  return asArray(output?.RuleTraceData).map((entry) => ({
    sequence: entry['@_sequence'] != null ? Number(entry['@_sequence']) : undefined,
    rulesheet: entry['@_rulesheet'],
    rule: entry['@_rule'],
    entityName: entry['@_entityname'],
    entityId: entry['@_entityid'],
    action: entry['@_action'],
    attribute: entry['@_name'],
    oldValue: entry['@_oldvalue'],
    newValue: entry['@_newvalue'],
    targetEntityId: entry['@_targetentityid'],
  }));
}

/** Parse a Corticon Ruletest (.ert) file into a list of testsheets, each with input entities and a captured execution trace. */
export function parseRuletest(filePath) {
  const doc = parseCorticonXml(filePath);
  const root = doc['com.corticon.rulesemf.assetmodel:RuletestAsset'];
  // A file can contain multiple <testsheetAssets> blocks (confirmed real, not a
  // parsing artifact -- e.g. 4 in the DC Medicaid/CHIP fixture). Each holds one
  // <testsheet> (the run's identity and captured <output> trace) alongside a
  // sibling <testsheetViewList> -- confirmed real: the input/expected-output
  // entity trees live there (`inputRoot`/`expectedRoot`), not inside the
  // testsheet's own <input>/<expectedOutput>, which are just empty placeholders.
  return asArray(root?.testsheetAssets).flatMap((assets) => {
    const view = assets.testsheetViewList;
    return asArray(assets.testsheet).map((sheet) => ({
      ruleActivity: sheet['@_ruleActivity'],
      input: asArray(view?.inputRoot?.children).map(extractTreeNode),
      expectedOutput: asArray(view?.expectedRoot?.children).map(extractTreeNode),
      // Multiple <output> blocks can appear per testsheet -- one per invoked
      // rule activity in sequence (e.g. Medicaid Applicant, then CHIP rules).
      trace: asArray(sheet.output).flatMap(extractRuleTrace),
    }));
  });
}
