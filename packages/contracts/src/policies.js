import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(__dirname, '..');

/**
 * Load and merge all `platform-registry-policies*.yaml` files from a directory.
 * Multiple files are merged in sorted filename order; later files override
 * earlier ones at the per-policy-ID level.
 * @param {string} [dir] - Directory to search (defaults to the contracts root)
 * @returns {Record<string, { citation: string, citationUrl?: string, description: string, programs?: string[] }>}
 */
export function loadPolicies(dir = contractsRoot) {
  const files = readdirSync(dir)
    .filter(f => f.startsWith('platform-registry-policies') && f.endsWith('.yaml'))
    .sort();
  const policies = {};
  for (const file of files) {
    const data = yaml.load(readFileSync(join(dir, file), 'utf8'));
    Object.assign(policies, data.policies || {});
  }
  return policies;
}

/** Platform policy registry — all regulatory citations keyed by stable policy ID. */
export const Policies = loadPolicies();
