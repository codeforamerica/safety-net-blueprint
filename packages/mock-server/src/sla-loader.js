/**
 * SLA types loader — discovers and parses SLA type contracts.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

/**
 * Discover and load all SLA type contracts from a directory.
 * Looks for files matching *-sla-types.yaml.
 * @param {string} specsDir - Path to the specs directory
 * @returns {Array<{ domain: string, slaTypes: Array, filePath: string }>}
 */
export function discoverSlaTypes(specsDir) {
  let files;
  try {
    files = readdirSync(specsDir);
  } catch {
    return [];
  }

  const results = [];

  for (const file of files) {
    if (!file.endsWith('-sla-types.yaml')) continue;

    const filePath = join(specsDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const parsed = yaml.load(content);

      if (!parsed || !parsed.domain || !parsed.slaTypes) {
        console.warn(`Skipping ${file}: missing domain or slaTypes`);
        continue;
      }

      results.push({
        domain: parsed.domain,
        slaTypes: parsed.slaTypes,
        filePath
      });
    } catch (err) {
      console.warn(`Failed to parse ${file}: ${err.message}`);
    }
  }

  return results;
}

/**
 * Find SLA types for a specific domain.
 * @param {Array} allSlaTypes - Array from discoverSlaTypes()
 * @param {string} domain - Domain name (e.g., "workflow")
 * @returns {Array} Array of SLA type objects, or empty array if not found
 */
export function findSlaTypes(allSlaTypes, domain) {
  const entry = allSlaTypes.find(e => e.domain === domain);
  return entry ? entry.slaTypes : [];
}
