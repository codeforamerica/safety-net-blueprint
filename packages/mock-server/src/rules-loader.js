/**
 * Rules loader — discovers and parses rule contracts.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

/**
 * Discover and load all rule contracts from a directory.
 * Looks for files matching *-rules.yaml.
 * @param {string} specsDir - Path to the specs directory
 * @returns {Array<{ domain: string, ruleSets: Array, filePath: string }>}
 */
export function discoverRules(specsDir) {
  let files;
  try {
    files = readdirSync(specsDir);
  } catch {
    return [];
  }

  const results = [];

  for (const file of files) {
    if (!file.endsWith('-rules.yaml')) continue;

    const filePath = join(specsDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const rules = yaml.load(content);

      if (!rules || !rules.domain || !rules.ruleSets) {
        console.warn(`Skipping ${file}: missing domain or ruleSets`);
        continue;
      }

      results.push({
        domain: rules.domain,
        context: rules.context || [],
        ruleSets: rules.ruleSets,
        filePath
      });
    } catch (err) {
      console.warn(`Failed to parse ${file}: ${err.message}`);
    }
  }

  return results;
}

/**
 * Find a specific ruleSet by domain and ruleType.
 * @param {Array} allRules - Array from discoverRules()
 * @param {string} domain - Domain name (e.g., "workflow")
 * @param {string} ruleType - Rule type (e.g., "assignment")
 * @returns {{ ruleSet: Object, context: string[] } | null}
 */
export function findRuleSet(allRules, domain, ruleType) {
  for (const entry of allRules) {
    if (entry.domain !== domain) continue;
    const ruleSet = entry.ruleSets.find(rs => rs.ruleType === ruleType);
    if (ruleSet) {
      return { ruleSet, context: entry.context };
    }
  }
  return null;
}
