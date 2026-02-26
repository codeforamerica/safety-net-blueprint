/**
 * State machine loader — discovers and parses state machine contracts.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

/**
 * Discover and load all state machine contracts from a directory.
 * Looks for files matching *-state-machine.yaml.
 * @param {string} specsDir - Path to the specs directory
 * @returns {Array<{ domain: string, object: string, apiSpec: string, stateMachine: Object, filePath: string }>}
 */
export function discoverStateMachines(specsDir) {
  let files;
  try {
    files = readdirSync(specsDir);
  } catch {
    return [];
  }

  const results = [];

  for (const file of files) {
    if (!file.endsWith('-state-machine.yaml')) continue;

    const filePath = join(specsDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const stateMachine = yaml.load(content);

      if (!stateMachine || !stateMachine.domain || !stateMachine.object) {
        console.warn(`Skipping ${file}: missing domain or object`);
        continue;
      }

      results.push({
        domain: stateMachine.domain,
        object: stateMachine.object,
        apiSpec: stateMachine.apiSpec || null,
        stateMachine,
        filePath
      });
    } catch (err) {
      console.warn(`Failed to parse ${file}: ${err.message}`);
    }
  }

  return results;
}
