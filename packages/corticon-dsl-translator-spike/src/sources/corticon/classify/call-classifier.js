import { basename } from 'node:path';
import { entriesOf } from '../../../map-utils.js';

// A connector invocation is a plain-object `invokes` shape ("#//@ruleflow/@connectorList.0"),
// distinct from a rulesheet/ruleflow invokes -- confirmed real in
// corticon.js-samples/ServiceCallOut/RESTCall/Fetch.erf. `connectorList` entries are
// referenced by array index, not by name, so this pulls the index back out rather
// than matching by name.
function connectorIndexFromInvokes(invokes) {
  const match = /^#\/\/@ruleflow\/@connectorList\.(\d+)$/.exec(invokes ?? '');
  return match ? Number(match[1]) : undefined;
}

// A BranchContainer's branches can also invoke a connector in principle (the same
// `allInvokesTargets` shape ruleflow-context.js walks) -- not confirmed real in any
// fixture, but cheap to handle alongside the confirmed real ActivityNode case rather
// than assuming only ActivityNode can ever invoke one.
function invocationTargets(node) {
  if (node.kind === 'ActivityNode') return [{ name: node.name, invokes: node.invokes }];
  return (node.branches ?? []).flatMap((branch) => branch.targets ?? []);
}

/**
 * Finds Corticon service call-out nodes as PatternFinding objects with pattern "call"
 * and variant "opaque" — a Ruleflow node invoking a `connectorList` entry instead of
 * a `.ers` ruleset (confirmed real in corticon.js-samples/ServiceCallOut/RESTCall/
 * Fetch.erf: an ActivityNode with `invokes="#//@ruleflow/@connectorList.0"`, paired
 * with `<connectorList className="FetchServiceCallout.js" serviceName="fetchURL"/>` in
 * the same ruleflow). Per issue #388, this is an orchestration/adapter-layer concern
 * to flag, not a Fact derivation to translate — a call-out is a side-effecting
 * external call, not a derivation from other known facts.
 *
 * Variant is "opaque" because purity cannot be determined from the source alone;
 * inspecting the external implementation is required to classify as function or procedure.
 */
export function classifyCalls(project) {
  const result = [];
  for (const [ruleflowFile, ruleflow] of entriesOf(project.ruleflows)) {
    const connectorsInOrder = entriesOf(ruleflow.connectors).map(([, connector]) => connector);
    for (const node of ruleflow.nodes ?? []) {
      for (const target of invocationTargets(node)) {
        const index = connectorIndexFromInvokes(target.invokes);
        if (index === undefined) continue;
        result.push({
          pattern: 'call',
          variant: 'opaque',
          node: target.name,
          ruleId: basename(ruleflowFile),
          connector: connectorsInOrder[index],
        });
      }
    }
  }
  return result;
}
