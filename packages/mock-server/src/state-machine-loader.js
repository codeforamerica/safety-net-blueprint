/**
 * State machine loader — discovers and parses state machine contracts.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import yaml from 'js-yaml';

/**
 * Resolve a JSON Schema-style $ref to an external YAML file.
 * Supports fragment pointers like ./schemas/foo.yaml#/$defs/Bar.
 */
function resolveRef(ref, baseFilePath) {
  const hashIdx = ref.indexOf('#');
  const filePart = hashIdx >= 0 ? ref.slice(0, hashIdx) : ref;
  const hashPart = hashIdx >= 0 ? ref.slice(hashIdx + 1) : '';
  if (!filePart) return null;
  try {
    const fullPath = resolve(dirname(baseFilePath), filePart);
    const doc = yaml.load(readFileSync(fullPath, 'utf8'));
    if (!hashPart) return doc;
    const parts = hashPart.split('/').filter(Boolean);
    let cur = doc;
    for (const p of parts) { cur = cur?.[p]; }
    return cur ?? null;
  } catch {
    return null;
  }
}

/**
 * Merge two arrays of objects by id, with overrides taking precedence.
 */
function mergeById(base = [], overrides = []) {
  const map = new Map((base || []).map(item => [item.id, item]));
  for (const item of (overrides || [])) map.set(item.id, item);
  return [...map.values()];
}

/**
 * Resolve the `extends:` field on a state machine, merging the extended file's
 * guards and procedures into `stateMachine._platformGuards` and
 * `stateMachine._platformProcedures`. Domain-level definitions take precedence.
 */
function resolveExtends(stateMachine, filePath) {
  if (!stateMachine.extends) return;
  try {
    const extPath = resolve(dirname(filePath), stateMachine.extends);
    if (!existsSync(extPath)) {
      console.warn(`extends: "${stateMachine.extends}" not found at ${extPath}`);
      return;
    }
    const extDoc = yaml.load(readFileSync(extPath, 'utf8'));
    if (!extDoc) return;
    stateMachine._platformGuards = extDoc.guards || [];
    stateMachine._platformProcedures = extDoc.procedures || [];
  } catch (e) {
    console.warn(`Failed to resolve extends "${stateMachine.extends}": ${e.message}`);
  }
}

/**
 * Resolve $refs in transition schema (request/response) in place.
 */
function resolveRequestBodyRefs(stateMachine, filePath) {
  for (const machine of (stateMachine.machines || [])) {
    for (const transition of (machine.transitions || [])) {
      if (transition.schema?.request?.$ref) {
        const resolved = resolveRef(transition.schema.request.$ref, filePath);
        if (resolved) transition.schema.request = resolved;
      }
      if (transition.schema?.response?.$ref) {
        const resolved = resolveRef(transition.schema.response.$ref, filePath);
        if (resolved) transition.schema.response = resolved;
      }
    }
  }
}

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

      // New format: machines: [{ object, states, transitions, events, ... }]
      if (Array.isArray(stateMachine.machines)) {
        resolveExtends(stateMachine, filePath);
        resolveRequestBodyRefs(stateMachine, filePath);
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
