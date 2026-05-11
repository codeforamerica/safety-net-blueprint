/**
 * State machine loader — discovers and parses state machine contracts.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

/**
 * Discover and load all state machine contracts from a directory.
 * Looks for files matching *-state-machine.yaml.
 *
 * Supports two formats:
 *   - New: top-level `machines: [{ object, states, operations, triggers, ... }]`
 *   - Old: flat top-level `object:` + `transitions:` (backward compat)
 *
 * Always returns one entry per machine with a `machine` field pointing to the
 * machine-level entry (new format) or the full doc (old format).
 *
 * @param {string} specsDir - Path to the specs directory
 * @returns {Array<{ domain: string, object: string, apiSpec: string, stateMachine: Object, machine: Object, filePath: string }>}
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

      if (!stateMachine || !stateMachine.domain) {
        console.warn(`Skipping ${file}: missing domain`);
        continue;
      }

      // New format: machines: [{ object, states, operations, triggers, ... }]
      if (Array.isArray(stateMachine.machines)) {
        for (const machine of stateMachine.machines) {
          if (!machine.object) {
            console.warn(`Skipping machine in ${file}: missing object`);
            continue;
          }
          results.push({
            domain: stateMachine.domain,
            object: machine.object,
            apiSpec: stateMachine.apiSpec || null,
            stateMachine,
            machine,
            filePath
          });
        }
        continue;
      }

      // Old format: flat object at top level
      if (!stateMachine.object) {
        console.warn(`Skipping ${file}: missing object`);
        continue;
      }

      results.push({
        domain: stateMachine.domain,
        object: stateMachine.object,
        apiSpec: stateMachine.apiSpec || null,
        stateMachine,
        machine: stateMachine,
        filePath
      });
    } catch (err) {
      console.warn(`Failed to parse ${file}: ${err.message}`);
    }
  }

  return results;
}
