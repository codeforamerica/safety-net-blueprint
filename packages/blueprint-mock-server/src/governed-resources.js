/**
 * Creates and updates a state machine governs.
 *
 * A machine declares, under `resources:`, guards for its own object and for
 * resources nested under it — a transcript deciding when an entry may be added
 * to it, and that only the system may change one. Creating or updating a
 * nested one runs those guards with `object` the governing record, found from
 * the path, and `request` the body. Creating the machine's own object has no
 * record yet, so only `request`; updating it, `object` is the record being
 * updated. Every machine governing a resource along its path must pass.
 *
 * Which create a machine governs is read from core's model of the API —
 * the resource the machine attaches to, and the resources nested under it —
 * not from collection names.
 */

import { resolveContextLayers } from './handlers/procedure-runner.js';
import { checkGuardClauses } from './state-machine-runner.js';
import { deriveCollectionName } from './collection-utils.js';

/**
 * The machines governing each create and update, by operation, domain and path.
 *
 * @param {Array} stateMachines - From `extract(docs, 'state-machines')`
 * @returns {Map<string, Array<{ entry: object, name: string, operation: object, owner: object }>>}
 *   Keyed `${operation} ${domain} ${path}`: a create by its collection path, an
 *   update by its item path, e.g. `create transcription /transcripts/{transcriptId}/entries`
 */
export function governorsByRoute(stateMachines) {
  const governors = new Map();
  for (const entry of stateMachines ?? []) {
    const declared = entry.machine?.resources;
    if (!declared || !entry.resource) continue;

    const add = (key, governor) => {
      if (!governors.has(key)) governors.set(key, []);
      governors.get(key).push(governor);
    };
    // Its own object: a create has no record to guard with yet, so no owner;
    // an update's record is the one being updated.
    const own = declared[entry.resource.name];
    if (own?.create) {
      add(`create ${entry.domain} ${entry.resource.path('collection')}`, { entry, name: entry.resource.name, operation: own.create, owner: null });
    }
    if (own?.update) {
      add(`update ${entry.domain} ${entry.resource.path('item')}`, { entry, name: entry.resource.name, operation: own.update, owner: entry.resource });
    }
    const visit = (resource) => {
      for (const child of resource.children) {
        const governed = child.name ? declared[child.name] : undefined;
        if (governed?.create) {
          add(`create ${entry.domain} ${child.path('collection')}`, { entry, name: child.name, operation: governed.create, owner: entry.resource });
        }
        if (governed?.update) {
          add(`update ${entry.domain} ${child.path('item')}`, { entry, name: child.name, operation: governed.update, owner: entry.resource });
        }
        visit(child);
      }
    };
    visit(entry.resource);
  }
  return governors;
}

/**
 * Run every governing machine's guards for a create or an update.
 *
 * @param {Object} options
 * @param {Array}  options.governors - This route's, from `governorsByRoute`
 * @param {'creating'|'updating'} options.verb - Names the operation, for the refusal
 * @param {Object} options.params    - The request's path parameters
 * @param {Object} options.body      - The body being created, or the change
 * @param {{ id: string|null, roles: string[] }} options.caller
 * @param {Object} options.store
 * @param {Function} [options.checkBody] - `() => refusal|null`: the body against the operation's schema, after the role check
 * @returns {{ status: number, code: string, message: string, details?: object[] }|null} The refusal, or null when every machine passes
 */
export function checkGoverned({ governors, verb, params, body, caller, store, checkBody }) {
  for (const { entry, name, operation, owner } of governors ?? []) {
    let record = null;
    if (owner) {
      const collection = deriveCollectionName(owner.path('collection'), '');
      record = store.findById(collection, params[owner.item.parameter]);
      if (!record) {
        return { status: 404, code: 'NOT_FOUND', message: `${entry.object} not found` };
      }
    }

    const baseContext = { caller, ...(record ? { object: { ...record } } : {}), request: body, now: new Date().toISOString() };
    const entities = resolveContextLayers(
      [entry.stateMachine.context, entry.machine.context, operation.context],
      record, baseContext, store
    );

    const refused = checkGuardClauses({
      guardItems: operation.guards,
      stateMachine: entry.stateMachine,
      machine: entry.machine,
      callerRoles: caller.roles,
      resource: record,
      context: { ...baseContext, entities },
      label: owner === entry.resource && name === entry.object ? `${verb} this ${name}` : record ? `${verb} a ${name} on this ${entry.object}` : `${verb} a ${name}`,
      checkBody,
    });
    if (refused) {
      const code = { 403: 'FORBIDDEN', 422: 'VALIDATION_ERROR' }[refused.status] ?? 'CONFLICT';
      return { status: refused.status, code, message: refused.error, ...(refused.details ? { details: refused.details } : {}) };
    }
  }
  return null;
}
