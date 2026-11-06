/**
 * Every operation a contract set has, and finding one by what names it.
 *
 * A state machine's call, a Suggestion's proposed call, an Arazzo step and a
 * routing entry each name an operation by id. OpenAPI and AsyncAPI make an id
 * unique only within its document, so two documents may declare the same one:
 * two domains that react to the same event each have the same `receive` id.
 * Each of those places used to keep its own map of id to operation, and
 * whichever document it read first won.
 *
 * A reference is one of:
 *
 *   claimTask                                  bare, when one API has it
 *   $apis.workflow.claimTask                   qualified by the API's name
 *   $sourceDescriptions.workflow.claimTask     an Arazzo step's, by its source
 *
 * The API's name is its OpenAPI document's file name without `-openapi.yaml`,
 * which the events AsyncAPI generated beside it shares — so `$apis.workflow`
 * finds an operation in either. A hand-written AsyncAPI document is named
 * without `-asyncapi.yaml`. The `$apis` form is ours, modeled on Arazzo's.
 *
 * The operations resolve generates — state machine actions, composition and
 * rules endpoints, and the events documents — are included whether or not the
 * set has been resolved yet, generated here the way resolve generates them.
 */

import { generatedOverlays, rulesApis, eventsAsyncapis } from './generate.js';

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];
const QUALIFIED = /^\$(apis|sourceDescriptions)\.([^.]+)\.(.+)$/;

/** `domains/workflow/workflow-events-asyncapi.yaml` → `workflow`. */
export function apiNameOf(relativePath) {
  const file = (relativePath ?? '').split('/').pop();
  return file.replace(/-events-asyncapi\.yaml$|-openapi\.yaml$|-asyncapi\.yaml$/, '');
}

/**
 * @typedef {object} Operation
 * @property {string} id - The operationId, or the AsyncAPI operation's key
 * @property {string} api - The name of the API it belongs to
 * @property {string} file - The relative path of the document that declares it
 * @property {'openapi'|'asyncapi'} kind
 * @property {string} [method] - An OpenAPI operation's, upper case
 * @property {string} [path] - An OpenAPI operation's path, as the document writes it
 * @property {'send'|'receive'} [action] - An AsyncAPI operation's
 */

/**
 * @param {import('../types.js').Doc[]} docs - A contract set, resolved or not
 * @returns {{
 *   all: Operation[],
 *   find: (ref: string, options?: { file?: string }) => { operation?: Operation, candidates: Operation[] },
 *   repeated: Operation[],
 * } | null} Null when the set can't be generated, so nothing can be said about it
 */
export function readOperations(docs) {
  const positioned = docs.filter((d) => d.relativePath !== null);
  let overlays; let generatedDocs;
  try {
    overlays = generatedOverlays(positioned);
    generatedDocs = [...rulesApis(positioned), ...eventsAsyncapis(positioned)];
  } catch {
    return null; // The set does not generate; that is reported where it fails.
  }
  // A resolved set already has what resolve generates; a document it wrote
  // is read once.
  const have = new Set(positioned.map((d) => d.relativePath));
  const all = [];
  const repeated = [];
  const inFile = new Map();
  const add = (operation) => {
    const key = `${operation.file}#${operation.id}`;
    const earlier = inFile.get(key);
    if (earlier) {
      // The same path generated onto a set that already has it is the same operation.
      if (earlier.method !== operation.method || earlier.path !== operation.path) repeated.push(operation);
      return;
    }
    inFile.set(key, operation);
    all.push(operation);
  };

  const fromPaths = (paths, file) => {
    for (const [path, item] of Object.entries(paths ?? {})) {
      for (const method of METHODS) {
        const id = item?.[method]?.operationId;
        if (id) add({ id, api: apiNameOf(file), file, kind: 'openapi', method: method.toUpperCase(), path });
      }
    }
  };

  for (const doc of [...positioned, ...generatedDocs.filter((d) => !have.has(d.relativePath))]) {
    if (doc.type === 'openapi') fromPaths(doc.content?.paths, doc.relativePath);
    if (doc.type === 'asyncapi') {
      for (const [id, operation] of Object.entries(doc.content?.operations ?? {})) {
        add({ id, api: apiNameOf(doc.relativePath), file: doc.relativePath, kind: 'asyncapi', action: operation?.action });
      }
    }
  }
  for (const overlay of overlays) {
    for (const action of overlay.actions ?? []) {
      if (action.target === '$.paths' && action.file) fromPaths(action.update, action.file);
    }
  }

  return { all, repeated, find: (ref, options) => findIn(all, ref, options) };
}

/**
 * The operation a reference names. `candidates` holds every operation it
 * could mean: one when it's found, none when nothing has it, and more than
 * one when a bare id is in several APIs and has to be qualified.
 *
 * `$sourceDescriptions.<name>` can't be looked up here, since only the Arazzo
 * document knows which file its source is: pass that file as `options.file`.
 *
 * @param {Operation[]} all
 * @param {string} ref
 * @param {{ file?: string }} [options]
 */
function findIn(all, ref, { file } = {}) {
  const qualified = QUALIFIED.exec(ref ?? '');
  const id = qualified ? qualified[3] : ref;
  let candidates = all.filter((operation) => operation.id === id);
  if (qualified?.[1] === 'apis') candidates = candidates.filter((operation) => operation.api === qualified[2]);
  if (file) {
    // The document named, or the other half of its API, beside it.
    const dir = (path) => path.split('/').slice(0, -1).join('/');
    candidates = candidates.filter((operation) => operation.file === file
      || (operation.api === apiNameOf(file) && dir(operation.file) === dir(file)));
  }
  return { operation: candidates.length === 1 ? candidates[0] : undefined, candidates };
}

/** How to write a reference to an operation that can't be named by its id alone. */
export function qualifiedRef(operation) {
  return `$apis.${operation.api}.${operation.id}`;
}
