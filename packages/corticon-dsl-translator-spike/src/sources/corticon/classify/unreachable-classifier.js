import { basename } from 'node:path';

/**
 * Converts the ruleflow execution context's unreachable rulesheet list into
 * PatternFinding objects with pattern "unreachable". A rulesheet is unreachable
 * when no execution path in any ruleflow ever invokes it; its output is excluded
 * from fact compilation.
 *
 * ruleflowContext.unreachable is already computed by resolveRuleflowContext —
 * this classifier just formats it as findings.
 */
export function classifyUnreachable(ruleflowContext) {
  return ruleflowContext.unreachable.map((rulesheetFile) => ({
    pattern: 'unreachable',
    ruleId: `${basename(rulesheetFile)}:*`,
  }));
}
