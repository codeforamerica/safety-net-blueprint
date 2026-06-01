import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(__dirname, '..');

/**
 * Load and merge all `{domain}-annotations*.yaml` files from a directory.
 * Multiple files for the same domain are merged in sorted filename order;
 * later files override earlier ones at the per-key level within each section.
 * @param {string} domain - Domain name (e.g. 'intake')
 * @param {string} [dir] - Directory to search (defaults to the contracts root)
 * @returns {{ schema: Record<string, object>, operations: Record<string, object>, events: Record<string, object> }}
 */
export function loadAnnotations(domain, dir = contractsRoot) {
  const files = readdirSync(dir)
    .filter(f => f.startsWith(`${domain}-annotations`) && f.endsWith('.yaml'))
    .sort();
  const merged = { schema: {}, operations: {}, events: {} };
  for (const file of files) {
    const data = yaml.load(readFileSync(join(dir, file), 'utf8'));
    Object.assign(merged.schema, data.schema || {});
    Object.assign(merged.operations, data.operations || {});
    Object.assign(merged.events, data.events || {});
  }
  return merged;
}

/** Intake domain annotations — schema fields, state machine operations, and AsyncAPI events. */
export const IntakeAnnotations = loadAnnotations('intake');
