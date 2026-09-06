import { basename } from 'node:path';
import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { isBlankTemplateRule } from '../rulesheet.js';
import { entriesOf } from '../../../map-utils.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

// Corticon's decision-table model represents each condition as a separate column —
// so checking a single condition's own text for a trailing "= null" is reliable.
function isNullCheckOn(path, condition) {
  if (!condition) return false;
  const touchesPath = (condition.referencedTerms ?? []).some((t) => canonicalAttributePath(t) === path);
  return touchesPath && /=\s*null\s*$/.test(condition.text ?? '');
}

/**
 * Finds self-loop rules where a condition guards on the written attribute being null —
 * the null-guard pattern. In a forward-chaining engine this prevents re-firing once a
 * value is set; the pattern is redundant in a declarative target.
 *
 * Variant distinguishes two cases:
 * - `default`: this rule is the sole writer of the attribute across the project.
 *   Compiles to a writable fact with a placeholder (the guarded default value).
 * - `fallback`: other non-null-guard writers of the same attribute exist.
 *   Becomes the final fallback branch of the compiled conditional expression.
 *
 * Note: the `table` variant (a whole decision table where every row guards on null)
 * is not yet detected — it requires rulesheet-level analysis across all rows.
 */
export function classifyNullGuards(project) {
  // First pass: collect all writers per path so we can determine default vs fallback.
  const writersByPath = new Map();
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      for (const action of (rule.actions ?? []).filter(Boolean)) {
        for (const path of attributePathsIn(action.modifiedTerms)) {
          if (!writersByPath.has(path)) writersByPath.set(path, []);
          writersByPath.get(path).push({ rulesheetFile, ruleIndex });
        }
      }
    });
  }

  // Second pass: find self-loops with null-check conditions.
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      const conditionReads = new Set(
        (rule.conditions ?? []).filter(Boolean).flatMap((c) => attributePathsIn(c.referencedTerms)),
      );
      for (const action of (rule.actions ?? []).filter(Boolean)) {
        const writePaths = attributePathsIn(action.modifiedTerms);
        const reads = new Set([...conditionReads, ...attributePathsIn(action.referencedTerms)]);
        for (const path of writePaths) {
          if (!reads.has(path)) continue;
          const hasNullCheck = (rule.conditions ?? []).filter(Boolean).some((c) => isNullCheckOn(path, c));
          if (!hasNullCheck) continue;
          const allWriters = writersByPath.get(path) ?? [];
          const otherWriters = allWriters.filter(
            (w) => !(w.rulesheetFile === rulesheetFile && w.ruleIndex === ruleIndex),
          );
          const variant = otherWriters.length === 0 ? 'default' : 'fallback';
          result.push({ pattern: 'null-guard', variant, node: path, ruleId: `${basename(rulesheetFile)}:${ruleIndex}` });
        }
      }
    });
  }
  return result;
}
