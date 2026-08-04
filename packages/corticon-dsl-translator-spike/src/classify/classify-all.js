import { canonicalAttributePath } from '../graph/attribute-path.js';
import { isBlankTemplateRule } from '../corticon/rulesheet.js';
import { entriesOf } from '../map-utils.js';
import { resolveRuleflowContext } from './ruleflow-context.js';
import { classifySelfLoops, classifyMultiHopCycles } from './cycle-classifier.js';
import { classifyEntityCreation } from './entity-creation-classifier.js';
import { classifyServiceCallouts } from './service-callout-classifier.js';
import { classifyDecisionTableCombinatorics } from './decision-table-classifier.js';
import { classifyFilters } from './filter-classifier.js';
import { classifyExpressionPatterns } from './expression-patterns.js';
import { classifyAttributeUsage } from './attribute-usage-classifier.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

/**
 * Attribute paths written by more than one distinct rulesheet -- the cross-rulesheet
 * Fact assembly pattern (e.g. Person.MedicaidEligible in Parse Cohorts.ers + Flatten.ers).
 * Derived directly from the project's own rules without a pre-built graph.
 */
function findCrossRulesheetAssembly(project) {
  const writesByPath = new Map();
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule) => {
      if (isBlankTemplateRule(rule)) return;
      for (const action of rule.actions.filter(Boolean)) {
        for (const writePath of attributePathsIn(action.modifiedTerms)) {
          if (!writesByPath.has(writePath)) writesByPath.set(writePath, new Set());
          writesByPath.get(writePath).add(rulesheetFile);
        }
      }
    });
  }
  const result = [];
  for (const [path, rulesheets] of writesByPath) {
    if (rulesheets.size > 1) result.push({ path, rulesheets: [...rulesheets] });
  }
  return result;
}

/**
 * Runs every Phase 3 classifier against a Phase 2 project model, matching
 * issue #388's pattern table: ruleflow-invocation-context-dependent classifications
 * (self-loops, multi-hop cycles) alongside classifications that need the raw
 * project rules (cross-rulesheet assembly, decision-table combinatorics) or only
 * the project's rulesheets/ruleflows directly (entity creation, service call-outs,
 * filters, the remaining expression patterns). Shared by classify-project.js (the
 * CLI) and anything else that needs a real classification without going through a
 * file on disk (tests, translate-project.js's own tests) -- not duplicated between them.
 */
export function classifyProject(project) {
  const ruleflowContext = resolveRuleflowContext(project);
  return {
    ruleflowContext: {
      roots: ruleflowContext.roots,
      unreachableRulesheets: ruleflowContext.unreachable,
      multiInvokedRulesheets: ruleflowContext.multiInvoked,
    },
    selfLoops: classifySelfLoops(project, ruleflowContext),
    multiHopCycles: classifyMultiHopCycles(project, ruleflowContext),
    crossRulesheetAssembly: findCrossRulesheetAssembly(project),
    decisionTableCombinatorics: classifyDecisionTableCombinatorics(project),
    entityCreation: classifyEntityCreation(project),
    serviceCallouts: classifyServiceCallouts(project),
    filters: classifyFilters(project),
    expressionPatterns: classifyExpressionPatterns(project),
    attributeUsage: classifyAttributeUsage(project),
  };
}
