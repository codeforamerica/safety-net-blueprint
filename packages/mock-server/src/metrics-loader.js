/**
 * Metrics loader — discovers and parses metric definition contracts.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

/**
 * Discover and load all metric definition contracts from a directory.
 * Looks for files matching *-metrics.yaml.
 * @param {string} specsDir - Path to the specs directory
 * @returns {Array<{ domain: string, metrics: Array, filePath: string }>}
 */
export function discoverMetrics(specsDir) {
  let files;
  try {
    files = readdirSync(specsDir);
  } catch {
    return [];
  }

  const results = [];

  for (const file of files) {
    if (!file.endsWith('-metrics.yaml')) continue;

    const filePath = join(specsDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const parsed = yaml.load(content);

      if (!parsed || !parsed.domain || !parsed.metrics) {
        console.warn(`Skipping ${file}: missing domain or metrics`);
        continue;
      }

      results.push({
        domain: parsed.domain,
        metrics: parsed.metrics,
        filePath
      });
    } catch (err) {
      console.warn(`Failed to parse ${file}: ${err.message}`);
    }
  }

  return results;
}
