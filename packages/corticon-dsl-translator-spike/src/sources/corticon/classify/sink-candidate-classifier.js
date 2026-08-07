import { isBlankTemplateRule } from '../corticon/rulesheet.js';
import { entriesOf } from '../../../map-utils.js';
import { buildEntityAliasMap } from '../../../graph/attribute-path.js';

/**
 * For each written attribute, computes signals that help identify which are
 * meaningful goal outputs (sink candidates) vs. intermediates or logging artifacts:
 *
 * - rulesheetCount / totalRulesheets: how many distinct rulesheets write to it
 * - ruleCount / totalRules: how many distinct rules (across all rulesheets) write to it
 * - latestPosition / totalPositions: the latest execution position of any rulesheet
 *   that writes to it, expressed as a fraction of the total ruleflow sequence length
 * - isOutput: true if declared in ruleset-config.yaml output_entities
 *
 * All three as x/y fractions so the author can judge relative to the whole project.
 *
 * classifierConfig (optional) is loaded from classifier-config.yaml:
 *   - tempPrefixes: attribute name prefixes that identify temporaries (excluded)
 *   - outputEntities: entity names declared as final outputs (tagged isOutput: true)
 */
export function classifySinkCandidates(project, ruleflowContext, attributeUsage, classifierConfig = {}) {
  const { writes } = attributeUsage;
  const { perRulesheet } = ruleflowContext;
  const aliasMap = buildEntityAliasMap(project);

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

  for (const [rulesheetFile, rulesheet] of entriesOf(project.rulesheets)) {
    const ctx = perRulesheet.get(rulesheetFile);
    const position = ctx?.firstInvocationOrder;

    for (const rule of rulesheet.rules) {
      if (isBlankTemplateRule(rule)) continue;
      for (const action of rule.actions.filter(Boolean)) {
        for (const term of action.modifiedTerms ?? []) {
          const alias = term.parent?.text ?? '';
          if (!alias) continue;
          const entity = aliasMap.get(alias) ?? alias;
          const key = `${entity}.${term.text}`;
          if (!writes.has(key)) continue;

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

  const { tempPrefixes = [], outputEntities = [] } = classifierConfig;
  const outputEntitySet = new Set(outputEntities.map((e) => e.toLowerCase()));

  const candidates = {};
  for (const key of writes) {
    const [entity, attr] = key.split('.');
    const isOutput = outputEntitySet.has(entity.toLowerCase());

    // Exclude temp attributes unless explicitly declared as an output entity
    if (!isOutput && tempPrefixes.some((prefix) => attr.startsWith(prefix))) continue;

    const rulesheetCount = writingRulesheetsByKey.get(key)?.size ?? 0;
    const ruleCount = writingRuleCountByKey.get(key) ?? 0;
    const latestPosition = latestPositionByKey.get(key) ?? null;
    candidates[key] = {
      rulesheetCount,
      totalRulesheets,
      ruleCount,
      totalRules,
      latestPosition,
      totalPositions,
      ...(isOutput ? { isOutput: true } : {}),
    };
  }

  return candidates;
}
