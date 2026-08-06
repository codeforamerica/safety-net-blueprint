import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { isBlankTemplateRule } from '../corticon/rulesheet.js';
import { entriesOf } from '../../../map-utils.js';
import { resolveRuleflowContext } from './ruleflow-context.js';
import { classifySelfLoops, classifyMultiHopCycles } from './cycle-classifier.js';
import { classifyEntityCreation } from './entity-creation-classifier.js';
import { classifyServiceCallouts } from './service-callout-classifier.js';
import { classifyDecisionTableCombinatorics } from './decision-table-classifier.js';
import { classifyFilters } from './filter-classifier.js';
import { classifyExpressionPatterns } from './expression-patterns.js';
import { classifyAttributeUsage } from './attribute-usage-classifier.js';
import { classifyNoOps } from './no-op-classifier.js';
import { classifySinkCandidates } from './sink-candidate-classifier.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

/**
 * Recursively stamps ruleId on every object that has rulesheet/ruleIndex or
 * rulesheet/ruleIndices, then strips rulesheet/ruleIndex/ruleIndices so
 * consumers work with the universal ruleId instead of Corticon-specific fields.
 */
function withRuleIds(value) {
  if (Array.isArray(value)) return value.map(withRuleIds);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'rulesheet' || k === 'ruleIndex' || k === 'ruleIndices') continue;
      out[k] = withRuleIds(v);
    }
    if ('rulesheet' in value && 'ruleIndex' in value) {
      out.ruleId = value.ruleIndex != null ? `${value.rulesheet}:${value.ruleIndex}` : value.rulesheet;
    } else if ('rulesheet' in value && 'ruleIndices' in value) {
      out.ruleId = value.rulesheet;
      out.ruleIds = value.ruleIndices.map((i) => `${value.rulesheet}:${i}`);
    } else if ('rulesheet' in value) {
      out.ruleId = value.rulesheet;
    }
    return out;
  }
  return value;
}

/**
 * Attribute paths written by more than one distinct rulesheet -- the cross-rulesheet
 * Fact assembly pattern (e.g. Person.MedicaidEligible in Parse Cohorts.ers + Flatten.ers).
 * Derived directly from the project's own rules without a pre-built graph.
 *
 * Null-check-masking rules (null-default pattern) are excluded from the count.
 * A null-default writer provides a placeholder fallback, not a partial fact
 * contribution -- including it falsely inflates the writer count and causes the
 * null-default rulesheet to be tagged as fact-assembly in the visualizer.
 * The null-check detection is the same heuristic cycle-classifier.js uses:
 * any condition that checks the written path against a literal null.
 */
function findCrossRulesheetAssembly(project) {
  const writesByPath = new Map();
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule) => {
      if (isBlankTemplateRule(rule)) return;
      for (const action of rule.actions.filter(Boolean)) {
        for (const writePath of attributePathsIn(action.modifiedTerms)) {
          // Exclude null-check-masking writers: a rule that checks `X = null`
          // on the same path it writes is a null-default, not a fact-assembly
          // participant. Same heuristic as cycle-classifier.js's isNullCheckOn.
          const isNullDefault = (rule.conditions ?? []).filter(Boolean).some((c) => {
            const touchesPath = (c.referencedTerms ?? []).some((t) => canonicalAttributePath(t) === writePath);
            return touchesPath && /=\s*null\s*$/.test(c.text ?? '');
          });
          if (isNullDefault) continue;
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
  // expressionPatterns runs first: classifySelfLoops needs it to avoid false-positive
  // decision-table-alternative-row labels on transform-in-place rules (e.g. decimal-rounding).
  const expressionPatterns = classifyExpressionPatterns(project);
  const selfLoops = classifySelfLoops(project, ruleflowContext, expressionPatterns);
  const attributeUsage = classifyAttributeUsage(project);
  return withRuleIds({
    ruleflowContext: {
      roots: ruleflowContext.roots,
      unreachableRulesheets: ruleflowContext.unreachable,
      multiInvokedRulesheets: ruleflowContext.multiInvoked,
    },
    selfLoops,
    multiHopCycles: classifyMultiHopCycles(project, ruleflowContext),
    crossRulesheetAssembly: findCrossRulesheetAssembly(project),
    decisionTableCombinatorics: classifyDecisionTableCombinatorics(project),
    entityCreation: classifyEntityCreation(project),
    serviceCallouts: classifyServiceCallouts(project),
    filters: classifyFilters(project),
    expressionPatterns,
    attributeUsage,
    noOps: classifyNoOps(project),
    sinkCandidates: classifySinkCandidates(project, ruleflowContext, attributeUsage),
  });
}
