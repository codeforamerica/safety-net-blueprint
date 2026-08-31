import { basename } from 'node:path';
import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { isBlankTemplateRule } from '../rulesheet.js';
import { entriesOf } from '../../../map-utils.js';

function attributePathsIn(terms) {
  return (terms ?? []).map(canonicalAttributePath).filter(Boolean);
}

// A collection-accumulation rule has the shape:
//   condition: collection.counted = null (or similar per-item guard)
//   action:    Parent.total = Parent.total + collection.field
// In Corticon forward-chaining, this fires once per matching entity instance.
// In reverse-chaining it translates directly to sum(collection, 'field').
// Detected by: the accumulating action reads an attribute on a DIFFERENT entity
// than the one it writes (the collection item entity vs. the parent entity).
function isCollectionAccumulation(path, rule) {
  const writtenEntity = path.split('.')[0];
  for (const action of (rule?.actions ?? []).filter(Boolean)) {
    const writePaths = attributePathsIn(action.modifiedTerms);
    if (!writePaths.includes(path)) continue;
    const actionReads = attributePathsIn(action.referencedTerms);
    if (!actionReads.includes(path)) continue;
    const otherEntityRead = actionReads.some((r) => r.split('.')[0] !== writtenEntity);
    if (otherEntityRead) return true;
  }
  return false;
}

/**
 * Finds self-loop rules in iterative rulesheets where an action accumulates a running
 * total into a scalar attribute across multiple entity-scoped firings — the
 * scalar-accumulator pattern. In a forward-chaining engine this fires once per
 * matching entity instance; in a declarative target it translates to a collection
 * aggregation (e.g. sum(collection, 'field')).
 *
 * Only emitted for iterative rulesheets: the same self-loop in a non-iterative
 * rulesheet is classified differently (null-guard or decision-table-alternative-row).
 */
export function classifyScalarAccumulators(project, ruleflowContext) {
  const result = [];
  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    if (!ruleflowContext.perRulesheet.get(rulesheetFile)?.iterative) continue;
    rulesheet.rules.forEach((rule, ruleIndex) => {
      if (isBlankTemplateRule(rule)) return;
      const conditionReads = new Set(
        (rule.conditions ?? []).filter(Boolean).flatMap((c) => attributePathsIn(c.referencedTerms)),
      );
      for (const action of (rule.actions ?? []).filter(Boolean)) {
        const writePaths = attributePathsIn(action.modifiedTerms);
        const reads = new Set([...conditionReads, ...attributePathsIn(action.referencedTerms)]);
        for (const path of writePaths) {
          if (reads.has(path) && isCollectionAccumulation(path, rule)) {
            result.push({ pattern: 'scalar-accumulator', node: path, ruleId: `${basename(rulesheetFile)}:${ruleIndex}` });
          }
        }
      }
    });
  }
  return result;
}
