import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import yaml from 'js-yaml';

/**
 * Loads classifier config for a given project directory by looking for
 * `classifier-config.yaml` files at two levels:
 *
 * - Ancestor-level: walks up from projectDir until it finds a classifier-config.yaml,
 *   picking up shared conventions (e.g. temp_prefixes) that apply across all rulesets
 *   in a directory tree.
 * - Ruleset-level: reads classifier-config.yaml directly from projectDir for
 *   ruleset-specific declarations (e.g. output_entities).
 *
 * Returns a merged config object with:
 *   - tempPrefixes: string[]   — attribute name prefixes that indicate temporaries
 *   - outputEntities: string[] — entity names declared as final outputs for this ruleset
 */
export function loadClassifierConfig(projectDir) {
  const tempPrefixes = [];
  const outputEntities = [];

  // Walk up from projectDir's parent to find an ancestor classifier-config.yaml
  let dir = dirname(projectDir);
  while (true) {
    const candidate = join(dir, 'classifier-config.yaml');
    if (existsSync(candidate)) {
      const raw = yaml.load(readFileSync(candidate, 'utf-8')) ?? {};
      tempPrefixes.push(...(raw.temp_prefixes ?? []));
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Ruleset-level config lives directly in projectDir
  const rulesetConfig = join(projectDir, 'classifier-config.yaml');
  if (existsSync(rulesetConfig)) {
    const raw = yaml.load(readFileSync(rulesetConfig, 'utf-8')) ?? {};
    outputEntities.push(...(raw.output_entities ?? []));
  }

  return { tempPrefixes, outputEntities };
}
