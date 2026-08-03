import { findCrossRulesheetAssembly } from '../graph/build-graph.js';
import { resolveRuleflowContext } from './ruleflow-context.js';
import { classifySelfLoops, classifyMultiHopCycles } from './cycle-classifier.js';
import { classifyEntityCreation } from './entity-creation-classifier.js';
import { classifyServiceCallouts } from './service-callout-classifier.js';
import { classifyDecisionTableCombinatorics } from './decision-table-classifier.js';
import { classifyFilters } from './filter-classifier.js';
import { classifyExpressionPatterns } from './expression-patterns.js';

/**
 * Runs every Phase 3 classifier against a Phase 2 {project, graph} model, matching
 * issue #388's pattern table: ruleflow-invocation-context-dependent classifications
 * (self-loops, multi-hop cycles) alongside classifications that only need the raw
 * graph (cross-rulesheet assembly, decision-table combinatorics) or only the project's
 * rulesheets/ruleflows directly (entity creation, service call-outs, filters, the
 * remaining expression patterns). Shared by classify-project.js (the CLI) and
 * anything else that needs a real classification without going through a file on
 * disk (tests, translate-project.js's own tests) -- not duplicated between them.
 */
export function classifyProject(project, graph) {
  const ruleflowContext = resolveRuleflowContext(project);
  return {
    ruleflowContext: {
      roots: ruleflowContext.roots,
      unreachableRulesheets: ruleflowContext.unreachable,
      multiInvokedRulesheets: ruleflowContext.multiInvoked,
    },
    selfLoops: classifySelfLoops(project, graph, ruleflowContext),
    multiHopCycles: classifyMultiHopCycles(graph, ruleflowContext),
    crossRulesheetAssembly: findCrossRulesheetAssembly(graph),
    decisionTableCombinatorics: classifyDecisionTableCombinatorics(graph),
    entityCreation: classifyEntityCreation(project),
    serviceCallouts: classifyServiceCallouts(project),
    filters: classifyFilters(project),
    expressionPatterns: classifyExpressionPatterns(project),
  };
}
