import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

/**
 * Load and merge all `*-policies*.yaml` files from a directory.
 * Multiple files are merged in sorted filename order; later files override
 * earlier ones at the per-policy-ID level.
 * @param {string} dir - Directory to search
 * @returns {Record<string, { citation: string, citationUrl?: string, description: string }>}
 */
export function loadPolicies(dir) {
  const files = readdirSync(dir, { recursive: true })
    .filter(f => typeof f === 'string' && f.includes('-policies') && f.endsWith('.yaml'))
    .sort();
  const policies = {};
  for (const file of files) {
    const data = yaml.load(readFileSync(join(dir, file), 'utf8'));
    Object.assign(policies, data.policies || {});
  }
  return policies;
}
