/**
 * Config loader — discovers and parses domain configuration files.
 * Looks for files matching *-config.yaml (excluding *-config-schema.yaml).
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

const METADATA_KEYS = new Set(['$schema', 'version', 'domain']);

/**
 * Discover and load all domain config files from a directory.
 * @param {string} specsDir - Path to the specs directory
 * @returns {Array<{ domain: string, version: string, catalogs: Object, filePath: string }>}
 */
export function discoverConfigs(specsDir) {
  let files;
  try {
    files = readdirSync(specsDir);
  } catch {
    return [];
  }

  const results = [];

  for (const file of files) {
    if (!file.endsWith('-config.yaml') || file.endsWith('-config-schema.yaml')) continue;

    const filePath = join(specsDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const config = yaml.load(content);

      if (!config || !config.domain) {
        console.warn(`Skipping ${file}: missing domain`);
        continue;
      }

      // Collect catalog arrays — all top-level keys that are not envelope metadata
      const catalogs = {};
      for (const [key, value] of Object.entries(config)) {
        if (!METADATA_KEYS.has(key) && Array.isArray(value)) {
          catalogs[key] = value;
        }
      }

      results.push({
        domain: config.domain,
        version: config.version,
        catalogs,
        filePath,
      });
    } catch (err) {
      console.warn(`Failed to parse ${file}: ${err.message}`);
    }
  }

  return results;
}
