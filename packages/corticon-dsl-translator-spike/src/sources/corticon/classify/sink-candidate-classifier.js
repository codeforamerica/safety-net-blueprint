import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { isBlankTemplateRule } from '../corticon/rulesheet.js';
import { entriesOf } from '../../../map-utils.js';

/**
 * For each written attribute, computes signals that help identify which are
 * meaningful goal outputs (sink candidates) vs. intermediates or logging artifacts:
 *
 * - rulesheetCount / totalRulesheets: how many distinct rulesheets write to it
 * - ruleCount / totalRules: how many distinct rules (across all rulesheets) write to it
 * - latestPosition / totalPositions: the latest execution position of any rulesheet
 *   that writes to it, expressed as a fraction of the total ruleflow sequence length
 *
 * All three as x/y fractions so the author can judge relative to the whole project.
 */
export function classifySinkCandidates(project, ruleflowContext, attributeUsage) {
  const { writes } = attributeUsage;
  const { perRulesheet } = ruleflowContext;

  // Count total rulesheets and total rules across the project for denominators.
  const totalRulesheets = entriesOf(project.rulesheets).length;
  let totalRules = 0;
  for (const [, rulesheet] of entriesOf(project.rulesheets)) {
    for (const rule of rulesheet.rules) {
      if (!isBlankTemplateRule(rule)) totalRules++;
    }
  }

  // Total ruleflow sequence length — the highest firstInvocationOrder seen.
  let totalPositions = 0;
  for (const ctx of perRulesheet.values()) {
    if (ctx.firstInvocationOrder !== undefined) {
      totalPositions = Math.max(totalPositions, ctx.firstInvocationOrder);
    }
  }

  // For each written attribute, scan all rules to collect which rulesheets and
  // rules write to it, and find the latest execution position among them.
  const writingRulesheetsByKey = new Map();
  const writingRuleCountByKey = new Map();
  const latestPositionByKey = new Map();
  const canonicalPathByKey = new Map();

  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    const ctx = perRulesheet.get(rulesheetFile);
    const position = ctx?.firstInvocationOrder;

    for (const rule of rulesheet.rules) {
      if (isBlankTemplateRule(rule)) continue;
      for (const action of rule.actions.filter(Boolean)) {
        for (const term of action.modifiedTerms ?? []) {
          const entity = term.parent?.text ?? '';
          if (!entity) continue;
          const key = `${entity}.${term.text}`;
          if (!writes[key]) continue;

          if (!canonicalPathByKey.has(key)) {
            const canonical = canonicalAttributePath(term)
              ?? (term.termtype === 'ENTITY' && term.fulltext?.includes('.') ? term.fulltext : null);
            if (canonical) canonicalPathByKey.set(key, canonical);
          }

          if (!writingRulesheetsByKey.has(key)) writingRulesheetsByKey.set(key, new Set());
          writingRulesheetsByKey.get(key).add(rulesheetFile);

          writingRuleCountByKey.set(key, (writingRuleCountByKey.get(key) ?? 0) + 1);

          if (position !== undefined) {
            const current = latestPositionByKey.get(key);
            if (current === undefined || position > current) {
              latestPositionByKey.set(key, position);
            }
          }
        }
      }
    }
  }

  const candidates = {};
  for (const [key, info] of Object.entries(writes)) {
    const rulesheetCount = writingRulesheetsByKey.get(key)?.size ?? 0;
    const ruleCount = writingRuleCountByKey.get(key) ?? 0;
    const latestPosition = latestPositionByKey.get(key) ?? null;
    candidates[key] = {
      ...info,
      canonicalPath: canonicalPathByKey.get(key) ?? null,
      rulesheetCount,
      totalRulesheets,
      ruleCount,
      totalRules,
      latestPosition,
      totalPositions,
    };
  }

  return candidates;
}
