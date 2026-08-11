import { classifySinkCandidates } from './sink-candidate-classifier.js';
import { classifyExpressionPatterns } from './expression-patterns.js';
import { classifyScalarAccumulators } from './scalar-accumulator-classifier.js';
import { classifyCycles } from './cycle-classifier.js';
import { classifyComposition } from './composition-classifier.js';
import { classifyNoOps } from './no-op-classifier.js';

/**
 * Runs every rulespec classifier against a loaded rulespec model and returns a unified
 * classification result: sinkCandidates (keyed by fact name) and patterns (an array of
 * PatternFinding objects from the translation-patterns catalog).
 *
 * Classifier ordering: expression patterns first since later classifiers may need to
 * exclude facts already classified at the expression level (e.g. scalar-accumulator
 * rules should not also appear as generic cycles).
 */
export function classifyRulespec(rulespec) {
  const { graph, sinkCandidates } = classifySinkCandidates(rulespec);

  const expressionPatterns = classifyExpressionPatterns(rulespec);
  const scalarAccumulators = classifyScalarAccumulators(rulespec);
  const cycles = classifyCycles(rulespec);
  const composition = classifyComposition(rulespec);
  const noOps = classifyNoOps(rulespec);

  const patterns = [
    ...expressionPatterns,
    ...scalarAccumulators,
    ...cycles,
    ...composition,
    ...noOps,
  ];

  return { graph, sinkCandidates, patterns };
}
