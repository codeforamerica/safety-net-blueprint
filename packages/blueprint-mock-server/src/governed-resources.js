/**
 * Creates a state machine governs.
 *
 * A machine declares, under `resources:`, guards for resources nested under its
 * object — a transcript deciding when an entry may be added to it. Creating one
 * runs those guards with `object` the governing record, found from the path,
 * and `request` the body being created. Every machine governing a resource
 * along its path must pass.
 *
 * Which create a machine governs is read from core's model of the API —
 * the resource the machine attaches to, and the resources nested under it —
 * not from collection names.
 */

import { resolveContextLayers } from './handlers/procedure-runner.js';
import { checkGuardClauses } from './state-machine-runner.js';
import { deriveCollectionName } from './collection-utils.js';

/**
 * The machines governing each create, by domain and collection path.
 *
 * @param {Array} stateMachines - From `extract(docs, 'state-machines')`
 * @returns {Map<string, Array<{ entry: object, name: string, create: object, owner: object }>>}
 *   Keyed `${domain} ${collectionPath}`, e.g. `transcription /transcripts/{transcriptId}/entries`
 */
export function governorsByCollection(stateMachines) {
  const governors = new Map();
  for (const entry of stateMachines ?? []) {
    const declared = entry.machine?.resources;
    if (!declared || !entry.resource) continue;

    const visit = (resource) => {
      for (const child of resource.children) {
        const create = child.name ? declared[child.name]?.create : undefined;
        if (create) {
          const key = `${entry.domain} ${child.path('collection')}`;
          if (!governors.has(key)) governors.set(key, []);
          governors.get(key).push({ entry, name: child.name, create, owner: entry.resource });
        }
        visit(child);
      }
    };
    visit(entry.resource);
  }
  return governors;
}

/**
 * Run every governing machine's create guards.
 *
 * @param {Object} options
 * @param {Array}  options.governors - This collection's, from `governorsByCollection`
 * @param {Object} options.params    - The request's path parameters
 * @param {Object} options.body      - The body being created
 * @param {{ id: string|null, roles: string[] }} options.caller
 * @param {Object} options.store
 * @returns {{ status: number, code: string, message: string }|null} The refusal, or null when every machine passes
 */
export function checkGovernedCreate({ governors, params, body, caller, store }) {
  for (const { entry, name, create, owner } of governors ?? []) {
    const collection = deriveCollectionName(owner.path('collection'), '');
    const record = store.findById(collection, params[owner.item.parameter]);
    if (!record) {
      return { status: 404, code: 'NOT_FOUND', message: `${entry.object} not found` };
    }

    const baseContext = { caller, object: { ...record }, request: body, now: new Date().toISOString() };
    const entities = resolveContextLayers(
      [entry.stateMachine.context, entry.machine.context, create.context],
      record, baseContext, store
    );

    const refused = checkGuardClauses({
      guardItems: create.guards,
      stateMachine: entry.stateMachine,
      machine: entry.machine,
      callerRoles: caller.roles,
      resource: record,
      context: { ...baseContext, entities },
      label: `creating a ${name} on this ${entry.object}`,
    });
    if (refused) {
      return { status: refused.status, code: refused.status === 403 ? 'FORBIDDEN' : 'CONFLICT', message: refused.error };
    }
  }
  return null;
}
