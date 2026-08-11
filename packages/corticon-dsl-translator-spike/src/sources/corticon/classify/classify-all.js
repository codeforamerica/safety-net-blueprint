import { resolveRuleflowContext } from './ruleflow-context.js';
import { classifyCycles, classifyMultiHopCycles } from './cycle-classifier.js';
import { classifyConstructors } from './constructor-classifier.js';
import { classifyCalls } from './call-classifier.js';
import { classifyHitPolicyUnverified, classifyDecisionTableAlternativeRows } from './decision-table-classifier.js';
import { classifyGuards } from './guard-classifier.js';
import { classifyExpressionPatterns } from './expression-patterns.js';
import { classifyNullGuards } from './null-guard-classifier.js';
import { classifyScalarAccumulators } from './scalar-accumulator-classifier.js';
import { classifyUnreachable } from './unreachable-classifier.js';
import { classifyComposition } from './composition-classifier.js';
import { classifyUnconditionalRows } from './unconditional-row-classifier.js';
import { classifyAttributeUsage } from './attribute-usage-classifier.js';
import { classifyNoOps } from './no-op-classifier.js';
import { classifySinkCandidates } from './sink-candidate-classifier.js';
import { loadClassifierConfig } from './load-classifier-config.js';

/**
 * Runs every classifier against a Phase 2 project model and returns a unified
 * classification result: sinkCandidates (keyed by attribute path) and patterns
 * (an array of PatternFinding objects from the translation-patterns catalog).
 *
 * Classifier ordering matters for exclusion sets:
 * 1. expressionPatterns first — cycle and decision-table classifiers need to skip
 *    rules already explained by expression-level patterns.
 * 2. nullGuards and scalarAccumulators — self-loop classifiers that take priority
 *    over the generic cycle classifier.
 * 3. cycles — only fires on iterative self-loops not already classified above.
 * 4. decisionTableAlternativeRows — non-iterative self-loops not classified by null-guard.
 * 5. Remaining classifiers are independent.
 */
export function classifyProject(project) {
  const ruleflowContext = resolveRuleflowContext(project);
  const classifierConfig = project.projectDir ? loadClassifierConfig(project.projectDir) : {};
  const attributeUsage = classifyAttributeUsage(project);

  // Step 1: expression patterns — needed as exclusion input for later classifiers.
  const expressionPatterns = classifyExpressionPatterns(project);

  // Step 2: null-guard and scalar-accumulator — self-loop classifiers with priority.
  const nullGuards = classifyNullGuards(project);
  const scalarAccumulators = classifyScalarAccumulators(project, ruleflowContext);

  // Exclusion set for the cycle classifier: only null-guard and scalar-accumulator
  // ruleIds explain iterative self-loops. Expression-level patterns (operator-precedence,
  // rounding, etc.) describe the expression shape but do NOT mean the self-loop isn't a
  // genuine cycle — passing them here would suppress real cycles (confirmed: all-patterns'
  // iterative-body.ers cycle would be masked by its operator-precedence classification).
  const selfLoopClassifiedRuleIds = new Set([
    ...nullGuards.map((f) => f.ruleId),
    ...scalarAccumulators.map((f) => f.ruleId),
  ]);

  // Step 3: genuine cycles — iterative self-loops not already classified.
  const cycles = classifyCycles(project, ruleflowContext, selfLoopClassifiedRuleIds);

  // Step 4: decision-table alternative rows — non-iterative self-loops.
  // Expression-pattern ruleIds are excluded (same "basename:N" format).
  const expressionPatternRuleIds = new Set(expressionPatterns.map((f) => f.ruleId));
  const decisionTableAlternativeRows = classifyDecisionTableAlternativeRows(
    project, ruleflowContext, expressionPatternRuleIds,
  );

  // Step 5: remaining independent classifiers.
  const hitPolicyUnverified = classifyHitPolicyUnverified(project);
  const constructors = classifyConstructors(project);
  const calls = classifyCalls(project);
  const guards = classifyGuards(project);
  const noOps = classifyNoOps(project);
  const multiHopCycles = classifyMultiHopCycles(project, ruleflowContext);
  const unreachable = classifyUnreachable(ruleflowContext);
  const composition = classifyComposition(project);
  const unconditionalRows = classifyUnconditionalRows(project);

  const patterns = [
    ...expressionPatterns,
    ...nullGuards,
    ...scalarAccumulators,
    ...cycles,
    ...multiHopCycles,
    ...decisionTableAlternativeRows,
    ...hitPolicyUnverified,
    ...constructors,
    ...calls,
    ...guards,
    ...noOps,
    ...unreachable,
    ...composition,
    ...unconditionalRows,
  ];

  return {
    ruleflowContext: {
      roots: ruleflowContext.roots.map((r) => r.split('/').pop()),
      unreachableRulesheets: ruleflowContext.unreachable.map((r) => r.split('/').pop()),
      multiInvokedRulesheets: ruleflowContext.multiInvoked.map(({ rulesheet, contexts }) => ({
        rulesheet: rulesheet.split('/').pop(),
        contexts,
      })),
    },
    sinkCandidates: classifySinkCandidates(project, ruleflowContext, attributeUsage, classifierConfig),
    patterns,
  };
}
