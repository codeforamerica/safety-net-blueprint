import { parseCorticonXml, asArray } from './xml.js';
import { extractExpression } from './expression.js';

// A single <branches> block can chain more than one <nextStep> -- confirmed real
// in InsuranceRating.erf (5 chained nodes under one branch) and in this spike's
// own all-patterns fixture (DisabilityBranchA -> DisabilityBranchB). Each nextStep
// is captured individually, in document order, as `targets` -- a single-`target`
// field would silently drop every step after the first.
function extractBranch(branch) {
  return {
    targets: asArray(branch?.nextStep).map((step) => ({
      name: step?.['@_name'],
      invokes: step?.['@_invokes'],
    })),
    label: branch?.label?.['@_expression'],
  };
}

function extractNode(node) {
  const xsiType = node['@_xsi:type'] ?? '';
  const kind = xsiType.endsWith(':BranchContainer') ? 'BranchContainer' : 'ActivityNode';
  const result = {
    kind,
    name: node['@_name'],
    order: node['@_order'] != null ? Number(node['@_order']) : undefined,
    // A plain boolean attribute on the node itself -- not a distinct node type, and
    // not specific to BranchContainer (confirmed real in the IRR fixture: `loop.erf`).
    iterative: node['@_iterative'] === 'true',
    invokes: node['@_invokes'],
  };
  if (kind === 'BranchContainer') {
    result.condition = extractExpression(node.condition?.parserOutput);
    result.branches = asArray(node.branches).map(extractBranch);
  }
  return result;
}

/** Parse a Corticon Ruleflow (.erf) file into { vocabulary, connectors, nodes }. */
export function parseRuleflow(filePath) {
  const doc = parseCorticonXml(filePath);
  const root = doc['com.corticon.rulesemf.assetmodel:RuleflowAsset'];
  const ruleflow = root?.ruleflow;

  const connectors = new Map();
  for (const connector of asArray(ruleflow?.connectorList)) {
    connectors.set(connector?.['@_serviceName'], {
      className: connector?.['@_className'],
      serviceName: connector?.['@_serviceName'],
    });
  }

  return {
    vocabulary: ruleflow?.['@_vocabulary'],
    nodes: asArray(ruleflow?.flowControlList)
      .map(extractNode)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    connectors,
  };
}
