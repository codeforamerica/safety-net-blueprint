import { basename } from 'node:path';
import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { isBlankTemplateRule } from '../rulesheet.js';
import { entriesOf } from '../../../map-utils.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

/**
 * Finds attribute paths written by more than one distinct rulesheet — the cross-rulesheet
 * Fact assembly / composition pattern (e.g. Person.MedicaidEligible in
 * Parse Cohorts.ers + Flatten.ers). Each contributor is represented as rulesheet:*
 * to indicate the whole rulesheet participates.
 *
 * Null-check-masking rules (null-default pattern) are excluded from the count.
 * A null-default writer provides a placeholder fallback, not a partial fact
 * contribution — including it falsely inflates the writer count and causes the
 * null-default rulesheet to be tagged as composition in the visualizer.
 * The null-check detection is the same heuristic cycle-classifier.js uses:
 * any condition that checks the written path against a literal null.
 */
export function classifyComposition(project) {
  const writesByPath = new Map();
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    rulesheet.rules.forEach((rule) => {
      if (isBlankTemplateRule(rule)) return;
      for (const action of (rule.actions ?? []).filter(Boolean)) {
        for (const writePath of attributePathsIn(action.modifiedTerms)) {
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
    if (rulesheets.size > 1) {
      result.push({
        pattern: 'composition',
        node: path,
        ruleIds: [...rulesheets].map((rs) => `${basename(rs)}:*`),
      });
    }
  }
  return result;
}
